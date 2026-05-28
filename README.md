# route-core

`route-core` is a small, zero-runtime-dependency routing engine for Node.js frameworks. It maps HTTP methods and paths to numeric `storeId` values, returns decoded route parameters, preserves the registered route template, and leaves handler ownership to the host framework.

It is designed for framework adapters that want a focused router core instead of a full HTTP dispatcher.

Current releases prioritize routing semantics, adapter compatibility, and package surface stability first. Benchmark-driven throughput tuning is still in progress.

- **Small public API**: `add`, `find`, `lookup`, and `allowed`.
- **Framework-owned stores**: route-core stores ids and params only; your framework owns handlers, middleware, and metadata.
- **Template-aware matching**: matches include `routePath`, which is useful for low-cardinality values such as `req.route`.
- **CJS, ESM, and TypeScript support**: the package exports CommonJS, ES module, and declaration entry points.

## Contents

- [Install](#install)
- [Quick Start](#quick-start)
- [API Reference](#api-reference)
  - [createRouter(options?)](#createrouteroptions)
  - [RouterOptions](#routeroptions)
  - [router.add(method, path, storeId)](#routeraddmethod-path-storeid)
  - [router.find(method, path)](#routerfindmethod-path)
  - [router.lookup(method, path, onMatch)](#routerlookupmethod-path-onmatch)
  - [router.allowed(path)](#routerallowedpath)
- [404 vs 405](#404-vs-405)
- [Route Syntax](#route-syntax)
  - [URL and Parameter Normalization](#url-and-parameter-normalization)
  - [Priority](#priority)
  - [ANY Method](#any-method)
- [Framework Integration](#framework-integration)
- [TypeScript](#typescript)
- [Language-Specific Documentation](#language-specific-documentation)
- [Error Reference](#error-reference)
- [Changelog](#changelog)
- [License](#license)

## Install

```bash
npm install route-core
```

## Quick Start

CommonJS:

```js
const { createRouter } = require('route-core')
```

ES modules:

```js
import { createRouter } from 'route-core'
```

Basic usage:

```js
const { createRouter } = require('route-core')

const router = createRouter()

router.add('GET', '/users', 0)
router.add('GET', '/users/:id', 1)
router.add('POST', '/users', 2)

console.log(router.find('GET', '/users'))
// { storeId: 0, params: null, routePath: '/users' }

console.log(router.find('GET', '/users/42'))
// { storeId: 1, params: { id: '42' }, routePath: '/users/:id' }

console.log(router.allowed('/users'))
// ['GET', 'POST']
```

Use `lookup()` when your adapter prefers callback-style dispatch without allocating a `MatchResult` wrapper:

```js
router.lookup('GET', '/users/42', (storeId, params, routePath) => {
  console.log(storeId)   // 1
  console.log(params)    // { id: '42' }
  console.log(routePath) // '/users/:id'
})
```

## API Reference

### `createRouter(options?)`

Creates and returns a new `Router` instance.

```ts
function createRouter(options?: RouterOptions): Router
```

#### `RouterOptions`

| Option | Type | Default | Description |
|------|------|:------:|------|
| `ignoreTrailingSlash` | `boolean` | `true` | Treats `/foo` and `/foo/` as the same route |
| `caseSensitive` | `boolean` | `false` | When `false`, the matcher normalizes path keys to lowercase |
| `maxParamLength` | `number` | `500` | Maximum decoded length for a parameter segment; overflow returns `null` |
| `allowWildcard` | `boolean` | `true` | When `false`, wildcard routes throw `InvalidPathError` |

### `router.add(method, path, storeId)`

Registers a route.

```ts
router.add(method: string, path: string, storeId: number): void
```

| Parameter | Description |
|------|------|
| `method` | HTTP method. Built-ins include `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`, `CONNECT`, and `ANY`. Methods are normalized to uppercase. |
| `path` | Route pattern. Supports static segments, `:param` named parameters, and trailing `*name` wildcards. |
| `storeId` | Non-negative safe integer returned on match. Your framework can map it to handlers or stores. |

Errors:

| Error class | Code | Trigger |
|--------|------|---------|
| `RouteConflictError` | `ERR_ROUTE_CONFLICT` | Duplicate registration for the same method and normalized route shape |
| `InvalidPathError` | `ERR_INVALID_PATH` | Wildcard route used while `allowWildcard` is `false` |
| `InvalidMethodError` | `ERR_INVALID_METHOD` | Empty method string |
| `InvalidStoreIdError` | `ERR_INVALID_STORE_ID` | `storeId` is not a non-negative safe integer |

### `router.find(method, path)`

Returns `MatchResult` on hit, or `null` on miss or invalid parameter input.

```ts
router.find(method: string, path: string): MatchResult | null
```

```ts
interface MatchResult {
  storeId: number
  params: Record<string, string> | null
  routePath: string
}
```

`find()` returns `null` when:

- No route matches.
- The matched parameter value exceeds `maxParamLength`.
- URL decoding fails for a matched parameter or wildcard value.

### `router.lookup(method, path, onMatch)`

Looks up a route and calls the callback directly on hit. This is intended for adapter integrations that prefer callback-style dispatch.

```ts
router.lookup(
  method: string,
  path: string,
  onMatch: (storeId: number, params: Record<string, string> | null, routePath: string) => void,
): boolean
```

| Return value | Meaning |
|--------|------|
| `true` | A route matched and `onMatch` was called |
| `false` | No route matched, or matched params were invalid |

`lookup()` follows the same matching semantics as `find()`, but avoids returning a `MatchResult` object.

### `router.allowed(path)`

Returns the registered methods for a path so you can distinguish `404 Not Found` from `405 Method Not Allowed`.

```ts
router.allowed(path: string): string[] | null
```

| Return value | Meaning |
|--------|------|
| `null` | No path match exists in any method bucket |
| `string[]` | The path exists, but the current request method is not registered |

Call `allowed()` only after `find()` returns `null`.

## 404 vs 405

```js
const { createRouter } = require('route-core')

const router = createRouter()
router.add('GET', '/users', 0)
router.add('POST', '/users', 1)

function dispatch(method, pathname, res) {
  const match = router.find(method, pathname)
  if (match) {
    return match
  }

  const methods = router.allowed(pathname)
  if (methods === null) {
    res.writeHead(404)
  } else {
    res.writeHead(405, { Allow: methods.join(', ') })
  }
}
```

## Route Syntax

### URL and Parameter Normalization

route-core splits on the raw `/` delimiter before decoding parameter values, so `%2F` stays inside the matched segment.

| Input handling | Behavior |
|----------|----------|
| query/hash | Ignored before matching |
| percent decoding | Applied only after a route is matched |
| `%2F` | Preserved inside the segment and decoded to `/` in params |
| `caseSensitive=false` | Affects matching keys only; returned params keep request casing |
| `maxParamLength` | Checked against the decoded parameter or wildcard value |

| Pattern type | Example | Match behavior |
|------|------|---------|
| Static | `/users/profile` | Exact match |
| Param | `/users/:id` | `/users/42` -> `{ id: '42' }` |
| Wildcard | `/assets/*file` | `/assets/js/app.js` -> `{ file: 'js/app.js' }` |
| Bare wildcard | `*` | Matches any path |

Normalized route shapes are unique. For example, `/users/:id` conflicts with `/users/:name`, and `/assets/*file` conflicts with `/assets/*path`.

### Priority

When multiple patterns can match the same request path, route-core uses this order:

```text
static > :param > *wildcard
```

### `ANY` Method

`ANY` acts as a fallback bucket. The router checks the concrete method first, then `ANY`.

```js
router.add('GET', '/health', 0)
router.add('ANY', '/health', 1)

router.find('GET', '/health')
// { storeId: 0, params: null, routePath: '/health' }

router.find('DELETE', '/health')
// { storeId: 1, params: null, routePath: '/health' }
```

## Framework Integration

route-core is transport-agnostic. A common integration pattern is `storeId -> store` mapping:

```ts
import { createRouter } from 'route-core'

interface RouteStore {
  handler: (req: any, res: any) => void
  middleware: Function[]
}

const router = createRouter({ ignoreTrailingSlash: true })
const storeMap = new Map<number, RouteStore>()
let nextId = 0

function register(method: string, path: string, store: RouteStore) {
  const id = nextId++
  router.add(method, path, id)
  storeMap.set(id, store)
}

function resolve(method: string, pathname: string, res: any) {
  const match = router.find(method, pathname)
  if (match) {
    return {
      store: storeMap.get(match.storeId)!,
      params: match.params ?? {},
      route: match.routePath,
    }
  }

  const methods = router.allowed(pathname)
  if (methods) {
    res.writeHead(405, { Allow: methods.join(', ') })
  } else {
    res.writeHead(404)
  }
  return null
}
```

## TypeScript

All public types are exported from the package root:

```ts
import { createRouter } from 'route-core'
import type { LookupHandler, MatchResult, Router, RouterOptions } from 'route-core'

const router: Router = createRouter({ caseSensitive: true })
```

## Language-Specific Documentation

- [Chinese guide](docs/README.zh-CN.md)

Documentation linkage:

- This root `README.md` is the default English package entry for npm and GitHub.
- `docs/README.zh-CN.md` is the Chinese companion guide for the same public API and usage model.
- When examples or wording diverge, the source code and released package behavior are authoritative; this English README is the primary package-facing entry, and the Chinese guide explains the same surface for Chinese readers.

## Error Reference

```js
const {
  RouteConflictError,
  InvalidPathError,
  InvalidMethodError,
  InvalidStoreIdError,
} = require('route-core')
```

| Error class | Code | Trigger |
|--------|------|---------|
| `RouteConflictError` | `ERR_ROUTE_CONFLICT` | Duplicate registration for the same method and normalized route shape |
| `InvalidPathError` | `ERR_INVALID_PATH` | Wildcard route used while `allowWildcard` is `false` |
| `InvalidMethodError` | `ERR_INVALID_METHOD` | Empty method string |
| `InvalidStoreIdError` | `ERR_INVALID_STORE_ID` | `storeId` is not a non-negative safe integer |

## Changelog

- [v0.0.2](changelogs/v0.0.2.md)
- [Unreleased](changelogs/unreleased.md)

## License

MIT
