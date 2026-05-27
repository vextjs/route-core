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
  lookupNode(node, preparedPath, offset, captures, options, (storeId, params, routePath) => {
    result = { storeId, params, routePath }
  })
  return result
}

export function lookupNode(
  node: TrieNode,
  preparedPath: PreparedPath,
  offset: number,
  captures: string[],
  options: Required<RouterOptions>,
  onMatch: LookupHandler,
): boolean {
  if (offset === preparedPath.rawSegments.length) {
    if (node.storeId !== null) {
      return finalizeLookup(node, captures, options, onMatch)
    }

    if (node.wildcardChild && node.wildcardChild.storeId !== null) {
      return finalizeLookup(node.wildcardChild, [...captures, ""], options, onMatch)
    }

    return false
  }

  const keySegment = preparedPath.keySegments[offset]
  const rawSegment = preparedPath.rawSegments[offset]
  if (keySegment === undefined || rawSegment === undefined) {
    return false
  }

  const staticChild = node.staticChildren.get(keySegment)
  if (staticChild) {
    if (lookupNode(staticChild, preparedPath, offset + 1, captures, options, onMatch)) {
      return true
    }
  }

  if (node.paramChild) {
    if (lookupNode(
      node.paramChild,
      preparedPath,
      offset + 1,
      [...captures, rawSegment],
      options,
      onMatch,
    )) {
      return true
    }
  }

  if (node.wildcardChild && node.wildcardChild.storeId !== null) {
    const rest = preparedPath.rawSegments.slice(offset).join("/")
    return finalizeLookup(node.wildcardChild, [...captures, rest], options, onMatch)
  }

  return false
}

function finalizeLookup(
  node: TrieNode,
  captures: string[],
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
