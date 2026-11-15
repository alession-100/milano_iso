# Plan

Legend: **O** = orchestrator (Opus 5.5), **E** = executor (Sonnet 5.5), **R** = reviewer. Every phase ends with a gate (G0-G7) run by R. Phases marked **HUMAN CHECKPOINT** stop for owner approval.

## Phase 0 - Scoping and scaffold (HUMAN CHECKPOINT)

**ASK (orchestrator asks the owner in one message, with recommended defaults):**
1. AOI: pilot area and final extent. *Default: Duomo-Cordusio about 1 km2, then the whole comune di Milano.*
2. Visual reference: 2-3 reference images, or choose "SimCity 2000 pixel look" vs "modern low-poly". *Default: low-poly with flat shading and a restricted palette.*
3. Hosting. *Default: static hosting (Cloudflare Pages, GitHub Pages or Netlify).*
4. Target devices. *Default: desktop and mid-range phones.*
5. UI language. *Default: Italian and English.*
6. Constraints on time, budget or data licences.

| ID | Owner | Task | Acceptance |
|---|---|---|---|
| T-0.1 | O | Resolve ASK items; confirm or amend ADR-0001..0005 | `DECISIONS.md` updated, no "Proposed" left |
| T-0.2 | E | Scaffold repo: `pipeline/`, `web/`, Makefile, lint/test tooling, CI, `.gitignore`; a hello-world scene rendered with the orthographic camera, plus a side-by-side render at 30 and 35.264 degrees elevation (ADR-0003) | `make test` and `npm run build` pass; screenshots saved |
| T-0.3 | E | Data source audit: for each source in `DATA_SOURCES.md` confirm URL, format, licence text, size, date | No "TO VERIFY" left in the table |

**Gate G0.**

## Phase 1 - Data acquisition and validation

| ID | Owner | Task | Acceptance |
|---|---|---|---|
| T-1.1 | E | Download and clip OSM for the AOI (plus comune boundary) into `data/raw/` | Checksum and date recorded |
| T-1.2 | E | Fetch height/building sources (regional topographic DB, Overture) for the AOI; map schemas | Field mapping documented |
| T-1.3 | E | Normalise to layers (buildings, roads, rail, water, green/landuse, named landmarks) in EPSG:32632; fix invalid geometries; log every dropped feature with reason | Validation report in `reports/artifacts/` |
| T-1.4 | E | Height fallback chain with `height_source` per building (order in `DATA_SOURCES.md`) | 100% of buildings have a height and a source |
| T-1.5 | E | Create `tests/landmarks.yaml`: coordinates from authoritative sources, each with a citation | Reviewer re-checks 100% of entries |
| T-1.6 | E | Data validation test suite (see `VERIFICATION.md` section 3) | `make test` green |

**Gate G1.**

## Phase 2 - Tiling and export

| ID | Owner | Task | Acceptance |
|---|---|---|---|
| T-2.1 | O | Decide tile scheme (default: 500 m grid in local metres from a fixed origin) -> ADR | ADR accepted |
| T-2.2 | E | Mesh export: extruded buildings merged per tile, roads as ribbons by class width, water and green polygons; compact binary or glTF | Tiles load in a test script |
| T-2.3 | E | `tiles.json` manifest: bbox, counts, hashes, byte sizes | Schema-validated |
| T-2.4 | E | Determinism test: build twice, compare hashes | Identical |

**Gate G2.**

## Phase 3 - Isometric viewer, vertical slice (HUMAN CHECKPOINT)

| ID | Owner | Task | Acceptance |
|---|---|---|---|
| T-3.1 | E | Orthographic camera per ADR-0003, pan/zoom with bounds and inertia, touch gestures | e2e interaction test |
| T-3.2 | E | Tile streaming, frustum culling, merged geometry | Draw-call budget met |
| T-3.3 | E | Flat shading, fixed directional light, cheap shadows, palette v1 | Visual snapshot approved by owner |
| T-3.4 | E | Debug overlay: fps, draw calls, tiles loaded | Visible via `?debug` |

**Gate G3** (includes performance on the pilot).

## Phase 4 - Style and landmarks (HUMAN CHECKPOINT)

| ID | Owner | Task | Acceptance |
|---|---|---|---|
| T-4.1 | E | Materials by building type and land use; roads with markings; water; parks; instanced trees | Style checklist signed by owner |
| T-4.2 | E | Low-poly landmark models (Duomo, Castello Sforzesco, Torre Velasca, Pirelli, Bosco Verticale, Stazione Centrale, CityLife towers, San Siro), placed from `landmarks.yaml` | Position error within budget; owner approves look |
| T-4.3 | E | Lighting polish; optional day/night | Budgets still met |

**Gate G4.**

## Phase 5 - Interaction and UI

| ID | Owner | Task | Acceptance |
|---|---|---|---|
| T-5.1 | E | Hover/click picking with info card (name, type, height, height source) | e2e test |
| T-5.2 | E | Rotation in 90-degree steps (four views), SimCity style | e2e test |
| T-5.3 | E | Layer toggles, search over a local index of named features, minimap | e2e test |
| T-5.4 | E | Responsive layout, touch, keyboard navigation, contrast, reduced motion | Checklist in `VERIFICATION.md` |

**Gate G5.**

## Phase 6 - Scale to the whole city

| ID | Owner | Task | Acceptance |
|---|---|---|---|
| T-6.1 | E | Run the pipeline on the full comune; measure time and memory; partition if needed | Reproducible end to end |
| T-6.2 | E | LOD: simplified far tiles, detailed near tiles | Visual and perf checks |
| T-6.3 | E | Streaming, caching headers, brotli/gzip | Payload budgets met |
| T-6.4 | E | Performance tuning to budgets | Budgets met on reference devices |

**Gate G6.**

## Phase 7 - QA and release (HUMAN CHECKPOINT)

| ID | Owner | Task | Acceptance |
|---|---|---|---|
| T-7.1 | R | Accuracy audit: landmarks plus a random sample of 50 buildings against source data | Within `VERIFICATION.md` tolerances |
| T-7.2 | E | Attribution, licence compliance, About page, README with rebuild instructions | Reviewer checklist |
| T-7.3 | E | Deploy static build; smoke test on real devices | URL works; checklist |
| T-7.4 | O | Retrospective; update `CLAUDE.md` with lessons | Committed |

**Gate G7.**
