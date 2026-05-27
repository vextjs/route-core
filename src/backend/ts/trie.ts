import type { RouterOptions } from "../../types.js"
import { decodeSegment, type PreparedPath } from "./normalize.js"

export type MatchState = {
  storeId: number
  params: Record<string, string> | null
}

export class TrieNode {
  readonly staticChildren = new Map<string, TrieNode>()
  paramChild: TrieNode | null = null
  wildcardChild: TrieNode | null = null
  storeId: number | null = null
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
  if (offset === preparedPath.rawSegments.length) {
    if (node.storeId !== null) {
      return finalizeMatch(node, captures, options)
    }

    if (node.wildcardChild && node.wildcardChild.storeId !== null) {
      return finalizeMatch(node.wildcardChild, [...captures, ""], options)
    }

    return null
  }

  const keySegment = preparedPath.keySegments[offset]
  const rawSegment = preparedPath.rawSegments[offset]
  if (keySegment === undefined || rawSegment === undefined) {
    return null
  }

  const staticChild = node.staticChildren.get(keySegment)
  if (staticChild) {
    const match = matchNode(staticChild, preparedPath, offset + 1, captures, options)
    if (match) {
      return match
    }
  }

  if (node.paramChild) {
    const match = matchNode(
      node.paramChild,
      preparedPath,
      offset + 1,
      [...captures, rawSegment],
      options,
    )
    if (match) {
      return match
    }
  }

  if (node.wildcardChild && node.wildcardChild.storeId !== null) {
    const rest = preparedPath.rawSegments.slice(offset).join("/")
    return finalizeMatch(node.wildcardChild, [...captures, rest], options)
  }

  return null
}

function finalizeMatch(
  node: TrieNode,
  captures: string[],
  options: Required<RouterOptions>,
): MatchState | null {
  if (node.storeId === null) {
    return null
  }

  const names = [...node.paramNames]
  if (node.wildcardName) {
    names.push(node.wildcardName)
  }

  if (names.length === 0) {
    return { storeId: node.storeId, params: null }
  }

  const params: Record<string, string> = {}
  for (let index = 0; index < names.length; index++) {
    const decoded = decodeSegment(captures[index] ?? "")
    if (decoded === null || decoded.length > options.maxParamLength) {
      return null
    }
    const name = names[index]
    if (name === undefined) {
      return null
    }
    params[name] = decoded
  }

  return { storeId: node.storeId, params }
}
