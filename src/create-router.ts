import type { Router, RouterOptions } from "./types.js"
import { RouteCoreRouter } from "./backend/ts/router.js"

export function createRouter(options?: RouterOptions): Router {
  return new RouteCoreRouter(options)
}
