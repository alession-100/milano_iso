# T-7.2 rebuild log: README followed from a fresh clone

- Clone: `git clone -q --branch t-7.2 C:/Users/studi/Documents/milano-iso milano-iso` into a new directory outside the repository (task scratch space), from the local repository; nothing was pushed.
- Machine: Windows 11, 20 logical cores, Git Bash; Node v24.12.0, npm 11.6.2, uv 0.13.8, GNU Make 4.4.1 (Python 3.12.16 installed by uv).
- First pass on commit 74d2d22 (README draft). The final web commit was pulled afterwards (`git pull`), the unit tests and `npm run build:prod` re-run and the screenshots retaken on it (entries near the end of the log). The full e2e run in the clone (179 passed) was on 74d2d22; the final commit's e2e runs are in the report (worktree).
- Extent: pilot. **Not done: `make data` (no raw data was downloaded, as instructed: the processed data came from the read-only `t66data` directory) and every city step except the file copy.** The city leg stopped at `make tiles EXTENT=city`: it needs `data/raw/comune_boundary/confine.geojson`, and `make data-boundary` failed twice (HTTP 502 Bad Gateway from dati.comune.milano.it, then a curl timeout at 08:01 UTC). The portal was unreachable during the task, so the README steps for the city are unverified.
- Server ports: dev server and `npm run serve` on 4218 only; e2e on 4217. Each server was stopped by me after use (nothing listens on 4217 or 4218 at the end).
- Below: the last 12 lines of each command, as recorded by a step script. `<clone>` stands for the scratch clone directory.

## README findings (fixed in README.md)
1. `make tiles EXTENT=city` needs the raw boundary from `make data-boundary` (not only the processed GeoPackage): added to the README note.
2. `make` steps of a non-pilot extent rewrite the tracked file `reports/artifacts/T-6.1/measurements.json` (the clone became dirty and the build id showed `+local`): the README now says so (`MEASURE=` turns it off).
3. `npx playwright install chromium` must run in `web/`: the README says so (the browser was already installed; the command returned at once).
4. The default tileset is the city; with only the pilot built, open `?tiles=tiles/pilot/`: already in the README, confirmed.
5. The pilot tiles built in the clone by `make tiles` are byte-identical to the reference tiles in `t66data` (`diff -r` empty, 104 files).

## Log

### $ git clone -q --branch t-7.2 C:/Users/studi/Documents/milano-iso milano-iso && cd milano-iso && git log --oneline -1 && git status --short | wc -l
- cwd: /c/Users/studi/AppData/Local/Temp/claude/d352876ecdc285bf/a1075ba5-a783-49d4-a1f1-5c7786945a17/scratchpad/rebuild
- wall time: 12 s, exit code 0
```
74d2d22 T-7.2: README draft and licence evidence extracts
0
```

### $ make setup
- cwd: /c/Users/studi/AppData/Local/Temp/claude/d352876ecdc285bf/a1075ba5-a783-49d4-a1f1-5c7786945a17/scratchpad/rebuild/milano-iso
- wall time: 27 s, exit code 0
```
41 packages are looking for funding
  run `npm fund` for details

7 moderate severity vulnerabilities

To address issues that do not require attention, run:
  npm audit fix

To address all issues, run:
  npm audit fix --force

Run `npm audit` for details.
```

### $ mkdir -p data/processed && cp C:/Users/studi/Documents/milano-iso/.claude/worktrees/t66data/processed/pilot.gpkg data/processed/ && ls -l data/processed && du -sh data
- cwd: /c/Users/studi/AppData/Local/Temp/claude/d352876ecdc285bf/a1075ba5-a783-49d4-a1f1-5c7786945a17/scratchpad/rebuild/milano-iso
- wall time: 0 s, exit code 0
```
total 7716
-rw-r--r-- 1 studi 197609 7901184 Nov 24 08:37 pilot.gpkg
7.6M	data
```

