import type { MatchResult } from "../../types.js"
import { decodeSegmentRange } from "./normalize.js"
import type { LookupHandler } from "./trie.js"
import type { DynamicTrieNode, RouteDefinition } from "./ir.js"
import {
  buildDynamicTrie,
  getCaptureNames,
  getExactStaticPath,
  getRootStaticSegment,
  getTrailingWildcardSegmentCount,
  hasPatternSegments,
} from "./ir.js"

export type RuntimeFindFn = (rawPath: string, matchPath: string) => MatchResult | null
export type RuntimeLookupFn = (rawPath: string, matchPath: string, onMatch: LookupHandler) => boolean

export type RuntimeFallbackResult = {
  find: RuntimeFindFn
  lookup: RuntimeLookupFn
}

type TrailingParamGroup = {
  headPrefix: string
  routeCount: number
  routesByDiscriminator: Record<string, RouteDefinition | undefined>
  numericCandidates: Array<[number, RouteDefinition]> | null
  numericMaxIndex: number
  numericRoutes: Array<RouteDefinition | undefined> | null
}

type TrailingWildcardRoute = {
  route: RouteDefinition
  basePath: string
  prefix: string | null
}

export function createExactStaticMapRuntime(routes: RouteDefinition[]): RuntimeFallbackResult {
  const lookupMap = Object.create(null) as Record<string, RouteDefinition | undefined>
  for (const route of routes) {
    const exactPath = getExactStaticPath(route)
    lookupMap[exactPath] = route
  }

  return {
    find(_rawPath, matchPath) {
      const route = lookupMap[matchPath]
      if (!route) {
        return null
      }
      return {
        storeId: route.storeId,
        params: null,
        routePath: route.routePath,
      }
    },
    lookup(_rawPath, matchPath, onMatch) {
      const route = lookupMap[matchPath]
      if (!route) {
        return false
      }
      onMatch(route.storeId, null, route.routePath)
      return true
    },
  }
}

