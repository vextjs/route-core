import assert from 'node:assert/strict'

export function runRouterCases(createRouter, errors) {
  const {
    InvalidMethodError,
    InvalidPathError,
    InvalidStoreIdError,
    RouteConflictError,
  } = errors
  const match = (storeId, params, routePath) => ({ storeId, params, routePath })

  {
    const router = createRouter()
    router.add('GET', '/users', 0)
    router.add('GET', '/users/:id', 1)
    router.add('GET', '/users/*rest', 2)
    router.add('POST', '/users', 3)

    assert.deepEqual(router.find('GET', '/users'), match(0, null, '/users'))
    assert.deepEqual(router.find('GET', '/users/42'), match(1, { id: '42' }, '/users/:id'))
    assert.deepEqual(router.find('GET', '/users/profile'), match(1, { id: 'profile' }, '/users/:id'))
    assert.deepEqual(router.allowed('/users'), ['GET', 'POST'])
    assert.equal(router.find('DELETE', '/users'), null)
  }

  {
    const router = createRouter()
    router.add('GET', '/users/profile', 10)
    router.add('GET', '/users/:id', 11)
    router.add('GET', '/users/*rest', 12)

    assert.deepEqual(router.find('GET', '/users/profile'), match(10, null, '/users/profile'))
    assert.deepEqual(router.find('GET', '/users/42'), match(11, { id: '42' }, '/users/:id'))
    assert.deepEqual(router.find('GET', '/users/a/b'), match(12, { rest: 'a/b' }, '/users/*rest'))
  }

  {
    const router = createRouter()
    router.add('ANY', '/health', 1)
    router.add('GET', '/health', 2)

    assert.deepEqual(router.find('GET', '/health'), match(2, null, '/health'))
    assert.deepEqual(router.find('DELETE', '/health'), match(1, null, '/health'))
    assert.deepEqual(router.allowed('/health'), ['GET'])

    const anyOnly = createRouter()
    anyOnly.add('ANY', '/only', 3)
    assert.equal(anyOnly.allowed('/only'), null)
  }

  {
    const router = createRouter()
    router.add('GET', '/files/:name', 4)
    router.add('GET', '/case/:value', 5)

    assert.deepEqual(router.find('GET', '/files/a%2Fb'), match(4, { name: 'a/b' }, '/files/:name'))
    assert.deepEqual(router.find('GET', '/case/MiXeD'), match(5, { value: 'MiXeD' }, '/case/:value'))
    assert.equal(router.find('GET', '/files/%E0%A4%A'), null)
    assert.equal(router.allowed('/files/%E0%A4%A'), null)
  }

  {
    const router = createRouter({ maxParamLength: 3 })
    router.add('GET', '/short/:value', 6)

    assert.deepEqual(router.find('GET', '/short/abc'), match(6, { value: 'abc' }, '/short/:value'))
    assert.equal(router.find('GET', '/short/abcd'), null)
    assert.equal(router.allowed('/short/abcd'), null)
  }

  {
    const router = createRouter()
    router.add('GET', '/trail', 7)
    assert.deepEqual(router.find('GET', '/trail/'), match(7, null, '/trail'))

    const strictSlash = createRouter({ ignoreTrailingSlash: false })
    strictSlash.add('GET', '/trail', 8)
    assert.equal(strictSlash.find('GET', '/trail/'), null)
  }

  {
    const router = createRouter({ caseSensitive: true })
    router.add('GET', '/Users', 9)
    assert.deepEqual(router.find('GET', '/Users'), match(9, null, '/Users'))
    assert.equal(router.find('GET', '/users'), null)
  }

  {
    const router = createRouter()
    router.add('GET', '/assets/*file', 13)
    assert.deepEqual(router.find('GET', '/assets/js/app.js'), match(13, { file: 'js/app.js' }, '/assets/*file'))
    assert.deepEqual(router.find('GET', '/assets'), match(13, { file: '' }, '/assets/*file'))

    const bare = createRouter()
    bare.add('GET', '*', 14)
    assert.deepEqual(bare.find('GET', '/anything/here'), match(14, { wildcard: 'anything/here' }, '*'))
  }

  {
    const router = createRouter()
    router.add('GET', '/dup', 15)
    assert.throws(() => router.add('GET', '/dup', 16), RouteConflictError)
  }

  {
    const router = createRouter()
    router.add('GET', '/shape/:id', 18)
    assert.throws(() => router.add('GET', '/shape/:name', 19), RouteConflictError)

    const wildcard = createRouter()
    wildcard.add('GET', '/wild/*file', 20)
    assert.throws(() => wildcard.add('GET', '/wild/*path', 21), RouteConflictError)
  }

  {
    const router = createRouter()
    assert.throws(() => router.add('', '/x', 0), InvalidMethodError)
    assert.throws(() => router.add('GET', 'x', 0), InvalidPathError)
    assert.throws(() => router.add('GET', '/x/*rest/tail', 0), InvalidPathError)
    assert.throws(() => router.add('GET', '/x', -1), InvalidStoreIdError)
    assert.throws(() => router.add('GET', '/x', 1.5), InvalidStoreIdError)
    assert.throws(() => router.add('GET', '/x', Number.MAX_SAFE_INTEGER + 1), InvalidStoreIdError)

    const noWildcard = createRouter({ allowWildcard: false })
    assert.throws(() => noWildcard.add('GET', '/assets/*file', 0), InvalidPathError)
  }

  {
    const router = createRouter()
    router.add('HEAD', '/explicit', 30)
    router.add('OPTIONS', '/explicit', 31)
    router.add('GET', '/explicit', 32)

    assert.deepEqual(router.allowed('/explicit'), ['GET', 'HEAD', 'OPTIONS'])

    const getOnly = createRouter()
    getOnly.add('GET', '/head', 33)
    assert.equal(getOnly.find('HEAD', '/head'), null)
    assert.deepEqual(getOnly.allowed('/head'), ['GET'])
  }

  {
    const router = createRouter()
    router.add('GET', '/lookup/:id', 40)
    router.add('ANY', '/lookup/fallback', 41)

    let callbackArgs = null
    const found = router.lookup('GET', '/lookup/abc', (storeId, params, routePath) => {
      callbackArgs = { storeId, params, routePath }
    })
    assert.equal(found, true)
    assert.deepEqual(callbackArgs, match(40, { id: 'abc' }, '/lookup/:id'))

    callbackArgs = null
    const anyFound = router.lookup('DELETE', '/lookup/fallback', (storeId, params, routePath) => {
      callbackArgs = { storeId, params, routePath }
    })
    assert.equal(anyFound, true)
    assert.deepEqual(callbackArgs, match(41, null, '/lookup/fallback'))

    assert.equal(router.lookup('GET', '/missing', () => {}), false)
    assert.throws(() => router.lookup('GET', '/lookup/abc', null), TypeError)
  }
}