### $ make tiles
- cwd: /c/Users/studi/AppData/Local/Temp/claude/d352876ecdc285bf/a1075ba5-a783-49d4-a1f1-5c7786945a17/scratchpad/rebuild/milano-iso
- wall time: 19 s, exit code 0
```
uv run python  -m milano_iso.tiles.export --extent pilot
tiles: -3_-3, -3_-2, -3_-1, -3_0, -3_1, -2_-3, -2_-2, -2_-1, -2_0, -2_1, -2_2, -1_-3, -1_-2, -1_-1, -1_0, -1_1, -1_2, 0_-2, 0_-1, 0_0, 0_1, 0_2, 1_-2, 1_-1, 1_0, 1_1, 1_2, 2_-2, 2_-1, 2_0
checks: {'buildings_total_in_layer': 240, 'buildings_rendered': 233, 'buildings_in_tiles': 233, 'buildings_count_matches': True, 'landmark_details_in_tiles': 122, 'landmark_details_built': 122, 'trees_in_layer': 360, 'trees_in_tiles': 360, 'trees_count_matches': True, 'buildings_in_two_tiles': [], 'rendered_volumes_without_rendered_building': 0, 'tiles_outside_pilot_aoi': ['-1_-3', '-1_2', '-2_-3', '-2_2', '-3_-1', '-3_-2', '-3_-3', '-3_0', '-3_1', '0_2', '1_2', '2_-1', '2_-2', '2_0']}
make tiles: done (tiles-export)
```

### $ diff -r data/tiles/pilot C:/Users/studi/Documents/milano-iso/.claude/worktrees/t66data/tiles/pilot && echo IDENTICAL; ls data/tiles/pilot | wc -l; du -sh data/tiles/pilot
- cwd: /c/Users/studi/AppData/Local/Temp/claude/d352876ecdc285bf/a1075ba5-a783-49d4-a1f1-5c7786945a17/scratchpad/rebuild/milano-iso
- wall time: 1 s, exit code 0
```
IDENTICAL
104
6.8M	data/tiles/pilot
```

### $ make web-tiles EXTENT=pilot && du -sh web/public/tiles/pilot
- cwd: /c/Users/studi/AppData/Local/Temp/claude/d352876ecdc285bf/a1075ba5-a783-49d4-a1f1-5c7786945a17/scratchpad/rebuild/milano-iso
- wall time: 1 s, exit code 0
```
test -f "data/tiles/pilot/tiles.json" || (echo "no tiles in data/tiles/pilot; run make tiles EXTENT=pilot" && exit 1)
mkdir -p web/public/tiles/pilot
rm -rf web/public/tiles/pilot/shards
cp -rf "data"/tiles/pilot/. web/public/tiles/pilot/
web-tiles: copied data/tiles/pilot to web/public/tiles/pilot
6.8M	web/public/tiles/pilot
```

### $ npm --prefix web run typecheck
- cwd: /c/Users/studi/AppData/Local/Temp/claude/d352876ecdc285bf/a1075ba5-a783-49d4-a1f1-5c7786945a17/scratchpad/rebuild/milano-iso
- wall time: 7 s, exit code 0
```

> milano-iso-web@0.1.0 typecheck
> tsc --noEmit
```

### $ npm --prefix web run lint
- cwd: /c/Users/studi/AppData/Local/Temp/claude/d352876ecdc285bf/a1075ba5-a783-49d4-a1f1-5c7786945a17/scratchpad/rebuild/milano-iso
- wall time: 13 s, exit code 0
```

> milano-iso-web@0.1.0 lint
> eslint .
```

### $ npm --prefix web test
- cwd: /c/Users/studi/AppData/Local/Temp/claude/d352876ecdc285bf/a1075ba5-a783-49d4-a1f1-5c7786945a17/scratchpad/rebuild/milano-iso
- wall time: 11 s, exit code 0
```

> milano-iso-web@0.1.0 test
> vitest run


 RUN  v5.1.0 <clone>/web


 Test Files  30 passed (30)
      Tests  322 passed (322)
   Start at  08:38:11
   Duration  9.20s (tests 52%, transform 31%, import 14%, worker 2%)
```

