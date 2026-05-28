# Unreleased

## Fixed

- Aligned package metadata and README wording with the current project state so the package no longer over-promises hot-path throughput.
- Reduced router hot-path overhead by removing pre-match decode validation, reusing capture buffers during traversal, and using lightweight allowed-method matching.
- Reduced request-path preprocessing allocations by removing `PreparedPath` key precomputation and calculating static match keys on demand during trie traversal.
- Added a machine-enforced route-only benchmark budget and wired CI to fail when the committed perf floor regresses.
- Corrected the `v0.0.2` changelog to match the current `docs/` file tree.
