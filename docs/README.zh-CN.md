# route-core 中文指南

`route-core` 是一个给框架作者和适配层维护者使用的路由内核。它负责 HTTP method 与 pathname 匹配，返回解码后的 params 和注册时的路由模板；真正的 handler、middleware、请求上下文和响应流程仍然由你的框架持有。

它适合“我只想要一个高性能路由匹配核心”的场景，不适合被当成完整 HTTP dispatcher 使用。

这个包有两种使用方式：

- **标准用法**：每次查找时直接传 `method` 和 `path`
- **高性能接入用法**：把可复用的部分提前准备好，减少每次请求的额外开销

大多数使用者先从标准用法开始即可。只有当你的适配层已经明确卡在热路径上时，才值得切到高性能接入用法。

## 目录导航

- [文档定位](#文档定位)
- [安装](#安装)
- [开始前先判断是否适合](#开始前先判断是否适合)
- [该选哪种用法](#该选哪种用法)
- [当前性能对比](#当前性能对比)
- [快速开始](#快速开始)
- [支持的路由模式](#支持的路由模式)
- [和 hapi 这类路由器相比少了什么](#和-hapi-这类路由器相比少了什么)
- [高性能接入快速开始](#高性能接入快速开始)
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
- [在 vext 类适配器中如何接入](#在-vext-类适配器中如何接入)
- [TypeScript](#typescript)
- [错误参考](#错误参考)
- [变更日志](#变更日志)
- [许可证](#许可证)
- [何时看哪份文档](#何时看哪份文档)

## 文档定位

这份文档只回答使用者最关心的问题：

- 这个包适不适合你
- 先怎么接
- 什么时候该用更激进的高性能接法
- 在真实框架或适配器里边界在哪里

## 安装

```bash
npm install route-core
```

## 开始前先判断是否适合

下面这些场景适合选 `route-core`：

- 你在做框架、适配器、网关或内部平台路由层
- 你希望 `storeId -> store` 的所有权留在自己框架里
- 你需要命中后直接拿到 `routePath`，用于 `req.route` 或指标标签
- 你已经有自己的请求对象，只缺路由匹配能力

下面这些场景通常不适合：

- 你想直接拿一个“注册 handler 就能跑”的完整 Web 路由器
- 你希望包内自带 middleware 编排或响应辅助
- 你希望无改造替换一个把 handler、defaultRoute 都挂在 router 上的库

## 该选哪种用法

优先选 **标准用法**，如果：

- 你现在拿到的还是原始 method 和原始 path
- 你更在意接入清晰度，而不是把适配层常数项压到最薄
- 你想先完成集成，再决定要不要走热路径

优先选 **高性能接入用法**，如果：

- 你是在适配层内部热路径里调用 router
- 同一个 method 会被大量重复 lookup
- 你已经有规范化 pathname，或者愿意每请求只规范化一次

两种用法的匹配结果完全一致。高性能接入用法只是把一些重复预处理提前做掉。

## 当前性能对比

先看结论：

- 你要的是最简单接入，优先选**标准用法**。
- 你选 `route-core` 的主要原因就是性能，优先选**高性能接入用法**。
- 当前版本真正稳定、明显超过 `find-my-way` 的，是高性能接入用法。

下面这组数据来自当前仓库在 `2026-05-29` 的本地实测，命令分别是 `npm run bench:compat` 和 `npm run bench:hot`：

| 场景 | 这代表什么 | `find-my-way` | route-core 标准用法 | route-core 高性能接入用法 |
|------|------|------|------|------|
| static | 精确静态路径，例如 `/users` | 约 `5.4M` 到 `5.9M 次/秒` | 约 `5.8M` 到 `6.0M 次/秒` | 约 `7.4M` 到 `7.5M 次/秒` |
| params | 参数路径，例如 `/users/:id` | 约 `2.5M` 到 `3.1M 次/秒` | 约 `3.0M` 到 `3.2M 次/秒` | 约 `3.9M` 到 `4.2M 次/秒` |
| wildcard | 尾部通配符路径，例如 `/assets/*file` | 约 `3.2M` 到 `3.4M 次/秒` | 约 `2.8M` 到 `2.9M 次/秒` | 约 `4.7M` 到 `4.9M 次/秒` |
| miss | 根本没命中任何路由的查找 | 约 `5.7M` 到 `6.7M 次/秒` | 约 `6.3M` 到 `6.5M 次/秒` | 约 `12.4M` 到 `12.5M 次/秒` |

怎么理解这张表：

- 标准用法更适合先接进去，但不是“所有场景都大幅领先”的模式。
- 高性能接入用法才是性能优先模式；如果你是因为速度选它，应该重点看这一列。
- wildcard 场景就是一个很直观的例子：高性能接入用法明显强于标准用法，也明显强于 `find-my-way`。

你也可以在自己的机器上直接复核：

```bash
npm run bench:compat
npm run bench:hot
```

这组数字应当看成“当前版本在当前环境下的快照”，不是脱离机器、Node 版本和路由结构的绝对承诺。

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

这个例子也说明了 `route-core` 的边界：

- 它只保存数值 `storeId`
- 你的框架负责把 `storeId` 回查成真正的 handler 或 middleware 链
- 命中时会把 `routePath` 一并返回，不需要你额外再查路由模板

## 支持的路由模式

当前支持的路由形态有：

- 精确静态路由，例如 `/users`
- 命名参数路由，例如 `/users/:id`
- 尾部通配符路由，例如 `/assets/*file`
- 裸通配符 `*`
- 作为 method 兜底的 `ANY`

当前限制：

- 通配符只能出现在最后一段
- 路径必须以 `/` 开头，除非整条路由就是裸通配符 `*`
- 不能有空路径段，例如 `/users//profile`
- 归一化后的路由形态必须唯一，所以 `/users/:id` 会和 `/users/:name` 冲突
- 当前不支持可选段、正则参数、位于路径中间的通配符

完整示例：

```js
const { createRouter } = require('route-core')

const router = createRouter()

router.add('GET', '/users', 0)
router.add('GET', '/users/:id', 1)
router.add('GET', '/assets/*file', 2)
router.add('ANY', '/health', 3)
router.add('GET', '*', 4)

console.log(router.find('GET', '/users'))
// { storeId: 0, params: null, routePath: '/users' }

console.log(router.find('GET', '/users/42'))
// { storeId: 1, params: { id: '42' }, routePath: '/users/:id' }

console.log(router.find('GET', '/assets/js/app.js'))
// { storeId: 2, params: { file: 'js/app.js' }, routePath: '/assets/*file' }

console.log(router.find('POST', '/health'))
// { storeId: 3, params: null, routePath: '/health' }

console.log(router.find('GET', '/anything-else'))
// { storeId: 4, params: null, routePath: '*' }
```

不支持的写法示例：

```js
router.add('GET', 'users', 0)              // 非法：必须以 / 开头
router.add('GET', '/users/*file/edit', 1)  // 非法：通配符必须在最后
router.add('GET', '/users/:id?', 2)        // 非法：不支持可选参数
router.add('GET', '/users/:id(\\d+)', 3)   // 非法：不支持正则参数
```

优先级规则：

- 静态路由优先于参数路由
- 参数路由优先于通配符路由
- 具体 method 优先于 `ANY`

例如：

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

## 和 hapi 这类路由器相比少了什么

如果把 `route-core` 和 `hapi` 这种完整框架路由器放在一起看，最大区别其实不是“快一点还是慢一点”，而是能力范围。

`route-core` 故意只支持更小的一套路由语法：

- 精确静态路径
- 每段一个命名参数，例如 `/users/:id`
- 只在最后一段出现的通配符，例如 `/assets/*file`
- `ANY` method 兜底

而 `hapi` 这类路由器还支持、但 `route-core` 当前不支持的能力包括：

- 可选参数，例如 `/hello/{user?}`
- 指定段数的多段参数，例如 `/hello/{user*2}`
- 单段内混合参数，例如 `/{filename}.jpg`
- 单段内多个参数，例如 `/{filename}.{ext}`
- 在路由声明里直接挂 handler、校验、认证和更多框架级配置

对使用者来说可以这样理解：

- 你要的是一个小而明确的匹配内核，准备自己接 handler、middleware、store 和上下文，就选 `route-core`
- 你要的是更丰富的路由表达能力和更完整的框架级路由能力，就选 `hapi` 这类完整路由器

所以 `route-core` 不是要做成 `hapi` 的语法兼容替身，而是一个能力边界更窄、但更适合热路径集成的路由核心。

## 高性能接入快速开始

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

对适配层作者来说，常见热路径用法是：

1. 在启动期 `prepareMethod()`
2. 每次请求只做一次 `preparePathname()`
3. 用 `lookupPrepared()` 或 `method.lookup()` 命中路由
4. 通过 `storeId` 回查自己的 store/handler

如果你想知道这两种用法分别对应哪些 API，名字如下：

- 标准用法：`add`、`find`、`lookup`、`allowed`
- 高性能接入用法：`prepareMethod`、`preparePathname`、`findPrepared`、`lookupPrepared`、`allowedPrepared`

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

这也是它的标准职责边界：

- `route-core` 负责匹配
- 你的框架负责 handler、middleware、metadata 和 fallback 行为
- `allowed()` 用来区分 `404` 和 `405`

## 在 vext 类适配器中如何接入

`route-core` 可以替换 `vext` 这类 native adapter 里的“路由匹配核心”，但它**不是**把 `find-my-way` 的 import 名称直接替换掉就完事的那种兼容。

不能直接一行替换的原因：

- `find-my-way` 会把 `handler + store` 直接注册在 router 上
- `find-my-way` 暴露 `lookup(req, res)` 和 `defaultRoute`
- `route-core` 只注册 `storeId`，命中结果通过 `find()` 或 `lookup()` 返回

能直接对齐的能力：

- `method + path` 注册模型
- 命名参数与尾部 wildcard 语义
- `ANY` 兜底 bucket
- 命中时返回 `routePath`，可直接用于 `req.route`

适配器自己需要持有的部分：

- `storeId -> store` 表
- `404 / 405` fallback 分支
- 请求对象 / 响应对象处理
- 可选的 prepared method 缓存

最小接入形态可以长这样：

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

当前对 `vext` 的推荐结论是：

- `✅` 可以作为匹配引擎接入
- `❌` 不应表述成“直接替换现有 adapter API”
- 真正的迁移边界应该放在 adapter 内部，而不是盲目做包级别替换

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

## 何时看变更说明

如果你要确认当前版本已经归档了什么变更，直接看 [../changelogs/v0.0.2.md](../changelogs/v0.0.2.md)。