export function createDynamicScannerRuntime(
  routes: RouteDefinition[],
  maxParamLength: number,
): RuntimeFallbackResult {
  const hasPatternRoutes = routes.some(hasPatternSegments)
  const segmentCountGuard = createSegmentCountGuard(routes)
  const trailingParamGroupsByRoot = new Map<string, Map<string, TrailingParamGroup>>()
  const trailingWildcardRoutesByRoot = new Map<string, TrailingWildcardRoute[]>()
  const rootlessTrailingWildcardRoutes: TrailingWildcardRoute[] = []
  const remainingRoutes: RouteDefinition[] = []

  for (const route of routes) {
    if (!hasPatternRoutes && isGroupedTrailingParamRoute(route)) {
      const rootKey = getRootStaticSegment(route)
      if (!rootKey) {
        remainingRoutes.push(route)
        continue
      }

      const { headPrefix, discriminator } = buildTrailingParamGroupParts(route)
      let groupsForRoot = trailingParamGroupsByRoot.get(rootKey)
      if (!groupsForRoot) {
        groupsForRoot = new Map<string, TrailingParamGroup>()
        trailingParamGroupsByRoot.set(rootKey, groupsForRoot)
      }

      let group = groupsForRoot.get(headPrefix)
      if (!group) {
        group = {
          headPrefix,
          routeCount: 0,
          routesByDiscriminator: Object.create(null) as Record<string, RouteDefinition | undefined>,
          numericCandidates: [],
          numericMaxIndex: -1,
          numericRoutes: null,
        }
        groupsForRoot.set(headPrefix, group)
      }
      group.routeCount += 1
      group.routesByDiscriminator[discriminator] = route
      if (group.numericCandidates) {
        const numericDiscriminator = parseCanonicalNumericDiscriminator(discriminator)
        if (numericDiscriminator === null) {
          group.numericCandidates = null
        } else {
          group.numericCandidates.push([numericDiscriminator, route])
          if (numericDiscriminator > group.numericMaxIndex) {
            group.numericMaxIndex = numericDiscriminator
          }
        }
      }
      continue
    }
    if (isTrailingStaticWildcardRoute(route)) {
      const wildcardRoute = createTrailingWildcardRoute(route)
      const rootKey = getRootStaticSegment(route)
      if (!rootKey) {
        rootlessTrailingWildcardRoutes.push(wildcardRoute)
        continue
      }

      const bucket = trailingWildcardRoutesByRoot.get(rootKey)
      if (bucket) {
        bucket.push(wildcardRoute)
      } else {
        trailingWildcardRoutesByRoot.set(rootKey, [wildcardRoute])
      }
      continue
    }
    remainingRoutes.push(route)
  }

  const trie = buildDynamicTrie(remainingRoutes)
  const hasTrieRoutes = remainingRoutes.length > 0
  const trailingParamGroupBuckets = new Map<string, TrailingParamGroup[]>()
  for (const [rootKey, groupsForRoot] of trailingParamGroupsByRoot) {
    const groups = [...groupsForRoot.values()]
    for (const group of groups) {
      group.numericRoutes = buildNumericRoutes(group)
    }
    trailingParamGroupBuckets.set(rootKey, groups)
  }
  const trieRootStaticKeys = new Set(trie.staticChildren.keys())
  const hasRootPatternChild = trie.patternChildren.length > 0
  const hasRootParamChild = trie.paramChild !== null
  const hasRootWildcardRoute = trie.wildcardRoute !== null
  const specializedRuntime = !hasTrieRoutes && rootlessTrailingWildcardRoutes.length === 0
    ? createSpecializedGroupedRuntime(trailingParamGroupBuckets, trailingWildcardRoutesByRoot, maxParamLength)
    : null

  if (specializedRuntime) {
    return specializedRuntime
  }

  return {
    find(rawPath, matchPath) {
      if (!matchesSegmentCountGuard(matchPath, segmentCountGuard)) {
        return null
      }

      const rootKey = getPathRootKey(matchPath)
      const trailingParamGroups = rootKey ? trailingParamGroupBuckets.get(rootKey) ?? null : null
      const trailingWildcardRoutes = rootKey ? trailingWildcardRoutesByRoot.get(rootKey) ?? [] : []
      const trieCanMatchRoot = hasTrieRoutes && (
        hasRootPatternChild
        || hasRootParamChild
        || hasRootWildcardRoute
        || (rootKey !== null && trieRootStaticKeys.has(rootKey))
      )

      if (
        trailingParamGroups === null
        && trailingWildcardRoutes.length === 0
        && rootlessTrailingWildcardRoutes.length === 0
        && !trieCanMatchRoot
      ) {
        return null
      }

      const trailingParamMatch = findTrailingParamMatch(
        trailingParamGroups,
        rawPath,
        matchPath,
        maxParamLength,
      )
      if (trailingParamMatch) {
        return trailingParamMatch
      }
      if (hasTrieRoutes) {
        const trieMatch = findInNode(trie, rawPath, matchPath, 1, [], maxParamLength)
        if (trieMatch) {
          return trieMatch
        }
      }
      const trailingWildcardMatch = findTrailingWildcardMatch(
        trailingWildcardRoutes,
        rawPath,
        matchPath,
        maxParamLength,
      )
      if (trailingWildcardMatch) {
        return trailingWildcardMatch
      }
      return findTrailingWildcardMatch(
        rootlessTrailingWildcardRoutes,
        rawPath,
        matchPath,
        maxParamLength,
      )
    },
    lookup(rawPath, matchPath, onMatch) {
      if (!matchesSegmentCountGuard(matchPath, segmentCountGuard)) {
        return false
      }

      const rootKey = getPathRootKey(matchPath)
      const trailingParamGroups = rootKey ? trailingParamGroupBuckets.get(rootKey) ?? null : null
      const trailingWildcardRoutes = rootKey ? trailingWildcardRoutesByRoot.get(rootKey) ?? [] : []
      const trieCanMatchRoot = hasTrieRoutes && (
        hasRootPatternChild
        || hasRootParamChild
        || hasRootWildcardRoute
        || (rootKey !== null && trieRootStaticKeys.has(rootKey))
      )

      if (
        trailingParamGroups === null
        && trailingWildcardRoutes.length === 0
        && rootlessTrailingWildcardRoutes.length === 0
        && !trieCanMatchRoot
      ) {
        return false
      }

      if (lookupTrailingParamMatch(
        trailingParamGroups,
        rawPath,
        matchPath,
        maxParamLength,
        onMatch,
      )) {
        return true
      }
      if (hasTrieRoutes) {
        if (lookupInNode(trie, rawPath, matchPath, 1, [], maxParamLength, onMatch)) {
          return true
        }
      }
      if (lookupTrailingWildcardMatch(
        trailingWildcardRoutes,
        rawPath,
        matchPath,
        maxParamLength,
        onMatch,
      )) {
        return true
      }
      return lookupTrailingWildcardMatch(
        rootlessTrailingWildcardRoutes,
        rawPath,
        matchPath,
        maxParamLength,
        onMatch,
      )
    },
  }
}

