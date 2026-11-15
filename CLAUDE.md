# Milano Iso - project rules

Interactive web map of Milan in isometric "SimCity" style, built from open geodata.
Read this file fully at the start of every session. Details live in `docs/`.

## Mission and success criteria
- Pilot area (AOI): Duomo-Cordusio, about 1 km2 (confirm in Phase 0). Then the whole comune di Milano.
- The geometry is real (footprints, streets, water, green areas from open data). Only the *style* is stylised.
- Measurable targets and budgets: see `docs/VERIFICATION.md`.

## Stack (proposed, confirm via ADRs in Phase 0)
- `pipeline/`: Python 3.12, geopandas, shapely, pyproj, pyogrio, pytest. Output: static tile files.
- `web/`: Vite + TypeScript + Three.js with an OrthographicCamera, vitest, Playwright.
- Static hosting only. No backend, no runtime calls to third-party map APIs.

## Target layout
```
milano-iso/
  CLAUDE.md  KICKOFF_PROMPT.md
  .claude/agents/        executor.md, reviewer.md
  docs/                  ROLES, PLAN, VERIFICATION, DATA_SOURCES, DECISIONS, PROGRESS
  tasks/                 T-<phase>.<n>.md   (task cards, from _TEMPLATE.md)
  reports/               R-<phase>.<n>.md   (executor reports, from _TEMPLATE.md)
  pipeline/  web/  tests/
  data/                  raw + intermediate data, gitignored
```

## Commands (to be created and confirmed in task T-0.2)
`make data` | `make tiles` | `make test` | `npm run dev` | `npm run build` | `npm test` | `npm run e2e`

## Hard rules
1. Never fabricate data, coordinates, heights, licences or numbers. Every figure comes from source files or script output, and is cited.
2. Small steps: one task card = one branch/commit. No unrelated changes.
3. Done = acceptance criteria met AND verification commands run AND evidence attached. "Should work" is not done.
4. Doer is not checker: gates are verified by the reviewer or orchestrator, never by the agent that wrote the code.
5. Deterministic pipeline: same inputs give identical outputs (pinned versions, fixed seeds, sorted iteration).
6. Metric CRS: EPSG:32632 (UTM 32N) in the pipeline; the web client uses metres from a fixed origin.
7. Raw data is never committed. Source, retrieval date, licence and checksum go in `docs/DATA_SOURCES.md`.
8. Ambiguity, or blocked after 2 attempts: stop and escalate (see `docs/ROLES.md`). Do not guess.
9. Keep `docs/PROGRESS.md` and `docs/DECISIONS.md` current.
10. Attribution ("(c) OpenStreetMap contributors" plus any other source) must be visible in the UI.
