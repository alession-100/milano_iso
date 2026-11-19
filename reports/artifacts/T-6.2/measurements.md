# T-6.2 measurements: the city tileset at five visible widths, three centres, two viewports

Produced by `web/scripts/measure-lod.mjs` on this machine (Windows 11, 20 logical cores, Chromium with SwiftShader software GL, `vite preview` of a production build with the city tileset in `dist/tiles/city/`, built from `make tiles EXTENT=city`). Raw results: `measurements.json`; run log: `measure_run.log`. Every number below is from that output.

## Method
- One fresh browser context per view (30 views). The tile requests (`.glb` and the feature `.json`) are held back until the camera is set, so the bytes and the time are those of this view alone, not of the 600 m start view.
- **Centres** (client metres, x = E - E0, z = -(N - N0)): `origin` (0, 0), the Duomo; `meazza` (-5291, -1529), the middle of the Stadio Meazza footprint (bounds quoted in R-6.1, converted with pyproj); `east4500` (4500, 0). Both other points were checked to be inside the comune boundary (`pts.py` output: `True`).
- **draw calls, triangles**: `renderer.info.render` of the last frame (`window.__milanoIso.render`), read when the draw-call count was equal on three consecutive polls and every visible tile of the level in use was loaded (`pending = 0`, nothing in flight). Shadows are on (the default).
- **tiles drawn per level**: `__milanoIso.tiles.drawnByLevel` (the new test hook; `level`, `mpp`, `pending`, `loadedByLevel` are there too).
- **bytes**: every response of the tile directory counted. `vite preview` does not compress, so "raw" is what was served; "gzip-9" is computed. The `.glb` figure is the gzip-9 recorded by the pipeline in `tiles.json` (Python zlib, the figure the 250 KB budget uses), the feature `.json` figure is Node's zlib. Node's zlib gives about 20% more than the pipeline's for the same `.glb` bytes (for the earlier build of L3_0_0.glb: 511,486 against 422,758 recorded); the column "Node zlib for all" shows that variant so neither number is hidden. Compression headers and caching are T-6.3.
- **time to complete**: from the release of the held tile requests to the stable state above. SwiftShader renders 1280x720 on the CPU, so the desktop times are an upper bound for a GPU browser; they say little about a phone. The page itself, `tiles.json` and the minimap are loaded before the clock starts (`tiles.json` is 2,321,208 bytes, 662,168 gzip; `minimap.svg` 390,352 bytes, 149,048 gzip).
- The pipeline's own gzip figure is used for the budget check below: **no view needs more than 245 draw calls (budget 300); 12 of the 30 views draw at least one tile above 250 KB gzip** (the dense centre at levels 2 and 3, see the last section).

## Table

