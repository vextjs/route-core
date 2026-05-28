import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { createRouter } from '../../dist/index.js'
import { createFindMyWayRouter, find, lookup } from './find-my-way.mjs'

const ITERATIONS = Number.parseInt(process.env.ROUTE_CORE_BENCH_ITERATIONS ?? '100000', 10)
const ASSERT_BUDGET = process.env.ROUTE_CORE_BENCH_ASSERT === '1'
const budget = ASSERT_BUDGET
  ? JSON.parse(readFileSync(new URL('./budget.json', import.meta.url), 'utf8'))
  : null
const results = new Map()

function bench(name, fn) {
  const start = performance.now()
  for (let index = 0; index < ITERATIONS; index++) {
    fn(index)
  }
  const durationMs = performance.now() - start
  const opsPerSecond = Math.round((ITERATIONS / durationMs) * 1000)
  results.set(name, opsPerSecond)
  console.log(`${name}: ${opsPerSecond.toLocaleString()} ops/sec (${durationMs.toFixed(2)} ms)`)
}

function createRouteCoreRouter() {
  const router = createRouter()
  for (let index = 0; index < 1000; index++) {
    router.add('GET', `/static/${index}`, index)
    router.add('GET', `/users/${index}/:id`, 1000 + index)
  }
  router.add('GET', '/assets/*file', 3000)
  return router
}

const routeCore = createRouteCoreRouter()
const findMyWayLookup = createFindMyWayRouter()
const findMyWayFind = createFindMyWayRouter()

bench('find-my-way lookup static', (index) => {
  lookup(findMyWayLookup, 'GET', `/static/${index % 1000}`)
})

bench('find-my-way find static', (index) => {
  find(findMyWayFind, 'GET', `/static/${index % 1000}`)
})

bench('route-core static', (index) => {
  routeCore.find('GET', `/static/${index % 1000}`)
})

bench('route-core lookup static', (index) => {
  routeCore.lookup('GET', `/static/${index % 1000}`, noop)
})

bench('find-my-way lookup params', (index) => {
  lookup(findMyWayLookup, 'GET', `/users/${index % 1000}/abc`)
})

bench('find-my-way find params', (index) => {
  find(findMyWayFind, 'GET', `/users/${index % 1000}/abc`)
})

bench('route-core params', (index) => {
  routeCore.find('GET', `/users/${index % 1000}/abc`)
})

bench('route-core lookup params', (index) => {
  routeCore.lookup('GET', `/users/${index % 1000}/abc`, noop)
})

bench('find-my-way lookup wildcard', (index) => {
  lookup(findMyWayLookup, 'GET', `/assets/js/${index}/app.js`)
})

bench('find-my-way find wildcard', (index) => {
  find(findMyWayFind, 'GET', `/assets/js/${index}/app.js`)
})

bench('route-core wildcard', (index) => {
  routeCore.find('GET', `/assets/js/${index}/app.js`)
})

bench('route-core lookup wildcard', (index) => {
  routeCore.lookup('GET', `/assets/js/${index}/app.js`, noop)
})

bench('find-my-way lookup miss', (index) => {
  lookup(findMyWayLookup, 'GET', `/missing/${index}`)
})

bench('find-my-way find miss', (index) => {
  find(findMyWayFind, 'GET', `/missing/${index}`)
})

bench('route-core miss', (index) => {
  routeCore.find('GET', `/missing/${index}`)
})

bench('route-core lookup miss', (index) => {
  routeCore.lookup('GET', `/missing/${index}`, noop)
})

if (budget) {
  const failures = []

  for (const [name, minimumOpsPerSecond] of Object.entries(budget.minimumOpsPerSecond ?? {})) {
    const actual = results.get(name)
    if (typeof actual !== 'number') {
      failures.push(`${name}: missing benchmark result`)
      continue
    }

    if (actual < minimumOpsPerSecond) {
      failures.push(`${name}: ${actual} < ${minimumOpsPerSecond}`)
    }
  }

  if (failures.length > 0) {
    console.error('benchmark budget failed:')
    for (const failure of failures) {
      console.error(`- ${failure}`)
    }
    process.exitCode = 1
  }
}

function noop() {}
