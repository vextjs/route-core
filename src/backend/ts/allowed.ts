import type { PreparedLookupPath } from "./normalize.js"
import type { CompiledMethodRuntime } from "./compiler.js"

export function findAllowedMethodsCompiled(
  methods: Map<string, CompiledMethodRuntime>,
  methodOrder: string[],
  preparedPath: PreparedLookupPath,
): string[] | null {
  const allowed: string[] = []
  const rawPathname = typeof preparedPath === "string" ? preparedPath : preparedPath.rawPathname
  const matchPathname = typeof preparedPath === "string" ? preparedPath : preparedPath.matchPathname

  for (const method of methodOrder) {
    const runtime = methods.get(method)
    if (!runtime) {
      continue
    }

    if (runtime.matches(rawPathname, matchPathname)) {
      allowed.push(method)
    }
  }

  return allowed.length > 0 ? allowed : null
}