### $ npm --prefix web run build
- cwd: /c/Users/studi/AppData/Local/Temp/claude/d352876ecdc285bf/a1075ba5-a783-49d4-a1f1-5c7786945a17/scratchpad/rebuild/milano-iso
- wall time: 2 s, exit code 0
```
rendering chunks...
computing gzip size...
dist/index.html                  7.47 kB │ gzip:   2.21 kB
dist/assets/debug-DI1qajM2.js    6.38 kB │ gzip:   2.76 kB
dist/assets/index-gG-oi2N2.js  722.09 kB │ gzip: 190.12 kB

[33m[plugin builtin:vite-reporter] 
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rolldownOptions.output.codeSplitting to improve chunking: https://rolldown.rs/reference/OutputOptions.codeSplitting
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.[39m
[32m✓ built in 465ms[39m
```

### $ npm --prefix web run build:prod
- cwd: /c/Users/studi/AppData/Local/Temp/claude/d352876ecdc285bf/a1075ba5-a783-49d4-a1f1-5c7786945a17/scratchpad/rebuild/milano-iso
- wall time: 19 s, exit code 0
```
computing gzip size...
dist/index.html                  7.47 kB │ gzip:   2.21 kB
dist/assets/debug-DI1qajM2.js    6.38 kB │ gzip:   2.76 kB
dist/assets/index-gG-oi2N2.js  722.09 kB │ gzip: 190.12 kB

[33m[plugin builtin:vite-reporter] 
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rolldownOptions.output.codeSplitting to improve chunking: https://rolldown.rs/reference/OutputOptions.codeSplitting
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.[39m
[32m✓ built in 482ms[39m
precompress C:\Users\studi\AppData\Local\Temp\claude\d352876ecdc285bf\a1075ba5-a783-49d4-a1f1-5c7786945a17\scratchpad\rebuild\milano-iso\web\dist: 122 files, raw 7622783 B, brotli 2110078 B, gzip 3788807 B
```

### $ make test 2>&1 | grep -E 'passed|failed|error|Tests|Test Files|All checks' 
- cwd: /c/Users/studi/AppData/Local/Temp/claude/d352876ecdc285bf/a1075ba5-a783-49d4-a1f1-5c7786945a17/scratchpad/rebuild/milano-iso
- wall time: 64 s, exit code 0
```
All checks passed!
tests/pipeline/test_glb.py::test_quantised_roundtrip_header_alignment_extension_and_error PASSED [ 25%]
tests/pipeline/test_glb.py::test_dequantise_helper_matches_error_bound PASSED [ 26%]
tests/pipeline/test_osm_extract.py::test_failed_area_assembly_listed PASSED [ 68%]
tests/pipeline/test_tiles_index.py::test_a_landmark_id_missing_from_the_yaml_is_an_error PASSED [ 77%]
==================== 303 passed, 150 deselected in 40.62s =====================
 Test Files  30 passed (30)
      Tests  322 passed (322)
```

### $ npx --prefix web playwright install chromium
- cwd: /c/Users/studi/AppData/Local/Temp/claude/d352876ecdc285bf/a1075ba5-a783-49d4-a1f1-5c7786945a17/scratchpad/rebuild/milano-iso
- wall time: 2 s, exit code 0
```

```

### $ E2E_PORT=4217 npm --prefix web run e2e 2>&1 | grep -vE '^  ok' | tail -8
- cwd: /c/Users/studi/AppData/Local/Temp/claude/d352876ecdc285bf/a1075ba5-a783-49d4-a1f1-5c7786945a17/scratchpad/rebuild/milano-iso
- wall time: 388 s, exit code 0
```
> milano-iso-web@0.1.0 e2e
> playwright test


Running 179 tests using 10 workers


  179 passed (6.4m)
```

### $ npm --prefix web run dev -- --port 4218 --strictPort --host 127.0.0.1   (then curl; stopped afterwards)
- wall time: not measured (started in the background, stopped after the checks), exit code: killed by me (the dev server runs until stopped)
```
VITE v8.3.8  ready in 259 ms   Local: http://127.0.0.1:4218/
curl /                          -> 200
curl /tiles/pilot/tiles.json    -> 200, 7222 bytes
```

### $ npm --prefix web run serve -- --port 4218   (then curl and a Chromium capture; stopped afterwards)
- wall time: not measured (runs until stopped)
```
serving .../web/dist on http://127.0.0.1:4218/
curl -I -H "Accept-Encoding: br" /                          -> 200, Content-Encoding: br, Cache-Control: no-cache, Vary: Accept-Encoding
curl -I -H "Accept-Encoding: br" /tiles/pilot/tiles.json    -> 200, Content-Encoding: br, Cache-Control: no-cache
node web/scripts/capture-t72.mjs (Chromium on http://127.0.0.1:4218/?tiles=tiles/pilot/): 9 screenshots, no console problems (only the ADR-0012 ReadPixels warning)
```

