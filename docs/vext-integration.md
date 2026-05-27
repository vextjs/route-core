# vext Integration Notes

## Status

`route-core` is implemented as a first-party TypeScript router package, but vext integration has not started in this package-level milestone.

## Intended Backend Switch

The planned adapter boundary remains:

```ts
type NativeRouterBackend = 'current' | 'route-core'
```

The default should remain `current` until route-core passes package tests, route-only benchmark comparison, vext smoke tests, and vext adapter/e2e benchmark gates.

## 404 / 405 Boundary

`route-core.allowed()` exists as package capability. vext should keep its current wrong-method behavior until a separate user-visible behavior change is approved and tested.

## Store Mapping

vext should map framework route stores outside `route-core`:

```ts
const id = nextId++
router.add(method, path, id)
storeMap.set(id, store)
```

If `router.add()` throws, the store must not be inserted.
