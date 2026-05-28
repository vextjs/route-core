import { METHOD_TOKEN, PARAM_NAME } from "../../constants.js"
import { InvalidMethodError, InvalidPathError } from "../../errors.js"
import type { RouterOptions } from "../../types.js"

export type Segment =
  | { kind: "static"; key: string }
  | { kind: "param"; name: string }
  | { kind: "wildcard"; name: string }

export type PreparedPath = {
  rawSegments: string[]
}

export function normalizeMethod(method: string): string {
  if (typeof method !== "string") {
    throw new InvalidMethodError("method must be a string")
  }

  const normalized = method.trim().toUpperCase()
  if (!normalized || !METHOD_TOKEN.test(normalized)) {
    throw new InvalidMethodError()
  }

  return normalized
}

export function parseRoutePath(path: string, options: Required<RouterOptions>): Segment[] {
  const normalizedPath = normalizeRouteTemplate(path, options)

  if (normalizedPath === "*") {
    if (!options.allowWildcard) {
      throw new InvalidPathError("Wildcard routes are disabled")
    }
    return [{ kind: "wildcard", name: "wildcard" }]
  }
  const rawSegments = splitPathSegments(normalizedPath)
  const segments: Segment[] = []

  for (let index = 0; index < rawSegments.length; index++) {
    const segment = rawSegments[index]
    if (!segment) {
      throw new InvalidPathError("path must not contain empty segments")
    }

    if (segment.startsWith(":")) {
      const name = segment.slice(1)
      if (!PARAM_NAME.test(name)) {
        throw new InvalidPathError(`Invalid parameter name: ${name}`)
      }
      segments.push({ kind: "param", name })
      continue
    }

    if (segment.startsWith("*")) {
      if (!options.allowWildcard) {
        throw new InvalidPathError("Wildcard routes are disabled")
      }
      if (index !== rawSegments.length - 1) {
        throw new InvalidPathError("Wildcard segment must be the final segment")
      }
      const name = segment.slice(1) || "wildcard"
      if (!PARAM_NAME.test(name)) {
        throw new InvalidPathError(`Invalid wildcard name: ${name}`)
      }
      segments.push({ kind: "wildcard", name })
      continue
    }

    if (segment.includes("*") || segment.includes(":")) {
      throw new InvalidPathError(`Invalid route segment: ${segment}`)
    }

    segments.push({ kind: "static", key: normalizeSegmentKey(segment, options.caseSensitive) })
  }

  return segments
}

export function normalizeRouteTemplate(path: string, options: Required<RouterOptions>): string {
  if (typeof path !== "string") {
    throw new InvalidPathError("path must be a string")
  }

  let normalizedPath = stripQueryHash(path.trim())
  if (normalizedPath === "") {
    normalizedPath = "/"
  }

  if (normalizedPath === "*") {
    return normalizedPath
  }

  if (!normalizedPath.startsWith("/")) {
    throw new InvalidPathError("path must start with / or be a bare * wildcard")
  }

  return normalizeTrailingSlash(normalizedPath, options.ignoreTrailingSlash)
}

export function prepareMatchPath(path: string, options: Required<RouterOptions>): PreparedPath | null {
  if (typeof path !== "string") {
    return null
  }

  let normalizedPath = stripQueryHash(path.trim())
  if (normalizedPath === "") {
    normalizedPath = "/"
  }

  if (!normalizedPath.startsWith("/")) {
    normalizedPath = `/${normalizedPath}`
  }

  normalizedPath = normalizeTrailingSlash(normalizedPath, options.ignoreTrailingSlash)
  return {
    rawSegments: splitPathSegments(normalizedPath),
  }
}

export function splitPathSegments(path: string): string[] {
  if (path === "/") {
    return []
  }
  return path.slice(1).split("/")
}

export function stripQueryHash(path: string): string {
  const queryIndex = path.indexOf("?")
  const hashIndex = path.indexOf("#")
  const endCandidates = [queryIndex, hashIndex].filter((index) => index >= 0)
  if (endCandidates.length === 0) {
    return path
  }
  return path.slice(0, Math.min(...endCandidates))
}

export function normalizeTrailingSlash(path: string, ignoreTrailingSlash: boolean): string {
  if (!ignoreTrailingSlash) {
    return path
  }

  let nextPath = path
  while (nextPath.length > 1 && nextPath.endsWith("/")) {
    nextPath = nextPath.slice(0, -1)
  }
  return nextPath
}

export function normalizeSegmentKey(segment: string, caseSensitive: boolean): string {
  return caseSensitive ? segment : segment.toLowerCase()
}

export function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}
