/* global process, console, window, performance, requestAnimationFrame */
// T-6.4 / T-6.7: a scripted pan/zoom session on the served build, sampling memory every SAMPLE_S seconds.
// Not part of the default e2e run: `npm run memory -- --port 4191 --out memory_run1.json [--duration 300]`
// (the server must already run: `npm run serve -- --port 4191`). Headed on the real GPU by default;
// `--software` runs headless with SwiftShader.
//
// What it does: opens `?e2e=1` (the test state: renderer counts; this turns MSAA off, which does not
// change what is held in memory), drives the camera along a fixed path across the whole city and
// through every zoom level (poses are a pure function of elapsed time, in `poseAt` below), with one
// real wheel turn and one real mouse drag in every sampling interval so the controls run too.
//
// Sampling (T-6.7): SAMPLE_S = 7 s, which does not divide the 50 s zoom period (gcd 1), so successive
// samples walk through the whole zoom cycle: after 50 samples (350 s) every 1 s phase has been hit, and
// a 5-minute run (42 samples) hits 42 distinct phases of 50. The widths actually sampled are read from
// the camera and the run is INVALID (fails) unless they reach both ends of the zoom range (rule 0).
// Every sample forces a garbage collection (CDP HeapProfiler.collectGarbage) and then reads:
//   - heap: Runtime.getHeapUsage usedSize; external: backingStorageSize (ArrayBuffer backing stores)
//     and embedderHeapUsedSize (both from the same CDP call, no extra headers needed);
//   - Performance.getMetrics: Nodes, JSEventListeners (browser-side counts);
//   - renderer-process and GPU-process private memory: the pids come from CDP SystemInfo.getProcessInfo
//     (browser session), the bytes from the OS (Windows: Get-Process PrivateMemorySize64; Linux:
//     /proc/<pid>/smaps_rollup Private_Clean+Private_Dirty; other: `ps` RSS, which is not private).
//     Portable to the three systems, but the OS call differs; where it fails the run fails (no silent skip);
//   - renderer.info.memory (geometries, textures) against what the app itself holds (the whole scene
//     graph plus the shadow map, `gpu` in testhook), programs, tiles and shards loaded, DOM node count.
//
// Pass rule (ADR-0043), on the samples after the first minute (warm-up WARMUP_S = 60 s):
//   0. coverage: the sampled widths reach <= 300 m and >= 3,800 m (the 4,000 m phase is sampled);
//   1. heap, external (backing stores) and renderer process memory, each: (a) the median of the last
//      minute exceeds the median of the second minute by at most LIMITS[m].pct per cent AND (b) the least
//      squares slope over all samples after warm-up is at most LIMITS[m].slope MB per minute. The heap
//      is first reduced by the shard catalogue, which is kept by design (ADR-0043): heap minus
//      (shards loaded) x SHARD_MB, SHARD_MB being the measured maximum heap cost of one shard;
//   2. geometries and textures: the renderer holds no more than the app holds (no slack: orphan <= 0; it holds fewer while a mesh is not yet drawn),
//      and never more than the cache allows (largest tile count x largest geometry count of one tile);
//   3. the cache never holds more tiles than its limit (64) or the largest set the view asked for
//      (`tiles.peakWanted`: a wanted tile is never evicted, ADR-0038), whichever is larger;
//   4. DOM nodes are constant after warm-up (min = max); programs constant after warm-up.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { ZOOM_PERIOD_S, analyse } from './memory-analysis.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const port = Number(arg('port', 4191));
const out = arg('out', '');
const durationS = Number(arg('duration', 300));
const SAMPLE_S = Number(arg('sample', 7));
const SHARD_MB = Number(arg('shard-mb', 0.06));
const headless = process.argv.includes('--software');
const tiles = arg('tiles', 'tiles/city/');

const args = ['--enable-precise-memory-info', '--js-flags=--expose-gc'];
if (headless) args.push('--use-angle=swiftshader', '--enable-unsafe-swiftshader');
const browser = await chromium.launch({ headless, ...(headless ? {} : { channel: arg('channel', 'chrome') }), args });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const problems = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
const cdp = await page.context().newCDPSession(page);
await cdp.send('HeapProfiler.enable');
await cdp.send('Performance.enable');
const bcdp = await browser.newBrowserCDPSession();

