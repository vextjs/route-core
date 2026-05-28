import type { Segment } from "./normalize.js"

export type RouteDefinition = {
  method: string
  matchPath: string
  routePath: string
  segments: Segment[]
  captureNames: string[]
  createParams: ((...values: string[]) => Record<string, string>) | null
  storeId: number
}

export type DynamicTrieNode = {
  terminal: RouteDefinition | null
  wildcardRoute: RouteDefinition | null
  readonly staticChildren: Map<string, DynamicTrieNode>
  paramChild: DynamicTrieNode | null
}

export function createRouteDefinition(
  method: string,
  routePath: string,
  segments: Segment[],
  storeId: number,
): RouteDefinition {
  const captureNames = segments.flatMap((segment) => {
    if (segment.kind === "param" || segment.kind === "wildcard") {
      return [segment.name]
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

      node.wildcardRoute = route
      break
    }

    const tail = route.segments[route.segments.length - 1]
    if (!tail || tail.kind !== "wildcard") {
      node.terminal = route
    }
  }

  return root
}
