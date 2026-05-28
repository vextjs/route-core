import type { MatchResult } from "../../types.js"
import type { RouteDefinition } from "./ir.js"
import { isExactStaticRoute } from "./ir.js"
import { compileDynamicMatcher } from "./codegen-dynamic.js"
import { compileStaticDispatcher } from "./codegen-static.js"
import { createDynamicScannerRuntime, createExactStaticMapRuntime } from "./runtime-fallback.js"
import type { LookupHandler } from "./trie.js"

const MAX_GENERATED_STATIC_ROUTES = 128
const MAX_GENERATED_DYNAMIC_ROUTES = 128
const MAX_ROOT_DISPATCH_ROOTS = 32

export type CompiledMethodRuntime = {
  find: (rawPath: string, matchPath: string) => MatchResult | null
  lookup: (rawPath: string, matchPath: string, onMatch: LookupHandler) => boolean
  matches: (rawPath: string, matchPath: string) => boolean
  meta: {
    staticRouteCount: number
    dynamicRouteCount: number
    sourceLength: number
  }
}

export type CompiledRouterRuntime = {
  methods: Map<string, CompiledMethodRuntime>
  anyMethod: CompiledMethodRuntime | null
  meta: {
    compileDurationMs: number
  }
}

export function compileRouterRuntime(
  routes: RouteDefinition[],
  maxParamLength: number,
): CompiledRouterRuntime {
  const startedAt = globalThis.performance?.now?.() ?? Date.now()
  const grouped = groupRoutesByMethod(routes)
  const methods = new Map<string, CompiledMethodRuntime>()
  let anyMethod: CompiledMethodRuntime | null = null

  for (const [method, methodRoutes] of grouped) {
    const compiled = compileMethodRoutes(methodRoutes, maxParamLength)
    if (method === "ANY") {
      anyMethod = compiled
      continue
    }
    methods.set(method, compiled)
  }

  const finishedAt = globalThis.performance?.now?.() ?? Date.now()
  return {
    methods,
    anyMethod,
    meta: {
      compileDurationMs: finishedAt - startedAt,
    },
  }
}

function groupRoutesByMethod(routes: RouteDefinition[]): Map<string, RouteDefinition[]> {
  const grouped = new Map<string, RouteDefinition[]>()

  for (const route of routes) {
    const bucket = grouped.get(route.method)
    if (bucket) {
      bucket.push(route)
      continue
    }
    grouped.set(route.method, [route])
  }

  return grouped
}

function compileMethodRoutes(
  routes: RouteDefinition[],
  maxParamLength: number,
): CompiledMethodRuntime {
  const staticRoutes = routes.filter(isExactStaticRoute)
  const dynamicRoutes = routes.filter((route) => !isExactStaticRoute(route))

  const staticRuntime = staticRoutes.length > MAX_GENERATED_STATIC_ROUTES
    ? { ...createExactStaticMapRuntime(staticRoutes), sourceLength: 0 }
    : compileStaticDispatcher(staticRoutes)
  const dynamicRuntime = dynamicRoutes.length > MAX_GENERATED_DYNAMIC_ROUTES
    ? { ...createDynamicScannerRuntime(dynamicRoutes, maxParamLength), sourceLength: 0 }
    : compileDynamicMatcher(dynamicRoutes, maxParamLength)
  const methodDispatch = createMethodDispatch(staticRoutes, dynamicRoutes)

  return {
    find(rawPath, matchPath) {
      const dispatch = methodDispatch.classify(matchPath)
      if (dispatch === "dynamic-only") {
        return dynamicRuntime.find(rawPath, matchPath)
      }
      if (dispatch === "miss") {
        return null
      }
      if (dispatch === "static-only") {
        return staticRuntime.find(rawPath, matchPath)
      }

      const staticMatch = staticRuntime.find(rawPath, matchPath)
      if (staticMatch) {
        return staticMatch
      }

      return dynamicRuntime.find(rawPath, matchPath)
    },
    lookup(rawPath, matchPath, onMatch) {
      const dispatch = methodDispatch.classify(matchPath)
      if (dispatch === "dynamic-only") {
        return dynamicRuntime.lookup(rawPath, matchPath, onMatch)
      }
      if (dispatch === "miss") {
        return false
      }
      if (dispatch === "static-only") {
        return staticRuntime.lookup(rawPath, matchPath, onMatch)
      }

      if (staticRuntime.lookup(rawPath, matchPath, onMatch)) {
        return true
      }

      return dynamicRuntime.lookup(rawPath, matchPath, onMatch)
    },
    matches(rawPath, matchPath) {
      const dispatch = methodDispatch.classify(matchPath)
      if (dispatch === "dynamic-only") {
        return dynamicRuntime.find(rawPath, matchPath) !== null
      }
      if (dispatch === "miss") {
        return false
      }
      if (dispatch === "static-only") {
        return staticRuntime.find(rawPath, matchPath) !== null
      }

      if (staticRuntime.find(rawPath, matchPath)) {
        return true
      }

      return dynamicRuntime.find(rawPath, matchPath) !== null
    },
    meta: {
      staticRouteCount: staticRoutes.length,
      dynamicRouteCount: dynamicRoutes.length,
      sourceLength: staticRuntime.sourceLength + dynamicRuntime.sourceLength,
    },
  }
}

