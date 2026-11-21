# T-6.5 budgets on the city (VERIFICATION section 5), after the merged coarse meshes and the draw-call cap

This replaces the draw-call row of `reports/artifacts/T-6.4/budgets.md`, which said "within 300" from one bench path and from views that never held the level-2 range. The claim "at most 300 draw calls" now rests on the settled-view sweep (`sweep.md`), and the bench is the second witness.

Machine: the same Windows 11 laptop as T-6.4. Browser for the frame rate: Google Chrome (installed, channel `chrome`), headed, real GPU as WebGL reports it: `ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x0000A7A0) Direct3D11 vs_5_0 ps_5_0, D3D11)` (in every `bench_*.json`). The display ran at 120 Hz in this session, so the 1280x720 means are the display cap. Build: `npm run build` of the T-6.5 commit, served by `npm run serve -- --dir <dist> --port 4197`. Tileset: `tiles/city/`. Sweep: headless Chromium, software GL (draw calls, triangles and levels do not depend on the GPU).

| Metric (target) | Result | How measured |
|---|---|---|
| Draw calls, every settled view (<= 300), 880 views: 8 windows 360x640 to 2560x1440, widths 300 to 4,000 m, 5 centres, rotation steps 0 and 1 | **0 views over 300; maxima per window 115, 143, 178, 222, 223, 245, 223, 268** (360x640, 412x915, 768x1024, 1280x720, 1366x768, 1440x900, 1920x1080, 2560x1440). Before: 211 views over 300, maxima 256, 266, 351, 457, 460, 501, 460, 685. The budget switch fired on 32 views, at most 1.20 px of error (ADR-0040) | `npm --prefix web run sweep:city -- --port 4197 --out ../reports/artifacts/T-6.5/sweep_after.json --summary ../reports/artifacts/T-6.5/sweep.md` (before: `sweep_before.json`; merge only: `sweep_fix1only.json`) |
| Draw calls, city bench 1280x720 (<= 300) | **maximum 207** in both runs (was 290); per segment 75 to 207 | `node web/scripts/bench-city.mjs --port 4197 --width 1280 --height 720 --out reports/artifacts/T-6.5/bench_1280x720_run1.json` (and `_run2`) |
| Draw calls, city bench 1920x1080 (<= 300) | **maximum 241** in both runs (the reviewer's bench of the unchanged client: 488); per segment 157 to 241 | same, `--width 1920 --height 1080`, `bench_1920x1080_run1.json`, `_run2` |
| Frame rate, city, desktop (>= 60 fps mean, real GPU) | 1280x720: **119.6 and 119.8 fps** mean (1 % low 106.4 and 106.4; the 120 Hz display cap), render CPU 1.99 and 1.98 ms; 1920x1080: **91.9 and 91.4 fps** mean (1 % low 67.1 and 66.2), render CPU 2.83 ms, up to 2,874,340 triangles | the same four bench runs |
| JS bundle (<= 600 KB gzip) | 184,542 B gzip-9 (`index-*.js`, 714,438 B raw; before 182,748 B); lazy `debug-*.js` 6,388 B raw | `gzip -9 -c web/dist/assets/index-*.js \| wc -c` |
| Tile size (<= 250 KB gzip each) | unchanged: no tile file changed (the merge is in the client); largest .glb 246,979 B | T-6.4 `budgets.md` |
| Initial payload (<= 3,000,000 B, brotli) | not re-measured: tile, shard and manifest bytes are the same files as in T-6.4 (1,492,540 B at 1280x720, 2,548,605 B at 412x915); the page's JS grew by 1,794 B gzip | - |
| Level 0 | base tile files byte-identical for the pilot (60 files) and the city (6,278 files); visual baselines unchanged (170 e2e tests pass, no snapshot file changed) | `bash web/scripts/compare-level0.sh` (see `R-6.5.md`) |

Segments of the city bench at 1920x1080 (run 1; run 2 differs by at most 0.5 fps mean, and by 1 call in one segment):

| segment | fps mean | max draw calls | level drawn |
|---|---:|---:|---|
| L0 pan at 600 m | 109.7 | 207 | 0 |
| zoom 600-1,200 m | 100.9 | 206 | 0 to 1 |
| zoom 1,200-2,400 m | 89.1 | 171 | 1 |
| zoom 2,400-4,000 m | 85.0 | 228 | 1 to 2 |
| pan at 4,000 m across the city | 76.6 | 241 | 2 |
| pan at 4,000 m, other diagonal | 82.0 | 217 | 2 |
| zoom in 4,000-600 m | 100.9 | 157 | 0 to 2 |

Segments at 1280x720 (run 1): max draw calls 207, 188, 137, 149, 75, 85, 111; levels 0, 0 to 1, 1 to 2, 2 to 3, 3, 3, 1 to 3; fps 118.8 to 120.0.

What the numbers do not cover: windows wider than 2,560 CSS px; frames while tiles are still loading (the bench passes through those and stays under 300); the phone (Pixel 7a) frame rate, which the owner measures (T-6.4).
