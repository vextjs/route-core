import type { RouteDefinition } from "./ir.js"
import { getCaptureNames } from "./ir.js"

type FinalizerMode = "find" | "lookup"

export function generateTerminalFinalizer(
  route: RouteDefinition,
  captureVarIndexes: number[],
  maxParamLength: number,
  mode: FinalizerMode,
): string {
  const names = getCaptureNames(route)
  if (names.length === 0) {
    if (mode === "find") {
      return `return { storeId: ${route.storeId}, params: null, routePath: ${JSON.stringify(route.routePath)} };`
    }
    return `onMatch(${route.storeId}, null, ${JSON.stringify(route.routePath)}); return true;`
  }

  const lines: string[] = []
  const valueNames: string[] = []

  for (let index = 0; index < names.length; index++) {
    const captureIndex = captureVarIndexes[index]
    const valueName = `value_${route.storeId}_${index}`
    valueNames.push(valueName)
    lines.push(`const ${valueName} = decodeSegmentRange(rawPath, c${captureIndex}s, c${captureIndex}e);`)
    lines.push(`if (${valueName} !== null && ${valueName}.length <= ${maxParamLength}) {`)
  }

  const paramPairs = names.map((name, index) => `${JSON.stringify(name)}: ${valueNames[index]}`)
  const paramsLiteral = `{ ${paramPairs.join(", ")} }`

  if (mode === "find") {
    lines.push(`return { storeId: ${route.storeId}, params: ${paramsLiteral}, routePath: ${JSON.stringify(route.routePath)} };`)
    for (let index = 0; index < names.length; index++) {
      lines.push("}")
    }
    return lines.join("\n")
  }

  lines.push(`onMatch(${route.storeId}, ${paramsLiteral}, ${JSON.stringify(route.routePath)});`)
  lines.push("return true;")
  for (let index = 0; index < names.length; index++) {
    lines.push("}")
  }
  return lines.join("\n")
}
