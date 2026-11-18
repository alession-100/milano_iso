# Decisions (ADR log)

Format: ID, status (Proposed / Accepted / Superseded), context, decision, consequences. The orchestrator confirms or amends every "Proposed" ADR in task T-0.1.

Owner answers to the Phase 0 ASK items were given on 2026-11-15 and are the basis of ADR-0001..0011.

## ADR-0001 - Stack
- **Status:** Accepted (2026-11-15, amended in T-0.1)
- **Decision:** Python pipeline (geopandas, shapely, pyproj, pyogrio, pytest) producing static tiles; web client with Vite, TypeScript and Three.js (vitest, Playwright).
- **Amendment (toolchain pinning):**
  - Python 3.12, managed with `uv`; dependencies locked in `uv.lock` (the system Python on the dev machine is 3.14 and must not be used for the pipeline).
  - Node 24 LTS with `package-lock.json`.
  - GNU make is the task runner (`make data|tiles|test`). On the Windows dev machine it is GNU Make 4.4.1 (winget `ezwinports.make`); on CI it is the runner's native make. Makefile recipes must work in a POSIX shell on both.
- **Consequences:** No backend; hosting is static; the pipeline is reproducible with Make and lockfiles.

## ADR-0002 - True orthographic camera instead of a tilted map
- **Status:** Accepted (2026-11-15)
- **Context:** Mapping libraries with a pitched perspective view do not give a real isometric projection.
- **Decision:** Use Three.js `OrthographicCamera`, with our own tile streaming.
- **Consequences:** More custom code than a map library; exact SimCity-like projection.

## ADR-0003 - Camera angle
- **Status:** Accepted (2026-11-15). The owner confirmed 30 degrees at the Phase 0 checkpoint after seeing the side-by-side render (`reports/artifacts/T-0.2/side-by-side.png`).
- **Context:** Classic SimCity pixel look is a 2:1 dimetric view; "true isometric" is slightly steeper.
- **Decision:** Azimuth 45 degrees, elevation 30 degrees (ground squares appear as 2:1 rhombi). The alternative, 35.264 degrees (true isometric), is rendered side by side in T-0.2 for the owner to compare.
- **Consequences:** Affects shading, texture choices and picking maths. The angle is a single config constant so it can change cheaply until Phase 3.

## ADR-0004 - Coordinates, origin, pilot AOI and tiling
- **Status:** Accepted (2026-11-15)
- **Decision:**
  - Pipeline CRS EPSG:32632. Client coordinates are metres from a fixed origin.
  - **Origin:** the position of the Duomo di Milano taken from a cited source (OSM element and/or Wikidata), transformed to EPSG:32632 and rounded to the nearest whole metre. The value and its citation are recorded in `docs/DATA_SOURCES.md` by T-0.3; no coordinate is typed from memory.
  - **Pilot AOI:** the 1000 m x 1000 m square in EPSG:32632 centred on the origin (origin +/- 500 m on each axis). Final extent: the administrative boundary of the Comune di Milano.
  - **Frozen values (corrected in T-0.3a after G0 blocker B1; verified by the orchestrator with shapely on 2026-11-15):** origin **E 514979, N 5034536** (EPSG:32632). This is the centroid of OSM relation/18017026 "Duomo di Milano" (E 514978.51, N 5034535.58; Overpass base 2026-11-15T19:00:21Z), rounded to whole metres. Pilot AOI bbox **514479, 5034036, 515479, 5035036**. These are constants in `pipeline/milano_iso/config.py` and are never recomputed at build time. The easting is only 0.01 m above a rounding boundary, so a library upgrade must not be allowed to move it. The first recorded value (E 514978, N 5034535) came from a numerically unstable centroid and is void. Wikidata Q18068 P625 lies 83.4 m away, just west of the OSM footprint (the facade side), so it is not used: the footprint centroid matches the landmark-position definition of ADR-0011. Provenance script: `pipeline/scripts/origin_from_sources.py`.
  - Tiles on a 500 m grid aligned to the origin (so the pilot AOI is exactly 2 x 2 tiles), adjustable after measuring size budgets (T-2.1).
- **Consequences:** Avoids floating-point jitter far from the origin; tile boundaries are simple to reason about.

## ADR-0005 - Static delivery on GitHub
- **Status:** Accepted (2026-11-15, amended: owner chose GitHub)
- **Decision:** Source on GitHub; CI on GitHub Actions; site and tiles deployed to GitHub Pages.
- **Risks:** GitHub Pages does not allow custom response headers, so the cache-control and pre-compressed brotli parts of T-6.3 may be impossible there. Pages size and bandwidth limits are verified (with a cited source) in T-0.3. If the full-city tiles break those limits, the fallback is a CDN-backed static host with a free tier (for example Cloudflare Pages/R2). That would be a new ADR and needs owner approval if it costs money (see ADR-0008).
- **Consequences:** No server costs by default; no runtime dependency on third-party map APIs. CI and deploy need a GitHub repository that the owner creates.

