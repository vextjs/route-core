import FindMyWay from 'find-my-way'

export function createFindMyWayRouter() {
  const router = FindMyWay()
  for (let index = 0; index < 1000; index++) {
    router.on('GET', `/static/${index}`, noop)
    router.on('GET', `/users/${index}/:id`, noop)
  }
  router.on('GET', '/assets/*', noop)
  return router
}

export function lookup(router, method, url) {
  router.lookup({ method, url, headers: {} }, { end: noop })
}

export function find(router, method, url) {
  router.find(method, url)
}

function noop() {}
