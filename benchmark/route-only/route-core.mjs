import { performance } from 'node:perf_hooks'
import { createRouter } from '../../dist/index.js'

const ITERATIONS = Number.parseInt(process.env.ROUTE_CORE_BENCH_ITERATIONS ?? '100000', 10)

function bench(name, fn) {
  const start = performance.now()
  for (let index = 0; index < ITERATIONS; index++) {
    fn(index)
  }
  const durationMs = performance.now() - start
  const opsPerSecond = Math.round((ITERATIONS / durationMs) * 1000)
  console.log(`${name}: ${opsPerSecond.toLocaleString()} ops/sec (${durationMs.toFixed(2)} ms)`)
}

const router = createRouter()
for (let index = 0; index < 1000; index++) {
  router.add('GET', `/static/${index}`, index)
  router.add('GET', `/users/${index}/:id`, 1000 + index)
}
router.add('GET', '/assets/*file', 3000)

bench('static', (index) => {
  router.find('GET', `/static/${index % 1000}`)
})

bench('params', (index) => {
  router.find('GET', `/users/${index % 1000}/abc`)
})

bench('wildcard', (index) => {
  router.find('GET', `/assets/js/${index}/app.js`)
})

bench('miss', (index) => {
  router.find('GET', `/missing/${index}`)
})