## ADR-0006 - UI language
- **Status:** Accepted (2026-11-15)
- **Decision:** Italian and English, with Italian as the default and English selectable. All UI strings go through a single i18n dictionary from the start. Feature names are shown as in the source data (no translation of proper names).

## ADR-0007 - Target and reference devices
- **Status:** Accepted (2026-11-15)
- **Decision:** Targets are desktop browsers and mid-range phones. The reference phone is the **Google Pixel 7a** (Chrome, Android). Emulated mobile viewports are used in e2e; frame-rate budgets for phones are confirmed on the real device by the owner at HUMAN CHECKPOINTs (Phase 3 and 7).
- **Consequences:** The "mid-range phone >= 30 fps" budget in `VERIFICATION.md` means the Pixel 7a.

## ADR-0008 - Budget
- **Status:** Accepted (2026-11-15)
- **Decision:** Default to free tiers and open data. The owner can reserve budget if needed: any paid service, domain or dataset is proposed to the owner with its cost and needs explicit approval before purchase.

## ADR-0009 - Data licences
- **Status:** Accepted (2026-11-15)
- **Decision:** Only openly licensed data. OSM data is ODbL; derived tiles that contain OSM data are treated as a Derivative/Produced Work under ODbL with "(c) OpenStreetMap contributors" visible in the UI. Every other source is accepted only after T-0.3 records its actual licence text; a source with an unclear or incompatible licence is not used.

## ADR-0010 - Version control and executor isolation
- **Status:** Accepted (2026-11-15)
- **Decision:** Git repository with default branch `main`. Each task card uses a branch `t-<phase>.<n>`. Tasks that run in parallel each get their own git worktree, so executors never share a working directory. The orchestrator merges into `main` after verification.

## ADR-0011 - Landmark checks by extent
- **Status:** Accepted (2026-11-15)
- **Context:** Most Phase 4 landmarks (San Siro, CityLife, Bosco Verticale, Pirelli, Stazione Centrale, probably Castello Sforzesco) lie outside the pilot AOI.
- **Decision:** `tests/landmarks.yaml` lists every landmark, each with a flag for whether it lies in the pilot AOI (computed, not guessed). G1 and G4 check the 5 m tolerance only for landmarks inside the processed extent; the full list is checked at G6. Landmark models outside the pilot may be built in Phase 4 but are placed and verified in Phase 6.
- **Also defined here:** a landmark's "position" is the centroid of its OSM footprint polygon (or the cited point for point features), compared with the centroid of the processed footprint.

## ADR-0012 - Phase 0 scaffold decisions (from T-0.2)
- **Status:** Accepted (2026-11-15)
- **Decisions:**
  - e2e console check ignores exactly one message, `GPU stall due to ReadPixels`. Headless Chromium's software GL (SwiftShader) emits it when a WebGL canvas is screenshotted, so the screenshot causes it, not the app. Every other console error, warning or page error fails the test. The filter is a single fully anchored regex in `web/e2e/smoke.spec.ts` (since T-0.2a), matching the full observed message `[.WebGL-0x<hex>]GL Driver Message (OpenGL, Performance, GL_CLOSE_PATH_NV, High): GPU stall due to ReadPixels`. It must not be widened without a new ADR. Known risk: the CI runner's GL driver may word the prefix differently. *Amended 2026-11-17 (T-3.1):* the exact optional suffix ` (this message will no longer repeat)`, which Chromium appends to the last repeat of the same warning, is also accepted. One shared helper should hold the filter for all specs (to do in T-3.4).
  - TypeScript is pinned to 6.0.3, the version npm resolved with the pinned typescript-eslint (7.0.2 exists). Upgrade only together with typescript-eslint support.
  - Extra pinned dev dependencies accepted: pyyaml, hatchling (build backend), @eslint/js, @types/node.
  - `npm audit` reports 7 moderate findings, all in dev dependencies (not shipped to the browser). Accepted for now and re-checked in T-7.2.
- **Integration fix:** after merging T-0.2 and T-0.3, `ruff` flagged `pipeline/scripts/origin_from_sources.py` (RUF007 plus formatting). The orchestrator applied ruff's fix. Script output is byte-identical before and after (diff checked).

## ADR-0013 - Phase 1 data layout and pipeline step conventions
- **Status:** Accepted (2026-11-15)
- **Decision:**
  - `data/raw/<source>/` holds downloaded files, unchanged. `data/interim/` holds per-source extracts in the source CRS. `data/processed/` holds normalised layers in EPSG:32632. All three are gitignored. Every path derives from `config.DATA_DIR`, which the env var `MILANO_ISO_DATA` can override (so parallel worktrees share one download cache). Manifests and the `pipeline/manifests/` folder always stay in the repo.
  - Every downloaded file has a committed manifest `pipeline/manifests/<source>.json` with url, retrieval date (UTC), byte size and sha256. Fetch steps are idempotent: they skip the download when the file exists and its sha256 matches the manifest, and fail loudly on a mismatch.
  - Each pipeline step is a module run as `uv run python -m milano_iso.<step>`. Each step's Make targets live in their own fragment `pipeline/mk/<step>.mk`, which appends to `DATA_STEPS`. This lets parallel tasks avoid editing a shared Makefile.
  - **Processing extent:** a feature is kept when it intersects the extent, and is kept whole (no cutting at the extent edge). Phase 1 uses the pilot AOI (ADR-0004); Phase 6 uses the comune boundary.
  - Landmarks are located by Wikidata QID, which is then resolved to the OSM element tagged with it. Their positions follow ADR-0011.
