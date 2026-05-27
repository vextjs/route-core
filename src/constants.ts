import type { RouterOptions } from "./types.js"

export const DEFAULT_OPTIONS: Required<RouterOptions> = {
  ignoreTrailingSlash: true,
  caseSensitive: false,
  maxParamLength: 500,
  allowWildcard: true,
}

export const BUILTIN_METHOD_ORDER = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
  "CONNECT",
]

export const ANY_METHOD = "ANY"
export const METHOD_TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
export const PARAM_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
