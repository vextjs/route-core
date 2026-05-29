import assert from 'node:assert/strict'
import test from 'node:test'
import { createRouter } from '../dist/index.js'

test('hot prepared method supports direct find and lookup', async (t) => {
  const router = createRouter()
  router.add('GET', '/users/:id', 1)
  router.add('ANY', '/rpc', 2)

  const get = router.prepareMethod('GET')

  assert.deepEqual(get.find('/users/abc'), {
    storeId: 1,
    params: { id: 'abc' },
    routePath: '/users/:id',
  })

  let lookupResult = null
  assert.equal(get.lookup('/users/xyz', (storeId, params, routePath) => {
    lookupResult = { storeId, params, routePath }
  }), true)
  assert.deepEqual(lookupResult, {
    storeId: 1,
    params: { id: 'xyz' },
    routePath: '/users/:id',
  })

  const post = router.prepareMethod('POST')
  assert.deepEqual(post.find('/rpc'), {
    storeId: 2,
    params: null,
    routePath: '/rpc',
  })

  assert.equal(router.lookupPrepared(post, '/rpc', () => {}), true)
})

test('preparePathname preserves raw params for case-insensitive routers', () => {
  const router = createRouter({ caseSensitive: false })
  router.add('GET', '/users/:id', 1)

  const get = router.prepareMethod('GET')
  const prepared = router.preparePathname('/Users/AbC')
  assert.ok(prepared)
  assert.deepEqual(router.findPrepared(get, prepared), {
    storeId: 1,
    params: { id: 'AbC' },
    routePath: '/users/:id',
  })
})

test('allowedPrepared reuses prepared path input', () => {
  const router = createRouter()
  router.add('GET', '/health', 1)
  router.add('POST', '/health', 2)
  router.add('ANY', '/health', 3)

  assert.deepEqual(router.allowedPrepared('/health'), ['GET', 'POST'])
})

test('prepared method handles stay live after add()', () => {
  const router = createRouter()
  router.add('GET', '/users/:id', 1)

  const get = router.prepareMethod('GET')
  assert.deepEqual(get.find('/users/42'), {
    storeId: 1,
    params: { id: '42' },
    routePath: '/users/:id',
  })

  router.add('GET', '/users/profile', 2)
  assert.deepEqual(get.find('/users/profile'), {
    storeId: 2,
    params: null,
    routePath: '/users/profile',
  })

  router.add('ANY', '/rpc', 3)
  const post = router.prepareMethod('POST')
  assert.deepEqual(post.find('/rpc'), {
    storeId: 3,
    params: null,
    routePath: '/rpc',
  })

  const any = router.prepareMethod('ANY')
  assert.deepEqual(any.find('/rpc'), {
    storeId: 3,
    params: null,
    routePath: '/rpc',
  })
})
