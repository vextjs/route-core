# route-core API

## Status

The first TypeScript implementation is available for local build and tests. The package is still private and is not ready for npm publication.

## Entry Points

```js
const { createRouter } = require('route-core')
```

```js
import { createRouter } from 'route-core'
```

Types are exported from the package root:

```ts
import type { MatchResult, Router, RouterOptions } from 'route-core'
```

## Router

```ts
const router = createRouter(options)
router.add(method, path, storeId)
router.find(method, path)
router.lookup(method, path, onMatch)
router.allowed(path)
```

`storeId` must be a non-negative safe integer. The router stores ids and route templates; frameworks keep their own handler store.

`find()` returns:

```ts
interface MatchResult {
	storeId: number
	params: Record<string, string> | null
	routePath: string
}
```

`routePath` is the registered template, such as `/users/:id`. Frameworks can use it for low-cardinality observability fields like `req.route`.

`lookup()` is the adapter hot-path API:

```ts
router.lookup(method, path, (storeId, params, routePath) => {
	const store = stores[storeId]
	store.handler(params, routePath)
})
```

It returns `true` on match and `false` on miss or invalid match input.

## Matching Semantics

- Static routes take priority over params, params take priority over wildcard routes.
- `ANY` is a `find()` fallback and is excluded from `allowed()`.
- `HEAD` does not auto-map to `GET`.
- `OPTIONS` does not auto-generate Allow.
- Params are decoded after raw slash splitting; `%2F` remains inside the same segment and returns as `/`.
- Malformed percent encoding returns `null` on match operations.
