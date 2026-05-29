import { METHOD_TOKEN, PARAM_NAME } from "../../constants.js"
import { InvalidMethodError, InvalidPathError } from "../../errors.js"
import type { RouterOptions } from "../../types.js"

export type Segment =
  | { kind: "static"; key: string }
  | { kind: "param"; name: string }
  | {
    kind: "pattern"
    source: string
    parts: PatternPart[]
    captureNames: string[]
    signature: string
    staticLiteralLength: number
    regexParamCount: number
    paramCount: number
    matcher: RegExp
  }
  | { kind: "wildcard"; name: string, segmentCount: number | null }

export type ParsedSegment =
  | Segment
  | { kind: "optional-param"; name: string }

export type PatternPart =
  | { kind: "static"; value: string }
  | {
    kind: "param"
    name: string
    constraintSource: string | null
    constraint: RegExp | null
  }

export type PreparedPath = {
  rawSegments: string[]
}

export type PreparedLookupPath =
  | string
  | {
    rawPathname: string
    matchPathname: string
  }

export function normalizeMethod(method: string): string {
  if (typeof method !== "string") {
    throw new InvalidMethodError("method must be a string")
  }

  if (isCommonNormalizedMethod(method)) {
    return method
  }

  if (isNormalizedMethodToken(method)) {
    return method
  }

  const normalized = method.trim().toUpperCase()
  if (!normalized || !METHOD_TOKEN.test(normalized)) {
    throw new InvalidMethodError()
  }

  return normalized
}