- **Consequences:** Reruns are cheap and deterministic. A changed upstream file is detected rather than silently used.

## ADR-0014 - Building geometry: DBT volumes first, OSM for attributes and gaps
- **Status:** Accepted (2026-11-15)
- **Context:** T-1.2 showed that the DBT 2020 of the Comune di Milano (CC BY 4.0, scale 1:1,000) splits every building into volume units (`UN_VOL`), each with its own height. In the pilot there are 4,657 volumes for 170 `EDIFC` buildings. `UN_VOL_AV` is the height of a flat-topped volume up to the eaves (spec pp.129-133). OSM has 706 building areas in the pilot, with names and types but sparse heights.
- **Decision:**
  - Rendered building massing comes from DBT volumes wherever DBT covers a building: each volume is extruded from its base to its top, with `height_source = dbt`.
  - OSM supplies attributes (name, `building` type, OSM id for the info card), joined spatially to the DBT buildings.
  - OSM buildings with no DBT counterpart (for example, built after the 2020 survey) are rendered from their OSM footprint. They use the height fallback chain steps 2-5 of `DATA_SOURCES.md`.
  - Both the Comune di Milano (CC BY 4.0) and OSM (ODbL) are credited in the UI.
- **Consequences:**
  - The geometry is far more accurate (roof steps, courtyards, towers on podiums), and the landmarks gain real massing.
  - Conflating DBT and OSM needs explicit, tested matching rules (T-1.4).
  - Completeness (VERIFICATION section 3) is measured per source: processed DBT volumes >= 99% of the source volumes in the extent, and processed OSM buildings >= 99% of the OSM building areas.

## ADR-0015 - Height rules for v1
- **Status:** Accepted (2026-11-15)
- **DBT volumes:**
  - Each volume spans from `bottom = UN_VOL_QE - UN_VOL_AV` to `top = UN_VOL_QE`, measured relative to the building's ground level.
  - **Ground level** is the minimum base Z of the building's ground-based volumes (`POR` 01). A building with no `POR` 01 volume uses the minimum base Z of all its volumes and is flagged.
  - Basis: the spec, pp.129-133 (flat-topped volume to eave level, portico intrados). The pilot data agree: for `POR` 01 and 04, `QE - AV` equals the base Z within 0.001 m; for `POR` 03 (porticoes) the volume starts 3.5 m above its base, so the open space under the portico stays empty.
  - No roof shapes are added: the model is flat-topped at eave level.
- **Overture (step 4 of the fallback chain) is skipped in v1.** T-0.3 found that Overture building heights come mainly from OSM, so the step adds little; and Overture was not fetched. Revisit in Phase 6 if many buildings fall through to the default.
- **Default height (step 5)** *(superseded by ADR-0016)* is derived from data, never typed: the median building height of DBT buildings matched to OSM buildings with the same `building` value in the processed extent, when there are at least 5 of them. Otherwise it is the median over all matched DBT buildings. The values are written to a committed artifact by the pipeline, and every such building has `height_source = default`.
- **OSM levels:** `building:levels x 3.0 m` with no roof allowance, as in `DATA_SOURCES.md`.

