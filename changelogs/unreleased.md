# Unreleased

## Fixed

- Aligned package metadata and README wording with the current project state so the package no longer over-promises hot-path throughput.
- Reduced router hot-path overhead by removing pre-match decode validation, reusing capture buffers during traversal, and using lightweight allowed-method matching.
- Reduced request-path preprocessing allocations by removing `PreparedPath` key precomputation and calculating static match keys on demand during trie traversal.
- Added a machine-enforced route-only benchmark budget and wired CI to fail when the committed perf floor regresses.
- Replaced the request-time trie traversal hot path with a compiled matcher backend plus hybrid fallback, including common-case pathname fast paths and compiled prefix miss guards.
- Extended the route-only benchmark with multi-round medians and warmup support, and recalibrated its regression budget around the stable rewritten runtime.
- Corrected the `v0.0.2` changelog to match the current `docs/` file tree.
- Added a prepared hot-path API (`prepareMethod`, `preparePathname`, `findPrepared`, `lookupPrepared`, `allowedPrepared`) and a dedicated hot benchmark so adapters can bypass most compat-facade overhead.
- Made prepared method handles stay live across later `add()` calls, and expanded the Chinese guide to document the same public contract as the English README.
- Reframed the English and Chinese READMEs around user-facing integration guidance, and documented the exact adapter-boundary tradeoffs for `vext`-style integrations.
