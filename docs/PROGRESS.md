# Progress

Single source of truth for state. The orchestrator updates it after every accepted task, so any new session can resume from here.

**Current phase:** 5 - Interaction and UI (started 2026-11-17). Phase 4 approved as is (ADR-0030), G4 PASS WITH RISKS, CI green after T-4.4. Desktop FPS 118.3 (Phase 3 build); Pixel 7a FPS still pending from the owner. Repo https://github.com/alession-100/milano_iso
**Last gate passed:** G3 PASS WITH RISKS (2026-11-17; first review FAIL on flaky inertia e2e, fixed in T-3.6). Earlier: G2 PASS WITH RISKS (2026-11-16). Earlier: G1 PASS WITH RISKS (2026-11-15). Earlier: G0 PASS WITH RISKS (2026-11-15; first review FAIL on origin B1, fixed in T-0.3a)
**Open escalations:** none

| Task | Status | Report | Notes |
|---|---|---|---|
| T-0.1 | done | - | Owner answers 2026-11-15; ADR-0001..0011 accepted (ADR-0003 provisional until checkpoint render) |
| T-0.2 | done | reports/R-0.2.md | Verified from a clean clone: make setup/test pass (pytest 3, vitest 6, ruff, tsc, eslint), build OK, JS about 131-133 kB gzip, e2e 2 passed, side-by-side render reviewed. CI not run (no remote). Decisions in ADR-0012 |
| T-0.3 | done | reports/R-0.3.md | Verified by orchestrator: script reproduces origin/bbox, 0 TO VERIFY, Wikidata P625 / Geofabrik size / DBT licence re-checked live. Origin 83 m mismatch resolved in ADR-0004. Open: DBT `UN_VOL_AV` semantics and join to `EDIFC` (T-1.2); Pages custom headers unconfirmed (T-6.3) |

| T-0.3a | done | reports/R-0.3a.md | Verified independently (shapely centroid 514978.51, 5034535.58; config constants, bbox, WGS84 corners and 83.4 m distance all match). ADR-0004 frozen. Was: Corrective (T-0.3 retry 1/2): G0 blocker B1, origin centroid float error (orchestrator confirmed with shapely: E 514978.511, N 5034535.581) |
| T-0.2a | done | reports/R-0.2a.md | Verified: make setup/test pass, e2e 1 passed, test passes alone, tree clean after e2e, CI permissions read-only. Was: G0 non-blocking hardening: uv --locked, e2e output dir, test independence, CI permissions |

| T-1.1 | done | reports/R-1.1.md | Verified: PBF sha256 matches manifest (md5 verified vs Geofabrik); 706 building areas vs 710 from live Overpass for the (slightly larger) WGS84 bbox; Duomo present; 0 of the 509 failed multipolygons are among the 245 relations in the pilot bbox (Overpass check). Closed highways come out as areas; T-1.3 handles them |
| T-1.2 | done | reports/R-1.2.md | Verified independently: ZIP sha256 matches manifest; own read of the ZIP gives 170 EDIFC_IS, 4657 UN_VOL, join 98.99%, AV = QE - baseZ (POR 01/04), POR 03 offset 3.5; spec pp.129-133 quotes confirmed. Decisions: EDIFC = IS (footprint) + ME (join); EDI_MIN to be included in T-1.3; POR 02/03 handled in T-1.4 |
| T-1.3 | done | reports/R-1.3.md | Verified independently: 12 layers, all EPSG:32632, 0 invalid, 0 empty, 0 outside the extent; OSM buildings 706/706 and parts 133/133 vs the interim tags; DBT volumes 4657 (EDIFC 4610 + EDI_MIN 47, 0 unmatched); Duomo centroid matches ADR-0004. Classify lists reviewed and accepted. EDIFC_USO kept as codes only (labels did not extract from the PDF) |
| T-1.4 | done (with correction) | reports/R-1.4.md | Verified: edge fix gives 5821 volumes, unmatched OSM 22/706 (3.1%); top 5 heights inspected (Torre Velasca 100.18 m, Duomo 94.58 m). Default-height rule found biased (about 30 m blocks on a crypt, roofs, an underground entrance), so ADR-0016 and corrective T-1.4a |
| T-1.4a | done | reports/R-1.4a.md | Verified: default 3.201 m (EDI_MIN, n=47); 7 not rendered (6 roof, 1 construction); all heights > 0 with a valid source; make test green |
| T-1.5 | done | reports/R-1.5.md | Verified: 16 entries, in_pilot flags match bbox (7 in pilot); 8 entries re-derived from the live OSM API (with inner rings) match within 0.005 m, and their QIDs match the OSM wikidata tags; YAML reproducible. Centrale uses a node fallback, so corrective T-1.5a |
| T-1.5a | done | reports/R-1.5a.md | Verified live: relation/18231605 (building=train_station, v3) contains node/6067258870; centroid matches within 0.001 m. Q651643 is the Madrid tower, so Q3995204 is kept. The Wikidata distance (52.6 m) is informational only; the 5 m tolerance applies to processed vs reference position |
| T-1.6 | done (with correction) | reports/R-1.6.md | Verified: make validate 78 pass / 3 fail / 2 skip; determinism OK (4 gpkg); make test unchanged (111, 83 data tests deselected). The 3 failures are the 7b rendered-landmark check: a definitional mismatch between OSM and DBT building extents, plus the Generali id assignment. Orchestrator measured OSM/DBT registration: mean offset 0.22 m over 41 pairs, so ADR-0017 and T-1.6a |
| T-1.6a | done (finding) | reports/R-1.6a.md | Verified: registration n=48, magnitude 0.167 m; Generali passes. Palazzo Reale fails because its reference point lies in its courtyard (orchestrator confirmed). ADR-0018 and T-1.6b (retry 2/2) |
| T-1.6b | done | reports/R-1.6b.md | Verified: make validate exit 0 (83 pass, 2 skip); filled-union distance 0.000 m for all 6; the deferred-landmark unit test fails when the guard is removed (orchestrator sabotage), passes with it |