type SegmentCountGuard = {
  exactCounts: Set<number> | null
  openEndedMinCount: number | null
}

function createSegmentCountGuard(routes: readonly RouteDefinition[]): SegmentCountGuard | null {
  let openEndedMinCount: number | null = null
  const exactCounts = new Set<number>()

  for (const route of routes) {
    const tail = route.segments[route.segments.length - 1]
    if (tail?.kind === "wildcard" && tail.segmentCount === null) {
      const minCount = route.segments.length - 1
      openEndedMinCount = openEndedMinCount === null ? minCount : Math.min(openEndedMinCount, minCount)
      continue
    }

    if (tail?.kind === "wildcard" && tail.segmentCount !== null) {
      exactCounts.add((route.segments.length - 1) + tail.segmentCount)
      continue
    }

    exactCounts.add(route.segments.length)
  }

  if (exactCounts.size === 0 && openEndedMinCount === null) {
    return null
  }

  return {
    exactCounts: exactCounts.size > 0 ? exactCounts : null,
    openEndedMinCount,
  }
}

function matchesSegmentCountGuard(
  path: string,
  guard: SegmentCountGuard | null,
): boolean {
  if (!guard) {
    return true
  }

  const segmentCount = countSegmentsInPath(path)
  if (guard.exactCounts?.has(segmentCount)) {
    return true
  }

  if (guard.openEndedMinCount === null) {
    return false
  }

  return segmentCount >= guard.openEndedMinCount
}

function countSegmentsInPath(path: string): number {
  if (path.length <= 1) {
    return 0
  }

  let count = 1
  for (let index = 1; index < path.length; index++) {
    if (path.charCodeAt(index) === 47) {
      count += 1
    }
  }
  return count
}

function createSpecializedGroupedRuntime(
  trailingParamGroupBuckets: ReadonlyMap<string, readonly TrailingParamGroup[]>,
  trailingWildcardRoutesByRoot: ReadonlyMap<string, readonly TrailingWildcardRoute[]>,
  maxParamLength: number,
): RuntimeFallbackResult | null {
  const roots = new Map<string, {
    rootPrefix: string
    secondCharCode: number
    paramGroup: TrailingParamGroup | null
    wildcardRoute: TrailingWildcardRoute | null
  }>()

  for (const [rootKey, groups] of trailingParamGroupBuckets) {
    if (groups.length > 1) {
      return null
    }
    const rootPrefix = `/${rootKey}`
    roots.set(rootPrefix, {
      rootPrefix,
      secondCharCode: rootPrefix.charCodeAt(1),
      paramGroup: groups[0] ?? null,
      wildcardRoute: roots.get(rootPrefix)?.wildcardRoute ?? null,
    })
  }

  for (const [rootKey, routes] of trailingWildcardRoutesByRoot) {
    if (routes.length > 1) {
      return null
    }
    const rootPrefix = `/${rootKey}`
    const existing = roots.get(rootPrefix)
    if (existing) {
      existing.wildcardRoute = routes[0] ?? null
      continue
    }
    roots.set(rootPrefix, {
      rootPrefix,
      secondCharCode: rootPrefix.charCodeAt(1),
      paramGroup: null,
      wildcardRoute: routes[0] ?? null,
    })
  }

  if (roots.size === 0) {
    return null
  }

  const rootEntries = [...roots.values()]
  const rootArgs: unknown[] = []
  const rootArgNames: string[] = []
  const findLines: string[] = [
    "const path = matchPath;",
    "const pathLen = path.length;",
    "if (pathLen <= 1) return null;",
    "const second = path.charCodeAt(1);",
  ]
  const lookupLines: string[] = [
    "const path = matchPath;",
    "const pathLen = path.length;",
    "if (pathLen <= 1) return false;",
    "const second = path.charCodeAt(1);",
  ]

  rootEntries.forEach((entry, index) => {
    const paramGroupArg = entry.paramGroup ? `paramGroup_${index}` : null
    const wildcardRoute = entry.wildcardRoute
    const wildcardRouteArg = wildcardRoute ? `wildcardRoute_${index}` : null
    if (paramGroupArg) {
      rootArgNames.push(paramGroupArg)
      rootArgs.push(entry.paramGroup)
    }
    if (wildcardRoute) {
      const wildcardArgName = wildcardRouteArg ?? `wildcardRoute_${index}`
      rootArgNames.push(wildcardArgName)
      rootArgs.push(wildcardRoute.route)
    }

    const slashPrefix = `${entry.rootPrefix}/`
    findLines.push(`if (second === ${entry.secondCharCode}) {`)
    findLines.push(`  if (path.startsWith(${JSON.stringify(slashPrefix)})) {`)
    appendSpecializedRootBody(
      findLines,
      entry,
      paramGroupArg,
      wildcardRouteArg,
      maxParamLength,
      "find",
    )
    findLines.push("  }")
    if (entry.wildcardRoute) {
      findLines.push(`  if (path === ${JSON.stringify(entry.rootPrefix)}) {`)
      findLines.push(`    return finalizeSingleCaptureFind(${wildcardRouteArg}, rawPath, pathLen, pathLen, ${maxParamLength});`)
      findLines.push("  }")
    }
    findLines.push("}")

    lookupLines.push(`if (second === ${entry.secondCharCode}) {`)
    lookupLines.push(`  if (path.startsWith(${JSON.stringify(slashPrefix)})) {`)
    appendSpecializedRootBody(
      lookupLines,
      entry,
      paramGroupArg,
      wildcardRouteArg,
      maxParamLength,
      "lookup",
    )
    lookupLines.push("  }")
    if (entry.wildcardRoute) {
      lookupLines.push(`  if (path === ${JSON.stringify(entry.rootPrefix)}) {`)
      lookupLines.push(`    return finalizeSingleCaptureLookup(${wildcardRouteArg}, rawPath, pathLen, pathLen, ${maxParamLength}, onMatch);`)
      lookupLines.push("  }")
    }
    lookupLines.push("}")
  })

  findLines.push("return null;")
  lookupLines.push("return false;")

  const find = new Function(
    "resolveTrailingParamRoute",
    "finalizeSingleCaptureFind",
    ...rootArgNames,
    `
      return function specializedGroupedFind(rawPath, matchPath) {
        ${findLines.join("\n")}
      }
    `,
  )(
    resolveTrailingParamRoute,
    finalizeSingleCaptureFind,
    ...rootArgs,
  ) as RuntimeFindFn

  const lookup = new Function(
    "resolveTrailingParamRoute",
    "finalizeSingleCaptureLookup",
    ...rootArgNames,
    `
      return function specializedGroupedLookup(rawPath, matchPath, onMatch) {
        ${lookupLines.join("\n")}
      }
    `,
  )(
    resolveTrailingParamRoute,
    finalizeSingleCaptureLookup,
    ...rootArgs,
  ) as RuntimeLookupFn

  return { find, lookup }
}

