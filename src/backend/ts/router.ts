import { ANY_METHOD, BUILTIN_METHOD_ORDER, DEFAULT_OPTIONS } from "../../constants.js"
import { InvalidPathError, RouteConflictError } from "../../errors.js"
import type {
  LookupHandler,
  MatchResult,
  PreparedMethod,
  PreparedPathname,
  Router,
  RouterOptions,
} from "../../types.js"
import { assertStoreId } from "../../internal/assert.js"
import { findAllowedMethodsCompiled } from "./allowed.js"
import {
  compileRouterRuntime,
  type CompiledMethodRuntime,
  type CompiledRouterRuntime,
} from "./compiler.js"
import {
  createRouteDefinition,
  getExactStaticPath,
  isExactStaticRoute,
  type RouteDefinition,
} from "./ir.js"
import {
  normalizeMethod,
  normalizeRouteTemplate,
  type ParsedSegment,
  parseRoutePath,
  prepareLookupPath,
  type Segment,
} from "./normalize.js"

type PreparedMethodBinding = {
  version: number
  specificRuntime: CompiledMethodRuntime | null
  anyRuntime: CompiledMethodRuntime | null
}

class PreparedMethodHandle implements PreparedMethod {
  readonly name: string
  private readonly readBinding: (currentVersion: number) => PreparedMethodBinding | null
  private specificRuntime: CompiledMethodRuntime | null = null
  private anyRuntime: CompiledMethodRuntime | null = null
  private bindingVersion = -1
  private readonly anyMethod

  constructor(
    name: string,
    readBinding: (currentVersion: number) => PreparedMethodBinding | null,
  ) {
    this.name = name
    this.readBinding = readBinding
    this.anyMethod = name === ANY_METHOD
  }

  find(pathname: PreparedPathname): MatchResult | null {
    this.refreshBinding()
    const { rawPathname, matchPathname } = resolvePreparedPathname(pathname)
    const primaryRuntime = this.anyMethod ? this.anyRuntime : this.specificRuntime
    const specificMatch = primaryRuntime?.find(rawPathname, matchPathname) ?? null
    if (specificMatch || this.anyMethod) {
      return specificMatch
    }

    return this.anyRuntime?.find(rawPathname, matchPathname) ?? null
  }

  lookup(pathname: PreparedPathname, onMatch: LookupHandler): boolean {
    if (typeof onMatch !== "function") {
      throw new TypeError("onMatch must be a function")
    }

    this.refreshBinding()
    const { rawPathname, matchPathname } = resolvePreparedPathname(pathname)
    const primaryRuntime = this.anyMethod ? this.anyRuntime : this.specificRuntime
    if (primaryRuntime?.lookup(rawPathname, matchPathname, onMatch)) {
      return true
    }

    if (this.anyMethod) {
      return false
    }

    return this.anyRuntime?.lookup(rawPathname, matchPathname, onMatch) ?? false
  }

  private refreshBinding(): void {
    const nextBinding = this.readBinding(this.bindingVersion)
    if (!nextBinding) {
      return
    }

    this.bindingVersion = nextBinding.version
    this.specificRuntime = nextBinding.specificRuntime
    this.anyRuntime = nextBinding.anyRuntime
  }
}

export class RouteCoreRouter implements Router {
  private readonly customMethodOrder: string[] = []
  private readonly options: Required<RouterOptions>
  private readonly routes: RouteDefinition[] = []
  private compiledRuntime: CompiledRouterRuntime | null = null
  private runtimeVersion = 0
  private dirty = true

  constructor(options: RouterOptions = {}) {
    this.options = {
      ignoreTrailingSlash: options.ignoreTrailingSlash ?? DEFAULT_OPTIONS.ignoreTrailingSlash,
      caseSensitive: options.caseSensitive ?? DEFAULT_OPTIONS.caseSensitive,
      maxParamLength: options.maxParamLength ?? DEFAULT_OPTIONS.maxParamLength,
      allowWildcard: options.allowWildcard ?? DEFAULT_OPTIONS.allowWildcard,
    }

    if (!Number.isSafeInteger(this.options.maxParamLength) || this.options.maxParamLength < 0) {
      throw new InvalidPathError("maxParamLength must be a non-negative safe integer")
    }
  }