| T-1.7 | done (retry 1/2) | reports/R-1.7.md | Verified on main: make data canonical 85c50ccd...b4fb (matches the executor); make validate 106 pass / 2 skip, landmark best offsets <= 0.71 m; Duomo 40 m sabotage fails at 38.8 m (executor evidence). First attempt blocked by an ADR-0020 flaw (R = all nearby buildings), amended |
| T-2.1 | done | - | ADR-0021 tile scheme |
| T-2.2 | done (finding) | reports/R-2.2.md | Verified: 4 tiles load in Node, 0 mismatches. Budget exceeded (379-662 KB gzip vs 250 KB); the export is not indexed. ADR-0022 and T-2.2a |
| T-2.2a | done (finding) | reports/R-2.2a.md | Verified independently: byte-identical rebuild, 12 tiles load, 1536 sampled positions max error 0.010 m, 233/233 buildings once. Tile 0_0 is 289,508 B gzip-9, over budget; orchestrator measured 250 m tiles (max 92.0 KB), so ADR-0023 |
| T-2.3 | done | reports/R-2.3.md | Verified independently: 30 tiles, largest 91.4 KB gzip; Khronos validator 0 errors, 0 warnings; data tile checks 9 pass; determinism check exits 1 under orchestrator sabotage (flipped byte), 0 normally. Accepted: the glb.py stride fix (validator finding) and the Comune attribution wording composed from the portal's quoted licence text |
| T-2.4 | merged into T-2.3 | | |

| T-2.5 | done | reports/R-2.5.md | Verified on main: make validate 111 pass / 1 skip (deferred Galleria). Region-Hausdorff reading accepted (max 0.271 m). The orchestrator fixed the root cause of the shared ATTRIBUTION mutation (deepcopy in manifest.py). Warm `make validate` takes about 333 s because `make data` is not incremental (to improve later) |