function appendSpecializedRootBody(
  lines: string[],
  entry: {
    rootPrefix: string
    paramGroup: TrailingParamGroup | null
    wildcardRoute: TrailingWildcardRoute | null
  },
  paramGroupArg: string | null,
  wildcardRouteArg: string | null,
  maxParamLength: number,
  mode: "find" | "lookup",
): void {
  if (entry.paramGroup && paramGroupArg) {
    lines.push(`    if (path.startsWith(${JSON.stringify(entry.paramGroup.headPrefix)})) {`)
    lines.push(`      const slashIndex = path.indexOf("/", ${entry.paramGroup.headPrefix.length});`)
    lines.push(`      if (slashIndex === -1) return ${mode === "find" ? "null" : "false"};`)
    lines.push(`      const route = resolveTrailingParamRoute(${paramGroupArg}, path, ${entry.paramGroup.headPrefix.length}, slashIndex);`)
    lines.push("      if (route) {")
    if (mode === "find") {
      lines.push(`        return finalizeSingleCaptureFind(route, rawPath, slashIndex + 1, pathLen, ${maxParamLength});`)
    } else {
      lines.push(`        return finalizeSingleCaptureLookup(route, rawPath, slashIndex + 1, pathLen, ${maxParamLength}, onMatch);`)
    }
    lines.push("      }")
    lines.push(`      return ${mode === "find" ? "null" : "false"};`)
    lines.push("    }")
  }

  if (entry.wildcardRoute && wildcardRouteArg) {
    lines.push(`    return ${mode === "find" ? "finalizeSingleCaptureFind" : "finalizeSingleCaptureLookup"}(${wildcardRouteArg}, rawPath, ${entry.wildcardRoute.prefix?.length ?? entry.rootPrefix.length}, pathLen, ${maxParamLength}${mode === "lookup" ? ", onMatch" : ""});`)
    return
  }

  lines.push(`    return ${mode === "find" ? "null" : "false"};`)
}