### $ cp C:/Users/studi/Documents/milano-iso/.claude/worktrees/t66data/processed/city.gpkg data/processed/ && du -sh data/processed
- cwd: /c/Users/studi/AppData/Local/Temp/claude/d352876ecdc285bf/a1075ba5-a783-49d4-a1f1-5c7786945a17/scratchpad/rebuild/milano-iso
- wall time: 0 s, exit code 0
```
380M	data/processed
```

### $ make tiles EXTENT=city
- cwd: /c/Users/studi/AppData/Local/Temp/claude/d352876ecdc285bf/a1075ba5-a783-49d4-a1f1-5c7786945a17/scratchpad/rebuild/milano-iso
- wall time: 3 s, exit code 2
```
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\Users\studi\AppData\Local\Temp\claude\d352876ecdc285bf\a1075ba5-a783-49d4-a1f1-5c7786945a17\scratchpad\rebuild\milano-iso\.venv\Lib\site-packages\pyogrio\geopandas.py", line 382, in read_dataframe
    result = read_func(
             ^^^^^^^^^^
  File "C:\Users\studi\AppData\Local\Temp\claude\d352876ecdc285bf\a1075ba5-a783-49d4-a1f1-5c7786945a17\scratchpad\rebuild\milano-iso\.venv\Lib\site-packages\pyogrio\raw.py", line 200, in read
    return ogr_read(
           ^^^^^^^^^
  File "pyogrio/_io.pyx", line 1708, in pyogrio._io.ogr_read
  File "pyogrio/_io.pyx", line 290, in pyogrio._io.ogr_open
pyogrio.errors.DataSourceError: C:\Users\studi\AppData\Local\Temp\claude\d352876ecdc285bf\a1075ba5-a783-49d4-a1f1-5c7786945a17\scratchpad\rebuild\milano-iso\data\raw\comune_boundary\confine.geojson: No such file or directory
measure: tiles-export [city] 2.1 s, peak 98 MB, rc 1
make: *** [pipeline/mk/50-tiles.mk:6: tiles-export] Error 1
```

### $ make data-boundary && ls -l data/raw/comune_boundary
- cwd: /c/Users/studi/AppData/Local/Temp/claude/d352876ecdc285bf/a1075ba5-a783-49d4-a1f1-5c7786945a17/scratchpad/rebuild/milano-iso
- wall time: 116 s, exit code 2
```
    response = self.parent.error(
               ^^^^^^^^^^^^^^^^^^
  File "C:\Users\studi\AppData\Roaming\uv\python\cpython-3.12.16-windows-x86_64-none\Lib\urllib\request.py", line 559, in error
    return self._call_chain(*args)
           ^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\Users\studi\AppData\Roaming\uv\python\cpython-3.12.16-windows-x86_64-none\Lib\urllib\request.py", line 492, in _call_chain
    result = func(*args)
             ^^^^^^^^^^^
  File "C:\Users\studi\AppData\Roaming\uv\python\cpython-3.12.16-windows-x86_64-none\Lib\urllib\request.py", line 639, in http_error_default
    raise HTTPError(req.full_url, code, msg, hdrs, fp)
urllib.error.HTTPError: HTTP Error 502: Bad Gateway
make: *** [pipeline/mk/10-osm.mk:7: data-boundary] Error 1
```