  add(method: string, path: string, storeId: number): void {
    const normalizedMethod = normalizeMethod(method)
    const routePath = normalizeRouteTemplate(path, this.options)
    const routeSegments = parseRoutePath(path, this.options)
    assertStoreId(storeId)
    this.registerMethodOrder(normalizedMethod)

    const routeDefinitions = createRouteDefinitions(
      normalizedMethod,
      routePath,
      routeSegments,
      storeId,
    )
    assertNoRouteConflicts(this.routes, routeDefinitions)
    this.routes.push(...routeDefinitions)
    this.dirty = true
  }

  find(method: string, path: string): MatchResult | null {
    const normalizedMethod = normalizeMethod(method)
    const preparedPath = this.preparePathname(path)
    if (!preparedPath) {
      return null
    }

    return this.findByNormalizedMethod(normalizedMethod, preparedPath)
  }

  lookup(method: string, path: string, onMatch: LookupHandler): boolean {
    if (typeof onMatch !== "function") {
      throw new TypeError("onMatch must be a function")
    }

    const normalizedMethod = normalizeMethod(method)
    const preparedPath = this.preparePathname(path)
    if (!preparedPath) {
      return false
    }

    return this.lookupByNormalizedMethod(normalizedMethod, preparedPath, onMatch)
  }

  allowed(path: string): string[] | null {
    const preparedPath = this.preparePathname(path)
    if (!preparedPath) {
      return null
    }

    return this.allowedPrepared(preparedPath)
  }

  prepareMethod(method: string): PreparedMethod {
    const normalizedMethod = normalizeMethod(method)
    return new PreparedMethodHandle(
      normalizedMethod,
      (currentVersion) => this.readPreparedMethodBinding(normalizedMethod, currentVersion),
    )
  }

  preparePathname(path: string): PreparedPathname | null {
    return prepareLookupPath(path, this.options)
  }

  findPrepared(method: PreparedMethod, pathname: PreparedPathname): MatchResult | null {
    return method.find(pathname)
  }

  lookupPrepared(
    method: PreparedMethod,
    pathname: PreparedPathname,
    onMatch: LookupHandler,
  ): boolean {
    return method.lookup(pathname, onMatch)
  }

  allowedPrepared(pathname: PreparedPathname): string[] | null {
    return findAllowedMethodsCompiled(
      this.ensureCompiled().methods,
      this.methodScanOrder(),
      pathname,
    )
  }

  private ensureCompiled(): CompiledRouterRuntime {
    if (!this.dirty && this.compiledRuntime) {
      return this.compiledRuntime
    }

    this.compiledRuntime = compileRouterRuntime(this.routes, this.options.maxParamLength)
    this.runtimeVersion += 1
    this.dirty = false
    return this.compiledRuntime
  }

  private registerMethodOrder(method: string): void {
    if (method !== ANY_METHOD && !BUILTIN_METHOD_ORDER.includes(method) && !this.customMethodOrder.includes(method)) {
      this.customMethodOrder.push(method)
    }
  }

  private methodScanOrder(): string[] {
    return [...BUILTIN_METHOD_ORDER, ...this.customMethodOrder]
  }

  private readPreparedMethodBinding(
    normalizedMethod: string,
    currentVersion: number,
  ): PreparedMethodBinding | null {
    if (!this.dirty && this.compiledRuntime && currentVersion === this.runtimeVersion) {
      return null
    }

    const runtime = this.ensureCompiled()
    return {
      version: this.runtimeVersion,
      specificRuntime: runtime.methods.get(normalizedMethod) ?? null,
      anyRuntime: runtime.anyMethod,
    }
  }

  private findByNormalizedMethod(
    normalizedMethod: string,
    pathname: PreparedPathname,
  ): MatchResult | null {
    const runtime = this.ensureCompiled()
    const { rawPathname, matchPathname } = resolvePreparedPathname(pathname)
    const normalizedMatch = runtime.methods.get(normalizedMethod)?.find(
      rawPathname,
      matchPathname,
    ) ?? null

    if (normalizedMatch || normalizedMethod === ANY_METHOD) {
      return normalizedMatch
    }

    return runtime.anyMethod?.find(rawPathname, matchPathname) ?? null
  }