function findInNode(
  node: DynamicTrieNode,
  rawPath: string,
  matchPath: string,
  index: number,
  captures: Array<[number, number]>,
  maxParamLength: number,
): MatchResult | null {
  if (index === matchPath.length) {
    if (node.terminal) {
      return finalizeFind(node.terminal, rawPath, captures, maxParamLength)
    }
    if (node.wildcardRoute) {
      captures.push([matchPath.length, matchPath.length])
      return finalizeFind(node.wildcardRoute, rawPath, captures, maxParamLength)
    }
    return null
  }

  const rawEnd = matchPath.indexOf("/", index)
  const end = rawEnd === -1 ? matchPath.length : rawEnd
  const segment = matchPath.slice(index, end)
  const nextIndex = end === matchPath.length ? matchPath.length : end + 1

  const staticChild = node.staticChildren.get(segment)
  if (staticChild) {
    const staticResult = findInNode(staticChild, rawPath, matchPath, nextIndex, captures, maxParamLength)
    if (staticResult) {
      return staticResult
    }
  }

  if (node.patternChildren.length > 0) {
    for (const patternChild of node.patternChildren) {
      const patternCaptures = matchPatternSegment(
        patternChild.segment,
        rawPath,
        matchPath,
        index,
        end,
        maxParamLength,
      )
      if (!patternCaptures) {
        continue
      }

      for (const capture of patternCaptures) {
        captures.push(capture)
      }
      const patternResult = findInNode(
        patternChild.node,
        rawPath,
        matchPath,
        nextIndex,
        captures,
        maxParamLength,
      )
      captures.length -= patternCaptures.length
      if (patternResult) {
        return patternResult
      }
    }
  }

  if (node.paramChild) {
    captures.push([index, end])
    const paramResult = findInNode(node.paramChild, rawPath, matchPath, nextIndex, captures, maxParamLength)
    captures.pop()
    if (paramResult) {
      return paramResult
    }
  }

  if (node.wildcardRoute) {
    captures.push([index, matchPath.length])
    const wildcardResult = finalizeFind(node.wildcardRoute, rawPath, captures, maxParamLength)
    captures.pop()
    return wildcardResult
  }

  return null
}

function lookupInNode(
  node: DynamicTrieNode,
  rawPath: string,
  matchPath: string,
  index: number,
  captures: Array<[number, number]>,
  maxParamLength: number,
  onMatch: LookupHandler,
): boolean {
  if (index === matchPath.length) {
    if (node.terminal) {
      return finalizeLookup(node.terminal, rawPath, captures, maxParamLength, onMatch)
    }
    if (node.wildcardRoute) {
      captures.push([matchPath.length, matchPath.length])
      return finalizeLookup(node.wildcardRoute, rawPath, captures, maxParamLength, onMatch)
    }
    return false
  }

  const rawEnd = matchPath.indexOf("/", index)
  const end = rawEnd === -1 ? matchPath.length : rawEnd
  const segment = matchPath.slice(index, end)
  const nextIndex = end === matchPath.length ? matchPath.length : end + 1

  const staticChild = node.staticChildren.get(segment)
  if (staticChild && lookupInNode(staticChild, rawPath, matchPath, nextIndex, captures, maxParamLength, onMatch)) {
    return true
  }

  if (node.patternChildren.length > 0) {
    for (const patternChild of node.patternChildren) {
      const patternCaptures = matchPatternSegment(
        patternChild.segment,
        rawPath,
        matchPath,
        index,
        end,
        maxParamLength,
      )
      if (!patternCaptures) {
        continue
      }

      for (const capture of patternCaptures) {
        captures.push(capture)
      }
      const matched = lookupInNode(
        patternChild.node,
        rawPath,
        matchPath,
        nextIndex,
        captures,
        maxParamLength,
        onMatch,
      )
      captures.length -= patternCaptures.length
      if (matched) {
        return true
      }
    }
  }

  if (node.paramChild) {
    captures.push([index, end])
    const matched = lookupInNode(node.paramChild, rawPath, matchPath, nextIndex, captures, maxParamLength, onMatch)
    captures.pop()
    if (matched) {
      return true
    }
  }

  if (node.wildcardRoute) {
    captures.push([index, matchPath.length])
    const matched = finalizeLookup(node.wildcardRoute, rawPath, captures, maxParamLength, onMatch)
    captures.pop()
    return matched
  }

  return false
}

