import { ANY_METHOD, BUILTIN_METHOD_ORDER, DEFAULT_OPTIONS } from "../../constants.js"
import { InvalidPathError, RouteConflictError } from "../../errors.js"
import type { MatchResult, Router, RouterOptions } from "../../types.js"
import { assertStoreId } from "../../internal/assert.js"
import { findAllowedMethods } from "./allowed.js"
import { normalizeMethod, parseRoutePath, prepareMatchPath, type PreparedPath } from "./normalize.js"
import { matchNode, TrieNode } from "./trie.js"

export class RouteCoreRouter implements Router {
  private readonly buckets = new Map<string, TrieNode>()
  private readonly customMethodOrder: string[] = []
  private readonly options: Required<RouterOptions>

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
    node.paramNames = paramNames
    node.wildcardName = wildcardName
  }

  find(method: string, path: string): MatchResult | null {
    const normalizedMethod = normalizeMethod(method)
    const preparedPath = prepareMatchPath(path, this.options)
    if (!preparedPath) {
      return null
    }

    const directMatch = this.findInBucket(normalizedMethod, preparedPath)
    if (directMatch || normalizedMethod === ANY_METHOD) {
      return directMatch
    }

    return this.findInBucket(ANY_METHOD, preparedPath)
  }

  allowed(path: string): string[] | null {
    const preparedPath = prepareMatchPath(path, this.options)
    if (!preparedPath) {
      return null
    }

    return findAllowedMethods(this.buckets, this.methodScanOrder(), preparedPath, this.options)
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

  private findInBucket(method: string, preparedPath: PreparedPath): MatchResult | null {
    const bucket = this.buckets.get(method)
    if (!bucket) {
      return null
    }

    return matchNode(bucket, preparedPath, 0, [], this.options)
  }

  private methodScanOrder(): string[] {
    return [...BUILTIN_METHOD_ORDER, ...this.customMethodOrder]
  }
}
