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
router.allowed(path)
```

`storeId` must be a non-negative safe integer. The router stores only ids and params; frameworks keep their own handler store.

## Matching Semantics

- Static routes take priority over params, params take priority over wildcard routes.
- `ANY` is a `find()` fallback and is excluded from `allowed()`.
- `HEAD` does not auto-map to `GET`.
- `OPTIONS` does not auto-generate Allow.
- Params are decoded after raw slash splitting; `%2F` remains inside the same segment and returns as `/`.
- Malformed percent encoding returns `null` on match operations.
