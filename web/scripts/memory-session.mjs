/* global process, console, window, performance, requestAnimationFrame, Buffer, document */
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
// Pass rule: ADR-0043 as amended by ADR-0044, coded in memory-analysis.mjs (thresholds are constants there; the
// samples of a finished run are judged again with `node scripts/memory-analysis.mjs run.json`). In short:
//   0. coverage: the sampled widths reach <= 300 m and >= 3,800 m (the 4,000 m phase is sampled);
//   1. heap (minus shards loaded x 0.06 MB, the catalogue is kept by design) and external memory:
//      last-minute median within a stated % of the first judged minute AND a fitted slope under a stated
//      MB/min (warm-up 60 s). Renderer-process memory is information only (it includes the driver's network
//      agent, ADR-0044): it fails only above a fitted slope of 6 MB/min after 180 s (12 MB/min under 10 minutes).
//      The renderer process is gated without the driver by memory-nodriver.mjs (slope from minute 20 <= 1 MB/min);
//   2. renderer geometries and textures never exceed what the app holds (the whole scene plus shadow
//      map): textures 0, geometries at most 1 and in at most 5 % of samples; and never more than the
//      cache allows (peak tiles held x largest geometry count of one tile + 1);
//   3. tiles in the scene at most max(64, `tiles.peakWanted`) (a wanted tile is never evicted, ADR-0038);
//   4. DOM nodes constant after warm-up; shader programs at most 8 and unchanged in the last minute.
//
// Options: --port, --duration (s), --out, --software, --closed (a path that repeats every 100 s, for
// attribution experiments), --shard-mb.
// T-6.9 (attribution of the renderer-process growth):
//   --dumps 600,2400     at these elapsed seconds (after the sample of that interval) record a detailed
//                        memory-infra dump (CDP Tracing on the browser session, category
//                        disabled-by-default-memory-infra, Tracing.requestMemoryDump) and save a summary of the
//                        renderer process's allocator categories to `<out>.dump<s>.json`; the raw trace is
//                        gzipped into `--dump-dir` when given (keep it outside the repo or under 5 MB).
//   --motion full|path|zoom|pan|wheel|drag|still
//                        which single kind of motion drives the camera (default `full`: the path above plus one
//                        real wheel turn and one real drag per interval; `path`: the same scripted path without the real input). `zoom`: poseAt's zoom only, centre fixed;
//                        `pan`: poseAt's x/z only (setView), width fixed at 1000 m; `wheel`: real wheel events every
//                        2 s, no setView; `drag`: real mouse drags every 2 s, no setView; `still`: nothing (control).
//                        Meant for the `--closed` path. Only `full` and `path` cover the zoom range, so the rule's coverage
//                        check (rule 0) fails for the other motions by design: read the slopes, not `pass`.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
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
const motion = arg('motion', 'full');
if (!['full', 'path', 'zoom', 'pan', 'wheel', 'drag', 'still'].includes(motion)) throw new Error(`unknown --motion ${motion}`);
const dumpTimes = arg('dumps', '')
  .split(',')
  .filter(Boolean)
  .map(Number)
  .sort((a, b) => a - b);
const dumpDir = arg('dump-dir', '');

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

/**
 * One detailed memory-infra dump (T-6.9): Tracing on the browser session records only for the duration of
 * the dump. Returns the trace as JSON text.
 */
async function memoryDump() {
  const done = new Promise((resolve) => bcdp.once('Tracing.tracingComplete', resolve));
  await bcdp.send('Tracing.start', {
    traceConfig: { includedCategories: ['disabled-by-default-memory-infra'], memoryDumpConfig: { triggers: [] } },
    transferMode: 'ReturnAsStream',
  });
  const r = await bcdp.send('Tracing.requestMemoryDump', { deterministic: true, levelOfDetail: 'detailed' });
  if (!r.success) throw new Error('Tracing.requestMemoryDump reported failure');
  await bcdp.send('Tracing.end');
  const { stream } = await done;
  let text = '';
  for (;;) {
    const c = await bcdp.send('IO.read', { handle: stream, size: 1 << 20 });
    text += c.base64Encoded ? Buffer.from(c.data, 'base64').toString('utf8') : c.data;
    if (c.eof) break;
  }
  await bcdp.send('IO.close', { handle: stream });
  return text;
}