| T-3.1 | done | reports/R-3.1.md | Verified on main: vitest 19 pass, e2e 12 pass (desktop and Pixel 7-class touch); screenshot reviewed. Accepted: the ADR-0012 suffix amendment, ground-axis arrow steps, instant zoom. `rig.setBounds` is wired at the T-3.2 merge |
| T-3.2 | done, integration pending | reports/R-3.2.md | Executor results: e2e 4 pass on the fixture; real pilot 82 draw calls (default) / 106 (widest), 0 failed tiles. Merge conflicts with T-3.1 (render loop, tempview), so integration is in T-3.5. Accepted: the shared console filter helper, and attribution links to osm.org/copyright and CC BY 4.0 |
| T-3.5 | done | reports/R-3.5.md | Verified on main: vitest 40, e2e 15 pass (fixture); JS 160 KB gzip; no permanent render loop. Orchestrator checked real data in the browser pane: 29 tiles loaded, 0 failed, 87 draw calls, attribution OSM + Comune, 0 console errors |
| T-3.3 | done | reports/R-3.3.md | Verified on main after merge: vitest 63, e2e 19 pass (bench excluded pending T-3.4 fix), JS 163 KB gzip; screenshots reviewed. Real default view: 111 draw calls with shadows. Material deviation ratified in ADR-0026. Look awaiting owner approval at checkpoint |
| T-3.4 | done (retry 1/2) | reports/R-3.4.md | Verified on main after merging T-3.3 + T-3.4 (one import conflict resolved by the orchestrator): vitest 63, e2e 21 pass, debug.spec 40/40 repeats pass; JS 163 KB gzip plus a 1.7 KB debug chunk. Cause: browser MSAA resolve under SwiftShader, so ADR-0027. The owner approved stopping a stray preview server (PID 40380) |

| T-3.6 | done | reports/R-3.6.md | Verified on main: vitest 66; 5 consecutive full e2e runs at default workers, 28/28 each. Visual baselines are candidate win32 only (skipped in CI with a reason); Linux baselines and the approval date follow the owner checkpoint. The B1 cause was the test's real mouse timing under load (the app already used event timestamps) |

