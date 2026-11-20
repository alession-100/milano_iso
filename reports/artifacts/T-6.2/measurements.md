# T-6.2 measurements: the city tileset at five visible widths, three centres, two viewports

Produced by `web/scripts/measure-lod.mjs` on this machine (Windows 11, 20 logical cores, Chromium with SwiftShader software GL, `vite preview` of a production build with the city tileset in `dist/tiles/city/`, built from `make tiles EXTENT=city`). Raw results: `measurements.json`; run log: `measure_run.log`. Every number below is from that output.

## Method
- One fresh browser context per view (30 views). The tile requests (`.glb` and the feature `.json`) are held back until the camera is set, so the bytes and the time are those of this view alone, not of the 600 m start view.
- **Centres** (client metres, x = E - E0, z = -(N - N0)): `origin` (0, 0), the Duomo; `meazza` (-5291, -1529), the middle of the Stadio Meazza footprint (bounds quoted in R-6.1, converted with pyproj); `east4500` (4500, 0). Both other points were checked to be inside the comune boundary (`pts.py` output: `True`).
- **draw calls, triangles**: `renderer.info.render` of the last frame (`window.__milanoIso.render`), read when the draw-call count was equal on three consecutive polls and every visible tile of the level in use was loaded (`pending = 0`, nothing in flight). Shadows are on (the default).
- **tiles drawn per level**: `__milanoIso.tiles.drawnByLevel` (the new test hook; `level`, `mpp`, `pending`, `loadedByLevel` are there too).
- **bytes**: every response of the tile directory counted. `vite preview` does not compress, so "raw" is what was served; "gzip-9" is computed. The `.glb` figure is the gzip-9 recorded by the pipeline in `tiles.json` (Python zlib, the figure the 250 KB budget uses), the feature `.json` figure is Node's zlib. Node's zlib gives about 20% more than the pipeline's for the same `.glb` bytes (for an earlier build of L3_0_0.glb: 511,486 against 422,758 recorded); the column "Node zlib for all" shows that variant so neither number is hidden. Compression headers and caching are T-6.3.
- **time to complete**: from the release of the held tile requests to the stable state above. SwiftShader renders 1280x720 on the CPU, so the desktop times are an upper bound for a GPU browser; they say little about a phone. The page itself, `tiles.json` and the minimap are loaded before the clock starts (`tiles.json` is 2,364,416 bytes, 674,597 gzip; `minimap.svg` 390,352 bytes, 149,048 gzip).
- The pipeline's own gzip figure is used for the budget check below: **no view needs more than 293 draw calls (budget 300), and no tile of any level is above 250 KB gzip (largest fetched: 246,979 B)**. Coarse tiles over 250 KB are split in four (quadtree) at build time, ids `L<n>_<i>_<j>q<digits>`.

## Table