## ADR-0016 - Default height and non-solid OSM buildings (amends ADR-0015)
- **Status:** Accepted (2026-11-15)
- **Context:** In T-1.4, 18 of the 22 OSM buildings with no DBT counterpart got the default height. Under ADR-0015 that is the median of DBT buildings of the same `building` type, about 28-34 m. That median comes from large `EDIFC` buildings and is biased. The DBT 2020 is a 1:1,000 survey, so a structure that OSM has but the DBT does not is much more likely to be minor or not a solid building. Examples in the pilot are a medieval crypt (San Giovanni in Conca), an underground shop entrance, roofs without walls (the Galleria's glass roof), and construction sites. A 30 m block at those places would be a visible error.
- **Decision:**
  1. The default height (step 5) is the median height of the DBT `EDI_MIN` (minor building) buildings in the processed extent: 3.2 m (n = 47) in the pilot, as measured by the orchestrator. The pipeline computes and records this value; it is not typed.
  2. OSM buildings with `building=roof` or `building=construction` that have no DBT match are kept in `buildings` but **not rendered**: `rendered = false` and `render_reason` set. Landmark roofs (the Galleria) are modelled in Phase 4.
  3. Every unmatched building stays listed in `unmatched_osm.csv` for review. A tall building built after 2020 without OSM height tags would show up too low; that is an accepted, visible gap.

## ADR-0017 - Checking positions when rendered buildings come from the DBT
- **Status:** Accepted (2026-11-15)
- **Context:** T-1.6 check 7b compared each landmark's reference position (the centroid of its OSM footprint, ADR-0011) with the centroid of the rendered DBT building(s). It failed for Palazzo Reale (18.5 m) and Torre Velasca (5.2 m). The OSM and DBT data draw a building's extent differently: a DBT building unit can include wings or a podium that OSM maps as separate buildings, so their centroids differ even when both are correctly placed. It failed for Palazzo delle Assicurazioni Generali because no rendered building got its `landmark_id`: the attribute transfer works from the DBT building outwards, and the overlapping DBT building took another OSM id.
  - **Orchestrator measurement:** I took the 41 OSM/DBT building pairs with IoU >= 0.8 in the pilot and compared their centroids. The mean offset is (dE +0.21 m, dN -0.08 m), the median distance 0.34 m and the p95 3.5 m. There is no systematic misregistration between the two sources.
- **Decision:**
  1. `landmark_id` is assigned landmark-first. The rendered building with the largest overlap with the landmark's OSM footprint is the primary building. Any other rendered building with more than 50% of its area inside that footprint also gets the id.
  2. **Rendered landmark check:** the reference position must lie inside the primary rendered building's footprint, or within `tolerance_m` (5 m) of it. The IoU between the OSM landmark footprint and the rendered footprints that carry the id is reported, not asserted.
  3. **Registration check:** over OSM/DBT pairs with IoU >= 0.8 (at least 20 pairs), the magnitude of the mean centroid offset vector must be <= 1.0 m. The baseline is 0.22 m; this check catches a CRS or datum shift.
  4. The pipeline-integrity check (7a, OSM footprint centroid within 5 m of the reference) is unchanged.

## ADR-0018 - Courtyards and deferred landmarks in the rendered landmark check (amends ADR-0017 point 2)
- **Status:** Accepted (2026-11-15)
- **Context:**
  - **Palazzo Reale:** after T-1.6a its reference position (the OSM footprint centroid) lies in the DBT courtyard of the palazzo, 22.3 m from the primary rendered building and 10.4 m from the nearest building carrying its id. The centroid of a building wrapped around a courtyard often falls inside the courtyard, so the point check was testing the shape, not the placement.
  - **Galleria:** landmark-first assignment gave its id to an unrelated building (IoU 0.006), even though its own OSM roof is not rendered (ADR-0016).
- **Decision:**
  1. The rendered landmark check measures the distance from the reference position to the union of all rendered buildings carrying the landmark id; the union is formed first and its interior rings (courtyards) are then filled. A courtyard enclosed by several buildings (Palazzo Reale) therefore counts. The tolerance stays 5 m.
     - The orchestrator measured this on 2026-11-15: all 6 rendered in-pilot landmarks are at 0.00 m, against 22.26 m for Palazzo Reale and 2.39 m for Generali under the old primary-only rule.
     - The registration check (ADR-0017 point 3) still guards against any systematic shift.
  2. A landmark whose own OSM element is not rendered (`rendered = false`) gets no `landmark_id` assignment at all and is reported as `deferred_phase4`.
- **Owner note:** this changes how the check measures, not the 5 m threshold. It is flagged to the owner at the G1 report.
- **Superseded in part:** point 1 is replaced by ADR-0020 (owner decision, 2026-11-15). Point 2 stays.

## ADR-0019 - Threshold for the share of explicit heights
- **Status:** Accepted (2026-11-15)
- **Context:** VERIFICATION section 3 says the baseline share of explicit (non-default) heights is measured at G1, after which an ADR fixes the threshold. G1 measured it on the pilot: 92.5% of buildings by count and 99.1% by footprint area.
- **Decision:** On the pilot, `make validate` asserts an explicit share of at least **90% by count** and at least **98% by footprint area**. These are about 2.5 and 1 percentage points below the baseline, to absorb small upstream data changes. For the whole city (Phase 6) the baseline is measured again and the threshold re-set by a new ADR before G6.

## ADR-0020 - Best-fit offset check for landmark placement (replaces ADR-0018 point 1)
- **Status:** Accepted (2026-11-15; owner approved at G1)
- **Context:** At G1 the reviewer shifted the Duomo's rendered building 40 m in a scratch copy, and the ADR-0018 check still passed (the reference point stayed inside the filled footprint). A check that cannot fail is not a check.
- **Decision:**
  - For each in-extent landmark with a rendered building, take its OSM footprint F and R, the union of the rendered footprints that **carry that landmark's id** (interior rings filled). *Amended 2026-11-16 (T-1.7 finding):* the original R, every rendered footprint within 60 m, let F slide to a better-covered spot in the dense centre. Palazzo Marino moved 70.2 m and Torre Velasca 50.7 m on correct data. The search window stays +/-50 m so that large shifts are still detected.
  - Find the translation t, within +/-50 m, that maximises area((F + t) intersected with R). Search on a 2 m grid, then refine on a 0.25 m grid around the best cell. If several t come within 0.5% of the maximum overlap, take the one with the smallest |t|.
  - **The landmark passes when |t| <= `tolerance_m` (5 m).** The best overlap ratio and the width of the plateau of near-maximal overlaps are reported.
  - The registration check (ADR-0017 point 3) and the pipeline-integrity check 7a stay as they are.
- **Known limitation:** when F lies well inside a much larger DBT block (Generali), the overlap plateau is wide, so the check is weak for that landmark. The plateau width is reported so the weakness is visible.

## ADR-0021 - Tile scheme and format (task T-2.1)
- **Status:** Accepted (2026-11-15)
- **Grid:** square 500 m tiles in EPSG:32632, aligned to the origin of ADR-0004.
  - Tile (i, j) covers E0 + 500*i <= E < E0 + 500*(i+1), and the same for N with j.
  - The pilot AOI is exactly tiles i, j in {-1, 0}: 4 tiles.
- **Client coordinates:** metres relative to the origin, Y up: x = E - E0, y = height, z = -(N - N0). float32 is enough: at 15 km from the origin its precision is about 1 mm.
- **Assignment:**
  - **Buildings** go whole to the single tile that contains the representative point of their `buildings` footprint. All their render volumes follow them. They are not split.
  - **Lines and areas** (roads, rail, water, green, road_areas, landuse) are clipped at tile edges, which VERIFICATION section 3 allows as "explicitly split".
  - Rows with `rendered = false` are excluded.
- **Format:** one binary glTF 2.0 file (`.glb`) per tile, written by our own deterministic writer (numpy + struct) so the output is byte-identical.
  - One mesh per layer, using float32 positions and normals and uint32 indices.
  - A per-vertex `_FEATURE_ID` (uint32) points into a sidecar `<tile>.json` feature table holding key, name, type, `height_m`, `height_source` and `landmark_id`, used for picking in Phase 5.
  - No textures. Colour and material are decided in the client (Phase 3).
- **Geometry:**
  - **Building footprints** are simplified with `simplify(0.2, preserve_topology=True)`. The Hausdorff distance to the original must be <= 0.5 m (VERIFICATION section 3), checked per feature.
  - **Buildings** are extruded from `bottom_m` to `top_m`: walls plus a flat top, and a bottom face only when `bottom_m > 0`.
  - **Flat layers** are triangulated at small fixed heights (style constants) to avoid z-fighting.
- **Road ribbon widths:**
  - An OSM `width` tag is used where it parses.
  - Otherwise the width comes from a per-class **style table** in the pipeline config. These widths are stylisation, labelled as such, and are not presented as measured data.
- **Manifest:** `tiles.json` with the format version, CRS, origin and tile size, and per tile: id, bbox (both local and EPSG:32632), counts per layer, byte size, gzip size and sha256. Validated against a committed JSON Schema (T-2.3).
- **Budget:** 250 KB gzip per tile (VERIFICATION section 5). Measured in T-2.2; if exceeded, the tile size or the format is revisited by ADR.

## ADR-0022 - Compact tile encoding (amends ADR-0021 format); all intersecting buildings exported
- **Status:** Accepted (2026-11-16)
- **Context:** T-2.2 measured all 4 pilot tiles above the 250 KB gzip budget: 379-662 KB, with 13.7 MB of raw glb in total. Buildings dominate (tile 0_0: 128,763 vertices for 42,921 triangles). The export is effectively non-indexed: three vertices per triangle, with float32 normals and float32 positions.
- **Decision:**
  1. **No `NORMAL` attribute.** The client uses flat shading, with normals derived in the shader from screen-space derivatives (three.js `flatShading: true`). Vertices are then shared through indices: each ring vertex is stored once at the bottom and once at the top of its volume.
  2. *(Amended 2026-11-16, see point 2a.)* **Quantised positions (`KHR_mesh_quantization`, required extension).** `POSITION` is int16 (normalized=false). The values are centimetre offsets from the tile's south-west corner at y = 0, with the node's translation set to that corner in client metres and its scale to 0.01.
     - Range: +/-327.67 m per axis. That covers a 500 m tile only if the offset starts at the tile centre, so the offset is taken **from the tile centre** instead.
     - Heights up to 327 m fit (the pilot maximum is 100.2 m). A feature exceeding the range makes the export fail loudly.
     - Rounding to 1 cm is far below the 0.5 m simplification tolerance.
  2a. **Amendment (T-2.2a finding).** Buildings are kept whole, so they overhang their tile. The worst case is dbt:EDIFC_5112, 358.9 m from its tile centre. Seven buildings, the Duomo among them, exceed +/-327.67 m.
     - **The quantisation unit becomes 2 cm:** node scale 0.02, centred on the tile centre, which gives a range of +/-655.34 m.
     - The maximum rounding error is 1 cm, far below the 0.5 m simplification tolerance.
     - Out-of-range coordinates still fail loudly. Phase 6 must re-check the worst overhang for the whole city.
  3. **Smallest index and id types.** `uint16` indices for meshes with fewer than 65,536 vertices (otherwise the mesh is split into chunks named `<layer>#<n>`). `_FEATURE_ID` is `uint16` when the tile has fewer than 65,536 features, else `uint32`.
  4. If the tiles are still over budget after 1-3, the next step is a smaller tile size (250 m), decided by ADR with measurements. Mesh compression (meshopt or Draco) is not adopted: it adds a dependency and a decoder.
  5. **All intersecting buildings are exported.** A rendered building whose representative point falls in a tile outside the 2 x 2 pilot block still gets exported, in that tile. Every feature then appears in exactly one tile, and edge tiles may hold only those buildings.
  6. **Underground roads and rail** (`underground = true`) are not exported in v1. Confirmed from T-2.2's assumption.

## ADR-0023 - Tile size 250 m (amends ADR-0021)
- **Status:** Accepted (2026-11-16)
- **Context:** After the compact encoding (ADR-0022), tile 0_0 is still 289,508 bytes gzip-9 against the 256,000 budget. The other 500 m tiles are 7.9-237 KB. ADR-0022 point 4 names a 250 m tile size as the next step, to be taken with measurements.
- **Measurement:** the orchestrator ran the T-2.2a exporter with the tile size patched to 250 m in a scratch copy on 2026-11-16. It produced 30 tiles; all 233 rendered buildings appear exactly once; the four largest tiles are 66.9, 81.6, 86.7 and 92.0 KB gzip-9.
- **Decision:**
  - Tiles are **250 m** squares aligned to the origin. Tile (i, j) covers E0 + 250*i <= E < E0 + 250*(i+1), and likewise for N with j. The pilot AOI is tiles i, j in {-2..1}: 16 tiles.
  - The tile size becomes a single constant `TILE_SIZE_M` in `pipeline/milano_iso/config.py`, recorded in `tiles.json`.
  - The quantisation (ADR-0022 point 2a: 2 cm from the tile centre, +/-655 m) still fits, since whole buildings overhang by at most a few hundred metres. The export keeps failing loudly if a building exceeds the range.
- **Consequences:** about 4 times more requests per area, still far within the draw-call budget (16 tiles x about 6 meshes for the pilot). The budget headroom (largest tile about 36% of 256 KB) leaves room for denser districts in Phase 6, where it is measured again.

## ADR-0015 amendment - Ground level of raised-only DBT buildings (T-1.7)
- **Status:** Accepted (2026-11-16)
- **Decision:** A DBT building with no `POR` 01 volume takes as its `ground_z` the median `base_z_min_m` of the `POR` 01 volumes of other buildings within 50 m of its footprint. It needs at least 5 such volumes; with fewer it widens to 100 m, and with still fewer it fails. It is flagged `ground_flag = neighbour_median` with the count in `ground_neighbours`. This replaces "the minimum base Z of all its volumes".
- **Evidence:** EDIFC_2671, an underpass ceiling (`POR` 04): with 83 neighbours it now spans 3.44-19.34 m, where before it was 0-15.9 m and filled the passage.

## ADR-0024 - CI toolchain pinning
- **Status:** Accepted (2026-11-17)
- **Context:**
  - The first CI run (43979971184) failed in `npm ci`. npm 11.19.1 on the runner rejected `web/package-lock.json`, which npm 11.6.2 had written on Windows: "Missing: @emnapi/core@2.0.0-beta.2 from lock file". These are dependencies of the optional `@rolldown/binding-wasm32-wasi`.
  - The run also warned that the actions in use target the deprecated Node 20.
- **Decision:**
  - The lockfile is regenerated with npm 11.19.1 (`npm install --package-lock-only`). It now records `@emnapi/*`, and both npm 11.6.2 and 11.19.1 accept it in `npm ci`.
  - CI installs npm 11.19.1 explicitly.
  - Locally, use npm 11.19.1 for any lockfile change (`npx npm@11.19.1 install ...`).
  - Actions are pinned by full commit SHA: `actions/checkout` v7.0.1, `actions/setup-node` v7.1.0, `astral-sh/setup-uv` v10.3.3, all on the node24 runtime. uv is pinned to 0.13.8, and checkout does not persist credentials.

## ADR-0025 - Viewer architecture for Phase 3
- **Status:** Accepted (2026-11-17)
- **Tile serving:**
  - Built tiles stay outside git (`data/tiles/pilot`).
  - `make web-tiles` copies them to `web/public/tiles/pilot/` (gitignored), so `npm run dev` and `npm run build` serve them as static files.
  - The client fetches `tiles/pilot/tiles.json` relative to the page. The query `?tiles=<base>` may override this for development.
- **e2e and CI without real data:**
  - CI has no 1.2 GB download, so the e2e tests use a small **synthetic fixture tileset**.
  - A committed, deterministic script runs the real exporter on synthetic input (a few buildings and roads around the origin) and writes it to `web/e2e/fixtures/tiles/`, where it is committed.
  - Tests serve it by intercepting `**/tiles/**` requests in Playwright.
  - The fixture is never presented as real data.
- **Test hook:**
  - With `?e2e=1`, `window.__milanoIso` exposes read-only state for tests through `web/src/testhook.ts` (`registerTestState(key, getter)`). The keys are `camera`, `tiles` and `render` (draw calls, triangles).
  - Without the flag it does not exist.
- **Module ownership** (so parallel tasks do not collide):
  - `camera.ts` and `controls.ts`: camera and input (T-3.1).
  - `tiles/` (loader, culling, manifest) and `scene.ts`: tiles (T-3.2).
  - `style/` (palette, materials, lights): T-3.3.
  - `debug.ts`: T-3.4.
  - `main.ts` is the composition root. Tasks add only small, clearly delimited blocks to it, and the orchestrator resolves merges.
- **Attribution:** the attribution shown in the UI comes from `tiles.json` (hard rule 10). It is shown as soon as any tile data is rendered, and the i18n dictionary holds only its label.

## ADR-0026 - Per-tile building materials (amends T-3.3 spec)
- **Status:** Accepted (2026-11-17)
- **Context:** Building colour comes from a per-tile lookup texture indexed by `_feature_id`. three.js does not re-upload a shared material's uniforms between draws of different meshes, so one shared building material cannot switch the lookup per tile.
- **Decision:**
  - Building meshes use one material instance per (tile, mesh). All of these share a single compiled shader program through `customProgramCacheKey`, so the draw-call count is unchanged (measured: 111 draw calls at the default real view with shadows).
  - Flat layers keep one shared material each.
  - Colours, sun direction and shadow settings are style constants in `web/src/style/` and are not data.

## ADR-0027 - No MSAA in e2e runs
- **Status:** Accepted (2026-11-17)
- **Context:** With continuous rendering (T-3.4 benchmark), headless Chromium on SwiftShader logs `GL_INVALID_OPERATION: glBlitFramebuffer: Blit feedback loop` at random moments. Our code has no render targets and never reads the canvas. The experiment by the executor: about 3 occurrences in 24 runs with `antialias: true`, 0 in 48 runs with `antialias: false`. The orchestrator confirmed after the fix: 40/40 runs of `debug.spec.ts` passed. The most likely source is the browser's own resolve of the multisampled default framebuffer.
- **Decision:**
  - The renderer is created with `antialias: !e2eEnabled()`. Production and `?debug` keep antialiasing; only `?e2e=1` runs drop it.
  - The console filter (ADR-0012) is not widened.
  - Visual-regression baselines (G3 and later) are captured under `?e2e=1`, so baselines and test runs stay consistent.
- **Consequence:** e2e screenshots are not antialiased. Antialiasing is checked on real devices at the checkpoints.

## ADR-0028 - Phase 4 scope (owner answers, 2026-11-17)
- **Status:** Accepted (2026-11-17)
- **Decisions by the owner:**
  1. **Landmark models** are built from the real DBT volume massing, with a few stylised details added on top (for example the Duomo's spires, a tower crown). Positions and heights stay data-driven. Every added detail is flagged as stylisation, and none changes a footprint or a height taken from data.
  2. **Landmarks outside the pilot** (San Siro, CityLife, Bosco Verticale, Pirelli, Stazione Centrale, and the Castello if it is outside) have their models built in Phase 4, but are placed and verified in Phase 6 with the whole city (ADR-0011).
  3. **Trees:** trees mapped in OSM (`natural=tree`, `natural=tree_row`) are placed at their positions. Parks also get decorative fill from a fixed seed. Fill trees carry `decorative = true` in the data and never count as real features (no picking info as a mapped tree).
  4. **Day/night:** a toggle with a night palette. The owner approves the night look at the Phase 4 checkpoint.
- **Also accepted:** the owner approved palette v1 (the day look) at the Phase 3 checkpoint.
- **Visual regression:** `threshold` 0.02 and `maxDiffPixelRatio` 0.001 (T-3.7: 0 px noise over 70 captures on Windows; Linux noise to be measured once the Linux baselines exist).

## ADR-0029 - Surface palette limit raised from 16 to 32 colours
- **Status:** Accepted (2026-11-17)
- **Context:** Palette v1 (T-3.3) uses 15 of 16 entries. Phase 4 (ADR-0028) adds trees, road markings and land-use and green kinds, which need more colours. The limit of 16 was a style restraint, not a technical one: the shader array is sized from `PALETTE_ORDER.length` and the lookup texture stores one byte per feature (up to 256 values).
- **Decision:** `MAX_PALETTE_COLOURS` = 32. New entries are appended after the existing ones, so the indices of palette v1 do not change. The night palette (T-4.3) must define a colour for every entry, enforced by its type.
- **Consequences:** the restrained look is kept by review at the Phase 4 checkpoint, not by the cap. The cost is a uniform array of up to 32 vec3.

## ADR-0030 - Phase 4 look approved
- **Status:** Accepted (2026-11-17)
- **Decision:** At the Phase 4 checkpoint the owner approved the Phase 4 look "as is":
  - the night palette and lights;
  - trees, with mapped and fill trees drawn alike;
  - road markings, including centre lines on residential streets;
  - the Duomo pinnacles, the Torre Velasca crown and the Galleria glass vault.
- **Evidence:** G4 PASS WITH RISKS (`docs/PROGRESS.md`, `reports/artifacts/G4/`).
- **Consequences:** the win32 baselines of T-4.2 are the approved references. The Linux baselines are regenerated from them by the `visual-baselines` workflow.

## ADR-0031 - Search index and minimap formats (T-5.3a)
- **Status:** Accepted (2026-11-17)
- **Decision:** The tile export writes `index.json` and `minimap.svg` next to the tiles. Both are listed in `tiles.json` with sha256 and gzip size.
  - **Index:** one entry per named rendered feature: building, street (grouped by exact name; ref = OSM ways and relations), green, water or landmark.
    - Landmark names come from `tests/landmarks.yaml` and take precedence over transferred building names.
    - Centre and bbox are local metres rounded to 0.1 m; sort is deterministic.
    - Names are verbatim (ADR-0006); the client folds accents for matching.
  - **Minimap:** an SVG with a local-metre `viewBox`, north up, and CSS classes per layer (themeable for day and night). Paths are simplified at 1.0 m, snapped to 0.1 m and sorted. It uses no GEOS union, for Linux/Windows byte identity.
- **Consequences:**
  - Fill trees, markings and landmark details never enter the index.
  - The whole-city minimap needs a coarser level of detail in Phase 6 to stay near 100 KB gzip.

## ADR-0032 - UI language runtime, shared UI colours, focus indicator and contrast criterion (T-5.4)
- **Status:** Accepted (2026-11-17), pending the G5 review
- **Decision:**
  - **Language (ADR-0006):** `i18n.ts` holds the language in use. The initial language is `?lang=it|en`, then the choice remembered in `localStorage` (`milano-iso.lang`, written only by a click on the IT/EN button), then Italian. `t(key)` reads the language in use; every module re-labels itself through `onLangChange`, so the switch is live (including `<html lang>`, aria-labels, the tiles notice and the info card). Feature names and the attribution entries are data and are never translated. A grep-based unit test (`i18n.test.ts`) fails on any literal user-facing string in the DOM code of `web/src`; its allow-list is in the test, each entry with its reason.
  - **One UI stylesheet:** the buttons, search box, list rows, notice, card and attribution use the same CSS variables (`--tb-*`, day and night, in `index.html`). The rotation buttons and the day/night toggle are no longer styled inline. This is UI style only; the map palette (ADR-0030) is unchanged.
  - **Targets:** every control is at least 44x44 CSS px. The check boxes of the layers panel are the whole 44 px row (the native input covers it). The attribution links and the card's OSM link are 44 px tall.
  - **Focus indicator:** a 3 px ring with a 2 px halo on each side (day: dark blue `#08306b` between white bands; night: amber `#ffd54f` between `#263238` bands). The map container draws the same on a pseudo-element over the canvas.
  - **Contrast criterion over a map that is light, mid and dark:** a single border or ring colour cannot reach 3:1 against every map colour (measured: a dark-grey border reached 1.57:1 on a tan roof). WCAG 1.4.11 asks for 3:1 for whichever part identifies the component, so a boundary counts when its border OR its own fill reaches 3:1, and a focus indicator when its ring OR its halo does. Border colours are therefore extreme (day `#1c262b`, night `#ffffff`), so the border and the fill cover complementary lightness ranges. Text is measured as the text colour against the control fill composited over the real map pixels (>= 4.5:1). `web/scripts/measure-contrast.mjs` does this on the real tiles.
  - **Tab order:** toolbar, map, the controls at the right (day/night, rotation), the info card, the attribution (the right-hand controls and the card are inserted before the attribution in the DOM).
  - **Tile retry:** a tile waiting for its retry counts as loading but holds no loader slot, and is retried only if still wanted.
- **Consequences:**
  - The win32 visual baselines that show the day/night toggle or the attribution were regenerated (the map pixels are unchanged, checked outside the UI boxes). The `*-linux.png` files are stale until the `visual-baselines` workflow is rerun.
  - The `?debug` overlay moves to the bottom on screens 600 px wide or less, so it does not cover the tiles notice.
  - Any new colour in the UI must be added to the measurement (`measure-contrast.mjs`) and keep the same ratios.
