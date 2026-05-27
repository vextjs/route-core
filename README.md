# route-core

`route-core` is a small, zero-runtime-dependency routing engine for Node.js frameworks. It maps HTTP methods and paths to numeric `storeId` values, returns decoded route params, preserves the registered route template, and keeps handler storage in the host framework.

It is built for framework adapters that want a focused router core rather than a full HTTP dispatcher.

- **Tiny public surface** — `add`, `find`, `lookup`, and `allowed`.
- **Framework-owned stores** — route-core stores ids and params; your adapter owns handlers, middleware, metadata, and response behavior.
- **Template-aware matching** — matches include `routePath`, so frameworks can set low-cardinality fields such as `req.route`.
- **CJS, ESM, and types** — the package exposes CommonJS, ES module, and TypeScript declaration entry points.

## 目录导航

- [Install](#install)
- [Quick Start](#quick-start)
- [API 参考](#api-参考)
  - [createRouter(options?)](#createrouteroptions)
  - [RouterOptions](#routeroptions)
  - [router.add(method, path, storeId)](#routeraddmethod-path-storeid)
  - [router.find(method, path)](#routerfindmethod-path)
  - [router.lookup(method, path, onMatch)](#routerlookupmethod-path-onmatch)
  - [router.allowed(path)](#routerallowedpath)
- [404 与 405 区分](#404-与-405-区分)
- [路由语法](#路由语法)
  - [URL 与参数规范化](#url-与参数规范化)
  - [优先级](#优先级)
  - [ANY 方法](#any-方法)
- [框架接入](#框架接入)
- [TypeScript](#typescript)
- [错误参考](#错误参考)
- [更多文档](#更多文档)
- [License](#license)

## Install

```bash
npm install route-core
```

---

## Quick Start

CommonJS:

```js
const { createRouter } = require('route-core')
```

ES modules:

```js
import { createRouter } from 'route-core'
```

---

```js
const { createRouter } = require('route-core')

const router = createRouter()

router.add('GET',  '/users',     0)
router.add('GET',  '/users/:id', 1)
router.add('POST', '/users',     2)

console.log(router.find('GET', '/users'))
// → { storeId: 0, params: null, routePath: '/users' }

console.log(router.find('GET', '/users/42'))
// → { storeId: 1, params: { id: '42' }, routePath: '/users/:id' }

console.log(router.find('DELETE', '/users'))
// → null

console.log(router.allowed('/users'))
// → ['GET', 'POST']  （路径存在，但 DELETE 未注册）
```

Use `lookup()` when an adapter wants a direct callback on match:

```js
router.lookup('GET', '/users/42', (storeId, params, routePath) => {
  console.log(storeId)   // 1
  console.log(params)    // { id: '42' }
  console.log(routePath) // '/users/:id'
})
```

---

## API 参考

### `createRouter(options?)`

创建并返回一个新的 `Router` 实例。

```ts
function createRouter(options?: RouterOptions): Router
```

#### `RouterOptions`

| 选项 | 类型 | 默认值 | 说明 |
|------|------|:------:|------|
| `ignoreTrailingSlash` | `boolean` | `true` | 将 `/foo` 与 `/foo/` 视为同一路由 |
| `caseSensitive` | `boolean` | `false` | 为 `false` 时，路径在匹配前统一转为小写 |
| `maxParamLength` | `number` | `500` | 单个参数段的最大字符数；超出时 `find()` 返回 `null`（不截断，直接放弃匹配）|
| `allowWildcard` | `boolean` | `true` | 为 `false` 时，注册含 `*` 的路由抛 `InvalidPathError` |

---

### `router.add(method, path, storeId)`

注册一条路由。

```ts
router.add(method: string, path: string, storeId: number): void
```

| 参数 | 说明 |
|------|------|
| `method` | HTTP 方法。支持 `GET`、`POST`、`PUT`、`PATCH`、`DELETE`、`HEAD`、`OPTIONS`、`CONNECT`、`ANY`；内部统一转为大写。自定义扩展 method 也被接受，但不保证与标准桶共享路由 |
| `path` | 路由路径。支持静态段、`:param` 命名参数、`*name` 通配符后缀 |
| `storeId` | 非负安全整数，命中时由路由器原样返回。框架用此值映射到自己的 handler/store |

**抛出的错误**

| 错误类 | code | 触发条件 |
|--------|------|---------|
| `RouteConflictError` | `ERR_ROUTE_CONFLICT` | 同 method + 同 path 重复注册 |
| `InvalidPathError` | `ERR_INVALID_PATH` | `allowWildcard: false` 且路径含 `*` |
| `InvalidMethodError` | `ERR_INVALID_METHOD` | method 为空字符串 |
| `InvalidStoreIdError` | `ERR_INVALID_STORE_ID` | `storeId` 不是非负安全整数 |

---

### `router.find(method, path)`

查找路由。命中时返回 `MatchResult`，未命中或参数超长时返回 `null`。

```ts
router.find(method: string, path: string): MatchResult | null
```

```ts
interface MatchResult {
  storeId: number
  params:  Record<string, string> | null  // 无参数路由命中时为 null
  routePath: string                        // 注册时的路由模板，如 /users/:id
}
```

`find()` 返回 `null` 的情形：
- 无路由匹配（路径不存在，或路径存在但 method 未注册且无 ANY 兜底）
- 参数段长度超过 `maxParamLength`

---

### `router.lookup(method, path, onMatch)`

查找路由并在命中时直接调用回调。这个 API 面向 adapter 热路径：框架可用 `storeId` 映射自己的 handler/store，并用 `routePath` 注入低基数字段，例如 vext 的 `req.route`。

```ts
router.lookup(
  method: string,
  path: string,
  onMatch: (storeId: number, params: Record<string, string> | null, routePath: string) => void,
): boolean
```

| 返回值 | 含义 |
|--------|------|
| `true` | 命中路由，且已调用 `onMatch` |
| `false` | 未命中路由，或 URL 参数非法/超限 |

`lookup()` 与 `find()` 使用同一套匹配语义；区别是 `lookup()` 不返回 `MatchResult` 对象，更适合 adapter 在命中后直接调度 handler。

---

### `router.allowed(path)`

查询指定路径已注册的 HTTP 方法列表，用于区分 404 与 405。

```ts
router.allowed(path: string): string[] | null
```

| 返回值 | 含义 |
|--------|------|
| `null` | 路径在任何 method bucket 均无匹配 → **404 Not Found** |
| `string[]` | 路径存在但当前请求方法未注册 → **405 Method Not Allowed**，数组即 `Allow` 响应头的值 |

`allowed()` 应在 `find()` 返回 `null` 后调用，仅用于确定响应状态码，不影响热路径性能。

> vext 接入首期保持现有 wrong method 404 行为；`allowed()` 先作为 route-core 能力落地。若未来在 vext 响应层启用 405，需要作为单独用户可见契约变更同步测试、`changelogs/unreleased.md` 与文档。

---

## 404 与 405 区分

```js
const { createRouter } = require('route-core')

const router = createRouter()
router.add('GET',  '/users', 0)
router.add('POST', '/users', 1)

function dispatch(method, pathname, res) {
  const match = router.find(method, pathname)
  if (match) {
    // 命中，执行 handler
    return match
  }

  // 区分 404 与 405
  const methods = router.allowed(pathname)
  if (methods === null) {
    res.writeHead(404)
  } else {
    res.writeHead(405, { Allow: methods.join(', ') })
  }
}

// GET  /users  → 命中 storeId 0
// POST /users  → 命中 storeId 1
// DELETE /users → find() 返回 null → allowed() 返回 ['GET', 'POST'] → 405
// GET  /posts  → find() 返回 null → allowed() 返回 null → 404
```

---

## 路由语法

### URL 与参数规范化

`route-core` 先按原始 `/` 分段，再处理参数值；`%2F` 不会产生新的路径段。

| 输入处理 | 目标行为 |
|----------|----------|
| query/hash | `find()` / `allowed()` 输入中先剥离，不参与匹配 |
| percent decode | 仅在路由命中后对参数和通配符值执行；解码失败时返回 `null` |
| `%2F` | 保留在当前参数段内，返回 params 时解码为 `/` |
| `caseSensitive=false` | 只影响匹配键；返回的 params 保留请求中的大小写语义 |
| `maxParamLength` | 按解码后的参数/通配符值检查；超限时 `find()` 与 `allowed()` 均返回 `null` |

| 模式 | 示例 | 匹配说明 |
|------|------|---------|
| 静态 | `/users/profile` | 精确匹配 `/users/profile` |
| 参数 | `/users/:id` | `/users/42` → `{ id: "42" }` |
| 通配符 | `/assets/*file` | `/assets/js/app.js` → `{ file: "js/app.js" }` |
| 裸通配符 | `*` | 匹配任意路径 |

重复路由按规范化 route shape 判断：`/users/:id` 与 `/users/:name` 视为同一路由 shape，`/assets/*file` 与 `/assets/*path` 也视为同一路由 shape，重复注册应抛 `RouteConflictError`。通配符只能位于末尾段；裸通配符命中时使用 `wildcard` 作为默认参数名。

### 优先级

同一 URL 存在多个可匹配模式时，路由器选择优先级最高的：

```
静态  >  :param  >  *通配符
```

示例——三条路由均已注册，请求 `/users/profile`：

```
GET /users/profile  ← 命中（静态优先）
GET /users/:id
GET /users/*rest
```

### `ANY` 方法

`ANY` 是通用兜底桶：路由器先查具体 method，未命中时再查 `ANY`。

```js
router.add('GET', '/health', 0)   // 仅匹配 GET
router.add('ANY', '/health', 1)   // 匹配其他所有 method

router.find('GET',    '/health')  // → { storeId: 0, params: null, routePath: '/health' }
router.find('DELETE', '/health')  // → { storeId: 1, params: null, routePath: '/health' }
```

> 注意：注册了 `ANY /path` 时，`find()` 对该路径永远不会返回 `null`，因此 `allowed()` 不适用于此类路径。

---

## 框架接入

`route-core` 与 HTTP 对象完全解耦，推荐采用 `storeId → store` 映射模式：

```ts
import { createRouter } from 'route-core'

interface RouteStore {
  handler: (req: any, res: any) => void
  middleware: Function[]
}

const router   = createRouter({ ignoreTrailingSlash: true })
const storeMap = new Map<number, RouteStore>()
let nextId = 0

function register(method: string, path: string, store: RouteStore) {
  const id = nextId++
  router.add(method, path, id)
  storeMap.set(id, store)       // add 成功后再写入，避免失败时留下脏 store
}

function resolve(method: string, pathname: string, res: any) {
  const match = router.find(method, pathname)
  if (match) {
    return {
      store:  storeMap.get(match.storeId)!,
      params: match.params ?? {},
      route:  match.routePath,
    }
  }

  // 区分 404 / 405
  const methods = router.allowed(pathname)
  if (methods) {
    res.writeHead(405, { Allow: methods.join(', ') })
  } else {
    res.writeHead(404)
  }
  return null
}
```

---

## TypeScript

`route-core` 随 JS 入口附带 `index.d.ts`，所有类型从包根导出：

```ts
import { createRouter } from 'route-core'
import type { LookupHandler, MatchResult, Router, RouterOptions } from 'route-core'

const router: Router = createRouter({ caseSensitive: true })
```

---

## 错误参考

```js
const { RouteConflictError, InvalidPathError, InvalidMethodError, InvalidStoreIdError } = require('route-core')

try {
  router.add('GET', '/foo', 0)
  router.add('GET', '/foo', 1)   // 同路径重复注册
} catch (err) {
  console.log(err instanceof RouteConflictError)  // true
  console.log(err.code)                           // 'ERR_ROUTE_CONFLICT'
}
```

| 错误类 | code | 触发时机 |
|--------|------|---------|
| `RouteConflictError` | `ERR_ROUTE_CONFLICT` | 同 method + 同 path 重复注册 |
| `InvalidPathError` | `ERR_INVALID_PATH` | `allowWildcard: false` 时注册含 `*` 路径 |
| `InvalidMethodError` | `ERR_INVALID_METHOD` | method 为空字符串 |
| `InvalidStoreIdError` | `ERR_INVALID_STORE_ID` | `storeId` 不是非负安全整数 |

---

## 更多文档

- [API details](docs/api.md)
- [vext integration notes](docs/vext-integration.md)
- [Benchmark notes](docs/benchmark.md)
- [Changelog](changelogs/v0.0.2.md)

---

## License

MIT © Rocky
