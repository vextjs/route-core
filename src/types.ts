export interface RouterOptions {
  ignoreTrailingSlash?: boolean
  caseSensitive?: boolean
  maxParamLength?: number
  allowWildcard?: boolean
}

export interface MatchResult {
  storeId: number
  params: Record<string, string> | null
}

export interface Router {
  add(method: string, path: string, storeId: number): void
  find(method: string, path: string): MatchResult | null
  allowed(path: string): string[] | null
}
