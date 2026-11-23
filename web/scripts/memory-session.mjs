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
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const port = Number(arg('port', 4191));
const out = arg('out', '');
const durationS = Number(arg('duration', 300));
const SAMPLE_S = Number(arg('sample', 7));
const ZOOM_PERIOD_S = 50; // poseAt below
const WARMUP_S = 60;
const PERIOD_S = 60; // the early and the last period of the rule
const SHARD_MB = Number(arg('shard-mb', 0.06)); // upper bound of the heap cost of one shard (ADR-0043)
// thresholds of rule 1 (ADR-0043): the median change in per cent and the fitted slope in MB per minute
const LIMITS = {
  heapAdj: { pct: 5, slope: 0.5 },
  external: { pct: 10, slope: 0.5 },
  renderer: { pct: 10, slope: 5 },
};
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

/** Private memory in MB of a list of pids, from the OS. */
function privateMB(pids) {
  if (pids.length === 0) return 0;
  if (process.platform === 'win32') {
    const r = spawnSync(
      'powershell',
      ['-NoProfile', '-Command', `(Get-Process -Id ${pids.join(',')} -ErrorAction SilentlyContinue | Measure-Object -Property PrivateMemorySize64 -Sum).Sum`],
      { encoding: 'utf8' },
    );
    // a process may exit between the CDP call and this one (a short-lived helper): the sum of the rest is used
    const v = Number(r.stdout.trim());
    if (!Number.isFinite(v) || v <= 0) throw new Error(`process memory (win32) failed: ${r.stderr}`);
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
  return { rendererMB: privateMB(of('renderer')), gpuMB: privateMB(of('GPU')) };
}

await page.goto(`http://127.0.0.1:${port}/?e2e=1&tiles=${tiles}`);
await page.waitForFunction(() => typeof window.__milanoIsoSetView === 'function' && window.__milanoIso?.tiles?.loaded > 0, null, {
  timeout: 120_000,
});

// The path: a Lissajous over the city (x, z in client metres inside the content bounds, taken from the
// camera clamp) and a zoom that sweeps 250 m to 4000 m geometrically with a 50 s period.
await page.evaluate(() => {
  const t0 = performance.now();
  window.__memSession = { stop: false };
  const poseAt = (s) => {
    const x = 3500 * Math.sin((2 * Math.PI * s) / 97) - 2500 * Math.sin((2 * Math.PI * s) / 41);
    const z = 3000 * Math.cos((2 * Math.PI * s) / 83) + 2500 * Math.sin((2 * Math.PI * s) / 53);
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
});

const samples = [];
const started = Date.now();
for (let i = 1; i * SAMPLE_S <= durationS; i++) {
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

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
/** Least-squares slope of y against t (seconds), in units per minute. */
const slopePerMin = (pts) => {
  const n = pts.length;
  const mt = pts.reduce((a, p) => a + p.t, 0) / n;
  const my = pts.reduce((a, p) => a + p.y, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of pts) {
    num += (p.t - mt) * (p.y - my);
    den += (p.t - mt) ** 2;
  }
  return (60 * num) / den;
};
const inRange = (lo, hi) => samples.filter((s) => s.t > lo && s.t <= hi);
const early = inRange(WARMUP_S, WARMUP_S + PERIOD_S);
const last = inRange(durationS - PERIOD_S, durationS);
const after = inRange(WARMUP_S, durationS);
const metric = (key, lim) => {
  const e = median(early.map((s) => s[key]));
  const l = median(last.map((s) => s[key]));
  const slope = slopePerMin(after.map((s) => ({ t: s.t, y: s[key] })));
  const changePct = (100 * (l - e)) / e;
  return {
    earlyMedianMB: e,
    lastMedianMB: l,
    changeMB: l - e,
    changePct,
    slopeMBPerMin: slope,
    limitPct: lim.pct,
    limitSlopeMBPerMin: lim.slope,
    pass: changePct <= lim.pct && slope <= lim.slope,
  };
};
const widths = samples.map((s) => s.widthM);
const bands = [0, 300, 600, 1500, 3000, 3800, Infinity];
const widthBands = {};
for (let b = 0; b + 1 < bands.length; b++) {
  widthBands[`${bands[b]}-${bands[b + 1]} m`] = widths.filter((w) => w > bands[b] && w <= bands[b + 1]).length;
}
const maxGeomsPerTile = Math.max(...samples.map((s) => s.maxGeomsPerTile));
const limit = samples[0].cacheLimit;
const maxWanted = Math.max(...samples.map((s) => s.peakWanted ?? 0));
const maxHold = Math.max(limit, maxWanted);
const orphanGeom = samples.map((s) => s.geometries - s.tileGeometries);
const orphanTex = samples.map((s) => s.textures - s.tileTextures);
const analysis = {
  rule: 'ADR-0043',
  sampleS: SAMPLE_S,
  zoomPeriodS: ZOOM_PERIOD_S,
  distinctZoomPhasesSampled: new Set(samples.map((s) => s.phaseS)).size,
  sampledWidthMinM: Math.min(...widths),
  sampledWidthMaxM: Math.max(...widths),
  sampledWidthBands: widthBands,
  heapAdjusted: metric('heapAdjMB', LIMITS.heapAdj),
  heapRaw: metric('heapUsedMB', { pct: Infinity, slope: Infinity }),
  external: metric('externalMB', LIMITS.external),
  rendererProcess: metric('rendererMB', LIMITS.renderer),
  gpuProcess: metric('gpuProcessMB', { pct: Infinity, slope: Infinity }),
  shardMBAssumed: SHARD_MB,
  shardsLoadedFirstLast: [samples[0].shardsLoaded, samples.at(-1).shardsLoaded],
  maxGeometries: Math.max(...samples.map((s) => s.geometries)),
  maxTextures: Math.max(...samples.map((s) => s.textures)),
  maxGeomsPerTile,
  maxTilesInScene: Math.max(...samples.map((s) => s.tilesInScene)),
  cacheLimit: limit,
  maxWantedTiles: maxWanted,
  geometryBound: maxHold * maxGeomsPerTile + 1,
  orphanGeometriesMax: Math.max(...orphanGeom),
  orphanTexturesMax: Math.max(...orphanTex),
  programsAfterWarmup: [Math.min(...after.map((s) => s.programs)), Math.max(...after.map((s) => s.programs))],
  domNodesAfterWarmup: [Math.min(...after.map((s) => s.domNodes)), Math.max(...after.map((s) => s.domNodes))],
  browserNodesAfterWarmup: [Math.min(...after.map((s) => s.nodes)), Math.max(...after.map((s) => s.nodes))],
};
analysis.coverageOk = analysis.sampledWidthMinM <= 300 && analysis.sampledWidthMaxM >= 3800;
analysis.geometriesWithinCache = analysis.maxGeometries <= analysis.geometryBound && analysis.orphanGeometriesMax <= 0;
analysis.texturesWithinCache = analysis.orphanTexturesMax <= 0;
analysis.tilesWithinLimit = analysis.maxTilesInScene <= maxHold;
analysis.domConstant = analysis.domNodesAfterWarmup[0] === analysis.domNodesAfterWarmup[1];
analysis.programsConstant = analysis.programsAfterWarmup[0] === analysis.programsAfterWarmup[1];
analysis.pass =
  durationS >= WARMUP_S + 2 * PERIOD_S &&
  analysis.coverageOk &&
  analysis.heapAdjusted.pass &&
  analysis.external.pass &&
  analysis.rendererProcess.pass &&
  analysis.geometriesWithinCache &&
  analysis.texturesWithinCache &&
  analysis.tilesWithinLimit &&
  analysis.domConstant &&
  analysis.programsConstant;
const result = { durationS, sampleS: SAMPLE_S, backend: headless ? 'software (SwiftShader)' : 'headed, real GPU', tiles, problems, samples, analysis };
if (out) writeFileSync(out, JSON.stringify(result, null, 2));
console.log(JSON.stringify(analysis, null, 2));
process.exit(analysis.pass ? 0 : 1);