type DispatchAction = "fallback" | "static-only" | "dynamic-only" | "miss"

type PrefixHint = {
  prefix: string
  slashPrefix: string
  exactOrSlashPrefix: boolean
  secondCharCode: number
}

type MethodDispatch = {
  classify: (matchPath: string) => DispatchAction
}

type DispatchPlan = {
  hints: PrefixHint[]
  knownSecondCharCodes: number[]
  rootPathAction: DispatchAction
  knownSecondCharMissAction: DispatchAction
  unknownSecondCharMissAction: DispatchAction
}

function createMethodDispatch(
  staticRoutes: RouteDefinition[],
  dynamicRoutes: RouteDefinition[],
): MethodDispatch {
  const plan = createDispatchPlan(staticRoutes, dynamicRoutes)
  if (!plan) {
    return {
      classify: () => dynamicRoutes.length === 0 ? "static-only" : "fallback",
    }
  }

  return {
    classify: compilePrefixDispatchClassifier(plan),
  }
}

function createDispatchPlan(
  staticRoutes: RouteDefinition[],
  dynamicRoutes: RouteDefinition[],
): DispatchPlan | null {
  const staticRoots = new Set<string>()
  let hasRootlessStatic = false
  for (const route of staticRoutes) {
    const first = route.segments[0]
    if (first?.kind === "static") {
      staticRoots.add(first.key)
      continue
    }
    hasRootlessStatic = true
  }

  const hints: PrefixHint[] = []
  const knownSecondCharCodes = new Set<number>()
  let hasNonHintDynamicRoute = false
  let hasRootlessDynamicRoute = false

  for (const rootKey of staticRoots) {
    knownSecondCharCodes.add(rootKey.charCodeAt(0))
  }

  for (const route of dynamicRoutes) {
    const first = route.segments[0]
    if (!first || first.kind !== "static") {
      hasNonHintDynamicRoute = true
      hasRootlessDynamicRoute = true
      continue
    }

    knownSecondCharCodes.add(first.key.charCodeAt(0))

    if (staticRoots.has(first.key)) {
      hasNonHintDynamicRoute = true
      continue
    }

    const prefix = `/${first.key}`
    const exactOrSlashPrefix = route.segments.length > 1 && route.segments[1]?.kind === "wildcard"
    if (!hints.some((hint) => hint.prefix === prefix && hint.exactOrSlashPrefix === exactOrSlashPrefix)) {
      hints.push({
        prefix,
        slashPrefix: `${prefix}/`,
        exactOrSlashPrefix,
        secondCharCode: prefix.charCodeAt(1),
      })
    }
  }

  if (knownSecondCharCodes.size > MAX_ROOT_DISPATCH_ROOTS) {
    return null
  }

  return {
    hints,
    knownSecondCharCodes: [...knownSecondCharCodes].sort((left, right) => left - right),
    rootPathAction: hasRootlessDynamicRoute
      ? "fallback"
      : hasRootlessStatic
        ? "static-only"
        : "miss",
    knownSecondCharMissAction: hasNonHintDynamicRoute ? "fallback" : "static-only",
    unknownSecondCharMissAction: hasNonHintDynamicRoute ? "fallback" : "miss",
  }
}

function compilePrefixDispatchClassifier(
  plan: DispatchPlan,
): MethodDispatch["classify"] {
  const { hints, knownSecondCharCodes } = plan
  const bySecondChar = new Map<number, PrefixHint[]>()
  for (const hint of hints) {
    const bucket = bySecondChar.get(hint.secondCharCode)
    if (bucket) {
      bucket.push(hint)
    } else {
      bySecondChar.set(hint.secondCharCode, [hint])
    }
  }

  const lines: string[] = [
    "return function classify(matchPath) {",
    "  const pathLen = matchPath.length;",
    `  if (pathLen <= 1) return ${JSON.stringify(plan.rootPathAction)};`,
    "  const second = matchPath.charCodeAt(1);",
  ]

  for (const [secondCharCode, bucket] of bySecondChar) {
    lines.push(`  if (second === ${secondCharCode}) {`)
    for (const hint of bucket) {
      if (hint.exactOrSlashPrefix) {
        lines.push(
          `    if (matchPath === ${JSON.stringify(hint.prefix)} || matchPath.startsWith(${JSON.stringify(hint.slashPrefix)})) return "dynamic-only";`,
        )
      } else {
        lines.push(
          `    if (matchPath.startsWith(${JSON.stringify(hint.slashPrefix)})) return "dynamic-only";`,
        )
      }
    }
    lines.push(`    return ${JSON.stringify(plan.knownSecondCharMissAction)};`)
    lines.push("  }")
  }

  if (knownSecondCharCodes.length > 0) {
    const unknownChecks = knownSecondCharCodes.map((code) => `second !== ${code}`).join(" && ")
    lines.push(`  if (${unknownChecks}) return ${JSON.stringify(plan.unknownSecondCharMissAction)};`)
  }

  lines.push(`  return ${JSON.stringify(plan.knownSecondCharMissAction)};`)
  lines.push("}")

  return new Function(lines.join("\n"))() as MethodDispatch["classify"]
}
