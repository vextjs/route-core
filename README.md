# route-core

`route-core` is a routing engine for framework authors and adapter maintainers. It matches HTTP methods and pathnames, returns decoded params plus the registered route template, and leaves handler ownership to your framework.

Use it when you want a router core that is:

- Fast on its own hot path
- Small and zero-runtime-dependency
- Explicit about framework boundaries: `route-core` matches routes, your framework owns handlers, middleware, and request lifecycle

Do not treat it as a complete HTTP dispatcher. It does not parse requests, own response flow, run middleware, or store handlers directly.

There are two ways to use it:

- **Standard usage**: pass `method` and `path` directly on each lookup
- **High-throughput usage**: prepare reusable handles so your adapter does less work per request

Most users should start with standard usage. Only switch to the high-throughput path when your adapter is already performance-sensitive and you understand where the extra cost is coming from.

## Contents

- [Install](#install)
- [Before You Choose It](#before-you-choose-it)
- [Choose a Usage Style](#choose-a-usage-style)
- [Current Performance Snapshot](#current-performance-snapshot)
- [Quick Start](#quick-start)
- [Supported Route Patterns](#supported-route-patterns)
- [High-Throughput Quick Start](#high-throughput-quick-start)
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

## Choose a Usage Style

Start with **standard usage** when:

- Your integration still receives raw method strings and raw paths
- Clarity matters more than squeezing out the last bit of adapter overhead
- You want the simplest migration path

Switch to **high-throughput usage** when:

- You call the router from an internal adapter hot path
- You can reuse a prepared method handle across many requests
- You already have a normalized pathname, or can normalize it once and reuse it

Both styles return the same routing result. The high-throughput path only exists to remove repeated prep work from very hot adapter code.

## Current Performance Snapshot

Short version first:

- If you want the easiest integration, choose **standard usage**.
- If you picked `route-core` mainly for speed, choose **high-throughput usage**.
- The clearest lead over `find-my-way` on this machine comes from the high-throughput path.

Latest local benchmark run on this project workspace, using `npm run bench:hot` and `npm run bench:compat` on May 29, 2026:

`lookup()`-style dispatch, which is usually the most relevant adapter metric:

| Scenario | `find-my-way lookup` | route-core `lookup()` | route-core hot `lookupPrepared()` |
|------|------|------|------|
| static | `6.24M ops/sec` | `6.05M ops/sec` | `8.34M ops/sec` |
| params | `2.69M ops/sec` | `2.82M ops/sec` | `3.68M ops/sec` |
| wildcard | `3.38M ops/sec` | `2.91M ops/sec` | `4.24M ops/sec` |
| miss | `6.27M ops/sec` | `6.32M ops/sec` | `12.63M ops/sec` |

Direct result-returning lookups:

| Scenario | `find-my-way find` | route-core `find()` | route-core hot `findPrepared()` |
|------|------|------|------|
| static | `5.30M ops/sec` | `5.71M ops/sec` | `7.96M ops/sec` |
| params | `2.59M ops/sec` | `2.95M ops/sec` | `3.62M ops/sec` |
| wildcard | `3.23M ops/sec` | `2.99M ops/sec` | `4.16M ops/sec` |
| miss | `6.38M ops/sec` | `6.67M ops/sec` | `11.68M ops/sec` |

How to read this:

- Standard usage is the easier API surface, but it is not the mode where `route-core` always wins across every scenario.
- High-throughput usage is the performance-first mode. That is the mode to benchmark if speed is your main decision point.
- On the current build, the hot path is the mode that leads `find-my-way` most consistently in these local benchmarks.
- Mixed-segment and regex-constrained routes are now covered by dedicated benchmarks too, but today they are primarily about route expressiveness, not about beating `find-my-way` on raw throughput.

To verify on your own machine:

```bash
npm run bench:compat
npm run bench:hot
```

Treat these numbers as a current snapshot, not a universal promise. Your Node version, CPU, and route mix will change the exact ratios.

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

## Supported Route Patterns

The router currently supports these route shapes:

- exact static routes such as `/users`
- named params such as `/users/:id`
- mixed params inside one segment such as `/assets/:name.:ext`
- multiple params inside one segment such as `/near/:lat-:lng`
- segment-level regex params such as `/reports/:id(^\\d+)`
- trailing optional params such as `/optional/:id?`
- fixed-count trailing multi-segment params such as `/files/*2:path`
- trailing wildcards such as `/assets/*file`
- bare wildcard `*`
- `ANY` as a method fallback bucket

Current limits:

- regex constraints only apply inside a single segment param
- optional params must be the final segment
- optional params must occupy the whole final segment
- fixed-count multi-segment params must be the final segment
- wildcard segments must be the final segment
- adjacent params inside one segment require a literal separator, so `:left:right` is invalid
- routes must start with `/`, unless the whole route is the bare wildcard `*`
- empty segments such as `/users//profile` are invalid
- normalized route shapes must be unique, so `/users/:id` conflicts with `/users/:name`
- wildcard segments in the middle of the path and full-path regex routes are not supported

Complete example:

```js
const { createRouter } = require('route-core')

const router = createRouter()

router.add('GET', '/users', 0)
router.add('GET', '/users/:id', 1)
router.add('GET', '/assets/:name.:ext', 2)
router.add('GET', '/near/:lat-:lng', 3)
router.add('GET', '/reports/:id(^\\d+).json', 4)
router.add('GET', '/optional/:id?', 5)
router.add('GET', '/optional', 6)
router.add('GET', '/files/*2:path', 7)
router.add('GET', '/assets/*file', 8)
router.add('ANY', '/health', 9)
router.add('GET', '*', 10)

console.log(router.find('GET', '/users'))
// { storeId: 0, params: null, routePath: '/users' }

console.log(router.find('GET', '/users/42'))
// { storeId: 1, params: { id: '42' }, routePath: '/users/:id' }

console.log(router.find('GET', '/assets/app.js'))
// { storeId: 2, params: { name: 'app', ext: 'js' }, routePath: '/assets/:name.:ext' }

console.log(router.find('GET', '/near/12.3-45.6'))
// { storeId: 3, params: { lat: '12.3', lng: '45.6' }, routePath: '/near/:lat-:lng' }

console.log(router.find('GET', '/reports/123.json'))
// { storeId: 4, params: { id: '123' }, routePath: '/reports/:id(^\\d+).json' }

console.log(router.find('GET', '/optional'))
// { storeId: 6, params: null, routePath: '/optional' }

console.log(router.find('GET', '/optional/42'))
// { storeId: 5, params: { id: '42' }, routePath: '/optional/:id?' }

console.log(router.find('GET', '/files/a/b'))
// { storeId: 7, params: { path: 'a/b' }, routePath: '/files/*2:path' }

console.log(router.find('GET', '/files/a'))
// null

console.log(router.find('GET', '/assets/js/app.js'))
// { storeId: 8, params: { file: 'js/app.js' }, routePath: '/assets/*file' }

console.log(router.find('POST', '/health'))
// { storeId: 9, params: null, routePath: '/health' }

console.log(router.find('GET', '/anything-else'))
// { storeId: 10, params: { wildcard: 'anything-else' }, routePath: '*' }
```

Examples of unsupported route shapes:

```js
router.add('GET', 'users', 0)               // invalid: must start with /
router.add('GET', '/users/*file/edit', 1)   // invalid: wildcard must be final
router.add('GET', '/users/:id?/tail', 2)    // invalid: optional param must be final
router.add('GET', '/users/*0:path', 3)      // invalid: fixed multi-segment count must be positive
router.add('GET', '/users/:id?.json', 4)    // invalid: optional param must occupy the full final segment
router.add('GET', '/users/:left:right', 5)  // invalid: adjacent params need a literal separator
router.add('GET', '/users/:id([)', 6)       // invalid: malformed regex constraint
```

Priority rules:

- static routes win over mixed or regex-constrained segment routes
- mixed or regex-constrained segment routes win over plain param routes
- plain param routes win over wildcard routes
- concrete methods win over `ANY`
- an explicit static route wins over the omitted branch of a trailing optional route

For example:

```js
const router = createRouter()

router.add('GET', '/users/profile', 0)
router.add('GET', '/users/:id', 1)
router.add('GET', '/users/*rest', 2)

console.log(router.find('GET', '/users/profile'))
// { storeId: 0, params: null, routePath: '/users/profile' }

console.log(router.find('GET', '/users/42'))
// { storeId: 1, params: { id: '42' }, routePath: '/users/:id' }

console.log(router.find('GET', '/users/a/b'))
// { storeId: 2, params: { rest: 'a/b' }, routePath: '/users/*rest' }
```

## High-Throughput Quick Start

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

The API names behind these two styles are:

- Standard usage: `add`, `find`, `lookup`, `allowed`
- High-throughput usage: `prepareMethod`, `preparePathname`, `findPrepared`, `lookupPrepared`, `allowedPrepared`

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
| `allowWildcard` | `boolean` | `true` | When `false`, both `*name` and `*2:name` routes throw `InvalidPathError` |

### `router.add(method, path, storeId)`

Registers a route.

```ts
router.add(method: string, path: string, storeId: number): void
```

| Parameter | Description |
|------|------|
| `method` | HTTP method. Built-ins include `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`, `CONNECT`, and `ANY`. Methods are normalized to uppercase. |
| `path` | Route pattern. Supports static segments, `:param`, mixed segments such as `:name.:ext`, segment regex params such as `:id(^\\d+)`, trailing `:param?`, trailing `*name`, trailing `*2:name`, and bare `*`. |
| `storeId` | Non-negative safe integer returned on match. Your framework can map it to handlers or stores. |

Errors:

| Error class | Code | Trigger |
|--------|------|---------|
| `RouteConflictError` | `ERR_ROUTE_CONFLICT` | Duplicate registration for the same method and normalized route shape |
| `InvalidPathError` | `ERR_INVALID_PATH` | Invalid route syntax, invalid placement for optional/wildcard segments, or wildcard routing used while `allowWildcard` is `false` |
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
| Mixed segment | `/assets/:name.:ext` | `/assets/app.js` -> `{ name: 'app', ext: 'js' }` |
| Multiple params in one segment | `/near/:lat-:lng` | `/near/12.3-45.6` -> `{ lat: '12.3', lng: '45.6' }` |
| Segment regex param | `/reports/:id(^\\d+)` | `/reports/123` -> `{ id: '123' }` |
| Optional param | `/optional/:id?` | `/optional` or `/optional/42` |
| Fixed multi-segment | `/files/*2:path` | `/files/a/b` -> `{ path: 'a/b' }` |
| Wildcard | `/assets/*file` | `/assets/js/app.js` -> `{ file: 'js/app.js' }` |
| Bare wildcard | `*` | Matches any path |

Normalized route shapes are unique. For example, `/users/:id` conflicts with `/users/:name`, `/assets/:name.:ext` conflicts with `/assets/:file.:kind`, and `/assets/*file` conflicts with `/assets/*path`.

Trailing optional params are internally treated as an omitted branch plus a present branch. An explicit static route for the omitted path may coexist and wins when both match.

### Priority

When multiple patterns can match the same request path, route-core uses this order:

```text
static > pattern segment > :param > *wildcard
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
- named params, mixed single-segment params, segment regex params, trailing optional params, trailing wildcard semantics, and fixed-count trailing multi-segment params
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
| `InvalidPathError` | `ERR_INVALID_PATH` | Invalid route syntax, invalid placement for optional/wildcard segments, or wildcard routing used while `allowWildcard` is `false` |
| `InvalidMethodError` | `ERR_INVALID_METHOD` | Empty method string |
| `InvalidStoreIdError` | `ERR_INVALID_STORE_ID` | `storeId` is not a non-negative safe integer |

## Changelog

- [v0.0.3](changelogs/v0.0.3.md)
- [v0.0.2](changelogs/v0.0.2.md)
- [Unreleased](changelogs/unreleased.md)

## License

MIT
