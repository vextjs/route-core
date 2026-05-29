import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { createRouter } from '../../dist/index.js'
import { createFindMyWayRouter, find, lookup } from './find-my-way.mjs'

const ITERATIONS = Number.parseInt(process.env.ROUTE_CORE_BENCH_ITERATIONS ?? '100000', 10)
const ROUNDS = Number.parseInt(process.env.ROUTE_CORE_BENCH_ROUNDS ?? '1', 10)
const WARMUP_ROUNDS = Number.parseInt(process.env.ROUTE_CORE_BENCH_WARMUP_ROUNDS ?? '2', 10)
const ASSERT_BUDGET = process.env.ROUTE_CORE_BENCH_ASSERT === '1'
const budgetPath = process.env.ROUTE_CORE_BENCH_BUDGET_PATH ?? './budget.json'
const budget = ASSERT_BUDGET
  ? JSON.parse(readFileSync(new URL(budgetPath, import.meta.url), 'utf8'))
  : null
const results = new Map()

function bench(name, fn) {
  const roundResults = []

  for (let round = 0; round < WARMUP_ROUNDS; round++) {
    for (let index = 0; index < ITERATIONS; index++) {
      fn(index)
    }
  }

  for (let round = 0; round < ROUNDS; round++) {
    const start = performance.now()
    for (let index = 0; index < ITERATIONS; index++) {
      fn(index)
    }
    const durationMs = performance.now() - start
    roundResults.push(Math.round((ITERATIONS / durationMs) * 1000))
  }

  const median = medianOf(roundResults)
  results.set(name, median)
  if (ROUNDS === 1) {
    console.log(`${name}: ${median.toLocaleString()} ops/sec`)
    return
  }

  const roundsLabel = roundResults.map((value) => value.toLocaleString()).join(', ')
  console.log(`${name}: ${median.toLocaleString()} ops/sec (median of ${ROUNDS}: ${roundsLabel})`)
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

function createAdvancedRouteCoreRouter() {
  const router = createRouter()
  for (let index = 0; index < 1000; index++) {
    router.add('GET', `/assets/${index}/:name.:ext`, 2000 + index)
    router.add('GET', `/reports/${index}/:id(^\\d+).json`, 3000 + index)
  }
  return router
}

const routeCore = createRouteCoreRouter()
const routeCoreAdvanced = createAdvancedRouteCoreRouter()
const findMyWayLookup = createFindMyWayRouter()
const findMyWayFind = createFindMyWayRouter()
const findMyWayAdvancedLookup = createFindMyWayRouter({ advanced: true })
const findMyWayAdvancedFind = createFindMyWayRouter({ advanced: true })

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

bench('find-my-way lookup mixed', (index) => {
  lookup(findMyWayAdvancedLookup, 'GET', `/assets/${index % 1000}/app.js`)
})

bench('find-my-way find mixed', (index) => {
  find(findMyWayAdvancedFind, 'GET', `/assets/${index % 1000}/app.js`)
})

bench('route-core mixed', (index) => {
  routeCoreAdvanced.find('GET', `/assets/${index % 1000}/app.js`)
})

bench('route-core lookup mixed', (index) => {
  routeCoreAdvanced.lookup('GET', `/assets/${index % 1000}/app.js`, noop)
})

bench('find-my-way lookup regex', (index) => {
  lookup(findMyWayAdvancedLookup, 'GET', `/reports/${index % 1000}/123.json`)
})

bench('find-my-way find regex', (index) => {
  find(findMyWayAdvancedFind, 'GET', `/reports/${index % 1000}/123.json`)
})

bench('route-core regex', (index) => {
  routeCoreAdvanced.find('GET', `/reports/${index % 1000}/123.json`)
})

bench('route-core lookup regex', (index) => {
  routeCoreAdvanced.lookup('GET', `/reports/${index % 1000}/123.json`, noop)
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

  for (const [name, requirement] of Object.entries(budget.minimumRatio ?? {})) {
    const actual = results.get(name)
    const reference = results.get(requirement.reference)
    if (typeof actual !== 'number') {
      failures.push(`${name}: missing benchmark result`)
      continue
    }
    if (typeof reference !== 'number') {
      failures.push(`${name}: missing reference benchmark result ${requirement.reference}`)
      continue
    }

    const actualRatio = actual / reference
    if (actualRatio < requirement.ratio) {
      failures.push(
        `${name}: ratio ${actualRatio.toFixed(2)} < ${requirement.ratio.toFixed(2)} against ${requirement.reference}`,
      )
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

function medianOf(values) {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) {
    return sorted[middle]
  }
  return Math.round((sorted[middle - 1] + sorted[middle]) / 2)
}

function noop() {}
