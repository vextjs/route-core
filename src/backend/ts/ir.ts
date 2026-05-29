import type { Segment } from "./normalize.js"

export type RouteDefinition = {
  method: string
  matchPath: string
  routePath: string
  segments: Segment[]
  captureNames: string[]
  createParams: ((...values: string[]) => Record<string, string>) | null
  storeId: number
  priority: number
  allowExactStaticOverlap: boolean
}

export type DynamicTrieNode = {
  terminal: RouteDefinition | null
  wildcardRoute: RouteDefinition | null
  readonly staticChildren: Map<string, DynamicTrieNode>
  readonly patternChildren: DynamicPatternChild[]
  paramChild: DynamicTrieNode | null
}

export type DynamicPatternChild = {
  segment: Extract<Segment, { kind: "pattern" }>
  node: DynamicTrieNode
}

export function createRouteDefinition(
  method: string,
  routePath: string,
  segments: Segment[],
  storeId: number,
  options: {
    priority?: number
    allowExactStaticOverlap?: boolean
  } = {},
): RouteDefinition {
  const captureNames = segments.flatMap((segment) => {
    if (segment.kind === "param" || segment.kind === "wildcard") {
      return [segment.name]
    }
    if (segment.kind === "pattern") {
      return [...segment.captureNames]
    }
    return []
  })

  return {
    method,
    matchPath: buildMatchPath(segments),
    routePath,
    segments,
    captureNames,
    createParams: captureNames.length === 0 ? null : compileParamsFactory(captureNames),
    storeId,
    priority: options.priority ?? 0,
    allowExactStaticOverlap: options.allowExactStaticOverlap ?? false,
  }
}

export function buildMatchPath(segments: Segment[]): string {
  if (segments.length === 0) {
    return "/"
  }

  const parts: string[] = []
  for (const segment of segments) {
    if (segment.kind !== "static") {
      break
    }
    parts.push(segment.key)
  }

  return parts.length === 0 ? "/" : `/${parts.join("/")}`
}

export function isExactStaticRoute(route: RouteDefinition): boolean {
  return route.segments.every((segment) => segment.kind === "static")
}

export function getExactStaticPath(route: RouteDefinition): string {
  if (!isExactStaticRoute(route)) {
    throw new TypeError("route is not exact static")
  }
  return buildMatchPath(route.segments)
}

export function getCaptureNames(route: RouteDefinition): string[] {
  return route.captureNames
}

export function getLeadingStaticPrefix(route: RouteDefinition): string {
  const parts: string[] = []
  for (const segment of route.segments) {
    if (segment.kind !== "static") {
      break
    }
    parts.push(segment.key)
  }
  return parts.length === 0 ? "/" : `/${parts.join("/")}`
}

export function getSegmentCount(route: RouteDefinition): number {
  return route.segments.length
}

export function getRootStaticSegment(route: RouteDefinition): string | null {
  const first = route.segments[0]
  if (!first || first.kind !== "static") {
    return null
  }
  return first.key
}

export function getTrailingWildcardSegmentCount(route: RouteDefinition): number | null {
  const tail = route.segments[route.segments.length - 1]
  if (!tail || tail.kind !== "wildcard") {
    return null
  }

  return tail.segmentCount
}

export function hasPatternSegments(route: RouteDefinition): boolean {
  return route.segments.some((segment) => segment.kind === "pattern")
}

function compileParamsFactory(names: string[]): (...values: string[]) => Record<string, string> {
  const argNames = names.map((_, index) => `value${index}`)
  const paramsLiteral = names
    .map((name, index) => `${JSON.stringify(name)}: value${index}`)
    .join(", ")

  return new Function(
    ...argNames,
    `return { ${paramsLiteral} };`,
  ) as (...values: string[]) => Record<string, string>
}

export function createDynamicTrieNode(): DynamicTrieNode {
  return {
    terminal: null,
    wildcardRoute: null,
    staticChildren: new Map<string, DynamicTrieNode>(),
    patternChildren: [],
    paramChild: null,
  }
}

export function buildDynamicTrie(routes: RouteDefinition[]): DynamicTrieNode {
  const root = createDynamicTrieNode()

  for (const route of routes) {
    let node = root
    for (const segment of route.segments) {
      if (segment.kind === "static") {
        let child = node.staticChildren.get(segment.key)
        if (!child) {
          child = createDynamicTrieNode()
          node.staticChildren.set(segment.key, child)
        }
        node = child
        continue
      }

      if (segment.kind === "param") {
        if (!node.paramChild) {
          node.paramChild = createDynamicTrieNode()
        }
        node = node.paramChild
        continue
      }

      if (segment.kind === "pattern") {
        let child = node.patternChildren.find((candidate) => candidate.segment.signature === segment.signature)
        if (!child) {
          child = {
            segment,
            node: createDynamicTrieNode(),
          }
          node.patternChildren.push(child)
        }
        node = child.node
        continue
      }

      node.wildcardRoute = route
      break
    }

    const tail = route.segments[route.segments.length - 1]
    if (!tail || tail.kind !== "wildcard") {
      node.terminal = route
    }
  }

  sortDynamicTrie(root)
  return root
}

function sortDynamicTrie(node: DynamicTrieNode): void {
  node.patternChildren.sort((left, right) => comparePatternSegments(left.segment, right.segment))
  for (const child of node.staticChildren.values()) {
    sortDynamicTrie(child)
  }
  for (const child of node.patternChildren) {
    sortDynamicTrie(child.node)
  }
  if (node.paramChild) {
    sortDynamicTrie(node.paramChild)
  }
}

function comparePatternSegments(
  left: Extract<Segment, { kind: "pattern" }>,
  right: Extract<Segment, { kind: "pattern" }>,
): number {
  if (left.staticLiteralLength !== right.staticLiteralLength) {
    return right.staticLiteralLength - left.staticLiteralLength
  }

  if (left.regexParamCount !== right.regexParamCount) {
    return right.regexParamCount - left.regexParamCount
  }

  if (left.paramCount !== right.paramCount) {
    return left.paramCount - right.paramCount
  }

  return left.signature.localeCompare(right.signature)
}
