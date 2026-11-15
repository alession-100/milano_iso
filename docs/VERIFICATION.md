# Verification

## 1. Principles
1. Every task has verification commands; every report pastes (trimmed) output or file paths as evidence.
2. Cheap checks after every step; expensive checks at gates.
3. Doer is not checker: gates are run by the reviewer; the orchestrator re-runs task-level commands.
4. Numbers beat adjectives: acceptance criteria are counts, tolerances, budgets or file existence.
5. Measure before setting a threshold: when a threshold is unknown, the first run records a baseline and an ADR sets the threshold.
6. Failures are reported with the exact command, output and suspected cause, never smoothed over.

## 2. Gate checklist

| Gate | After | Reviewer must confirm |
|---|---|---|
| G0 | Phase 0 | Scaffold builds from clean checkout; ADRs accepted; data audit complete; CI green |
| G1 | Phase 1 | Section 3 checks pass; landmarks.yaml re-verified against cited sources; drop log reviewed |
| G2 | Phase 2 | Tiles valid, continuous, within size budget; two builds give identical hashes |
| G3 | Phase 3 | Section 4 checks pass on the pilot; visual snapshots match; perf budgets met |
| G4 | Phase 4 | Style checklist; landmark placement error within tolerance; budgets still met |
| G5 | Phase 5 | e2e suite green; accessibility checklist; no console errors |
| G6 | Phase 6 | Full-city build reproducible; payload and perf budgets met; no memory leaks over a 5-minute pan/zoom session |
| G7 | Phase 7 | Accuracy audit passed; attribution visible; deploy verified on real devices; README rebuild tested from scratch |

## 3. Data checks (pipeline)
- **CRS:** all intermediate layers in EPSG:32632; assert in tests.
- **Geometry:** `is_valid` for all features after repair; zero-area and duplicate features removed and counted.
- **Completeness:** processed buildings in the AOI >= 99% of source buildings; every drop has a logged reason.
- **Heights:** every building has `height_m` and `height_source`. Report the distribution, the share per source, and outliers (> 250 m or < 2 m) with IDs. Baseline share of explicit (non-default) heights is measured in G1; the threshold is then fixed by ADR.
- **Sanity:** the tallest building height must be plausible for Milan (the tallest towers are around 230 m; reviewer verifies the exact figure from a cited source).
- **Positional accuracy:** footprint simplification tolerance <= 0.5 m; each landmark in `tests/landmarks.yaml` within 5 m of the rendered/processed position.
- **Tiles:** no gaps or overlaps between tile bboxes; every feature appears in exactly one tile (or is explicitly split); manifest counts equal sum of tile counts.
- **Determinism:** two consecutive builds give identical content hashes.

## 4. Web checks
- **Static:** type-check, lint, unit tests (vitest), production build.
- **E2E:** Playwright on desktop and mobile viewports: load, pan, zoom, rotate, pick, search, layer toggles.
- **Visual regression:** fixed camera positions, fixed seed, screenshot diff with a stored threshold; owner approves baseline images at HUMAN CHECKPOINTs.
- **Console:** zero errors and warnings in e2e runs.
- **Accessibility:** keyboard-reachable controls, sufficient contrast, `prefers-reduced-motion` honoured.

## 5. Budgets (initial targets, adjust only via ADR with measurements)

| Metric | Target |
|---|---|
| Frame rate, pilot AOI | >= 60 fps desktop, >= 30 fps mid-range phone |
| Initial payload (gzip/brotli) | <= 3 MB |
| JS bundle (gzip) | <= 600 KB |
| Tile size (gzip) | <= 250 KB each |
| Draw calls, typical view | <= 300 |
| Time to first render | <= 3 s on a fast connection |

## 6. Failure protocol
1. Reproduce and capture evidence (command, output, screenshot).
2. Write a corrective task card with the evidence and the narrowest possible fix.
3. Max 2 retries per task, then escalate to the owner with options.
4. Never lower a threshold to make a check pass without an ADR and the owner's agreement.
