import { spawnSync } from 'node:child_process'

const env = {
  ...process.env,
  ROUTE_CORE_BENCH_ASSERT: process.env.ROUTE_CORE_BENCH_ASSERT ?? '1',
  ROUTE_CORE_BENCH_ROUNDS: process.env.ROUTE_CORE_BENCH_ROUNDS ?? '5',
  ROUTE_CORE_BENCH_WARMUP_ROUNDS: process.env.ROUTE_CORE_BENCH_WARMUP_ROUNDS ?? '2',
  ROUTE_CORE_BENCH_ITERATIONS: process.env.ROUTE_CORE_BENCH_ITERATIONS ?? '20000',
}

const benchmarkEntries = [
  {
    entry: 'benchmark/hot-path/index.mjs',
    budgetPath: './gate-budget.json',
  },
  {
    entry: 'benchmark/route-only/index.mjs',
    budgetPath: './gate-budget.json',
  },
]

for (const { entry, budgetPath } of benchmarkEntries) {
  const result = spawnSync(process.execPath, [entry], {
    stdio: 'inherit',
    env: {
      ...env,
      ROUTE_CORE_BENCH_BUDGET_PATH: process.env.ROUTE_CORE_BENCH_BUDGET_PATH ?? budgetPath,
    },
  })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}
