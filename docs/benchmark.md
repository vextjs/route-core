# route-core Benchmark

## Route-only Benchmark

Run:

```bash
npm run bench
```

The benchmark compares four paths for static, param, wildcard, and miss cases:

- `find-my-way lookup()`
- `find-my-way find()`
- `route-core.find()`
- `route-core.lookup()`

This benchmark is a package-level signal only. It does not replace vext adapter-only or e2e benchmarks.

## Acceptance Boundary

The TypeScript implementation does not need to beat mature external routers in every route-only case before vext integration. It must provide a measurable baseline and make the cost of first-party routing visible.

The vext default backend must not switch until adapter-only and e2e measurements are available and within the confirmed regression budget.