// Windows: one long-lived PowerShell answers every query (starting one per sample took 20 s on a busy machine).
const PS_LOOP =
  'while (($l = [Console]::In.ReadLine()) -ne $null) { $r = (Get-Process -Id ($l -split ",") -ErrorAction SilentlyContinue | Measure-Object -Property PrivateMemorySize64 -Sum).Sum; Write-Output ("R " + $r) }';
let winHelper = null;
let winBuf = '';
let winWaiting = null;
function winQuery(pids) {
  if (!winHelper) {
    winHelper = spawn('powershell', ['-NoProfile', '-NoLogo', '-Command', PS_LOOP], { stdio: ['pipe', 'pipe', 'ignore'] });
    winHelper.stdout.on('data', (d) => {
      winBuf += d.toString();
      const m = /R (\d*)\r?\n/.exec(winBuf);
      if (m && winWaiting) {
        winBuf = winBuf.slice(m.index + m[0].length);
        const w = winWaiting;
        winWaiting = null;
        w(Number(m[1]));
      }
    });
  }
  return new Promise((resolve) => {
    winWaiting = resolve;
    winHelper.stdin.write(`${pids.join(',')}\n`);
  });
}

/** Private memory in MB of a list of pids, from the OS. */
async function privateMB(pids) {
  if (pids.length === 0) return 0;
  if (process.platform === 'win32') {
    // a process may exit between the CDP call and this one (a short-lived helper): the sum of the rest is used
    const v = await winQuery(pids);
    if (!Number.isFinite(v) || v <= 0) throw new Error('process memory (win32) failed');
    return v / 1048576;
  }
  if (process.platform === 'linux') {
    let kb = 0;
    for (const pid of pids) {
      const t = readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8');
      for (const m of t.matchAll(/^Private_(?:Clean|Dirty):\s+(\d+) kB/gm)) kb += Number(m[1]);
    }
    return kb / 1024;
  }
  const r = spawnSync('ps', ['-o', 'rss=', '-p', pids.join(',')], { encoding: 'utf8' });
  return r.stdout.split(/\r?\n/).reduce((a, l) => a + (Number(l.trim()) || 0), 0) / 1024; // RSS, not private
}
async function processMemory() {
  const { processInfo } = await bcdp.send('SystemInfo.getProcessInfo');
  const of = (type) => processInfo.filter((p) => p.type === type).map((p) => p.id);
  return { rendererMB: await privateMB(of('renderer')), gpuMB: await privateMB(of('GPU')) };
}

await page.goto(`http://127.0.0.1:${port}/?e2e=1&tiles=${tiles}`);
await page.waitForFunction(() => typeof window.__milanoIsoSetView === 'function' && window.__milanoIso?.tiles?.loaded > 0, null, {
  timeout: 120_000,
});