### $ make data-boundary && ls -l data/raw/comune_boundary
- cwd: /c/Users/studi/AppData/Local/Temp/claude/d352876ecdc285bf/a1075ba5-a783-49d4-a1f1-5c7786945a17/scratchpad/rebuild/milano-iso
- wall time: 12 s, exit code 2
```
    response = self.parent.error(
               ^^^^^^^^^^^^^^^^^^
  File "C:\Users\studi\AppData\Roaming\uv\python\cpython-3.12.16-windows-x86_64-none\Lib\urllib\request.py", line 559, in error
    return self._call_chain(*args)
           ^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\Users\studi\AppData\Roaming\uv\python\cpython-3.12.16-windows-x86_64-none\Lib\urllib\request.py", line 492, in _call_chain
    result = func(*args)
             ^^^^^^^^^^^
  File "C:\Users\studi\AppData\Roaming\uv\python\cpython-3.12.16-windows-x86_64-none\Lib\urllib\request.py", line 639, in http_error_default
    raise HTTPError(req.full_url, code, msg, hdrs, fp)
urllib.error.HTTPError: HTTP Error 502: Bad Gateway
make: *** [pipeline/mk/10-osm.mk:7: data-boundary] Error 1
```

### $ git pull -q
- cwd: /c/Users/studi/AppData/Local/Temp/claude/d352876ecdc285bf/a1075ba5-a783-49d4-a1f1-5c7786945a17/scratchpad/rebuild/milano-iso
- wall time: 3 s, exit code 0
```

```

### $ git log --oneline -1
- cwd: /c/Users/studi/AppData/Local/Temp/claude/d352876ecdc285bf/a1075ba5-a783-49d4-a1f1-5c7786945a17/scratchpad/rebuild/milano-iso
- wall time: 0 s, exit code 0
```
2c2ae4b T-7.2: regenerate the 22 win32 baselines again for the final attribution line (names the boundary dataset); before = main 23dba91, after, diff, pixel counts
```

### $ npm --prefix web test
- cwd: /c/Users/studi/AppData/Local/Temp/claude/d352876ecdc285bf/a1075ba5-a783-49d4-a1f1-5c7786945a17/scratchpad/rebuild/milano-iso
- wall time: 10 s, exit code 0
```

> milano-iso-web@0.1.0 test
> vitest run


 RUN  v5.1.0 <clone>/web


 Test Files  30 passed (30)
      Tests  322 passed (322)
   Start at  08:59:05
   Duration  8.89s (tests 70%, import 15%, transform 11%, worker 3%)
```

### $ npm --prefix web run build:prod
- cwd: /c/Users/studi/AppData/Local/Temp/claude/d352876ecdc285bf/a1075ba5-a783-49d4-a1f1-5c7786945a17/scratchpad/rebuild/milano-iso
- wall time: 21 s, exit code 0
```
computing gzip size...
dist/index.html                  7.47 kB │ gzip:   2.21 kB
dist/assets/debug-CzYokMmy.js    6.38 kB │ gzip:   2.77 kB
dist/assets/index-5VSsjIYL.js  722.92 kB │ gzip: 190.45 kB

[33m[plugin builtin:vite-reporter] 
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rolldownOptions.output.codeSplitting to improve chunking: https://rolldown.rs/reference/OutputOptions.codeSplitting
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.[39m
[32m✓ built in 570ms[39m
precompress C:\Users\studi\AppData\Local\Temp\claude\d352876ecdc285bf\a1075ba5-a783-49d4-a1f1-5c7786945a17\scratchpad\rebuild\milano-iso\web\dist: 122 files, raw 7623611 B, brotli 2110415 B, gzip 3789149 B
```

### $ npm --prefix web run build:prod
- cwd: /c/Users/studi/AppData/Local/Temp/claude/d352876ecdc285bf/a1075ba5-a783-49d4-a1f1-5c7786945a17/scratchpad/rebuild/milano-iso
- wall time: 20 s, exit code 0
```
computing gzip size...
dist/index.html                  7.47 kB │ gzip:   2.21 kB
dist/assets/debug-C3kIgK-u.js    6.38 kB │ gzip:   2.77 kB
dist/assets/index-DBSDSIz2.js  722.91 kB │ gzip: 190.45 kB

[33m[plugin builtin:vite-reporter] 
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rolldownOptions.output.codeSplitting to improve chunking: https://rolldown.rs/reference/OutputOptions.codeSplitting
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.[39m
[32m✓ built in 558ms[39m
precompress C:\Users\studi\AppData\Local\Temp\claude\d352876ecdc285bf\a1075ba5-a783-49d4-a1f1-5c7786945a17\scratchpad\rebuild\milano-iso\web\dist: 122 files, raw 7623605 B, brotli 2110272 B, gzip 3789144 B
```

