# route-core 中文指南

`route-core` 是一个面向 Node.js 框架适配层的轻量级路由内核。它只负责方法与路径匹配、参数提取、路由模板回传，以及 `storeId` 分发；真正的 handler、middleware、上下文和响应流程仍由宿主框架持有。

## 目录导航

- [文档定位](#文档定位)
- [英文 README 与中文文档的联动关系](#英文-readme-与中文文档的联动关系)
- [安装](#安装)
- [快速开始](#快速开始)
- [公开 API 概览](#公开-api-概览)
- [路由语义](#路由语义)
- [框架接入建议](#框架接入建议)
- [何时看哪份文档](#何时看哪份文档)

## 文档定位

这份文档是 `route-core` 的中文配套说明，面向中文使用者说明如何理解和接入当前公开 API。默认入口仍然是项目根目录的英文 README：

- 英文入口：[../README.md](../README.md)
- 当前版本说明：[../changelogs/v0.0.2.md](../changelogs/v0.0.2.md)

## 英文 README 与中文文档的联动关系

两者描述的是同一个包和同一套公开 API，不是两套不同文档体系。

- 根 `README.md` 是默认英文入口，面向 npm/GitHub 读者，优先提供安装、Quick Start 和公开 API 总览。
- `docs/README.zh-CN.md` 是中文配套说明，重点帮助中文读者快速理解相同的 API、语义和接入方式。
- 如果两边示例措辞存在细微差异，以源码实现、已发布包行为和英文 `README.md` 的公开入口描述为准。
- 当英文 README 更新公开 API 或用户接入方式时，中文文档需要同步更新，保证两者联动而不是长期漂移。

## 安装

```bash
npm install route-core
```

## 快速开始

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

router.lookup('GET', '/users/42', (storeId, params, routePath) => {
  console.log(storeId)
  console.log(params)
  console.log(routePath)
})
```

## 公开 API 概览

当前公开接口只有四个方法：

- `add(method, path, storeId)`：注册路由。
- `find(method, path)`：查询命中结果，返回 `MatchResult | null`。
- `lookup(method, path, onMatch)`：为热路径适配层提供回调式命中接口。
- `allowed(path)`：帮助区分 404 与 405。

返回结果 `MatchResult` 的关键字段：

- `storeId`：路由命中后返回的数值 id。
- `params`：命名参数或通配符参数；无参数路由时为 `null`。
- `routePath`：注册时的路由模板，例如 `/users/:id`。

## 路由语义

当前语义与英文 README 保持一致：

- 优先级：`static > :param > *wildcard`
- `ANY`：先查具体 method，未命中再查 `ANY`
- 参数处理：按原始 `/` 分段后再 decode，`%2F` 不会切出新的路径段
- `allowed(path)`：只在 `find()` 返回 `null` 后使用，用于区分 404 与 405
- `maxParamLength`：按解码后的参数长度检查，超限返回 `null`

## 框架接入建议

推荐使用 `storeId -> store` 的映射方式集成：

1. 由宿主框架维护 handler、middleware、metadata。
2. 注册路由时把内部 store 映射成数值 `storeId`。
3. 命中后通过 `find()` 或 `lookup()` 取回 `storeId`、`params` 和 `routePath`。
4. 如果需要低基数路由模板，例如 `req.route`，直接使用 `routePath`。

## 何时看哪份文档

- 你想快速了解安装、入口示例和包的默认对外说明：先看英文 [../README.md](../README.md)
- 你希望用中文理解同一套 API 和接入方式：看这份中文文档
- 你要确认当前版本已经归档了什么变更：看 [../changelogs/v0.0.2.md](../changelogs/v0.0.2.md)

如果后续项目继续补更多中文技术文档，仍应以这份中文指南作为入口索引，并保持与根 README 的双向链接。