// The path: a Lissajous over the city (x, z in client metres inside the content bounds, taken from the
// camera clamp) and a zoom that sweeps 250 m to 4000 m geometrically with a 50 s period.
// `--closed` (attribution experiment, T-6.7): every component has a period that divides 100 s, so the path
// repeats exactly and the same tiles are visited again and again; the default path does not repeat.
const closed = process.argv.includes('--closed');
await page.evaluate((closedPath) => {
  const t0 = performance.now();
  window.__memSession = { stop: false };
  const poseAt = (s) => {
    const [p1, p2, p3, p4] = closedPath ? [100, 50, 100, 25] : [97, 41, 83, 53];
    const x = 3500 * Math.sin((2 * Math.PI * s) / p1) - 2500 * Math.sin((2 * Math.PI * s) / p2);
    const z = 3000 * Math.cos((2 * Math.PI * s) / p3) + 2500 * Math.sin((2 * Math.PI * s) / p4);
    const u = 0.5 - 0.5 * Math.cos((2 * Math.PI * s) / 50); // 0..1..0
    const width = 250 * Math.pow(4000 / 250, u);
    return [x, z, width];
  };
  const frame = () => {
    if (window.__memSession.stop) return;
    const [x, z, w] = poseAt((performance.now() - t0) / 1000);
    window.__milanoIsoSetView(x, z, w);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}, closed);

const samples = [];
const started = Date.now();
for (let i = 1; i * SAMPLE_S <= durationS && Date.now() - started <= durationS * 1000; i++) {
  const due = started + i * SAMPLE_S * 1000;
  // real input for part of the interval: one wheel turn and one drag
  await page.mouse.move(640, 360);
  await page.mouse.wheel(0, i % 2 ? -300 : 300);
  await page.mouse.down();
  await page.mouse.move(600 + (i % 5) * 20, 330, { steps: 5 });
  await page.mouse.up();
  const wait = due - Date.now();
  if (wait > 0) await page.waitForTimeout(wait);
  await cdp.send('HeapProfiler.collectGarbage');
  const heap = await cdp.send('Runtime.getHeapUsage');
  const metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  const proc = await processMemory();
  const state = await page.evaluate(() => ({
    gpu: window.__milanoIso.gpu,
    tiles: window.__milanoIso.tiles,
    camera: window.__milanoIso.camera,
  }));
  const s = {
    t: Math.round((Date.now() - started) / 1000),
    phaseS: Math.round(((Date.now() - started) / 1000) % ZOOM_PERIOD_S),
    heapUsedMB: heap.usedSize / 1048576,
    heapTotalMB: heap.totalSize / 1048576,
    externalMB: (heap.backingStorageSize ?? NaN) / 1048576,
    embedderMB: (heap.embedderHeapUsedSize ?? NaN) / 1048576,
    nodes: metrics.Nodes,
    listeners: metrics.JSEventListeners,
    rendererMB: proc.rendererMB,
    gpuProcessMB: proc.gpuMB,
    geometries: state.gpu.geometries,
    textures: state.gpu.textures,
    programs: state.gpu.programs,
    tileGeometries: state.gpu.tileGeometries,
    tileTextures: state.gpu.tileTextures,
    maxGeomsPerTile: state.gpu.maxGeomsPerTile,
    tilesInScene: state.gpu.tilesInScene,
    tilesWanted: state.tiles.wanted,
    peakWanted: state.tiles.peakWanted,
    tilesLoaded: state.tiles.loaded,
    tilesLoading: state.tiles.loading,
    shardsLoaded: state.tiles.shards?.loaded ?? 0,
    shardsTotal: state.tiles.shards?.total ?? 0,
    level: state.tiles.level,
    cacheLimit: state.gpu.cacheLimit,
    domNodes: state.gpu.domNodes,
    widthM: state.camera.visibleWidth,
  };
  s.heapAdjMB = s.heapUsedMB - s.shardsLoaded * SHARD_MB;
  samples.push(s);
  console.log(
    `t=${s.t}s ph ${s.phaseS} w ${s.widthM.toFixed(0)} L${s.level} heap ${s.heapUsedMB.toFixed(1)} (adj ${s.heapAdjMB.toFixed(1)}) ext ${s.externalMB.toFixed(1)} rend ${s.rendererMB.toFixed(0)} gpu ${s.gpuProcessMB.toFixed(0)} MB geoms ${s.geometries}/${s.tileGeometries} tex ${s.textures}/${s.tileTextures} prog ${s.programs} tiles ${s.tilesLoaded}/${s.tilesInScene} shards ${s.shardsLoaded} dom ${s.domNodes}`,
  );
}
await page.evaluate(() => {
  window.__memSession.stop = true;
});
await browser.close();
winHelper?.kill();

const analysis = analyse(samples, durationS, SAMPLE_S, SHARD_MB);
const result = { durationS, sampleS: SAMPLE_S, backend: headless ? 'software (SwiftShader)' : 'headed, real GPU', tiles, problems, samples, analysis };
if (out) writeFileSync(out, JSON.stringify(result, null, 2));
console.log(JSON.stringify(analysis, null, 2));
process.exit(analysis.pass ? 0 : 1);
