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

test('prepared APIs normalize raw string pathnames with the standard router rules', () => {
  const router = createRouter({ caseSensitive: false })
  router.add('GET', '/users/:id', 1)
  router.add('GET', '/health', 2)
  router.add('POST', '/health', 3)

  const get = router.prepareMethod('GET')

  assert.deepEqual(get.find('/Users/AbC/?from=app#section'), {
    storeId: 1,
    params: { id: 'AbC' },
    routePath: '/users/:id',
  })

  assert.deepEqual(router.findPrepared(get, '/Users/AbC/?from=app#section'), {
    storeId: 1,
    params: { id: 'AbC' },
    routePath: '/users/:id',
  })

  let lookupResult = null
  assert.equal(router.lookupPrepared(get, '/Users/AbC/?from=app#section', (storeId, params, routePath) => {
    lookupResult = { storeId, params, routePath }
  }), true)
  assert.deepEqual(lookupResult, {
    storeId: 1,
    params: { id: 'AbC' },
    routePath: '/users/:id',
  })

  assert.deepEqual(router.allowedPrepared('/Health/?from=app#section'), ['GET', 'POST'])
})

test('allowedPrepared reuses prepared path input', () => {
  const router = createRouter()
  router.add('GET', '/health', 1)
  router.add('POST', '/health', 2)
  router.add('ANY', '/health', 3)

  assert.deepEqual(router.allowedPrepared('/health'), ['GET', 'POST'])
})

test('router prepared wrappers reject method handles from another router instance', () => {
  const routerA = createRouter()
  routerA.add('GET', '/a', 1)

  const routerB = createRouter()
  routerB.add('GET', '/b', 2)

  const getFromA = routerA.prepareMethod('GET')

  assert.deepEqual(getFromA.find('/a'), {
    storeId: 1,
    params: null,
    routePath: '/a',
  })

  assert.throws(
    () => routerB.findPrepared(getFromA, '/a'),
    /same router instance/,
  )
  assert.throws(
    () => routerB.lookupPrepared(getFromA, '/a', () => {}),
    /same router instance/,
  )
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

test('hot prepared method supports optional params and fixed multi-segment wildcards', () => {
  const router = createRouter()
  router.add('GET', '/optional/:id?', 10)
  router.add('GET', '/files/*2:path', 11)

  const get = router.prepareMethod('GET')

  assert.deepEqual(get.find('/optional'), {
    storeId: 10,
    params: null,
    routePath: '/optional/:id?',
  })

  assert.deepEqual(get.find('/optional/42'), {
    storeId: 10,
    params: { id: '42' },
    routePath: '/optional/:id?',
  })

  assert.deepEqual(get.find('/files/a/b'), {
    storeId: 11,
    params: { path: 'a/b' },
    routePath: '/files/*2:path',
  })

  assert.equal(get.find('/files/a'), null)
})

test('hot prepared method supports mixed segments and regex params', () => {
  const router = createRouter()
  router.add('GET', '/assets/:name.:ext', 20)
  router.add('GET', '/assets/:id(^\\d+)', 21)
  router.add('GET', '/assets/:left-:right', 22)
  router.add('GET', '/assets/*file', 23)

  const get = router.prepareMethod('GET')

  assert.deepEqual(get.find('/assets/app.js'), {
    storeId: 20,
    params: { name: 'app', ext: 'js' },
    routePath: '/assets/:name.:ext',
  })

  assert.deepEqual(get.find('/assets/123'), {
    storeId: 21,
    params: { id: '123' },
    routePath: '/assets/:id(^\\d+)',
  })

  assert.deepEqual(get.find('/assets/user-admin'), {
    storeId: 22,
    params: { left: 'user', right: 'admin' },
    routePath: '/assets/:left-:right',
  })

  assert.deepEqual(get.find('/assets/js/app.js'), {
    storeId: 23,
    params: { file: 'js/app.js' },
    routePath: '/assets/*file',
  })

  assert.deepEqual(get.find('/assets/slug'), {
    storeId: 23,
    params: { file: 'slug' },
    routePath: '/assets/*file',
  })
})
