import type { RouterOptions } from "../../types.js"
import { type PreparedPath } from "./normalize.js"
import { matchesNode, type TrieNode } from "./trie.js"

export function findAllowedMethods(
  buckets: Map<string, TrieNode>,
  methodOrder: string[],
  preparedPath: PreparedPath,
  options: Required<RouterOptions>,
): string[] | null {
  const methods: string[] = []
  for (const method of methodOrder) {
    const bucket = buckets.get(method)
    if (!bucket) {
      continue
    }

    const match = matchesNode(bucket, preparedPath, 0, [], options)
    if (match) {
      methods.push(method)
    }
  }

  return methods.length > 0 ? methods : null
}