/** Summary of the allocators of the renderer processes in a trace: bytes per allocator name (depth <= 4) and the process totals. */
function summariseDump(traceText, rendererPids) {
  const trace = JSON.parse(traceText);
  const events = Array.isArray(trace) ? trace : trace.traceEvents;
  const hex = (v) => (typeof v === 'string' ? parseInt(v, 16) : Number(v));
  const procs = {};
  for (const e of events) {
    if (e.ph !== 'v' || !e.args?.dumps) continue;
    const d = e.args.dumps;
    const proc = (procs[e.pid] ??= { pid: e.pid, allocators: {}, totals: {} });
    for (const [k, v] of Object.entries(d.process_totals ?? {})) proc.totals[k] = typeof v === 'object' ? v : hex(v);
    for (const [name, a] of Object.entries(d.allocators ?? {})) {
      if (name.split('/').length > 4) continue;
      const attr = a.attrs ?? {};
      const size = attr.effective_size?.value ?? attr.size?.value;
      if (size === undefined) continue;
      proc.allocators[name] = { sizeBytes: hex(size), ...(attr.size && attr.effective_size ? { rawSizeBytes: hex(attr.size.value) } : {}) };
    }
  }
  return { rendererPids, processes: Object.values(procs).filter((p) => rendererPids.includes(p.pid)) };
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
await page.evaluate(([closedPath, mode]) => {
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
  if (mode === 'wheel' || mode === 'drag' || mode === 'still') return; // no scripted pose
  const frame = () => {
    if (window.__memSession.stop) return;
    const [x, z, w] = poseAt((performance.now() - t0) / 1000);
    // T-6.9: `zoom` keeps the centre (0, 0) and sweeps the width; `pan` keeps the width and sweeps the centre
    if (mode === 'zoom') window.__milanoIsoSetView(0, 0, w);
    else if (mode === 'pan') window.__milanoIsoSetView(x, z, 1000);
    else window.__milanoIsoSetView(x, z, w);
    window.__memFrames = (window.__memFrames ?? 0) + 1; // T-6.9: frames of the scripted path, to compare workloads
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}, [closed, motion]);
// real input of the wheel and drag runs: one wheel turn or one drag every 2 s, in the background
let inputStop = false;
const inputLoop = (async () => {
  if (motion !== 'wheel' && motion !== 'drag') return;
  await page.mouse.move(640, 360);
  for (let k = 0; !inputStop; k++) {
    if (motion === 'wheel') await page.mouse.wheel(0, k % 2 ? 300 : -300);
    else {
      await page.mouse.move(640, 360);
      await page.mouse.down();
      await page.mouse.move(640 + (k % 2 ? -120 : 120), 360 + (k % 4 < 2 ? -60 : 60), { steps: 10 });
      await page.mouse.up();
    }
    await page.waitForTimeout(2000);
  }
})();

const samples = [];
const started = Date.now();
for (let i = 1; i * SAMPLE_S <= durationS && Date.now() - started <= durationS * 1000; i++) {
  const due = started + i * SAMPLE_S * 1000;
  if (motion === 'full') {
    // real input for part of the interval: one wheel turn and one drag
    await page.mouse.move(640, 360);
    await page.mouse.wheel(0, i % 2 ? -300 : 300);
    await page.mouse.down();
    await page.mouse.move(600 + (i % 5) * 20, 330, { steps: 5 });
    await page.mouse.up();
  }
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
    frames: window.__memFrames ?? 0,
    visibility: document.visibilityState,
    hasFocus: document.hasFocus(),
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
    frames: state.frames,
    tilesStarted: state.tiles.started,
    visibility: state.visibility,
    hasFocus: state.hasFocus,
  };
  s.heapAdjMB = s.heapUsedMB - s.shardsLoaded * SHARD_MB;
  samples.push(s);
  while (dumpTimes.length && s.t >= dumpTimes[0]) {
    const at = dumpTimes.shift();
    const text = await memoryDump();
    const { processInfo } = await bcdp.send('SystemInfo.getProcessInfo');
    const rpids = processInfo.filter((p) => p.type === 'renderer').map((p) => p.id);
    const summary = { atS: at, sampleT: s.t, rendererMBFromOS: s.rendererMB, traceChars: text.length, ...summariseDump(text, rpids) };
    if (out) writeFileSync(`${out}.dump${at}.json`, JSON.stringify(summary, null, 2));
    if (dumpDir) writeFileSync(`${dumpDir}/dump${at}.trace.json.gz`, gzipSync(text));
    console.log(`dump at ${at}s: ${summary.processes.length} renderer process(es), trace ${(text.length / 1048576).toFixed(1)} MB`);
  }
  console.log(
    `t=${s.t}s ph ${s.phaseS} w ${s.widthM.toFixed(0)} L${s.level} heap ${s.heapUsedMB.toFixed(1)} (adj ${s.heapAdjMB.toFixed(1)}) ext ${s.externalMB.toFixed(1)} rend ${s.rendererMB.toFixed(0)} gpu ${s.gpuProcessMB.toFixed(0)} MB geoms ${s.geometries}/${s.tileGeometries} tex ${s.textures}/${s.tileTextures} prog ${s.programs} tiles ${s.tilesLoaded}/${s.tilesInScene} shards ${s.shardsLoaded} dom ${s.domNodes}`,
  );
}
inputStop = true;
await inputLoop;
await page.evaluate(() => {
  window.__memSession.stop = true;
});
await browser.close();
winHelper?.kill();

const analysis = analyse(samples, durationS, SAMPLE_S, SHARD_MB);
const result = { motion, closed, durationS, sampleS: SAMPLE_S, backend: headless ? 'software (SwiftShader)' : 'headed, real GPU', tiles, problems, samples, analysis };
if (out) writeFileSync(out, JSON.stringify(result, null, 2));
console.log(JSON.stringify(analysis, null, 2));
process.exit(analysis.pass ? 0 : 1);
