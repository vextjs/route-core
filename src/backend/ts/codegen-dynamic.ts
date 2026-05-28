import type { MatchResult } from "../../types.js"
import { decodeSegmentRange } from "./normalize.js"
import type { LookupHandler } from "./trie.js"
import type { DynamicTrieNode, RouteDefinition } from "./ir.js"
import { buildDynamicTrie, getCaptureNames } from "./ir.js"
import { generateTerminalFinalizer } from "./codegen-finalizer.js"

export type DynamicFindFn = (rawPath: string, matchPath: string) => MatchResult | null
export type DynamicLookupFn = (rawPath: string, matchPath: string, onMatch: LookupHandler) => boolean

export type DynamicCodegenResult = {
  find: DynamicFindFn
  lookup: DynamicLookupFn
  sourceLength: number
}

type CodegenMode = "find" | "lookup"

type CodegenContext = {
  counter: number
  maxParamLength: number
  mode: CodegenMode
}

export function compileDynamicMatcher(
  routes: RouteDefinition[],
  maxParamLength: number,
): DynamicCodegenResult {
  if (routes.length === 0) {
    return {
      find: () => null,
      lookup: () => false,
      sourceLength: 0,
    }
  }

  const trie = buildDynamicTrie(routes)
  const maxCaptures = routes.reduce((currentMax, route) => {
    return Math.max(currentMax, getCaptureNames(route).length)
  }, 0)

  const findSource = renderDynamicSource(trie, maxCaptures, maxParamLength, "find")
  const lookupSource = renderDynamicSource(trie, maxCaptures, maxParamLength, "lookup")

  const find = new Function(
    "decodeSegmentRange",
    `
      return function generatedDynamicFind(rawPath, matchPath) {
        const path = matchPath
        const pathLen = path.length
        ${renderCaptureDeclarations(maxCaptures)}
        ${findSource}
        return null
      }
    `,
  )(decodeSegmentRange) as DynamicFindFn

  const lookup = new Function(
    "decodeSegmentRange",
    `
      return function generatedDynamicLookup(rawPath, matchPath, onMatch) {
        const path = matchPath
        const pathLen = path.length
        ${renderCaptureDeclarations(maxCaptures)}
        ${lookupSource}
        return false
      }
    `,
  )(decodeSegmentRange) as DynamicLookupFn

  return {
    find,
    lookup,
    sourceLength: findSource.length + lookupSource.length,
  }
}

function renderCaptureDeclarations(maxCaptures: number): string {
  if (maxCaptures === 0) {
    return ""
  }

  const lines: string[] = []
  for (let index = 0; index < maxCaptures; index++) {
    lines.push(`let c${index}s = 0;`)
    lines.push(`let c${index}e = 0;`)
  }
  return lines.join("\n")
}

function renderDynamicSource(
  trie: DynamicTrieNode,
  maxCaptures: number,
  maxParamLength: number,
  mode: CodegenMode,
): string {
  const context: CodegenContext = {
    counter: 0,
    maxParamLength,
    mode,
  }

  return renderNode(trie, "1", 0, context)
}

function renderNode(
  node: DynamicTrieNode,
  indexExpr: string,
  captureCount: number,
  context: CodegenContext,
): string {
  const lines: string[] = []

  if (node.terminal || node.wildcardRoute) {
    lines.push(`if (${indexExpr} === pathLen) {`)
    if (node.terminal) {
      lines.push(indent(generateTerminalFinalizer(
        node.terminal,
        captureIndexes(node.terminal),
        context.maxParamLength,
        context.mode,
      )))
    }
    if (node.wildcardRoute) {
      lines.push(indent(`c${captureCount}s = pathLen;`))
      lines.push(indent(`c${captureCount}e = pathLen;`))
      lines.push(indent(generateTerminalFinalizer(
        node.wildcardRoute,
        captureIndexes(node.wildcardRoute),
        context.maxParamLength,
        context.mode,
      )))
    }
    lines.push("}")
  }

  if (
    node.staticChildren.size === 0
    && node.paramChild === null
    && node.wildcardRoute === null
  ) {
    return lines.join("\n")
  }

  lines.push(`if (${indexExpr} < pathLen) {`)

  const rawEndVar = uniqueName(context, "segment_end_raw")
  const endVar = uniqueName(context, "segment_end")
  lines.push(indent(`const ${rawEndVar} = path.indexOf("/", ${indexExpr});`))
  lines.push(indent(`const ${endVar} = ${rawEndVar} === -1 ? pathLen : ${rawEndVar};`))

  const staticKeys = [...node.staticChildren.keys()].sort()
  if (staticKeys.length > 0) {
    const keyVar = uniqueName(context, "segment_key")
    lines.push(indent(`const ${keyVar} = path.slice(${indexExpr}, ${endVar});`))
    lines.push(indent(`switch (${keyVar}) {`))
    for (const key of staticKeys) {
      const child = node.staticChildren.get(key)
      if (!child) {
        continue
      }
      const nextVar = uniqueName(context, "next_index")
      lines.push(indent(`case ${JSON.stringify(key)}:`, 2))
      lines.push(indent(`const ${nextVar} = ${endVar} === pathLen ? pathLen : ${endVar} + 1;`, 3))
      const childCode = renderNode(child, nextVar, captureCount, context)
      if (childCode) {
        lines.push(indent(childCode, 3))
      }
      lines.push(indent("break;", 3))
    }
    lines.push(indent("default:", 2))
    lines.push(indent("break;", 3))
    lines.push(indent("}"))
  }

  if (node.paramChild) {
    const nextVar = uniqueName(context, "next_index")
    lines.push(indent(`c${captureCount}s = ${indexExpr};`))
    lines.push(indent(`c${captureCount}e = ${endVar};`))
    lines.push(indent(`const ${nextVar} = ${endVar} === pathLen ? pathLen : ${endVar} + 1;`))
    const childCode = renderNode(node.paramChild, nextVar, captureCount + 1, context)
    if (childCode) {
      lines.push(indent(childCode))
    }
  }

  if (node.wildcardRoute) {
    lines.push(indent(`c${captureCount}s = ${indexExpr};`))
    lines.push(indent(`c${captureCount}e = pathLen;`))
    lines.push(indent(generateTerminalFinalizer(
      node.wildcardRoute,
      captureIndexes(node.wildcardRoute),
      context.maxParamLength,
      context.mode,
    )))
  }

  lines.push("}")
  return lines.join("\n")
}

function captureIndexes(route: RouteDefinition): number[] {
  return getCaptureNames(route).map((_, index) => index)
}

function indent(source: string, depth = 1): string {
  const prefix = "  ".repeat(depth)
  return source
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n")
}

function uniqueName(context: CodegenContext, prefix: string): string {
  const value = context.counter
  context.counter += 1
  return `${prefix}_${value}`
}