function matchPatternSegment(
  segment: Extract<RouteDefinition["segments"][number], { kind: "pattern" }>,
  rawPath: string,
  matchPath: string,
  start: number,
  end: number,
  maxParamLength: number,
): Array<[number, number]> | null {
  const localSegment = matchPath.slice(start, end)
  const match = segment.matcher.exec(localSegment)
  if (!match?.groups) {
    return null
  }

  const captures: Array<[number, number]> = []
  let offset = 0
  let paramIndex = 0

  for (const part of segment.parts) {
    if (part.kind === "static") {
      offset += part.value.length
      continue
    }

    const captureValue = match.groups[`p${paramIndex}`]
    if (typeof captureValue !== "string" || captureValue.length === 0) {
      return null
    }

    const captureStart = start + offset
    const captureEnd = captureStart + captureValue.length
    const decoded = decodeCapture(rawPath, captureStart, captureEnd, maxParamLength)
    if (decoded === null) {
      return null
    }
    if (part.constraint && !part.constraint.test(decoded)) {
      return null
    }

    captures.push([captureStart, captureEnd])
    offset += captureValue.length
    paramIndex += 1
  }

  if (offset !== (end - start)) {
    return null
  }

  return captures
}

function finalizeFind(
  route: RouteDefinition,
  rawPath: string,
  captures: Array<[number, number]>,
  maxParamLength: number,
): MatchResult | null {
  if (!hasValidTrailingWildcardCapture(route, rawPath, captures)) {
    return null
  }

  const names = getCaptureNames(route)
  if (names.length === 0) {
    return {
      storeId: route.storeId,
      params: null,
      routePath: route.routePath,
    }
  }

  if (names.length === 1) {
    const capture = captures[0]
    if (!capture) {
      return null
    }

    const decoded = decodeCapture(rawPath, capture[0], capture[1], maxParamLength)
    if (decoded === null) {
      return null
    }

    return {
      storeId: route.storeId,
      params: route.createParams ? route.createParams(decoded) : { [names[0] ?? "param_0"]: decoded },
      routePath: route.routePath,
    }
  }

  const values: string[] = []
  for (let index = 0; index < names.length; index++) {
    const capture = captures[index]
    if (!capture) {
      return null
    }
    const decoded = decodeCapture(rawPath, capture[0], capture[1], maxParamLength)
    if (decoded === null) {
      return null
    }
    values.push(decoded)
  }

  return {
    storeId: route.storeId,
    params: route.createParams ? route.createParams(...values) : null,
    routePath: route.routePath,
  }
}

function finalizeSingleCaptureFind(
  route: RouteDefinition,
  rawPath: string,
  start: number,
  end: number,
  maxParamLength: number,
): MatchResult | null {
  if (!hasValidTrailingWildcardCaptureRange(route, rawPath, start, end)) {
    return null
  }

  const decoded = decodeCapture(rawPath, start, end, maxParamLength)
  if (decoded === null) {
    return null
  }

  return {
    storeId: route.storeId,
    params: route.createParams ? route.createParams(decoded) : null,
    routePath: route.routePath,
  }
}

function finalizeLookup(
  route: RouteDefinition,
  rawPath: string,
  captures: Array<[number, number]>,
  maxParamLength: number,
  onMatch: LookupHandler,
): boolean {
  if (!hasValidTrailingWildcardCapture(route, rawPath, captures)) {
    return false
  }

  const names = getCaptureNames(route)
  if (names.length === 0) {
    onMatch(route.storeId, null, route.routePath)
    return true
  }

  if (names.length === 1) {
    const capture = captures[0]
    if (!capture) {
      return false
    }

    const decoded = decodeCapture(rawPath, capture[0], capture[1], maxParamLength)
    if (decoded === null) {
      return false
    }

    onMatch(
      route.storeId,
      route.createParams ? route.createParams(decoded) : { [names[0] ?? "param_0"]: decoded },
      route.routePath,
    )
    return true
  }

  const values: string[] = []
  for (let index = 0; index < names.length; index++) {
    const capture = captures[index]
    if (!capture) {
      return false
    }
    const decoded = decodeCapture(rawPath, capture[0], capture[1], maxParamLength)
    if (decoded === null) {
      return false
    }
    values.push(decoded)
  }

  onMatch(route.storeId, route.createParams ? route.createParams(...values) : null, route.routePath)
  return true
}

function finalizeSingleCaptureLookup(
  route: RouteDefinition,
  rawPath: string,
  start: number,
  end: number,
  maxParamLength: number,
  onMatch: LookupHandler,
): boolean {
  if (!hasValidTrailingWildcardCaptureRange(route, rawPath, start, end)) {
    return false
  }

  const decoded = decodeCapture(rawPath, start, end, maxParamLength)
  if (decoded === null) {
    return false
  }

  onMatch(route.storeId, route.createParams ? route.createParams(decoded) : null, route.routePath)
  return true
}

