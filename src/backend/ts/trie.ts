import type { RouterOptions } from "../../types.js"
import { decodeSegment, type PreparedPath } from "./normalize.js"

export type MatchState = {
  storeId: number
  params: Record<string, string> | null
  routePath: string
}

export type LookupHandler = (
  storeId: number,
  params: Record<string, string> | null,
  routePath: string,
) => void

export class TrieNode {
  readonly staticChildren = new Map<string, TrieNode>()
  paramChild: TrieNode | null = null
  wildcardChild: TrieNode | null = null
  storeId: number | null = null
  routePath: string | null = null
  paramNames: string[] = []
  wildcardName: string | null = null
}

export function matchNode(
  node: TrieNode,
  preparedPath: PreparedPath,
  offset: number,
  captures: string[],
  options: Required<RouterOptions>,
): MatchState | null {
  let result: MatchState | null = null
  lookupNode(node, preparedPath, offset, captures, 0, options, (storeId, params, routePath) => {
    result = { storeId, params, routePath }
  })
  return result
}

export function matchesNode(
  node: TrieNode,
  preparedPath: PreparedPath,
  offset: number,
  captures: string[],
  options: Required<RouterOptions>,
): boolean {
  return matchesNodeInternal(node, preparedPath, offset, captures, 0, options)
}

export function lookupNode(
  node: TrieNode,
  preparedPath: PreparedPath,
  offset: number,
  captures: string[],
  captureCount: number,
  options: Required<RouterOptions>,
  onMatch: LookupHandler,
): boolean {
  if (offset === preparedPath.rawSegments.length) {
    if (node.storeId !== null) {
      return finalizeLookup(node, captures, captureCount, options, onMatch)
    }

    if (node.wildcardChild && node.wildcardChild.storeId !== null) {
      captures[captureCount] = ""
      return finalizeLookup(node.wildcardChild, captures, captureCount + 1, options, onMatch)
    }

    return false
  }

  const rawSegment = preparedPath.rawSegments[offset]
  if (rawSegment === undefined) {
    return false
  }

  if (node.staticChildren.size > 0) {
    const staticKey = options.caseSensitive ? rawSegment : rawSegment.toLowerCase()
    const staticChild = node.staticChildren.get(staticKey)
    if (staticChild) {
      if (lookupNode(staticChild, preparedPath, offset + 1, captures, captureCount, options, onMatch)) {
        return true
      }
    }
  }

  if (node.paramChild) {
    captures[captureCount] = rawSegment
    if (lookupNode(node.paramChild, preparedPath, offset + 1, captures, captureCount + 1, options, onMatch)) {
      return true
    }
  }

  if (node.wildcardChild && node.wildcardChild.storeId !== null) {
    captures[captureCount] = preparedPath.rawSegments.slice(offset).join("/")
    return finalizeLookup(node.wildcardChild, captures, captureCount + 1, options, onMatch)
  }

  return false
}

function matchesNodeInternal(
  node: TrieNode,
  preparedPath: PreparedPath,
  offset: number,
  captures: string[],
  captureCount: number,
  options: Required<RouterOptions>,
): boolean {
  if (offset === preparedPath.rawSegments.length) {
    if (node.storeId !== null) {
      return hasValidCaptures(node, captures, captureCount, options)
    }

    if (node.wildcardChild && node.wildcardChild.storeId !== null) {
      captures[captureCount] = ""
      return hasValidCaptures(node.wildcardChild, captures, captureCount + 1, options)
    }

    return false
  }

  const rawSegment = preparedPath.rawSegments[offset]
  if (rawSegment === undefined) {
    return false
  }

  if (node.staticChildren.size > 0) {
    const staticKey = options.caseSensitive ? rawSegment : rawSegment.toLowerCase()
    const staticChild = node.staticChildren.get(staticKey)
    if (staticChild && matchesNodeInternal(staticChild, preparedPath, offset + 1, captures, captureCount, options)) {
      return true
    }
  }

  if (node.paramChild) {
    captures[captureCount] = rawSegment
    if (matchesNodeInternal(node.paramChild, preparedPath, offset + 1, captures, captureCount + 1, options)) {
      return true
    }
  }

  if (node.wildcardChild && node.wildcardChild.storeId !== null) {
    captures[captureCount] = preparedPath.rawSegments.slice(offset).join("/")
    return hasValidCaptures(node.wildcardChild, captures, captureCount + 1, options)
  }

  return false
}

function finalizeLookup(
  node: TrieNode,
  captures: string[],
  captureCount: number,
  options: Required<RouterOptions>,
  onMatch: LookupHandler,
): boolean {
  if (node.storeId === null || node.routePath === null) {
    return false
  }

  const names = [...node.paramNames]
  if (node.wildcardName) {
    names.push(node.wildcardName)
  }

  if (names.length === 0) {
    onMatch(node.storeId, null, node.routePath)
    return true
  }

   if (captureCount !== names.length) {
    return false
  }

  const params: Record<string, string> = {}
  for (let index = 0; index < names.length; index++) {
    const decoded = decodeSegment(captures[index] ?? "")
    if (decoded === null || decoded.length > options.maxParamLength) {
      return false
    }
    const name = names[index]
    if (name === undefined) {
      return false
    }
    params[name] = decoded
  }

  onMatch(node.storeId, params, node.routePath)
  return true
}

function hasValidCaptures(
  node: TrieNode,
  captures: string[],
  captureCount: number,
  options: Required<RouterOptions>,
): boolean {
  if (node.storeId === null) {
    return false
  }

  const namesCount = node.paramNames.length + (node.wildcardName ? 1 : 0)
  if (namesCount !== captureCount) {
    return false
  }

  for (let index = 0; index < namesCount; index++) {
    const decoded = decodeSegment(captures[index] ?? "")
    if (decoded === null || decoded.length > options.maxParamLength) {
      return false
    }
  }

  return true
}

