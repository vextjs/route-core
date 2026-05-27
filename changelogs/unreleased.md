# Unreleased

## Added

- Implemented the first TypeScript `route-core` router with named exports, CJS/ESM/types build outputs, shared semantic cases, package entry tests, and a basic route-only benchmark.
- Added route semantics for static, param, wildcard, ANY fallback, method buckets, trailing slash normalization, case sensitivity, URL parameter decoding, route shape conflicts, `allowed()` boundaries, and `storeId` validation.
- Added `docs/api.md`, `docs/vext-integration.md`, and `docs/benchmark.md` for the first local implementation milestone.
- Added route-only benchmark comparison for `find-my-way lookup()`, `find-my-way find()`, and the route-core TypeScript backend.
- Added GitHub Actions CI for install, typecheck, tests, and benchmark smoke on Node.js 20 and 22.

## Changed

- Split the router implementation into the confirmed skeleton: public exports, public types/errors/factory, internal assertions, and `src/backend/ts/` backend modules.
- Updated CommonJS build finalization to preserve recursive module structure and rewrite internal `.js` requires to `.cjs`.
- Updated README status from design preview to private pre-release implementation status.
- Kept `private: true` and a failing `prepublishOnly` guard to prevent accidental publication before vext integration and release validation.