function isGroupedTrailingParamRoute(route: RouteDefinition): boolean {
  if (route.segments.length === 0) {
    return false
  }

  const tail = route.segments[route.segments.length - 1]
  if (!tail || tail.kind !== "param") {
    return false
  }

  if (!route.segments.slice(0, -1).every((segment) => segment.kind === "static")) {
    return false
  }

  return route.segments.length > 1
}

function buildTrailingParamGroupParts(route: RouteDefinition): {
  headPrefix: string
  discriminator: string
} {
  const staticParts = route.segments
    .slice(0, -1)
    .map((segment) => (segment.kind === "static" ? segment.key : ""))

  const discriminator = staticParts[staticParts.length - 1] ?? ""
  const headParts = staticParts.slice(0, -1)
  return {
    headPrefix: headParts.length === 0 ? "/" : `/${headParts.join("/")}/`,
    discriminator,
  }
}

function findTrailingParamMatch(
  groups: readonly TrailingParamGroup[] | null,
  rawPath: string,
  matchPath: string,
  maxParamLength: number,
): MatchResult | null {
  if (!groups) {
    return null
  }

  for (const group of groups) {
    if (!matchPath.startsWith(group.headPrefix)) {
      continue
    }

    const segmentStart = group.headPrefix.length
    const slashIndex = matchPath.indexOf("/", segmentStart)
    if (slashIndex < 0) {
      continue
    }

    const route = resolveTrailingParamRoute(group, matchPath, segmentStart, slashIndex)
    if (!route) {
      continue
    }

    return finalizeSingleCaptureFind(route, rawPath, slashIndex + 1, matchPath.length, maxParamLength)
  }

  return null
}

function lookupTrailingParamMatch(
  groups: readonly TrailingParamGroup[] | null,
  rawPath: string,
  matchPath: string,
  maxParamLength: number,
  onMatch: LookupHandler,
): boolean {
  if (!groups) {
    return false
  }

  for (const group of groups) {
    if (!matchPath.startsWith(group.headPrefix)) {
      continue
    }

    const segmentStart = group.headPrefix.length
    const slashIndex = matchPath.indexOf("/", segmentStart)
    if (slashIndex < 0) {
      continue
    }

    const route = resolveTrailingParamRoute(group, matchPath, segmentStart, slashIndex)
    if (!route) {
      continue
    }

    return finalizeSingleCaptureLookup(
      route,
      rawPath,
      slashIndex + 1,
      matchPath.length,
      maxParamLength,
      onMatch,
    )
  }

  return false
}

function isTrailingStaticWildcardRoute(route: RouteDefinition): boolean {
  if (route.segments.length === 0) {
    return false
  }

  const tail = route.segments[route.segments.length - 1]
  if (!tail || tail.kind !== "wildcard") {
    return false
  }

  return route.segments.slice(0, -1).every((segment) => segment.kind === "static")
}

function createTrailingWildcardRoute(route: RouteDefinition): TrailingWildcardRoute {
  const basePath = route.matchPath
  return {
    route,
    basePath,
    prefix: basePath === "/" ? null : `${basePath}/`,
  }
}

function findTrailingWildcardMatch(
  routes: readonly TrailingWildcardRoute[],
  rawPath: string,
  matchPath: string,
  maxParamLength: number,
): MatchResult | null {
  for (const route of routes) {
    const capture = trailingWildcardCapture(route, matchPath)
    if (!capture) {
      continue
    }
    const result = finalizeSingleCaptureFind(route.route, rawPath, capture[0], capture[1], maxParamLength)
    if (result) {
      return result
    }
  }

  return null
}

function lookupTrailingWildcardMatch(
  routes: readonly TrailingWildcardRoute[],
  rawPath: string,
  matchPath: string,
  maxParamLength: number,
  onMatch: LookupHandler,
): boolean {
  for (const route of routes) {
    const capture = trailingWildcardCapture(route, matchPath)
    if (!capture) {
      continue
    }
    if (finalizeSingleCaptureLookup(route.route, rawPath, capture[0], capture[1], maxParamLength, onMatch)) {
      return true
    }
  }

  return false
}

