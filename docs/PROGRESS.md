# Progress

Single source of truth for state. The orchestrator updates it after every accepted task, so any new session can resume from here.

**Current phase:** 2 complete (G2 PASS WITH RISKS); T-2.5 follow-ups before Phase 3 (owner approved on 2026-11-15: ADR-0020 best-fit landmark check, then Phase 2) (owner go-ahead 2026-11-15; 30 degrees confirmed; data downloads of about 600 MB each approved)
**Last gate passed:** G2 PASS WITH RISKS (2026-11-16). Earlier: G1 PASS WITH RISKS (2026-11-15). Earlier: G0 PASS WITH RISKS (2026-11-15; first review FAIL on origin B1, fixed in T-0.3a)
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

| T-2.5 | in progress | | G2 follow-ups: content bbox, flat coverage test, simplification test, empty tiles |

Status values: todo, in progress, review, retry (n/2), blocked, done.

## Environment notes (dev machine, Windows 11)
- Python 3.12 via `uv` (uv 0.13.8, installed with `pip install --user uv`); system Python 3.14 is not used.
- GNU Make 4.4.1 via winget `ezwinports.make`; shims for `make` and `uv` in `~/bin` (on Git Bash PATH).
- Node v24.12.0, npm 11.6.2, git 2.52.0.
- No GitHub remote yet; `gh` CLI not installed. CI cannot run until the owner creates the repo.

## Carry-over risks from G0
- CI never run (no remote; owner has not yet supplied a GitHub repo URL). First run may trip the anchored GPU-stall filter on Linux (ADR-0012).
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