| T-3.7 | done | reports/R-3.7.md | Verified on main: vitest 66, e2e 30 pass, visual 24/24 on repeat; every colour sabotage fails at least 1 view (executor table); thresholds per ADR-0028. Linux baselines from the owner's `visual-baselines` workflow run committed 2026-11-17 (reviewed: same scene as win32, font rendering differs only); CI skip removed |
| T-4.1 | done | reports/R-4.1.md | Verified: pytest 188, vitest 83, e2e 40/40, tile determinism exit 0, screenshots reviewed. Pilot: 186 mapped trees (0 dropped), 0 tree_row, 174 fill (`decorative=true`), 1,897 dashes, 235 crossings from `footway=crossing`. Max tile 99,953 B gzip; draw calls 136 default / 167 at 4000 m; JS 167.5 KB. Centre lines on residential streets are the executor's choice (owner to judge). The T-2.3/T-1.6 summaries are rewritten by the tools on every run |
| T-4.3 | done | reports/R-4.3.md | Verified in worktree: vitest 77, e2e 40/40, build 165 KB gzip; screenshots reviewed. Draw calls unchanged day/night (111 at 1280x720). Palette 23/32. Lit windows skipped (optional); water edge band not possible without per-vertex data. Night look awaits owner approval. Linux baselines now stale: main is not pushed until the owner reruns `visual-baselines` at the checkpoint |
| T-4.2 | done | reports/R-4.2.md | Verified: pytest 232, vitest 85, e2e 40/40; screenshots reviewed. 122 details (Duomo 110, Velasca 11, Galleria vault 1), all `stylised=true`, 56 style constants, none presented as real figures. Buildings layer: 0 of 30 tiles changed (per-layer hash). Galleria vault base 25.750 m = lowest top of the 8 adjacent EDIFC_4893 volumes. Draw calls 140 default / 172 at 4000 m. Out-of-pilot specs unit-tested only; previews in Phase 6 (pipeline has no small-AOI mode). Velasca crown looks busy: owner to judge |
| T-4.4 | done | tasks/T-4.4.md | CI fix: markings snapped to 1 mm and sorted, so tiles are identical on Linux and Windows (GEOS last-bit float differences reordered dashes and flipped rectangle diagonals). Two new tests fail without the fix. CI green on run 44151393731 (all steps, including Linux visual) |
| T-5.2 | done | reports/R-5.2.md | Verified: vitest 120, e2e 54/54 x2 and rotation spec 80/80 on repeat (after a test race fix; the first review found 2/2 failures). Draw calls 140/138/140/139 over the 4 azimuths. Q = counter-clockwise, E = clockwise. Rotation buttons hidden in visual baselines (covered by rotation.spec). 6 new rot baselines are win32 only: main not pushed until Linux baselines are regenerated at the end of Phase 5 |
| T-5.3a | done | reports/R-5.3a.md | Verified: pytest 253, vitest 88, e2e 40; tile glb/json hashes unchanged (only tiles.json). Pilot index: 277 entries (76 buildings, 184 streets, 10 green, 0 water (no named water), 7 landmarks); Generali now named from landmarks.yaml. index 12.6 KB gzip, minimap 29.7 KB gzip (1.0 m tolerance); a whole-city minimap needs a coarser level (~5.4 MB gzip at pilot settings). Several buildings share a name (e.g. Ca' Granda x2): the search UI must group them |
| T-5.1 | done | reports/R-5.1.md | Verified: vitest 179, e2e 94/94 x5 after two fixes. First, an e2e race (draw calls sampled before tiles settled; fixed by the executor). Second, a wall-clock 50 ms assert that flaked about 1 in 300 under parallel load (removed by the orchestrator; timing stays recorded). picking.spec 450/450 on repeat. Draw calls unchanged with hover (140/146); JS 180.6 KB gzip. Fill trees and markings not pickable; details select their landmark. Notes: index fetched on first selection; a pick inside a tree row highlights the whole row; no language-switch UI yet (T-5.4); per-tile spatial index may be needed in Phase 6 |
| T-5.3b | done | reports/R-5.3b.md | Verified: vitest 164, e2e 74/74 x2 then 77/77 after the fix; screenshots reviewed. The night minimap first read as day (light night-building colour + view-polygon tint); fixed and tested by computed fill. JS 173.6 KB gzip; index fetched lazily. Notice moved under the toolbar, debug overlay to the right. For T-5.4: the rotation buttons keep their day look at night; re-check 412 px overlaps with T-5.1's card zone |
| T-5.4 | done | reports/R-5.4.md | Verified by the orchestrator: typecheck, lint, vitest 188, build; e2e 123/123 x3 on port 4189 and ui.spec --repeat-each=5 120/120; screenshots reviewed. Accepted reading: boundary contrast = border or fill (WCAG 1.4.11), focus = ring or halo (ADR-0032). IT/EN switch, help panel, 44 px targets, one UI stylesheet with measured contrast over the real map (worst: text 4.91, boundary 3.47, focus 3.58), tab order and focus ring, layout and touch e2e at 1280x720 and 412x915, shared e2e settle helpers, tile retry fix. The 22 win32 baselines were regenerated (map pixels unchanged outside the UI boxes); the Linux baselines are stale until `visual-baselines` is rerun. ADR-0032 |
| T-5.5 | done | reports/R-5.5.md | Verified on merged main (97c80e8, with T-5.6): make test (pytest 257, vitest 195), build, e2e 171/171 x2 and toolbar/visual/layout/ui --repeat-each=3 357/357. An earlier run on the same commit reported 2 failures after 5.7 h (machine likely asleep or starved; the failing names were not captured) and was not reproduced. Layout rule: roomy (>= 700 x 600) minimap bottom-left and card as right panel, otherwise minimap behind its button and card as bottom sheet; new layout.spec sweep at 46 sizes. Landmark cards show the DBT body height (Duomo 94,6 m); Palazzo Reale shows none (4 volumes, 19.4 to 25.7 m, ambiguous); no OSM link for real landmarks (ids not in the tiles). A layers or help panel hides the tile notice while open. 4 win32 night baselines regenerated (toggle check mark) |
| T-5.6 | done | reports/R-5.6.md | Verified: make test (pytest 257, vitest 193), e2e 123/123 (x3 executor, x1 orchestrator). Real data: street 184 -> 176, new kind stop 11 (platform tags carried as roads.is_platform); "duomo" and "galleria" list the landmark first; index.json byte-identical over two rebuilds (Windows). Orchestrator fix: the T-1.6 validation summary had been overwritten by a partial run; regenerated in full (143 passed, 1 skipped). Existing real-data checkouts need `make data` again before `make tiles`. ADR-0033 |

### Gate G5 status (2026-11-18)
- First review (b1bcc78): FAIL. B1: desktop minimap over the OSM attribution at 601-936 px wide (hard rule 10). Fixed by T-5.5; N1 to N6 fixed by T-5.5 and T-5.6.
- Re-review (b9c4841): FAIL. B2 (same class): at short heights (640x360, 667x375, 740x360, 600x412) the open layers panel, the open minimap or the tile notice covers the attribution links; N1b regresses at 360 px wide for heights 599-601; N7 only partly fixed (drag still uses real-time waits). All 10 4a items pass at 1280x720 and 412x915; e2e 171/171 x2; contrast text 4.91, boundary 3.47.
- Second failed attempt at the layout (T-5.4, T-5.5): escalated to the owner per hard rule 8 before a third attempt.


Status values: todo, in progress, review, retry (n/2), blocked, done.

## Environment notes (dev machine, Windows 11)
- Python 3.12 via `uv` (uv 0.13.8, installed with `pip install --user uv`); system Python 3.14 is not used.
- GNU Make 4.4.1 via winget `ezwinports.make`; shims for `make` and `uv` in `~/bin` (on Git Bash PATH).
- Node v24.12.0, npm 11.6.2, git 2.52.0.
- No GitHub remote yet; `gh` CLI not installed. CI cannot run until the owner creates the repo.

## Carry-over risks from G0
- CI: first run 43979971184 failed in `npm ci` (lockfile missing optional @emnapi deps; log supplied by the owner). Fixed in ADR-0024. **CI green:** run 43984706073 on commit 7378994 passed every step: setup, make test, web build, Playwright install and e2e on Linux. The e2e console filter (ADR-0012) did not trip on the runner. First run may trip the anchored GPU-stall filter on Linux (ADR-0012).
- CI actions pinned by tag, not SHA. Pin by SHA when the remote exists.
- Attribution is still a placeholder. It must read "(c) OpenStreetMap contributors" (+ Comune di Milano CC BY if DBT is used) before any OSM geometry renders (Phase 3).
- The web client needs an origin constant that matches `pipeline/milano_iso/config.py`, with a test (Phase 2/3).
- DBT `UN_VOL_AV` semantics and the join to `EDIFC` are unknown (T-1.2).
- GitHub Pages custom headers unconfirmed (T-6.3).
- The web client must skip `rendered = false` rows (Phase 2/3 export).
- `reports/artifacts/T-1.6/junit.xml` contains timestamps, so a `make validate` run dirties the tree; consider gitignoring it.
- Python artifact writers emit CRLF on Windows (git normalises on commit; set newline='
' when touched).

## Carry-over from G1 (reviewer findings, non-blocking)
1. **The ADR-0018 rendered-landmark check cannot detect misplacement.** Shifting the Duomo's rendered building 40 m in a scratch copy still passes. Proposed fix: a best-fit offset check (owner decision pending). It must be fixed before G4.
2. **Generali:** `landmark_id` sits on DBT block EDIFC_4831 (5,644 m2), whose transferred OSM name is "Palazzo Carminati". The info card would mix up the names (Phase 5).
3. **EDIFC_2671:** an underpass-ceiling volume (POR 04) rendered solid from 0 m, about 3.4 m too low at the top. Its footprint is also missing from `dbt_buildings` with no drop-log row.
4. **Simplification <= 0.5 m check:** to be written at tile export (Phase 2).
5. **Duplicate check:** it only catches same key plus same geometry; extend it to geometry-only.
6. **Cosmetic:** -0.0 bottoms, CRLF artifacts, timestamps in junit.xml.
7. **Torre Velasca:** 100.18 m at the eaves vs 106 m to the roof (en.wikipedia citing LIFE 1957; Wikidata P2048). Consistent with ADR-0015 (no roofs).

## Carry-over from G2 (non-blocking)
- **Fixed in T-2.5:**
  - content bbox (buildings overhang their cell by up to about 141 m, which would break culling);
  - flat-layer coverage test;
  - real simplification test;
  - 0-byte empty tiles;
  - `validate` depends on `data`.
- **Open:**
  - 29 zero-area road triangles from quantisation (harmless);
  - per-volume simplification slivers (cosmetic);
  - the road width style table must cover the city classes in Phase 6;
  - Torre Velasca's roof-cap centroid is 5.2 m from its OSM reference: an OSM/DBT difference in extent (ADR-0017), and the best-fit check passes.

## G3 review 2026-11-17: FAIL (1 blocker)
- **B1:** the e2e inertia test is flaky under load (4 of 12 full runs failed). Fixed in T-3.6.
- **Passed:**
  - JS 163 KB gzip;
  - initial payload at most about 1.3-1.6 MB gzip (upper bound, all tiles);
  - first render with tiles about 0.2 s on localhost;
  - draw calls 44-136;
  - 0 console errors;
  - attribution visible on desktop and 412 px;
  - keyboard and reduced motion OK;
  - no idle render loop;
  - a 404, garbage or truncated tile leaves the app working with 1 error;
  - builds are byte-identical.
- **Real desktop FPS:** 118.3 mean, owner-measured with `?debug=bench` on 2026-11-17 (VERIFICATION section 5 target >= 60: met). **Pending the owner:** FPS on the Pixel 7a (headless SwiftShader benchmark: 10.6 fps desktop, 19.7 fps at 412 px; indicative only), and approval of the visual baselines.

## Carry-over from G3 re-review (non-blocking)
1. **Visual diff misses visible colour changes.** The default per-pixel `threshold` is 0.2 (a ground darkening of 16 levels passes). The fixture has only `building_type=yes`. Tighten the threshold and enrich the fixture before the baselines are approved.
2. **CI visual skip:** resolved 2026-11-17; Linux baselines committed and the skip removed.
3. **Inertia settle check:** loosened to 15 s in e2e (stop timing is covered by unit tests).
4. **404 test:** uses a local prefix filter for browser "Failed to load resource" lines.
5. **The debug overlay covers the tile notice** (debug mode only). Resolved in T-5.4 (the overlay sits at the bottom on narrow screens; e2e by bounding boxes).
6. **Retry edge cases:** a slot is held for 2 s, retries run for unwanted tiles, and a transient 404 still logs a browser console error (matters for G5). Resolved in T-5.4 except the browser console line for a 404, which the browser itself writes and e2e filters by prefix; a waiting retry no longer holds a slot and an unwanted tile is not retried (unit tests).
7. **The notice is Italian only** (`DEFAULT_LANG`); language switching comes in Phase 5. Resolved in T-5.4 (IT/EN switch, ADR-0032).

## Gate G4 (2026-11-17): PASS WITH RISKS
Reviewer re-ran everything in a fresh clone of local main 4e89f4e. Evidence: `reports/artifacts/G4/`.
- Tests: `make test` (pytest 232, vitest 85); `make validate` 135 passed, 1 skipped (Galleria, ADR-0018); data and tile determinism OK; e2e 40/40 x3; win32 visual 36/36.
- Landmarks: centroid and best-fit checks pass (worst best-fit 0.707 m, Duomo). 122 details, worst 0.013 m outside their footprint (tolerance 2 m). Buildings layer identical in 30/30 tiles against bbcc4b0, checked by an independent comparator.
- Data versus style: all 174 fill trees `decorative=true` with no OSM id; 0 inside buildings, water or roads. All markings and details `stylised=true`. Galleria base 25.75 m confirmed from the raw DBT.
- Budgets: draw calls 140/146 default and 172 at 4000 m (day = night); max tile 99,953 B gzip; JS 167.6 KB. Headless bench about 10% below G3 (indicative).
- Toggle: keyboard and `aria-pressed` OK, no overlap at 412 px; contrast >= 5.37:1.

**G4 carry-over (non-blocking):**
1. Linux visual baselines: resolved 2026-11-17 (owner reran `visual-baselines`; 12 images committed).
2. Toggle focus ring nearly invisible in night mode (G5). Resolved in T-5.4 (amber ring with halos; screenshots in `reports/artifacts/T-5.4/`).
3. The fill clearance has no rail/tram entry (Phase 6).
4. `test_no_detail_base_below_the_volume_it_sits_on` passes vacuously when a detail sits on no volume.
5. The Galleria base depends on the adjacency buffer (26.708 m at 0 m buffer); a documented style constant.
6. The glass vault may read as water at night (owner).
7. Phase 5 picking must honour `decorative`.
8. One OSM tree stands inside a building footprint (data).
9. Real-device FPS to be re-measured after Phase 4.

- 2026-11-17 CI check branch `ci/phase-5` (run 44159857228): `make test` green on Linux (T-5.3a index and minimap byte-identical); e2e red, expected from the 6 missing `rot` Linux baselines, but the log is not public, so this is unconfirmed until the end-of-phase baseline run.
