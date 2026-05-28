import type { MatchResult } from "../../types.js"
import type { LookupHandler } from "./trie.js"
import type { RouteDefinition } from "./ir.js"
import { getExactStaticPath } from "./ir.js"

export type StaticFindFn = (rawPath: string, matchPath: string) => MatchResult | null
export type StaticLookupFn = (rawPath: string, matchPath: string, onMatch: LookupHandler) => boolean

export type StaticCodegenResult = {
  find: StaticFindFn
  lookup: StaticLookupFn
  sourceLength: number
}

export function compileStaticDispatcher(routes: RouteDefinition[]): StaticCodegenResult {
  if (routes.length === 0) {
    return {
      find: () => null,
      lookup: () => false,
      sourceLength: 0,
    }
  }

  const sortedRoutes = [...routes].sort((left, right) => getExactStaticPath(left).localeCompare(getExactStaticPath(right)))
  const findSource = renderStaticSource(sortedRoutes, "find")
  const lookupSource = renderStaticSource(sortedRoutes, "lookup")

  const find = new Function(`
    return function generatedStaticFind(rawPath, matchPath) {
      const path = matchPath
      ${findSource}
      return null
    }
  `)() as StaticFindFn

  const lookup = new Function(`
    return function generatedStaticLookup(rawPath, matchPath, onMatch) {
      const path = matchPath
      ${lookupSource}
      return false
    }
  `)() as StaticLookupFn

  return {
    find,
    lookup,
    sourceLength: findSource.length + lookupSource.length,
  }
}

function renderStaticSource(
  routes: RouteDefinition[],
  mode: "find" | "lookup",
): string {
  const lines: string[] = []
  lines.push("switch (path) {")
  for (const route of routes) {
    const exactPath = getExactStaticPath(route)
    lines.push(`case ${JSON.stringify(exactPath)}:`)
    if (mode === "find") {
      lines.push(`return { storeId: ${route.storeId}, params: null, routePath: ${JSON.stringify(route.routePath)} };`)
      continue
    }
    lines.push(`onMatch(${route.storeId}, null, ${JSON.stringify(route.routePath)});`)
    lines.push("return true;")
  }
  lines.push("default:")
  lines.push("break;")
  lines.push("}")
  return lines.join("\n")
}
