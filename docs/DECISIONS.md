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
  - e2e console check ignores exactly one message, `GPU stall due to ReadPixels`. Headless Chromium's software GL (SwiftShader) emits it when a WebGL canvas is screenshotted, so the screenshot causes it, not the app. Every other console error, warning or page error fails the test. The filter is a single fully anchored regex in `web/e2e/smoke.spec.ts` (since T-0.2a), matching the full observed message `[.WebGL-0x<hex>]GL Driver Message (OpenGL, Performance, GL_CLOSE_PATH_NV, High): GPU stall due to ReadPixels`. It must not be widened without a new ADR. Known risk: the CI runner's GL driver may word the prefix differently.
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
- **Default height (step 5)** is derived from data, never typed: the median building height of DBT buildings matched to OSM buildings with the same `building` value in the processed extent, when there are at least 5 of them. Otherwise it is the median over all matched DBT buildings. The values are written to a committed artifact by the pipeline, and every such building has `height_source = default`.
- **OSM levels:** `building:levels x 3.0 m` with no roof allowance, as in `DATA_SOURCES.md`.