  private lookupByNormalizedMethod(
    normalizedMethod: string,
    pathname: PreparedPathname,
    onMatch: LookupHandler,
  ): boolean {
    const runtime = this.ensureCompiled()
    const { rawPathname, matchPathname } = resolvePreparedPathname(pathname)

    if (runtime.methods.get(normalizedMethod)?.lookup(
      rawPathname,
      matchPathname,
      onMatch,
    )) {
      return true
    }

    if (normalizedMethod === ANY_METHOD) {
      return false
    }

    return runtime.anyMethod?.lookup(rawPathname, matchPathname, onMatch) ?? false
  }
}

function resolvePreparedPathname(pathname: PreparedPathname): {
  rawPathname: string
  matchPathname: string
} {
  if (typeof pathname === "string") {
    return {
      rawPathname: pathname,
      matchPathname: pathname,
    }
  }

  return pathname
}

type ExpandedRouteVariant = {
  segments: Segment[]
  priority: number
  allowExactStaticOverlap: boolean
}

function createRouteDefinitions(
  method: string,
  routePath: string,
  parsedSegments: ParsedSegment[],
  storeId: number,
): RouteDefinition[] {
  return expandParsedSegments(parsedSegments).map((variant) => createRouteDefinition(
    method,
    routePath,
    variant.segments,
    storeId,
    {
      priority: variant.priority,
      allowExactStaticOverlap: variant.allowExactStaticOverlap,
    },
  ))
}

function expandParsedSegments(parsedSegments: ParsedSegment[]): ExpandedRouteVariant[] {
  const tail = parsedSegments[parsedSegments.length - 1]
  if (tail?.kind !== "optional-param") {
    return [{
      segments: parsedSegments as Segment[],
      priority: 1,
      allowExactStaticOverlap: false,
    }]
  }

  const headSegments = parsedSegments.slice(0, -1) as Segment[]
  return [
    {
      segments: headSegments,
      priority: 0,
      allowExactStaticOverlap: true,
    },
    {
      segments: [...headSegments, { kind: "param", name: tail.name }],
      priority: 1,
      allowExactStaticOverlap: false,
    },
  ]
}

function assertNoRouteConflicts(
  existingRoutes: readonly RouteDefinition[],
  newRoutes: readonly RouteDefinition[],
): void {
  const newMethods = new Set(newRoutes.map((route) => route.method))
  const existingByMethod = new Map<string, RouteDefinition[]>()

  for (const route of existingRoutes) {
    if (!newMethods.has(route.method)) {
      continue
    }
    const bucket = existingByMethod.get(route.method)
    if (bucket) {
      bucket.push(route)
    } else {
      existingByMethod.set(route.method, [route])
    }
  }

  for (const route of newRoutes) {
    const existing = existingByMethod.get(route.method) ?? []
    for (const candidate of existing) {
      if (routesConflict(candidate, route)) {
        throw new RouteConflictError()
      }
    }
  }

  for (let index = 0; index < newRoutes.length; index++) {
    for (let compareIndex = index + 1; compareIndex < newRoutes.length; compareIndex++) {
      if (routesConflict(newRoutes[index]!, newRoutes[compareIndex]!)) {
        throw new RouteConflictError()
      }
    }
  }
}

function routesConflict(left: RouteDefinition, right: RouteDefinition): boolean {
  if (left.method !== right.method) {
    return false
  }

  if (!sameRouteShape(left.segments, right.segments)) {
    return false
  }

  if (canCoexistAsOptionalStaticOverlap(left, right)) {
    return false
  }

  return true
}

function sameRouteShape(left: readonly Segment[], right: readonly Segment[]): boolean {
  if (left.length !== right.length) {
    return false
  }

  for (let index = 0; index < left.length; index++) {
    const leftSegment = left[index]!
    const rightSegment = right[index]!
    if (segmentConflictKey(leftSegment) !== segmentConflictKey(rightSegment)) {
      return false
    }
  }

  return true
}

function segmentConflictKey(segment: Segment): string {
  switch (segment.kind) {
    case "static":
      return `static:${segment.key}`
    case "param":
      return "param"
    case "pattern":
      return `pattern:${segment.signature}`
    case "wildcard":
      return "wildcard"
    default:
      return "unknown"
  }
}

function canCoexistAsOptionalStaticOverlap(left: RouteDefinition, right: RouteDefinition): boolean {
  if (!isExactStaticRoute(left) || !isExactStaticRoute(right)) {
    return false
  }

  if (left.allowExactStaticOverlap === right.allowExactStaticOverlap) {
    return false
  }

  return getExactStaticPath(left) === getExactStaticPath(right)
}
