export interface RouterOptions {
  ignoreTrailingSlash?: boolean
  caseSensitive?: boolean
  maxParamLength?: number
  allowWildcard?: boolean
}

export interface MatchResult {
  storeId: number
  params: Record<string, string> | null
  routePath: string
}

export type LookupHandler = (
  storeId: number,
  params: Record<string, string> | null,
  routePath: string,
) => void

export interface Router {
  add(method: string, path: string, storeId: number): void
  find(method: string, path: string): MatchResult | null
  lookup(method: string, path: string, onMatch: LookupHandler): boolean
  allowed(path: string): string[] | null
}
