/* global process, console, window, performance, requestAnimationFrame */
// T-6.4: a 5-minute scripted pan/zoom session on the served build, sampling memory every 10 s.
// Not part of the default e2e run: `npm run memory -- --port 4191 --out memory_run1.json`
// (the server must already run: `npm run serve -- --port 4191`).
//
// What it does: opens `?e2e=1` (the test state: renderer counts; this turns MSAA off, which does not
// change what is held in memory), drives the camera along a fixed path across the whole city and
// through every zoom level (poses are a pure function of elapsed time, in `poseAt` below), with one
// real wheel turn and one real mouse drag in every sampling interval so the controls run too. Every
// SAMPLE_S seconds it forces a garbage collection (CDP HeapProfiler.collectGarbage) and then reads
// Runtime.getHeapUsage, renderer.info.memory (geometries, textures), programs, tiles loaded and in
// the scene, and the DOM node count.
//
// Pass rule (stated in the report), on the samples after the first minute (warm-up):
//   1. heap: the median of the last minute is within 10 % of the median of the second minute;
//   2. geometries and textures never exceed what the tile cache allows. The renderer holds a geometry
//      only for a tile that is in the scene (evicted tiles are disposed), so: geometries held by the
//      renderer minus geometries of the tiles in the scene is at most 1 (the ground plane), textures
//      held minus textures of the tiles in the scene is at most 0, and the geometry count never exceeds
//      (largest tile count the cache can hold) x (largest geometry count of one tile) + 1;
//   3. the cache never holds more tiles than its limit (64) or the largest set the view asked for
//      (`tiles.wanted`: a wanted tile is never evicted, ADR-0038), whichever is larger.
import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const port = Number(arg('port', 4191));
const out = arg('out', '');
const durationS = Number(arg('duration', 300));
const SAMPLE_S = Number(arg('sample', 10));
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
  const state = await page.evaluate(() => ({
    gpu: window.__milanoIso.gpu,
    tiles: window.__milanoIso.tiles,
    camera: window.__milanoIso.camera,
  }));
  const s = {
    t: Math.round((Date.now() - started) / 1000),
    heapUsedMB: heap.usedSize / 1048576,
    heapTotalMB: heap.totalSize / 1048576,
    geometries: state.gpu.geometries,
    textures: state.gpu.textures,
    programs: state.gpu.programs,
    tileGeometries: state.gpu.tileGeometries,
    tileTextures: state.gpu.tileTextures,
    maxGeomsPerTile: state.gpu.maxGeomsPerTile,
    tilesInScene: state.gpu.tilesInScene,
    tilesWanted: state.tiles.wanted,
    tilesLoaded: state.tiles.loaded,
    tilesLoading: state.tiles.loading,
    level: state.tiles.level,
    cacheLimit: state.gpu.cacheLimit,
    domNodes: state.gpu.domNodes,
    widthM: state.camera.visibleWidth,
  };
  samples.push(s);
  console.log(
    `t=${s.t}s heap ${s.heapUsedMB.toFixed(1)} MB geoms ${s.geometries} (tiles ${s.tileGeometries}) tex ${s.textures} prog ${s.programs} loaded ${s.tilesLoaded} inScene ${s.tilesInScene} dom ${s.domNodes} L${s.level} w ${s.widthM.toFixed(0)}`,
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
const inRange = (lo, hi) => samples.filter((s) => s.t > lo && s.t <= hi);
const minute2 = inRange(60, 120);
const last = inRange(durationS - 60, durationS);
const heap2 = median(minute2.map((s) => s.heapUsedMB));
const heapL = median(last.map((s) => s.heapUsedMB));
const after = inRange(60, durationS);
const maxGeomsPerTile = Math.max(...samples.map((s) => s.maxGeomsPerTile));
const limit = samples[0].cacheLimit;
const maxWanted = Math.max(...samples.map((s) => s.tilesWanted ?? 0));
const maxHold = Math.max(limit, maxWanted);
const orphanGeom = after.map((s) => s.geometries - s.tileGeometries);
const orphanTex = after.map((s) => s.textures - s.tileTextures);
const analysis = {
  heapMedianMinute2MB: heap2,
  heapMedianLastMinuteMB: heapL,
  heapChangePct: (100 * (heapL - heap2)) / heap2,
  heapWithin10pct: Math.abs(heapL - heap2) <= 0.1 * heap2,
  maxGeometries: Math.max(...samples.map((s) => s.geometries)),
  maxTextures: Math.max(...samples.map((s) => s.textures)),
  maxGeomsPerTile,
  maxTilesInScene: Math.max(...samples.map((s) => s.tilesInScene)),
  cacheLimit: limit,
  maxWantedTiles: maxWanted,
  geometryBound: maxHold * maxGeomsPerTile + 1,
  orphanGeometriesMax: Math.max(...orphanGeom),
  orphanTexturesMax: Math.max(...orphanTex),
  maxPrograms: Math.max(...samples.map((s) => s.programs)),
  programsAfterMinute1: [Math.min(...after.map((s) => s.programs)), Math.max(...after.map((s) => s.programs))],
  domNodesAfterMinute1: [Math.min(...after.map((s) => s.domNodes)), Math.max(...after.map((s) => s.domNodes))],
};
analysis.geometriesWithinCache = analysis.maxGeometries <= analysis.geometryBound && analysis.orphanGeometriesMax <= 1;
analysis.texturesWithinCache = analysis.orphanTexturesMax <= 0;
analysis.tilesWithinLimit = analysis.maxTilesInScene <= maxHold;
analysis.pass = analysis.heapWithin10pct && analysis.geometriesWithinCache && analysis.texturesWithinCache && analysis.tilesWithinLimit;
const result = { durationS, sampleS: SAMPLE_S, backend: headless ? 'software (SwiftShader)' : 'headed, real GPU', tiles, problems, samples, analysis };
if (out) writeFileSync(out, JSON.stringify(result, null, 2));
console.log(JSON.stringify(analysis, null, 2));
process.exit(analysis.pass ? 0 : 1);
