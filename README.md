# route-core

`route-core` is a routing engine for framework authors and adapter maintainers. It matches HTTP methods and pathnames, returns decoded params plus the registered route template, and leaves handler ownership to your framework.

Use it when you want a router core that is:

- Fast on its own hot path
- Small and zero-runtime-dependency
- Explicit about framework boundaries: `route-core` matches routes, your framework owns handlers, middleware, and request lifecycle

Do not treat it as a complete HTTP dispatcher. It does not parse requests, own response flow, run middleware, or store handlers directly.

The package exposes two user-facing surfaces:

- **Compat API**: `add`, `find`, `lookup`, and `allowed`
- **Hot API**: `prepareMethod`, `preparePathname`, `findPrepared`, `lookupPrepared`, and `allowedPrepared`

Most users should start with the compat API. Adapter internals that already have a normalized pathname should use the hot API.

## Contents

- [Install](#install)
- [Before You Choose It](#before-you-choose-it)
- [Choose an API Surface](#choose-an-api-surface)
- [Quick Start](#quick-start)
- [Hot Path Quick Start](#hot-path-quick-start)
- [API Reference](#api-reference)
  - [createRouter(options?)](#createrouteroptions)
  - [RouterOptions](#routeroptions)
  - [router.add(method, path, storeId)](#routeraddmethod-path-storeid)
  - [router.find(method, path)](#routerfindmethod-path)
  - [router.lookup(method, path, onMatch)](#routerlookupmethod-path-onmatch)
  - [router.allowed(path)](#routerallowedpath)
  - [router.prepareMethod(method)](#routerpreparemethodmethod)
  - [router.preparePathname(path)](#routerpreparepathnamepath)
  - [router.findPrepared(method, pathname)](#routerfindpreparedmethod-pathname)
  - [router.lookupPrepared(method, pathname, onMatch)](#routerlookuppreparedmethod-pathname-onmatch)
  - [router.allowedPrepared(pathname)](#routerallowedpreparedpathname)
- [404 vs 405](#404-vs-405)
- [Route Syntax](#route-syntax)
  - [URL and Parameter Normalization](#url-and-parameter-normalization)
  - [Priority](#priority)
  - [ANY Method](#any-method)
- [Framework Integration](#framework-integration)
- [Using route-core in a vext-like Adapter](#using-route-core-in-a-vext-like-adapter)
- [TypeScript](#typescript)
- [Language-Specific Documentation](#language-specific-documentation)
- [Error Reference](#error-reference)
- [Changelog](#changelog)
- [License](#license)

## Install

```bash
npm install route-core
```

## Before You Choose It

`route-core` is a good fit when:

- You are building a framework, adapter, gateway, or internal platform router
- You want `storeId -> store` ownership in your own layer
- You want `routePath` back for metrics tags such as `req.route`
- You already have a request object and only need route matching

It is usually not the right fit when:

- You want an off-the-shelf web framework router with handlers attached directly
- You expect built-in middleware orchestration or HTTP response helpers
- You need a drop-in replacement for a library whose public API includes handler registration and default-route callbacks

## Choose an API Surface

Use the **compat API** when:

- Your integration still receives raw method strings and raw paths
- Clarity matters more than squeezing out the last bit of adapter overhead
- You want the simplest migration path

Use the **hot API** when:

- You call the router from an internal adapter hot path
- You can reuse a prepared method handle across many requests
- You already have a normalized pathname, or can normalize it once and reuse it

The router semantics are the same on both surfaces. The hot API only removes avoidable facade work.

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

What this example shows in practice:

- `route-core` only stores numeric `storeId`
- your framework maps `storeId` back to handlers or middleware chains
- `routePath` comes back on hit, so you do not need a second route-template lookup

## Hot Path Quick Start

If your adapter already has a normalized `pathname`, prefer the prepared hot path:

```js
import { createRouter } from 'route-core'

const router = createRouter()
router.add('GET', '/users/:id', 1)

const GET = router.prepareMethod('GET')

console.log(GET.find('/users/42'))
// { storeId: 1, params: { id: '42' }, routePath: '/users/:id' }

GET.lookup('/users/42', (storeId, params, routePath) => {
  console.log(storeId)   // 1
  console.log(params)    // { id: '42' }
  console.log(routePath) // '/users/:id'
})
```

If your adapter still receives raw paths, you can normalize once and reuse the prepared value:

```js
const preparedPath = router.preparePathname('/Users/42?from=app')
if (preparedPath) {
  console.log(router.findPrepared(GET, preparedPath))
}
```

Prepared method handles stay live across later `add()` calls. When the route table changes, route-core rebinds the prepared handle to the latest compiled runtime on the next lookup.

For adapter authors, the common pattern is:

1. Prepare the method once during bootstrap
2. Normalize the request pathname once per request
3. Use `lookupPrepared()` or `method.lookup()` for the thinnest dispatch path
4. Resolve `storeId` in your own store table

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

### `router.prepareMethod(method)`

Prepares a reusable hot-path method handle.

```ts
router.prepareMethod(method: string): PreparedMethod
```

```ts
interface PreparedMethod {
  name: string
  find(pathname: PreparedPathname): MatchResult | null
  lookup(pathname: PreparedPathname, onMatch: LookupHandler): boolean
}
```

Use this when your adapter will perform many lookups with the same HTTP method.

Prepared method handles remain valid after later `add()` calls. They automatically pick up newly compiled routes on the next lookup.

### `router.preparePathname(path)`

Normalizes a path once so it can be reused by the hot API.

```ts
router.preparePathname(path: string): PreparedPathname | null
```

```ts
type PreparedPathname =
  | string
  | {
      rawPathname: string
      matchPathname: string
    }
```

Common-case already-normalized lowercase ASCII paths usually return a plain string. Case-insensitive paths that need separate raw and match representations return the object form.

### `router.findPrepared(method, pathname)`

Calls the prepared hot path directly.

```ts
router.findPrepared(method: PreparedMethod, pathname: PreparedPathname): MatchResult | null
```

This is equivalent to `method.find(pathname)`.

### `router.lookupPrepared(method, pathname, onMatch)`

Calls the prepared hot lookup path directly.

```ts
router.lookupPrepared(
  method: PreparedMethod,
  pathname: PreparedPathname,
  onMatch: LookupHandler,
): boolean
```

This is equivalent to `method.lookup(pathname, onMatch)`.

### `router.allowedPrepared(pathname)`

Runs `allowed()` against a prepared pathname.

```ts
router.allowedPrepared(pathname: PreparedPathname): string[] | null
```

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

That is the intended ownership model:

- `route-core` owns route matching
- your framework owns handler instances, middleware chains, metadata, and fallback behavior
- `allowed()` is how you distinguish `404` from `405`

If your framework hot path already parsed the URL, switch the example above to `prepareMethod()` plus `preparePathname()`.

## Using route-core in a vext-like Adapter

`route-core` can replace the routing core used inside a `vext`-style native adapter, but it is **not** a one-line import swap for `find-my-way`.

Why it is not a direct replacement:

- `find-my-way` registers `handler + store` directly on the router
- `find-my-way` exposes `lookup(req, res)` plus `defaultRoute`
- `route-core` registers `storeId` only and returns matches through `find()` or `lookup()`

What maps cleanly:

- route registration shape: `method + path`
- named params and trailing wildcard semantics
- `ANY` fallback bucket
- route-template return value for `req.route`

What the adapter must own:

- `storeId -> store` table
- `404` / `405` fallback branching
- request-object and response-object handling
- optional prepared method caching for hot methods

Minimal adapter shape:

```ts
import { createRouter } from 'route-core'

const router = createRouter()
const stores: RouteStore[] = []
const GET = router.prepareMethod('GET')

function register(method: string, path: string, store: RouteStore) {
  const storeId = stores.length
  stores.push(store)
  router.add(method, path, storeId)
}

function dispatch(methodHandle: ReturnType<typeof router.prepareMethod>, rawPath: string) {
  const preparedPath = router.preparePathname(rawPath)
  if (!preparedPath) return false

  return methodHandle.lookup(preparedPath, (storeId, params, routePath) => {
    const store = stores[storeId]!
    store.handle(params ?? {}, routePath)
  })
}
```

Current recommendation for `vext`:

- **Yes**, `route-core` is viable as the matching engine
- **No**, it should not be described as a drop-in replacement for the current adapter contract
- The migration unit is the adapter boundary, not a blind package swap

## TypeScript

All public types are exported from the package root:

```ts
import { createRouter } from 'route-core'
import type {
  LookupHandler,
  MatchResult,
  PreparedMethod,
  PreparedPathname,
  Router,
  RouterOptions,
} from 'route-core'

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