function trailingWildcardCapture(
  route: TrailingWildcardRoute,
  matchPath: string,
): [number, number] | null {
  const { basePath, prefix } = route
  if (basePath === "/") {
    return matchPath.length === 1
      ? [1, 1]
      : [1, matchPath.length]
  }

  if (matchPath === basePath) {
    return [matchPath.length, matchPath.length]
  }

  if (!prefix || !matchPath.startsWith(prefix)) {
    return null
  }

  return [prefix.length, matchPath.length]
}

function decodeCapture(
  rawPath: string,
  start: number,
  end: number,
  maxParamLength: number,
): string | null {
  const rawLength = end - start
  if (rawLength < 0) {
    return null
  }

  const percentIndex = rawPath.indexOf("%", start)
  if (percentIndex === -1 || percentIndex >= end) {
    if (rawLength > maxParamLength) {
      return null
    }
    return rawPath.slice(start, end)
  }

  const decoded = decodeSegmentRange(rawPath, start, end)
  if (decoded === null || decoded.length > maxParamLength) {
    return null
  }
  return decoded
}

function hasValidTrailingWildcardCapture(
  route: RouteDefinition,
  rawPath: string,
  captures: Array<[number, number]>,
): boolean {
  const fixedSegmentCount = getTrailingWildcardSegmentCount(route)
  if (fixedSegmentCount === null) {
    return true
  }

  const capture = captures[captures.length - 1]
  if (!capture) {
    return false
  }

  return countSegmentsInRange(rawPath, capture[0], capture[1]) === fixedSegmentCount
}

function hasValidTrailingWildcardCaptureRange(
  route: RouteDefinition,
  rawPath: string,
  start: number,
  end: number,
): boolean {
  const fixedSegmentCount = getTrailingWildcardSegmentCount(route)
  if (fixedSegmentCount === null) {
    return true
  }

  return countSegmentsInRange(rawPath, start, end) === fixedSegmentCount
}

function countSegmentsInRange(path: string, start: number, end: number): number {
  if (start === end) {
    return 0
  }

  let count = 1
  for (let index = start; index < end; index++) {
    if (path.charCodeAt(index) === 47) {
      count += 1
    }
  }
  return count
}

function getPathRootKey(matchPath: string): string | null {
  if (matchPath.length <= 1) {
    return null
  }

  const firstSlashIndex = matchPath.indexOf("/", 1)
  if (firstSlashIndex === -1) {
    return matchPath.slice(1)
  }
  return matchPath.slice(1, firstSlashIndex)
}

function resolveTrailingParamRoute(
  group: TrailingParamGroup,
  matchPath: string,
  segmentStart: number,
  slashIndex: number,
): RouteDefinition | undefined {
  const numericRoutes = group.numericRoutes
  if (numericRoutes) {
    const index = parseCanonicalNumericSegment(matchPath, segmentStart, slashIndex)
    if (index !== null) {
      return numericRoutes[index]
    }
  }

  return group.routesByDiscriminator[matchPath.slice(segmentStart, slashIndex)]
}

function buildNumericRoutes(
  group: TrailingParamGroup,
): Array<RouteDefinition | undefined> | null {
  if (!group.numericCandidates || group.numericCandidates.length !== group.routeCount) {
    return null
  }

  if (group.numericMaxIndex < 0) {
    return null
  }

  const maxAllowedIndex = Math.max(32, group.routeCount * 4)
  if (group.numericMaxIndex > maxAllowedIndex) {
    return null
  }

  const numericRoutes = new Array<RouteDefinition | undefined>(group.numericMaxIndex + 1)
  for (const [index, route] of group.numericCandidates) {
    numericRoutes[index] = route
  }
  return numericRoutes
}

function parseCanonicalNumericDiscriminator(discriminator: string): number | null {
  if (discriminator.length === 0) {
    return null
  }

  if (discriminator.length > 1 && discriminator.charCodeAt(0) === 48) {
    return null
  }

  let value = 0
  for (let index = 0; index < discriminator.length; index++) {
    const digit = discriminator.charCodeAt(index) - 48
    if (digit < 0 || digit > 9) {
      return null
    }
    value = (value * 10) + digit
  }
  return value
}

function parseCanonicalNumericSegment(
  path: string,
  start: number,
  end: number,
): number | null {
  if (start >= end) {
    return null
  }

  if ((end - start) > 1 && path.charCodeAt(start) === 48) {
    return null
  }

  let value = 0
  for (let index = start; index < end; index++) {
    const digit = path.charCodeAt(index) - 48
    if (digit < 0 || digit > 9) {
      return null
    }
    value = (value * 10) + digit
  }
  return value
}
