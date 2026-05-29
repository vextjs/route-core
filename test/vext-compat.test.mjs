import assert from 'node:assert/strict'
import test from 'node:test'
import { createRouter } from '../dist/index.js'

test('vext adapter compatibility fixture', async (t) => {
  await t.test('lookup carries store id, params, and route template for req.route', () => {
    const router = createRouter()
    const stores = []

    registerRoute(router, stores, 'GET', '/users/:id', [routeTemplateMiddleware, handlerMiddleware])
    registerRoute(router, stores, 'GET', '/users/profile', [routeTemplateMiddleware, handlerMiddleware])

    const dynamicResponse = dispatch(router, stores, 'GET', '/users/abc-123')
    assert.deepEqual(dynamicResponse, {
      route: '/users/:id',
      params: { id: 'abc-123' },
      chain: ['route:/users/:id', 'handler:/users/:id'],
    })

    const staticResponse = dispatch(router, stores, 'GET', '/users/profile')
    assert.deepEqual(staticResponse, {
      route: '/users/profile',
      params: {},
      chain: ['route:/users/profile', 'handler:/users/profile'],
    })
  })

  await t.test('lookup fallback preserves ANY route templates', () => {
    const router = createRouter()
    const stores = []

    registerRoute(router, stores, 'ANY', '/rpc', [routeTemplateMiddleware, handlerMiddleware])

    const response = dispatch(router, stores, 'POST', '/rpc')
    assert.deepEqual(response, {
      route: '/rpc',
      params: {},
      chain: ['route:/rpc', 'handler:/rpc'],
    })
  })

  await t.test('fresh router reload does not require route deregistration', () => {
    const first = createRouter()
    const firstStores = []
    registerRoute(first, firstStores, 'GET', '/reload/:version', [handlerMiddleware])

    const second = createRouter()
    const secondStores = []
    registerRoute(second, secondStores, 'GET', '/reload/current', [handlerMiddleware])

    assert.equal(dispatch(first, firstStores, 'GET', '/reload/current').route, '/reload/:version')
    assert.equal(dispatch(second, secondStores, 'GET', '/reload/current').route, '/reload/current')
  })

  await t.test('prepared method handle supports vext-like hot dispatch after later add calls', () => {
    const router = createRouter()
    const stores = []

    registerRoute(router, stores, 'GET', '/users/:id', [routeTemplateMiddleware, handlerMiddleware])

    const GET = router.prepareMethod('GET')

    assert.deepEqual(
      dispatchPrepared(router, GET, stores, '/users/42'),
      {
        route: '/users/:id',
        params: { id: '42' },
        chain: ['route:/users/:id', 'handler:/users/:id'],
      },
    )

    registerRoute(router, stores, 'GET', '/health', [routeTemplateMiddleware, handlerMiddleware])

    assert.deepEqual(
      dispatchPrepared(router, GET, stores, '/health'),
      {
        route: '/health',
        params: {},
        chain: ['route:/health', 'handler:/health'],
      },
    )
  })
})

function registerRoute(router, stores, method, path, chain) {
  const storeId = stores.length
  stores.push({ routePath: path, chain })
  router.add(method, path, storeId)
  return storeId
}

function dispatch(router, stores, method, path) {
  let response = null
  const matched = router.lookup(method, path, (storeId, params, routePath) => {
    const store = stores[storeId]
    assert.ok(store, `missing store for id ${storeId}`)

    const req = {
      route: routePath,
      params: params ?? {},
      chain: [],
    }

    for (const middleware of store.chain) {
      middleware(req)
    }

    response = {
      route: req.route,
      params: req.params,
      chain: req.chain,
    }
  })

  assert.equal(matched, true)
  assert.ok(response)
  return response
}

function dispatchPrepared(router, preparedMethod, stores, path) {
  const preparedPath = router.preparePathname(path)
  assert.ok(preparedPath)

  let response = null
  const matched = preparedMethod.lookup(preparedPath, (storeId, params, routePath) => {
    const store = stores[storeId]
    assert.ok(store, `missing store for id ${storeId}`)

    const req = {
      route: routePath,
      params: params ?? {},
      chain: [],
    }

    for (const middleware of store.chain) {
      middleware(req)
    }

    response = {
      route: req.route,
      params: req.params,
      chain: req.chain,
    }
  })

  assert.equal(matched, true)
  assert.ok(response)
  return response
}

function routeTemplateMiddleware(req) {
  req.chain.push(`route:${req.route}`)
}

function handlerMiddleware(req) {
  req.chain.push(`handler:${req.route}`)
}
