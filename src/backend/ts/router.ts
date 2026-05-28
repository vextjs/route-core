import { ANY_METHOD, BUILTIN_METHOD_ORDER, DEFAULT_OPTIONS } from "../../constants.js"
import { InvalidPathError, RouteConflictError } from "../../errors.js"
import type { LookupHandler, MatchResult, Router, RouterOptions } from "../../types.js"
import { assertStoreId } from "../../internal/assert.js"
import { findAllowedMethodsCompiled } from "./allowed.js"
import { compileRouterRuntime, type CompiledRouterRuntime } from "./compiler.js"
import { createRouteDefinition, type RouteDefinition } from "./ir.js"
import {
  normalizeMethod,
  normalizeRouteTemplate,
  parseRoutePath,
  prepareLookupPath,
} from "./normalize.js"
import { TrieNode } from "./trie.js"

export class RouteCoreRouter implements Router {
  private readonly buckets = new Map<string, TrieNode>()
  private readonly customMethodOrder: string[] = []
  private readonly options: Required<RouterOptions>
  private readonly routes: RouteDefinition[] = []
  private compiledRuntime: CompiledRouterRuntime | null = null
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

    const bucket = this.getOrCreateBucket(normalizedMethod)
    let node = bucket
    const paramNames: string[] = []
    let wildcardName: string | null = null

    for (const segment of routeSegments) {
      if (segment.kind === "static") {
        let child = node.staticChildren.get(segment.key)
        if (!child) {
          child = new TrieNode()
          node.staticChildren.set(segment.key, child)
        }
        node = child
        continue
      }

      if (segment.kind === "param") {
        if (!node.paramChild) {
          node.paramChild = new TrieNode()
        }
        paramNames.push(segment.name)
        node = node.paramChild
        continue
      }

      if (!node.wildcardChild) {
        node.wildcardChild = new TrieNode()
      }
      wildcardName = segment.name
      node = node.wildcardChild
    }

    if (node.storeId !== null) {
      throw new RouteConflictError()
    }

    node.storeId = storeId
    node.routePath = routePath
    node.paramNames = paramNames
    node.wildcardName = wildcardName

    this.routes.push(createRouteDefinition(
      normalizedMethod,
      routePath,
      routeSegments,
      storeId,
    ))
    this.dirty = true
  }

  find(method: string, path: string): MatchResult | null {
    const runtime = this.ensureCompiled()
    const normalizedMethod = normalizeMethod(method)
    const preparedPath = prepareLookupPath(path, this.options)
    if (!preparedPath) {
      return null
    }

    const rawPathname = typeof preparedPath === "string" ? preparedPath : preparedPath.rawPathname
    const matchPathname = typeof preparedPath === "string" ? preparedPath : preparedPath.matchPathname

    const normalizedMatch = runtime.methods.get(normalizedMethod)?.find(
      rawPathname,
      matchPathname,
    ) ?? null

    if (normalizedMatch || normalizedMethod === ANY_METHOD) {
      return normalizedMatch
    }

    return runtime.anyMethod?.find(rawPathname, matchPathname) ?? null
  }

  lookup(method: string, path: string, onMatch: LookupHandler): boolean {
    if (typeof onMatch !== "function") {
      throw new TypeError("onMatch must be a function")
    }

    const runtime = this.ensureCompiled()
    const normalizedMethod = normalizeMethod(method)
    const preparedPath = prepareLookupPath(path, this.options)
    if (!preparedPath) {
      return false
    }

    const rawPathname = typeof preparedPath === "string" ? preparedPath : preparedPath.rawPathname
    const matchPathname = typeof preparedPath === "string" ? preparedPath : preparedPath.matchPathname

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

    return runtime.anyMethod?.lookup(
      rawPathname,
      matchPathname,
      onMatch,
    ) ?? false
  }

  allowed(path: string): string[] | null {
    const preparedPath = prepareLookupPath(path, this.options)
    if (!preparedPath) {
      return null
    }

    return findAllowedMethodsCompiled(
      this.ensureCompiled().methods,
      this.methodScanOrder(),
      preparedPath,
    )
  }

  private ensureCompiled(): CompiledRouterRuntime {
    if (!this.dirty && this.compiledRuntime) {
      return this.compiledRuntime
    }

    this.compiledRuntime = compileRouterRuntime(this.routes, this.options.maxParamLength)
    this.dirty = false
    return this.compiledRuntime
  }

  private getOrCreateBucket(method: string): TrieNode {
    let bucket = this.buckets.get(method)
    if (!bucket) {
      bucket = new TrieNode()
      this.buckets.set(method, bucket)

      if (method !== ANY_METHOD && !BUILTIN_METHOD_ORDER.includes(method)) {
        this.customMethodOrder.push(method)
      }
    }
    return bucket
  }

  private methodScanOrder(): string[] {
    return [...BUILTIN_METHOD_ORDER, ...this.customMethodOrder]
  }
}
