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
- **Status:** Accepted, provisional (2026-11-15). Re-confirmed by the owner at the Phase 0 checkpoint from a side-by-side render.
- **Context:** Classic SimCity pixel look is a 2:1 dimetric view; "true isometric" is slightly steeper.
- **Decision:** Azimuth 45 degrees, elevation 30 degrees (ground squares appear as 2:1 rhombi). The alternative, 35.264 degrees (true isometric), is rendered side by side in T-0.2 for the owner to compare.
- **Consequences:** Affects shading, texture choices and picking maths. The angle is a single config constant so it can change cheaply until Phase 3.

## ADR-0004 - Coordinates, origin, pilot AOI and tiling
- **Status:** Accepted (2026-11-15)
- **Decision:**
  - Pipeline CRS EPSG:32632. Client coordinates are metres from a fixed origin.
  - **Origin:** the position of the Duomo di Milano taken from a cited source (OSM element and/or Wikidata), transformed to EPSG:32632 and rounded to the nearest whole metre. The value and its citation are recorded in `docs/DATA_SOURCES.md` by T-0.3; no coordinate is typed from memory.
  - **Pilot AOI:** the 1000 m x 1000 m square in EPSG:32632 centred on the origin (origin +/- 500 m on each axis). Final extent: the administrative boundary of the Comune di Milano.
  - **Recorded values (T-0.3, verified by the orchestrator 2026-11-15):** origin E 514978, N 5034535 (EPSG:32632), the area-weighted centroid of OSM relation/18017026 "Duomo di Milano". Pilot AOI bbox 514478, 5034035, 515478, 5035035. Wikidata Q18068 P625 lies 83.3 m away, just west of the OSM footprint extent (the facade side), so it is not used: the footprint centroid matches the landmark-position definition of ADR-0011. Reproduce with `pipeline/scripts/origin_from_sources.py`.
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
