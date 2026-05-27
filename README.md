# route-core

> **状态：首期 TypeScript 实现已落地 / 私有预发布护栏开启**
>
> 当前仓库已提供 `route-core` 的首期 TypeScript 路由实现、CJS/ESM/types 构建入口、shared semantic cases 和 route-only benchmark。`package.json` 版本仍为 `0.0.1`，并保留 `private: true` 与 `prepublishOnly` 护栏；发布前仍需完成 vext 接入、e2e benchmark 和发布门禁复核。

`route-core` 目标是成为 `vext` 的第一方 Node.js 路由内核：首期用 TypeScript 实现零第三方路由依赖的 Radix Trie，逐步替换 vext 当前外部路由依赖；Zig/native backend 仅作为后续可选加速方向。

- **第一方内核** — 作为 vext 自家组件接入，旧外部路由库只保留为迁移前现状基线
- **首期 TS 核心** — TypeScript 实现完整 trie，作为默认实现、语义真相源与未来 backend 对照
- **未来可选加速** — 只有 benchmark 证明路由内核成为瓶颈时，才另起 Zig/native backend PoC
- **目标 API** — 暴露最小 `add / find / allowed` API，并预留 vext adapter-private fast path 决策空间

## 目录导航

- [当前状态](#当前状态)
- [包导出契约](#包导出契约)
- [目标 API 预览](#目标-api-预览)
- [API 参考](#api-参考)
  - [createRouter(options?)](#createrouteroptions)
  - [RouterOptions](#routeroptions)
  - [router.add(method, path, storeId)](#routeraddmethod-path-storeid)
  - [router.find(method, path)](#routerfindmethod-path)
  - [router.allowed(path)](#routerallowedpath)
- [404 与 405 区分](#404-与-405-区分)
- [路由语法](#路由语法)
  - [URL 与参数规范化](#url-与参数规范化)
  - [优先级](#优先级)
  - [ANY 方法](#any-方法)
- [框架接入](#框架接入)
- [TypeScript](#typescript)
- [Backend 策略](#backend-策略)
- [从源码构建](#从源码构建)
- [运行测试](#运行测试)
- [性能基准](#性能基准)
- [错误参考](#错误参考)
- [License](#license)

## 当前状态

当前仓库已进入首期 TypeScript 实现阶段：

- `src/index.ts` 仅保留 public exports；首期 TypeScript backend 已拆分到 `src/backend/ts/`。
- `package.json` 已提供 `main` / `module` / `types` / `exports`，构建后输出 `dist/index.cjs`、`dist/index.js` 与 `dist/index.d.ts`。
- `test/shared/cases.mjs` 覆盖 static、params、wildcard、ANY、HEAD/OPTIONS、URL 编码、route shape、storeId 和 `allowed()` 边界。
- `benchmark/route-only/index.mjs` 已提供 `find-my-way lookup()`、`find-my-way find()` 与 route-core TS backend 的 route-only 对照 benchmark。
- `docs/api.md`、`docs/vext-integration.md` 与 `docs/benchmark.md` 已补充首期实现说明。
- 尚未发布 npm 包，且 `private: true` 与 `prepublishOnly` 仍会阻止误发布。
- Node.js 目标版本暂定为 `>=18.0.0`。

vext feature flag 接入、adapter-only/e2e benchmark、旧外部路由依赖移除和发布流程仍属于后续阶段；在此之前请继续以 `.devcodex/rutex/requirements/rutex-ts路由引擎/` 下的需求与技术方案为准。

---

## 包导出契约

首期公共包面采用 named exports，不把 default export 作为正式契约。

| 消费方式 | 目标写法 |
|----------|----------|
| CJS | `const { createRouter } = require('route-core')` |
| ESM | `import { createRouter } from 'route-core'` |
| TypeScript 类型 | `import type { Router, RouterOptions, MatchResult } from 'route-core'` |

当前 `package.json` 已提供 `main` / `module` / `types` 与 `exports.{import,require,types}`，分别指向 ESM、CJS 和类型声明产物。发布前仍保留 `private: true` 与 `prepublishOnly` 失败门禁。

---

## 目标 API 预览

> 以下示例在执行 `npm install` 与 `npm run build` 后可通过本地构建产物运行。

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
import { createRouter } from 'route-core'
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

router.find('GET',    '/health')  // → { storeId: 0, params: null }
router.find('DELETE', '/health')  // → { storeId: 1, params: null }
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
import type { Router, RouterOptions, MatchResult } from 'route-core'

const router: Router = createRouter({ caseSensitive: true })
```

---

## Backend 策略

首期只实现 TypeScript backend：

- npm 包名固定为 `route-core`。
- 内部 backend id 为 `ts`。
- `ts` backend 是默认实现、生产 fallback 与语义真相源。
- Zig/native backend 不进入首期，只有在 route-only 或 vext e2e benchmark 证明路由内核成为明确瓶颈时才另起需求。

未来 Zig/native backend 必须复用相同 public API 与 shared cases，不得改变业务调用方式。

---

## 从源码构建

构建 ESM/CJS/types：

```bash
# 构建 ESM/CJS/types
npm run build

# 类型检查
npm run typecheck
```

---

## 运行测试

运行测试：

```bash
npm test                    # 构建后运行全部 Node test cases
npm run test:shared         # shared cases
npm run test:router         # route-core ts backend
npm run test:package        # ESM/CJS package entry
```

目标共享测试用例（`test/shared/cases.mjs`）覆盖范围：

- 静态、参数、通配符路由
- 路由优先级（静态 > 参数 > 通配符）
- `ANY` 方法兜底
- 尾斜杠规范化
- 大小写不敏感匹配
- `maxParamLength` 边界（500 字符命中，501 字符返回 `null`）
- URL 编码边界：合法 percent decode、malformed `%`、`%2F`、params 大小写保真
- 重复路由检测
- route shape 冲突：`:id` vs `:name`、`*file` vs `*path`、通配符非末尾段、裸通配符默认参数名
- 未命中返回 `null`
- `allowed()` 404 / 405 区分、ANY-only 返回 `null`、参数超长返回 `null`、HEAD/OPTIONS 策略、Allow 顺序与去重
- `storeId` 合法性与注册失败不污染外部 store

---

## 性能基准

运行 route-only benchmark：

```bash
npm run bench              # find-my-way lookup/find 与 route-core TS backend 对照
```

验收门槛：

| 场景 | 门槛 |
|------|------|
| 纯路由基线 | 当前脚本输出 `find-my-way lookup()`、`find-my-way find()` 与 `route-core(ts backend)` 的静态、参数、通配符与 miss 吞吐量 |
| vext e2e RPS | 不超过 P0 确认的回退预算，默认建议 `<= 5%` |
| vext e2e p99 | 不高于当前基线 + P0 确认预算 |
| 参数路由 10 万次调用后堆增长 | < 10 MB |
| 旧外部路由依赖 | P8 默认启用后不再出现在 vext runtime dependencies |

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

## License

MIT © Rocky