export function parseRoutePath(path: string, options: Required<RouterOptions>): ParsedSegment[] {
  const normalizedPath = normalizeRouteTemplate(path, options)

  if (normalizedPath === "*") {
    if (!options.allowWildcard) {
      throw new InvalidPathError("Wildcard routes are disabled")
    }
    return [{ kind: "wildcard", name: "wildcard", segmentCount: null }]
  }
  const rawSegments = splitPathSegments(normalizedPath)
  const segments: ParsedSegment[] = []

  for (let index = 0; index < rawSegments.length; index++) {
    const segment = rawSegments[index]
    if (!segment) {
      throw new InvalidPathError("path must not contain empty segments")
    }

    const simpleParam = parseSimpleParamSegment(segment, index === rawSegments.length - 1)
    if (simpleParam) {
      segments.push(simpleParam)
      continue
    }

    if (segment.startsWith("*")) {
      if (!options.allowWildcard) {
        throw new InvalidPathError("Wildcard routes are disabled")
      }
      if (index !== rawSegments.length - 1) {
        throw new InvalidPathError("Wildcard segment must be the final segment")
      }
      const fixedSegments = parseFixedWildcardSegments(segment)
      const name = fixedSegments ? fixedSegments.name : (segment.slice(1) || "wildcard")
      if (!PARAM_NAME.test(name)) {
        throw new InvalidPathError(`Invalid wildcard name: ${name}`)
      }
      segments.push({ kind: "wildcard", name, segmentCount: fixedSegments?.count ?? null })
      continue
    }

    const patternSegment = parsePatternSegment(segment, options)
    if (patternSegment) {
      segments.push(patternSegment)
      continue
    }

    if (segment.includes("*") || segment.includes(":") || segment.includes("?") || segment.includes("#")) {
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

  let normalizedPath = path.trim()
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
  const prepared = prepareLookupPath(path, options)
  if (!prepared) {
    return null
  }

  const rawPathname = typeof prepared === "string" ? prepared : prepared.rawPathname

  return {
    rawSegments: splitPathSegments(rawPathname),
  }
}

export function prepareLookupPath(
  path: string,
  options: Required<RouterOptions>,
): PreparedLookupPath | null {
  if (typeof path !== "string") {
    return null
  }

  const fastPath = tryPrepareLookupFastPath(path, options)
  if (fastPath) {
    return fastPath
  }

  let normalizedPath = trimPathIfNeeded(path)
  normalizedPath = stripQueryHash(normalizedPath)
  if (normalizedPath === "") {
    normalizedPath = "/"
  }

  if (!normalizedPath.startsWith("/")) {
    normalizedPath = `/${normalizedPath}`
  }

  normalizedPath = normalizeTrailingSlash(normalizedPath, options.ignoreTrailingSlash)
  if (options.caseSensitive) {
    return normalizedPath
  }

  const matchPathname = normalizeLookupCase(normalizedPath)
  if (matchPathname === normalizedPath) {
    return normalizedPath
  }

  return {
    rawPathname: normalizedPath,
    matchPathname,
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
  if (queryIndex === -1 && hashIndex === -1) {
    return path
  }
  if (queryIndex === -1) {
    return path.slice(0, hashIndex)
  }
  if (hashIndex === -1) {
    return path.slice(0, queryIndex)
  }
  return path.slice(0, Math.min(queryIndex, hashIndex))
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
  if (segment.indexOf("%") === -1) {
    return segment
  }

  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}

export function decodeSegmentRange(path: string, start: number, end: number): string | null {
  if (start === end) {
    return ""
  }

  const percentIndex = path.indexOf("%", start)
  if (percentIndex === -1 || percentIndex >= end) {
    return path.slice(start, end)
  }

  try {
    return decodeURIComponent(path.slice(start, end))
  } catch {
    return null
  }
}

function trimPathIfNeeded(path: string): string {
  if (path.length === 0) {
    return path
  }

  const first = path.charCodeAt(0)
  const last = path.charCodeAt(path.length - 1)
  const hasOuterWhitespace = first <= 32 || last <= 32
  return hasOuterWhitespace ? path.trim() : path
}

function parseFixedWildcardSegments(
  segment: string,
): { count: number, name: string } | null {
  const match = /^\*(\d+):([A-Za-z_][A-Za-z0-9_]*)$/.exec(segment)
  if (!match) {
    return null
  }

  const count = Number.parseInt(match[1]!, 10)
  if (!Number.isSafeInteger(count) || count <= 0) {
    throw new InvalidPathError("Fixed wildcard segment count must be a positive safe integer")
  }

  return {
    count,
    name: match[2]!,
  }
}

function parseSimpleParamSegment(
  segment: string,
  isFinalSegment: boolean,
): ParsedSegment | null {
  const match = /^:([A-Za-z_][A-Za-z0-9_]*)(\?)?$/.exec(segment)
  if (!match) {
    return null
  }

  const name = match[1]!
  const isOptional = match[2] === "?"
  if (!PARAM_NAME.test(name)) {
    throw new InvalidPathError(`Invalid parameter name: ${name}`)
  }

  if (!isOptional) {
    return { kind: "param", name }
  }

  if (!isFinalSegment) {
    throw new InvalidPathError("Optional parameter must be the final segment")
  }

  return { kind: "optional-param", name }
}

function parsePatternSegment(
  segment: string,
  options: Required<RouterOptions>,
): Extract<Segment, { kind: "pattern" }> | null {
  if (!segment.includes(":")) {
    return null
  }

  const parts: PatternPart[] = []
  let cursor = 0
  let sawParam = false
  let sawLiteral = false
  let previousWasParam = false

  while (cursor < segment.length) {
    const char = segment[cursor]
    if (char === ":") {
      const { part, nextIndex } = parsePatternParamPart(segment, cursor)
      if (previousWasParam) {
        throw new InvalidPathError("Adjacent parameters in a single segment require a literal separator")
      }
      parts.push(part)
      sawParam = true
      previousWasParam = true
      cursor = nextIndex
      continue
    }

    const literalStart = cursor
    while (cursor < segment.length && segment[cursor] !== ":") {
      const current = segment[cursor]
      if (current === "*" || current === "?" || current === "#") {
        throw new InvalidPathError(`Invalid route segment: ${segment}`)
      }
      cursor += 1
    }

    const literal = segment.slice(literalStart, cursor)
    if (!literal) {
      throw new InvalidPathError(`Invalid route segment: ${segment}`)
    }
    parts.push({
      kind: "static",
      value: normalizeSegmentKey(literal, options.caseSensitive),
    })
    sawLiteral = true
    previousWasParam = false
  }

  if (!sawParam) {
    return null
  }

  if (!sawLiteral && parts.length === 1 && parts[0]?.kind === "param" && parts[0].constraintSource === null) {
    return null
  }

  const captureNames: string[] = []
  let staticLiteralLength = 0
  let regexParamCount = 0
  let paramCount = 0
  const matcherParts: string[] = []
  const signatureParts: string[] = []

  for (const part of parts) {
    if (part.kind === "static") {
      staticLiteralLength += part.value.length
      matcherParts.push(escapeRegexLiteral(part.value))
      signatureParts.push(`s:${part.value}`)
      continue
    }

    const groupName = `p${paramCount}`
    matcherParts.push(`(?<${groupName}>.+)`)
    signatureParts.push(part.constraintSource === null ? "p" : `r:${part.constraintSource}`)
    captureNames.push(part.name)
    paramCount += 1
    if (part.constraintSource !== null) {
      regexParamCount += 1
    }
  }

  return {
    kind: "pattern",
    source: segment,
    parts,
    captureNames,
    signature: signatureParts.join("|"),
    staticLiteralLength,
    regexParamCount,
    paramCount,
    matcher: new RegExp(`^${matcherParts.join("")}$`),
  }
}

function parsePatternParamPart(
  segment: string,
  start: number,
): { part: Extract<PatternPart, { kind: "param" }>, nextIndex: number } {
  let cursor = start + 1
  while (cursor < segment.length && isParamChar(segment.charCodeAt(cursor), cursor === start + 1)) {
    cursor += 1
  }

  const name = segment.slice(start + 1, cursor)
  if (!PARAM_NAME.test(name)) {
    throw new InvalidPathError(`Invalid parameter name: ${name}`)
  }

  if (segment[cursor] === "?") {
    throw new InvalidPathError("Optional parameters must occupy the entire final segment")
  }

  let constraintSource: string | null = null
  if (segment[cursor] === "(") {
    const parsedConstraint = readRegexConstraint(segment, cursor)
    constraintSource = parsedConstraint.source
    cursor = parsedConstraint.nextIndex
  }

  return {
    part: {
      kind: "param",
      name,
      constraintSource,
      constraint: constraintSource === null ? null : compileSegmentConstraint(constraintSource),
    },
    nextIndex: cursor,
  }
}

function readRegexConstraint(
  segment: string,
  openParenIndex: number,
): { source: string, nextIndex: number } {
  let cursor = openParenIndex + 1
  let depth = 1
  let inCharClass = false
  let escaped = false

  while (cursor < segment.length) {
    const char = segment[cursor]!
    if (escaped) {
      escaped = false
      cursor += 1
      continue
    }

    if (char === "\\") {
      escaped = true
      cursor += 1
      continue
    }

    if (char === "[" && !inCharClass) {
      inCharClass = true
      cursor += 1
      continue
    }

    if (char === "]" && inCharClass) {
      inCharClass = false
      cursor += 1
      continue
    }

    if (!inCharClass && char === "(") {
      depth += 1
      cursor += 1
      continue
    }

    if (!inCharClass && char === ")") {
      depth -= 1
      if (depth === 0) {
        const source = segment.slice(openParenIndex + 1, cursor)
        if (!source) {
          throw new InvalidPathError("Regex parameter constraint must not be empty")
        }
        return {
          source,
          nextIndex: cursor + 1,
        }
      }
      cursor += 1
      continue
    }

    cursor += 1
  }

  throw new InvalidPathError("Unterminated regex parameter constraint")
}

function compileSegmentConstraint(source: string): RegExp {
  try {
    return new RegExp(`^(?:${source})$`)
  } catch (error) {
    throw new InvalidPathError(
      `Invalid regex parameter constraint: ${error instanceof Error ? error.message : source}`,
    )
  }
}

function isParamChar(code: number, isFirst: boolean): boolean {
  if (isFirst) {
    return (
      (code >= 65 && code <= 90)
      || (code >= 97 && code <= 122)
      || code === 95
    )
  }

  return (
    (code >= 65 && code <= 90)
    || (code >= 97 && code <= 122)
    || (code >= 48 && code <= 57)
    || code === 95
  )
}

function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function tryPrepareLookupFastPath(
  path: string,
  options: Required<RouterOptions>,
): PreparedLookupPath | null {
  if (path.length === 0 || path.charCodeAt(0) !== 47) {
    return null
  }

  const lastCode = path.charCodeAt(path.length - 1)
  if (lastCode <= 32) {
    return null
  }

  if (options.ignoreTrailingSlash && path.length > 1 && lastCode === 47) {
    return null
  }

  if (options.caseSensitive) {
    for (let index = 1; index < path.length; index++) {
      const code = path.charCodeAt(index)
      if (code === 63 || code === 35) {
        return null
      }
    }

    return path
  }

  for (let index = 1; index < path.length; index++) {
    const code = path.charCodeAt(index)
    if (code === 63 || code === 35) {
      return null
    }
    if ((code >= 65 && code <= 90) || code > 127) {
      return null
    }
  }

  return path
}

function normalizeLookupCase(path: string): string {
  let shouldLowercase = false

  for (let index = 0; index < path.length; index++) {
    const code = path.charCodeAt(index)
    if (code >= 65 && code <= 90) {
      shouldLowercase = true
      break
    }
    if (code > 127) {
      shouldLowercase = true
      break
    }
  }

  return shouldLowercase ? path.toLowerCase() : path
}

function isNormalizedMethodToken(method: string): boolean {
  if (method.length === 0) {
    return false
  }

  for (let index = 0; index < method.length; index++) {
    const code = method.charCodeAt(index)
    const isDigit = code >= 48 && code <= 57
    const isUpper = code >= 65 && code <= 90
    const isHyphen = code === 45
    const isAllowedPunctuation =
      code === 33
      || code === 35
      || code === 36
      || code === 37
      || code === 38
      || code === 39
      || code === 42
      || code === 43
      || code === 46
      || code === 94
      || code === 95
      || code === 96
      || code === 124
      || code === 126

    if (!(isDigit || isUpper || isHyphen || isAllowedPunctuation)) {
      return false
    }
  }

  return true
}

function isCommonNormalizedMethod(method: string): boolean {
  return method === "GET"
    || method === "POST"
    || method === "PUT"
    || method === "PATCH"
    || method === "DELETE"
    || method === "HEAD"
    || method === "OPTIONS"
    || method === "TRACE"
    || method === "CONNECT"
    || method === "ANY"
}
