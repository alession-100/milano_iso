# T-6.4 budgets on the city (VERIFICATION section 5)

Machine: Windows 11 laptop; browser for the frame rate and the memory session: Google Chrome 157.0.8103.79 (installed), headed, window 1280 x 720 (CSS pixels, device pixel ratio 1, renderer pixel ratio 1); GPU as WebGL reports it: `ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x0000A7A0) Direct3D11 vs_5_0 ps_5_0, D3D11)`, ANGLE backend `gl=egl-angle,angle=d3d11` (CDP `SystemInfo.getInfo`, in every `bench_*.json`). The machine also has an NVIDIA RTX 4000 Ada Laptop GPU; the browser used the Intel one. Final build: `npm run build:prod` of commit 6826978 plus the report commit, served by `npm run serve -- --port 4191`. Tileset: `tiles/city/` (the default).

"Display cap": the frame rate of a `requestAnimationFrame` loop cannot exceed the refresh rate of the display. The same machine capped at 119.7 fps in one session and at 101.7 fps in the next (the pilot bench, which costs 0.67 ms of CPU per frame, also gives 101.5 in the second session), so the means below are the display, not the app. The "unlimited" runs add `--disable-frame-rate-limit --disable-gpu-vsync` and show what the app could do.

| Metric (target) | Result | How measured (command) |
|---|---|---|
| Frame rate, city, desktop (>= 60 fps mean, real GPU) | **101.7 and 101.6 fps mean** over the 80 s city path (every segment 101.1 to 102.0); 1 % low 88.5 fps in both runs; without the display cap 225.9 and 227.2 fps mean (1 % low 42.5 and 43.7); CPU time of the render call 1.48 ms mean. Before the tuning (earlier session, display at 120): 119.7 and 119.4 mean, unlimited 205.4 and 207.1 | `node web/scripts/bench-city.mjs --port 4191 --out reports/artifacts/T-6.4/bench_after_desktop_run1.json` (and `_run2`; `--unlimited` for the others) |
| Frame rate, Pixel 7a (>= 30 fps) | not measured here: the owner measures it (steps in `reports/R-6.4.md`). Same bench in a 412 x 915 window on this GPU: 98.6 fps mean (display cap), 257 draw calls at most | `node web/scripts/bench-city.mjs --port 4191 --width 412 --height 915` |
| Initial payload (<= 3,000,000 B, brotli, until the default view is drawn, prefetch excluded; ADR-0038) | 1,492,540 B (1280 x 720, level 0; runs 1,351,921 / 1,492,540 / 1,372,339) and 2,548,605 B (412 x 915, level 1; runs 2,388,623 / 2,548,605 / 2,683,220) | `node web/scripts/measure-payload.mjs --label br --port 4191 --only initial --runs 3 --out reports/artifacts/T-6.4/payload` (details in `payload/measurements.md`) |
| JS bundle (<= 600 KB gzip) | 183,715 B gzip-9 (`index-*.js`, 709,389 B raw, 150,983 B brotli); the lazy `debug-*.js` chunk 2,763 B | same command (table "JS bundle") |
| Tile size (<= 250 KB gzip each) | largest .glb 246,979 B gzip-9 (`L3_1_-1`), of 4,349 tiles; per-level limit 250,000 B in `tiles.json` | `python` over `web/public/tiles/city/shards/*.json` (`glb.gzip9_bytes`), values written by the pipeline |
| Draw calls, typical view (<= 300) | **maximum 290 over the city path, in both runs** (at level 2, in the zoom 2,400 to 4,000 m segment); per segment 164 to 290; 257 in the 412 x 915 window (was 318 before ADR-0039); the pilot path 99 | `bench_after_desktop_run1.json`, `_run2.json`, `bench_after_phone412x915.json`, `bench_pilot.json` |
| Time to first render (<= 3 s, fast connection) | 481 to 1,054 ms over 6 runs (1280 x 720: 1,054 / 922 / 762; 412 x 915: 597 / 481 / 534), view complete 1.26 to 1.44 s; network 40 Mbit/s, 20 ms latency, cold cache. Software GL (SwiftShader) in headless Chromium 159, so an upper bound for a GPU browser | same payload command |
| Memory, 5-minute pan and zoom (G6) | passes twice: heap +1.05 % and +1.64 % (last minute against minute 2); see `memory_summary.md` | `npm --prefix web run memory -- --port 4191 --out reports/artifacts/T-6.4/memory_run1.json` (and `_run2`) |

Segments of the city path (run 1; run 2 differs by at most 0.2 fps and 4.7 fps of 1 % low; draw calls and triangles are identical; per-segment tables for every run are in the `bench_*.json` files):

| segment | fps mean | 1 % low | max draw calls | max triangles | level drawn |
|---|---:|---:|---:|---:|---|
| L0 pan at 600 m | 101.8 | 90.9 | 207 | 632,465 | 0 |
| zoom 600-1,200 m | 102.0 | 90.2 | 188 | 1,068,971 | 0 to 1 |
| zoom 1,200-2,400 m | 101.2 | 76.6 | 254 | 1,632,030 | 1 to 2 |
| zoom 2,400-4,000 m | 101.8 | 88.5 | 290 | 2,032,826 | 2 to 3 |
| pan at 4,000 m across the city | 101.8 | 90.9 | 164 | 843,197 | 3 |
| pan at 4,000 m, other diagonal | 101.9 | 90.3 | 179 | 893,473 | 3 |
| zoom in 4,000-600 m | 101.1 | 81.5 | 202 | 1,183,213 | 1 to 3 |
