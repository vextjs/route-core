# route-core 中文指南

`route-core` 是一个面向 Node.js 框架适配层的轻量级路由内核。它负责 HTTP method 与路径匹配、命名参数解码、路由模板回传，以及数值 `storeId` 分发；真正的 handler、middleware、上下文和响应流程仍由宿主框架持有。

它适合那些想要一个聚焦路由内核、而不是完整 HTTP dispatcher 的框架适配层。

当前版本公开两层能力：

- `compat API`：`add`、`find`、`lookup`、`allowed`
- `hot API`：`prepareMethod`、`preparePathname`、`findPrepared`、`lookupPrepared`、`allowedPrepared`

- **双层公开面**：保留兼容 facade，同时公开更薄的 hot path，方便框架内部吃到更高吞吐。
- **宿主持有 store**：`route-core` 只管理 `storeId` 和参数；真正的 handler、middleware 和 metadata 由你的框架持有。
- **模板感知匹配**：命中结果会回传 `routePath`，适合 `req.route` 这类低基数标签。
- **支持 CJS、ESM 与 TypeScript**：包根同时导出 CommonJS、ES module 和声明文件。

## 目录导航

- [文档定位](#文档定位)
- [英文 README 与中文文档的联动关系](#英文-readme-与中文文档的联动关系)
- [安装](#安装)
- [快速开始](#快速开始)
- [Hot Path 快速开始](#hot-path-快速开始)
- [API 参考](#api-参考)
  - [`createRouter(options?)`](#createrouteroptions)
  - [`RouterOptions`](#routeroptions)
  - [`router.add(method, path, storeId)`](#routeraddmethod-path-storeid)
  - [`router.find(method, path)`](#routerfindmethod-path)
  - [`router.lookup(method, path, onMatch)`](#routerlookupmethod-path-onmatch)
  - [`router.allowed(path)`](#routerallowedpath)
  - [`router.prepareMethod(method)`](#routerpreparemethodmethod)
  - [`router.preparePathname(path)`](#routerpreparepathnamepath)
  - [`router.findPrepared(method, pathname)`](#routerfindpreparedmethod-pathname)
  - [`router.lookupPrepared(method, pathname, onMatch)`](#routerlookuppreparedmethod-pathname-onmatch)
  - [`router.allowedPrepared(pathname)`](#routerallowedpreparedpathname)
- [404 与 405](#404-与-405)
- [路由语法](#路由语法)
  - [URL 与参数规范化](#url-与参数规范化)
  - [优先级](#优先级)
  - [`ANY` Method](#any-method)
- [框架集成](#框架集成)
- [TypeScript](#typescript)
- [错误参考](#错误参考)
- [变更日志](#变更日志)
- [许可证](#许可证)
- [何时看哪份文档](#何时看哪份文档)

## 文档定位

这份文档是 `route-core` 的中文配套说明，面向中文使用者解释同一套公开 API、行为约定和接入方式。默认包入口仍然是项目根目录的英文 README：

- 英文入口：[../README.md](../README.md)
- 当前版本说明：[../changelogs/v0.0.2.md](../changelogs/v0.0.2.md)

## 英文 README 与中文文档的联动关系

两者描述的是同一个包和同一套公开契约，不是两套不同文档体系。

- 根 `README.md` 是 npm/GitHub 的默认英文入口，优先提供安装、Quick Start、完整 API 与行为说明。
- `docs/README.zh-CN.md` 是中文配套入口，覆盖同样的公开 API、语义、限制条件和接入建议。
- 如果两边示例措辞存在细微差异，以源码实现和已发布包行为为准。
- 当英文 README 更新公开 API 或用户接入方式时，中文文档必须同步更新，避免长期漂移。

## 安装

```bash
npm install route-core
```

## 快速开始

CommonJS：

```js
const { createRouter } = require('route-core')
```

ES modules：

```js
import { createRouter } from 'route-core'
```

基础用法：

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

如果你的适配层更偏好 callback 式命中分发，可以使用 `lookup()`，避免返回 `MatchResult` 包装对象：

```js
router.lookup('GET', '/users/42', (storeId, params, routePath) => {
  console.log(storeId)   // 1
  console.log(params)    // { id: '42' }
  console.log(routePath) // '/users/:id'
})
```

## Hot Path 快速开始

如果你的适配层已经拿到了规范化的 `pathname`，更推荐走 prepared hot path：

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

如果你的适配层仍然拿到的是原始路径，可以先规范化一次，再在 hot path 中复用：

```js
const preparedPath = router.preparePathname('/Users/42?from=app')
if (preparedPath) {
  console.log(router.findPrepared(GET, preparedPath))
}
```

prepared method handle 会在后续 `add()` 后保持可用。路由表发生变化时，`route-core` 会在下一次 lookup 时把它重新绑定到最新的 compiled runtime。

## API 参考

### `createRouter(options?)`

创建并返回一个新的 `Router` 实例。

```ts
function createRouter(options?: RouterOptions): Router
```

#### `RouterOptions`

| 选项 | 类型 | 默认值 | 说明 |
|------|------|:------:|------|
| `ignoreTrailingSlash` | `boolean` | `true` | 把 `/foo` 和 `/foo/` 视为同一路由 |
| `caseSensitive` | `boolean` | `false` | 为 `false` 时，匹配键会规范化为小写 |
| `maxParamLength` | `number` | `500` | 单个参数段解码后的最大长度；超限返回 `null` |
| `allowWildcard` | `boolean` | `true` | 为 `false` 时，通配符路由会抛出 `InvalidPathError` |

### `router.add(method, path, storeId)`

注册一条路由。

```ts
router.add(method: string, path: string, storeId: number): void
```

| 参数 | 说明 |
|------|------|
| `method` | HTTP method。内置包括 `GET`、`POST`、`PUT`、`PATCH`、`DELETE`、`HEAD`、`OPTIONS`、`CONNECT` 和 `ANY`。method 会规范化为大写。 |
| `path` | 路由模式。支持静态段、`:param` 命名参数，以及尾部 `*name` 通配符。 |
| `storeId` | 命中时返回的非负安全整数。你的框架可以把它映射回 handler 或 store。 |

错误：

| 错误类 | Code | 触发条件 |
|--------|------|----------|
| `RouteConflictError` | `ERR_ROUTE_CONFLICT` | 同 method 和归一路由形状重复注册 |
| `InvalidPathError` | `ERR_INVALID_PATH` | `allowWildcard=false` 时仍使用通配符路由 |
| `InvalidMethodError` | `ERR_INVALID_METHOD` | method 为空字符串 |
| `InvalidStoreIdError` | `ERR_INVALID_STORE_ID` | `storeId` 不是非负安全整数 |

### `router.find(method, path)`

命中时返回 `MatchResult`，未命中或参数输入无效时返回 `null`。

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

`find()` 返回 `null` 的情况：

- 没有任何路由命中
- 命中的参数值解码后长度超过 `maxParamLength`
- 命中的参数或通配符值 URL 解码失败

### `router.lookup(method, path, onMatch)`

查找路由，并在命中时直接调用回调。它适合偏好 callback 式分发的适配层。

```ts
router.lookup(
  method: string,
  path: string,
  onMatch: (storeId: number, params: Record<string, string> | null, routePath: string) => void,
): boolean
```

| 返回值 | 含义 |
|--------|------|
| `true` | 路由命中，且已调用 `onMatch` |
| `false` | 没有命中，或命中参数无效 |

`lookup()` 与 `find()` 采用完全相同的匹配语义，只是不返回 `MatchResult` 对象。

### `router.allowed(path)`

返回某条路径上已注册的方法，用来区分 `404 Not Found` 和 `405 Method Not Allowed`。

```ts
router.allowed(path: string): string[] | null
```

| 返回值 | 含义 |
|--------|------|
| `null` | 所有 method bucket 中都不存在该路径 |
| `string[]` | 该路径存在，但当前请求 method 没有注册 |

建议只在 `find()` 返回 `null` 后再调用 `allowed()`。

### `router.prepareMethod(method)`

创建一个可复用的 hot-path method handle。

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

当你的适配层会对同一个 HTTP method 做大量 lookup 时，优先使用它。

prepared method handle 在后续 `add()` 之后仍然有效；它会在下一次 lookup 时自动切到最新 compiled runtime。

### `router.preparePathname(path)`

把路径规范化一次，供 hot API 重复使用。

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

常见的已规范化、小写 ASCII 路径通常会返回纯字符串；在大小写不敏感模式下，如果既要保留原始参数大小写、又要使用小写路径参与匹配，则会返回对象形态。

### `router.findPrepared(method, pathname)`

直接调用 prepared hot path。

```ts
router.findPrepared(method: PreparedMethod, pathname: PreparedPathname): MatchResult | null
```

它等价于 `method.find(pathname)`。

### `router.lookupPrepared(method, pathname, onMatch)`

直接调用 prepared hot lookup path。

```ts
router.lookupPrepared(
  method: PreparedMethod,
  pathname: PreparedPathname,
  onMatch: LookupHandler,
): boolean
```

它等价于 `method.lookup(pathname, onMatch)`。

### `router.allowedPrepared(pathname)`

对 prepared pathname 执行 `allowed()`。

```ts
router.allowedPrepared(pathname: PreparedPathname): string[] | null
```

## 404 与 405

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

## 路由语法

### URL 与参数规范化

`route-core` 会先按原始 `/` 分隔符切段，再对命中的参数值做 decode，因此 `%2F` 会留在同一个段里，而不会切成新的路径段。

| 输入处理 | 行为 |
|----------|------|
| query/hash | 匹配前会忽略 |
| percent decoding | 只有在路由命中后才执行 |
| `%2F` | 会保留在同一路径段中，最终在 `params` 里解码成 `/` |
| `caseSensitive=false` | 只影响匹配键；返回的 `params` 保持请求时的大小写 |
| `maxParamLength` | 针对解码后的参数或通配符值进行检查 |

| 模式类型 | 示例 | 匹配行为 |
|----------|------|----------|
| Static | `/users/profile` | 精确匹配 |
| Param | `/users/:id` | `/users/42` -> `{ id: '42' }` |
| Wildcard | `/assets/*file` | `/assets/js/app.js` -> `{ file: 'js/app.js' }` |
| Bare wildcard | `*` | 匹配任意路径 |

归一路由形状必须唯一。例如 `/users/:id` 会与 `/users/:name` 冲突，`/assets/*file` 会与 `/assets/*path` 冲突。

### 优先级

当多条模式都可能命中同一路径时，`route-core` 使用以下顺序：

```text
static > :param > *wildcard
```

### `ANY` Method

`ANY` 作为兜底 bucket。router 会先查具体 method，再查 `ANY`。

```js
router.add('GET', '/health', 0)
router.add('ANY', '/health', 1)

router.find('GET', '/health')
// { storeId: 0, params: null, routePath: '/health' }

router.find('DELETE', '/health')
// { storeId: 1, params: null, routePath: '/health' }
```

## 框架集成

`route-core` 与具体传输层无关。常见集成方式是 `storeId -> store` 映射：

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

对于更强调吞吐的宿主适配层，推荐：

1. 把 method 预先变成 prepared method handle
2. 把原始 URL 预先规范化成 prepared pathname
3. 命中后通过 `storeId` 回查真正的 handler/middleware/store

## TypeScript

所有公开类型都从包根导出：

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

## 错误参考

```js
const {
  RouteConflictError,
  InvalidPathError,
  InvalidMethodError,
  InvalidStoreIdError,
} = require('route-core')
```

| 错误类 | Code | 触发条件 |
|--------|------|----------|
| `RouteConflictError` | `ERR_ROUTE_CONFLICT` | 同 method 和归一路由形状重复注册 |
| `InvalidPathError` | `ERR_INVALID_PATH` | `allowWildcard=false` 时仍使用通配符路由 |
| `InvalidMethodError` | `ERR_INVALID_METHOD` | method 为空字符串 |
| `InvalidStoreIdError` | `ERR_INVALID_STORE_ID` | `storeId` 不是非负安全整数 |

## 变更日志

- [v0.0.2](../changelogs/v0.0.2.md)
- [Unreleased](../changelogs/unreleased.md)

## 许可证

MIT

## 何时看哪份文档

- 你想快速了解安装、入口示例和默认对外说明：先看英文 [../README.md](../README.md)
- 你希望用中文了解同一套 API、行为语义和接入方式：看这份中文文档
- 你要确认当前版本已经归档了什么变更：看 [../changelogs/v0.0.2.md](../changelogs/v0.0.2.md)

如果后续继续补更多中文技术文档，仍应以这份中文指南作为入口索引，并保持与根 README 的双向链接。
