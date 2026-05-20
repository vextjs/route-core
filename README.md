# route-core

面向 Node.js 的超高性能路由引擎，由 Zig 原生 Radix Trie 驱动。

- **原生核心** — Zig 实现完整 trie；匹配在 V8 之外完成，params 以平铺数组返回，将 GC 压力降至最低
- **自动降级** — 当原生 `.node` 二进制不可用时，包会透明地降级到语义完全一致的 JS trie
- **框架无关** — 仅暴露最小 `add / find / allowed` API，任何 Node.js 框架均可几行代码接入
- **TypeScript 支持** — 随包附带完整 `.d.ts` 类型声明

## 目录

- [安装](#安装)
- [快速上手](#快速上手)
- [API 参考](#api-参考)
  - [createRouter(options?)](#createrouteroptions)
  - [RouterOptions](#routeroptions)
  - [router.add(method, path, storeId)](#routeraddmethod-path-storeid)
  - [router.find(method, path)](#routerfindmethod-path)
  - [router.allowed(path)](#routerallowedpath)
- [404 与 405 区分](#404-与-405-区分)
- [路由语法](#路由语法)
  - [优先级](#优先级)
  - [ANY 方法](#any-方法)
- [框架接入](#框架接入)
- [TypeScript](#typescript)
- [原生二进制与降级](#原生二进制与降级)
- [从源码构建](#从源码构建)
- [运行测试](#运行测试)
- [性能基准](#性能基准)
- [错误参考](#错误参考)
- [License](#license)

## 安装

**Node.js 版本要求：`>=18.0.0`**

```bash
npm install route-core
```

以下三个平台包含预编译二进制，无需任何构建工具：

| 平台 | 架构 |
|------|------|
| Linux | x64 |
| Windows | x64 |
| macOS | arm64（Apple Silicon）|

`linux-arm64` 将在 `v0.1.x` 维护周期内追加。

---

## 快速上手

```js
const { createRouter } = require('route-core')

const router = createRouter()

router.add('GET',  '/users',     0)
router.add('GET',  '/users/:id', 1)
router.add('POST', '/users',     2)

console.log(router.find('GET', '/users'))
// → { storeId: 0, params: null }

console.log(router.find('GET', '/users/42'))
// → { storeId: 1, params: { id: '42' } }

console.log(router.find('DELETE', '/users'))
// → null

console.log(router.allowed('/users'))
// → ['GET', 'POST']  （路径存在，但 DELETE 未注册）
```

ESM 消费方式（适用于 `vext` 或 `type: "module"` 项目）：

```js
import routeCore from 'route-core'
const { createRouter } = routeCore
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
| `storeId` | 非负整数，命中时由路由器原样返回。框架用此值映射到自己的 handler/store |

**抛出的错误**

| 错误类 | code | 触发条件 |
|--------|------|---------|
| `RouteConflictError` | `ERR_ROUTE_CONFLICT` | 同 method + 同 path 重复注册 |
| `InvalidPathError` | `ERR_INVALID_PATH` | `allowWildcard: false` 且路径含 `*` |
| `InvalidMethodError` | `ERR_INVALID_METHOD` | method 为空字符串 |

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
}
```

`find()` 返回 `null` 的情形：
- 无路由匹配（路径不存在，或路径存在但 method 未注册且无 ANY 兜底）
- 参数段长度超过 `maxParamLength`

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

| 模式 | 示例 | 匹配说明 |
|------|------|---------|
| 静态 | `/users/profile` | 精确匹配 `/users/profile` |
| 参数 | `/users/:id` | `/users/42` → `{ id: "42" }` |
| 通配符 | `/assets/*file` | `/assets/js/app.js` → `{ file: "js/app.js" }` |
| 裸通配符 | `*` | 匹配任意路径 |

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

router.find('GET',    '/health')  // → { storeId: 0, params: null }
router.find('DELETE', '/health')  // → { storeId: 1, params: null }
```

> 注意：注册了 `ANY /path` 时，`find()` 对该路径永远不会返回 `null`，因此 `allowed()` 不适用于此类路径。

---

## 框架接入

`route-core` 与 HTTP 对象完全解耦，推荐采用 `storeId → store` 映射模式：

```ts
import routeCore from 'route-core'

const { createRouter } = routeCore

interface RouteStore {
  handler: (req: any, res: any) => void
  middleware: Function[]
}

const router   = createRouter({ ignoreTrailingSlash: true })
const storeMap = new Map<number, RouteStore>()
let nextId = 0

function register(method: string, path: string, store: RouteStore) {
  const id = nextId++
  storeMap.set(id, store)       // 必须先存 store，再调用 router.add
  router.add(method, path, id)
}

function resolve(method: string, pathname: string, res: any) {
  const match = router.find(method, pathname)
  if (match) {
    return {
      store:  storeMap.get(match.storeId)!,
      params: match.params ?? {},
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
import routeCore from 'route-core'
import type { Router, RouterOptions, MatchResult } from 'route-core'

const { createRouter } = routeCore

const router: Router = createRouter({ caseSensitive: true })
```

---

## 原生二进制与降级

启动时 `route-core` 按以下顺序加载二进制：

```
prebuilds/<platform>-<arch>/rutex.node  ← 预编译（优先）
./rutex.node                            ← 本地开发构建
内嵌 JS fallback trie                   ← 始终可用
```

JS fallback trie 与原生引擎在语义上完全一致——同一套测试用例同时覆盖两者。切换对调用方透明，无需修改任何代码。

---

## 从源码构建

需要 [Zig 0.14.x](https://ziglang.org/download/)。

```bash
# 拉取 vendored N-API 头文件（仅需执行一次）
npm run vendor-headers

# Release 构建 → ./rutex.node
npm run build

# Debug 构建
npm run build:debug
```

**Windows** — 构建需要 `node.lib`，通过 Zig 构建选项传入其所在目录：

```powershell
zig build -Doptimize=ReleaseFast -Dnode-lib-path="C:\path\to\node-lib"
```

本地开发时若不传 `-Dnode-lib-path`，`build.zig` 会启用 `linker_allow_shlib_undefined` 允许构建完成；若生成的 `.node` 在运行时无法加载，程序自动退回 JS fallback trie。

---

## 运行测试

```bash
npm test                    # 全量测试
npm run test:fallback       # 仅测 JS trie
npm run test:native         # 仅测原生二进制
```

共享测试用例（`test/shared/cases.mjs`）覆盖范围：

- 静态、参数、通配符路由
- 路由优先级（静态 > 参数 > 通配符）
- `ANY` 方法兜底
- 尾斜杠规范化
- 大小写不敏感匹配
- `maxParamLength` 边界（500 字符命中，501 字符返回 `null`）
- 重复路由检测
- 未命中返回 `null`
- `allowed()` 404 / 405 区分

---

## 性能基准

```bash
npm run bench              # 纯路由吞吐量（native vs JS fallback）
npm run bench:integration  # 端到端 autocannon 30 秒
```

验收门槛：

| 场景 | 门槛 |
|------|------|
| 参数路由吞吐量（native）| ≥ JS fallback × 2 |
| 静态路由吞吐量（native）| ≥ JS fallback × 1.5 |
| 大路由表（500 条）吞吐量（native）| ≥ JS fallback × 2 |
| autocannon p99 延迟（100 并发，30s）| ≤ 1ms |
| 参数路由 10 万次调用后堆增长 | < 10 MB |

---

## 错误参考

```js
const { RouteConflictError, InvalidPathError, InvalidMethodError } = require('route-core')

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

---

## License

MIT © Rocky