| viewport | centre | width m | mpp | level | draw calls | triangles | tiles drawn per level | tiles fetched | tile bytes raw KB | tile bytes gzip-9 KB (pipeline zlib for .glb, Node zlib for .json) | largest .glb gzip-9 KB (pipeline) | tile bytes gzip-9 KB (Node zlib for all) | all bytes since load gzip-9 KB (Node zlib; adds tiles.json and minimap.svg) | time to complete s |
|---|---|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 1280x720 | origin | 300 | 0.23 | 0 | 92 | 315676 | {0:38} | 38 | 5942 | 2385 | 98 | 2842 | 3592 | 1.5 |
| 1280x720 | origin | 600 | 0.47 | 0 | 187 | 607702 | {0:54} | 54 | 8119 | 3241 | 98 | 3863 | 4612 | 6.4 |
| 1280x720 | origin | 1200 | 0.94 | 1 | 126 | 1055221 | {1:33} | 37 | 9340 | 4000 | 196 | 4822 | 5571 | 5.1 |
| 1280x720 | origin | 2400 | 1.88 | 2 | 254 | 1628619 | {2:48} | 52 | 15042 | 5998 | 240 | 7250 | 8000 | 5.0 |
| 1280x720 | origin | 4000 | 3.13 | 3 | 168 | 1537540 | {3:35} | 39 | 13595 | 5452 | 241 | 6584 | 7334 | 5.4 |
| 1280x720 | meazza | 300 | 0.23 | 0 | 66 | 69687 | {0:36} | 36 | 2529 | 859 | 89 | 986 | 1736 | 4.8 |
| 1280x720 | meazza | 600 | 0.47 | 0 | 143 | 146126 | {0:51} | 51 | 3269 | 1102 | 89 | 1262 | 2012 | 6.7 |
| 1280x720 | meazza | 1200 | 0.94 | 1 | 129 | 245755 | {1:32} | 36 | 3333 | 1275 | 89 | 1496 | 2246 | 7.7 |
| 1280x720 | meazza | 2400 | 1.88 | 2 | 113 | 512702 | {2:24} | 28 | 6204 | 2232 | 201 | 2667 | 3416 | 5.1 |
| 1280x720 | meazza | 4000 | 3.13 | 3 | 121 | 691413 | {3:23} | 27 | 7193 | 2714 | 173 | 3229 | 3979 | 6.2 |
| 1280x720 | east4500 | 300 | 0.23 | 0 | 54 | 70431 | {0:35} | 35 | 2165 | 636 | 89 | 720 | 1469 | 4.7 |
| 1280x720 | east4500 | 600 | 0.47 | 0 | 141 | 145953 | {0:49} | 49 | 2805 | 824 | 89 | 928 | 1678 | 5.1 |
| 1280x720 | east4500 | 1200 | 0.94 | 1 | 116 | 150602 | {1:28} | 32 | 2635 | 1002 | 94 | 1170 | 1920 | 6.5 |
| 1280x720 | east4500 | 2400 | 1.88 | 2 | 121 | 370154 | {2:20} | 24 | 4251 | 1575 | 158 | 1882 | 2631 | 5.4 |
| 1280x720 | east4500 | 4000 | 3.13 | 3 | 100 | 715741 | {3:20} | 24 | 6754 | 2662 | 241 | 3204 | 3953 | 4.7 |
| 412x915 | origin | 300 | 0.73 | 1 | 69 | 611707 | {1:21} | 21 | 5777 | 2509 | 196 | 3029 | 3779 | 1.1 |
| 412x915 | origin | 600 | 1.46 | 1 | 131 | 1159412 | {1:37} | 37 | 9463 | 4052 | 196 | 4887 | 5636 | 1.5 |
| 412x915 | origin | 1200 | 2.91 | 2 | 210 | 1564804 | {2:46} | 50 | 15618 | 6237 | 240 | 7542 | 8292 | 2.0 |
| 412x915 | origin | 2400 | 5.83 | 3 | 195 | 1640142 | {3:48} | 52 | 17403 | 6911 | 241 | 8314 | 9064 | 2.0 |
| 412x915 | origin | 4000 | 9.71 | 3 | 293 | 2082590 | {3:61} | 65 | 19819 | 7839 | 241 | 9424 | 10174 | 2.3 |
| 412x915 | meazza | 300 | 0.73 | 1 | 52 | 137635 | {1:23} | 23 | 3050 | 1239 | 196 | 1475 | 2225 | 0.7 |
| 412x915 | meazza | 600 | 1.46 | 1 | 130 | 272139 | {1:40} | 40 | 4543 | 1808 | 196 | 2145 | 2895 | 1.1 |
| 412x915 | meazza | 1200 | 2.91 | 2 | 131 | 644721 | {2:27} | 31 | 8004 | 2977 | 216 | 3572 | 4322 | 1.1 |
| 412x915 | meazza | 2400 | 5.83 | 3 | 128 | 917028 | {3:30} | 34 | 9944 | 3844 | 233 | 4599 | 5349 | 1.3 |
| 412x915 | meazza | 4000 | 9.71 | 3 | 244 | 1417572 | {3:46} | 50 | 14212 | 5493 | 233 | 6564 | 7314 | 1.7 |
| 412x915 | east4500 | 300 | 0.73 | 1 | 59 | 61919 | {1:22} | 22 | 2451 | 1006 | 196 | 1192 | 1942 | 0.7 |
| 412x915 | east4500 | 600 | 1.46 | 1 | 101 | 172186 | {1:32} | 32 | 3416 | 1393 | 196 | 1658 | 2407 | 0.9 |
| 412x915 | east4500 | 1200 | 2.91 | 2 | 129 | 533432 | {2:25} | 29 | 6388 | 2498 | 196 | 3013 | 3762 | 0.9 |
| 412x915 | east4500 | 2400 | 5.83 | 3 | 137 | 926914 | {3:26} | 30 | 9166 | 3666 | 241 | 4421 | 5170 | 1.1 |
| 412x915 | east4500 | 4000 | 9.71 | 3 | 235 | 1574633 | {3:47} | 51 | 15097 | 5969 | 241 | 7180 | 7930 | 1.8 |

## Tiles above the 250 KB gzip budget
None, at any level (pipeline gzip-9 of the .glb; the 250,000 B limit is built in as `max_tile_gzip_bytes` of each level): level 1 largest 200,465 B (836 tiles, none split), level 2 largest 245,977 B (267 tiles, 13 parents split into 52 quarters), level 3 largest 246,979 B (107 tiles, 13 parents split into 52 half-size tiles). See `reports/artifacts/T-6.1/city/T-2.3/lod_summary.md` and ADR-0037.

## How the thresholds were reached (earlier runs of the same script; their output files were overwritten, the numbers were printed to the console)
- Thresholds 1 / 2 / 5 m, no split: level 0 was used up to 1 m per pixel, so at 1280x720 the views at 1200 m drew **448** (origin), **368** (meazza) and **369** (east4500) calls, and level 1 at 2400 m drew 325, 285 and 276. Hence level 1 from 0.5 m and level 2 from 1.5 m per pixel.
- Thresholds 0.5 / 1.5 / 5 m, with the quadtree split: every view fitted except 1280x720 origin 4000 m (level 2, 396 draw calls: the split adds tiles). Hence level 3 from 3 m per pixel (so that view uses level 3: 168 calls).