| viewport | centre | width m | mpp | level | draw calls | triangles | tiles drawn per level | tiles fetched | tile bytes raw KB | tile bytes gzip-9 KB (pipeline zlib for .glb, Node zlib for .json) | largest .glb gzip-9 KB (pipeline) | tile bytes gzip-9 KB (Node zlib for all) | all bytes since load gzip-9 KB (Node zlib; adds tiles.json and minimap.svg) | time to complete s |
|---|---|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 1280x720 | origin | 300 | 0.23 | 0 | 92 | 315676 | {0:38} | 38 | 5942 | 2385 | 98 | 2842 | 3581 | 2.0 |
| 1280x720 | origin | 600 | 0.47 | 0 | 187 | 607702 | {0:54} | 54 | 8119 | 3241 | 98 | 3863 | 4601 | 6.2 |
| 1280x720 | origin | 1200 | 0.94 | 1 | 126 | 1055221 | {1:33} | 37 | 9340 | 4000 | 196 | 4822 | 5560 | 4.6 |
| 1280x720 | origin | 2400 | 1.88 | 2 | 124 | 1739271 | {2:24} | 28 | 16101 | 6428 | 390 | 7810 | 8548 | 4.4 |
| 1280x720 | origin | 4000 | 3.13 | 2 | 229 | 2641655 | {2:41} | 45 | 23654 | 9237 | 390 | 11218 | 11957 | 5.7 |
| 1280x720 | meazza | 300 | 0.23 | 0 | 66 | 69687 | {0:36} | 36 | 2529 | 859 | 89 | 986 | 1724 | 4.8 |
| 1280x720 | meazza | 600 | 0.47 | 0 | 143 | 146126 | {0:51} | 51 | 3269 | 1102 | 89 | 1262 | 2001 | 6.3 |
| 1280x720 | meazza | 1200 | 0.94 | 1 | 129 | 245755 | {1:32} | 36 | 3333 | 1275 | 89 | 1496 | 2235 | 8.0 |
| 1280x720 | meazza | 2400 | 1.88 | 2 | 113 | 512702 | {2:24} | 28 | 6204 | 2232 | 201 | 2667 | 3405 | 6.6 |
| 1280x720 | meazza | 4000 | 3.13 | 2 | 245 | 1195021 | {2:45} | 49 | 12433 | 4537 | 240 | 5436 | 6174 | 6.6 |
| 1280x720 | east4500 | 300 | 0.23 | 0 | 54 | 70431 | {0:35} | 35 | 2165 | 636 | 89 | 720 | 1458 | 7.1 |
| 1280x720 | east4500 | 600 | 0.47 | 0 | 141 | 145953 | {0:49} | 49 | 2805 | 824 | 89 | 928 | 1667 | 5.6 |
| 1280x720 | east4500 | 1200 | 0.94 | 1 | 116 | 150602 | {1:28} | 32 | 2635 | 1002 | 94 | 1170 | 1909 | 7.2 |
| 1280x720 | east4500 | 2400 | 1.88 | 2 | 112 | 395294 | {2:18} | 22 | 4437 | 1647 | 280 | 1974 | 2712 | 5.1 |
| 1280x720 | east4500 | 4000 | 3.13 | 2 | 211 | 1221498 | {2:33} | 37 | 11068 | 4273 | 390 | 5164 | 5903 | 5.5 |
| 412x915 | origin | 300 | 0.73 | 1 | 69 | 611707 | {1:21} | 21 | 5777 | 2509 | 196 | 3029 | 3767 | 3.8 |
| 412x915 | origin | 600 | 1.46 | 1 | 131 | 1159412 | {1:37} | 37 | 9463 | 4052 | 196 | 4887 | 5625 | 1.6 |
| 412x915 | origin | 1200 | 2.91 | 2 | 123 | 1676664 | {2:28} | 32 | 16643 | 6664 | 390 | 8090 | 8828 | 1.8 |
| 412x915 | origin | 2400 | 5.83 | 3 | 100 | 1118420 | {3:27} | 31 | 14221 | 5324 | 434 | 6353 | 7091 | 1.6 |
| 412x915 | origin | 4000 | 9.71 | 3 | 172 | 1362879 | {3:32} | 36 | 14587 | 5450 | 434 | 6494 | 7233 | 1.7 |
| 412x915 | meazza | 300 | 0.73 | 1 | 52 | 137635 | {1:23} | 23 | 3050 | 1239 | 196 | 1475 | 2214 | 0.8 |
| 412x915 | meazza | 600 | 1.46 | 1 | 130 | 272139 | {1:40} | 40 | 4543 | 1808 | 196 | 2145 | 2884 | 1.2 |
| 412x915 | meazza | 1200 | 2.91 | 2 | 131 | 644721 | {2:27} | 31 | 8004 | 2977 | 216 | 3572 | 4311 | 1.0 |
| 412x915 | meazza | 2400 | 5.83 | 3 | 85 | 793959 | {3:21} | 25 | 9488 | 3535 | 378 | 4204 | 4942 | 1.1 |
| 412x915 | meazza | 4000 | 9.71 | 3 | 169 | 961284 | {3:31} | 35 | 11278 | 4150 | 378 | 4912 | 5650 | 1.5 |
| 412x915 | east4500 | 300 | 0.73 | 1 | 59 | 61919 | {1:22} | 22 | 2451 | 1006 | 196 | 1192 | 1931 | 0.7 |
| 412x915 | east4500 | 600 | 1.46 | 1 | 101 | 172186 | {1:32} | 32 | 3416 | 1393 | 196 | 1658 | 2396 | 1.0 |
| 412x915 | east4500 | 1200 | 2.91 | 2 | 103 | 667487 | {2:17} | 21 | 7065 | 2772 | 336 | 3360 | 4099 | 1.1 |
| 412x915 | east4500 | 2400 | 5.83 | 3 | 75 | 659326 | {3:14} | 18 | 7639 | 2920 | 434 | 3494 | 4232 | 0.8 |
| 412x915 | east4500 | 4000 | 9.71 | 3 | 136 | 1159743 | {3:26} | 30 | 12579 | 4739 | 434 | 5657 | 6395 | 1.4 |

## Tiles above the 250 KB gzip budget in a measured view (pipeline gzip-9 of the .glb)
Level 1 never exceeds it (largest 200,465 B, the whole city). Levels 2 and 3 do in the dense centre: 13 of 228 tiles at level 2 (largest 399,050 B) and 8 of 68 at level 3 (largest 444,736 B), see `reports/artifacts/T-6.1/city/T-2.3/lod_summary.md`. Views that draw one: `1280x720 origin 2400/4000`, `1280x720 east4500 2400/4000`, `412x915 origin 1200/2400/4000`, `412x915 meazza 2400/4000`, `412x915 east4500 1200/2400/4000` (column "largest .glb gzip-9 KB" above). The budget is reported, not lowered, as the card says.

## Before the thresholds were set (an earlier run of the same script, thresholds 1 / 2 / 5 m; its output file was overwritten, the numbers were printed to the console)
Level 0 was used up to 1 m per pixel, so at 1280x720 the views at 1200 m drew **448** (origin), **368** (meazza) and **369** (east4500) calls, and level 1 at 2400 m drew 325, 285 and 276 calls at the three centres. That is why level 1 starts at 0.5 m per pixel and level 2 at 1.5 m per pixel (ADR-0037).
