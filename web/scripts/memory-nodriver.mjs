/* global process, console, WebSocket, setTimeout, Buffer */
// T-6.9: the same closed camera path as `memory-session.mjs --closed`, but with NO automation driver attached
// to the page: Chrome is started by this script with --remote-debugging-port, and the only things sent over
// CDP are a Target.createTarget, one Runtime.evaluate that installs the scripted camera path, and (browser
// session) SystemInfo.getProcessInfo and Tracing memory dumps. Playwright is not used, so its Network, Page,
// Runtime and Log agents are never enabled in the page. The page's own network agent stays off.
//   node scripts/memory-nodriver.mjs --port 4213 --duration 620 --out run.json [--dumps 200,610] [--closed] [--motion path|still]
// Samples every SAMPLE_S s: renderer and GPU process private memory (OS) and the memory-infra
// `private_footprint_bytes` of the page's renderer at dump times. No heap or app counters (they need a driver).
// Pass rule (ADR-0044 a, `judgeNoDriver` in memory-analysis.mjs): every sample visible, >= 30 minutes, frames within
// 25 % of the reference run (--reference run.json, default T-6.9 playwright2_path_closed_20min.json), renderer slope
// from minute 20 <= 1 MB/min; exit 1 otherwise. The samples of a saved run are judged again with
// `node scripts/memory-analysis.mjs run.json --nodriver [--reference ref.json]`.
// Windows only for the sampler; Chrome from the installed channel (path below, override with --chrome).
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_REFERENCE, judgeNoDriver } from './memory-analysis.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const port = Number(arg('port', 4213));
const durationS = Number(arg('duration', 620));
const SAMPLE_S = Number(arg('sample', 7));
const out = arg('out', '');
const motion = arg('motion', 'path');
const closed = process.argv.includes('--closed');
const dumpTimes = arg('dumps', '')
  .split(',')
  .filter(Boolean)
  .map(Number)
  .sort((a, b) => a - b);
const chromePath = arg('chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
if (!existsSync(chromePath)) throw new Error(`Chrome not found at ${chromePath}`);

const profile = mkdtempSync(path.join(tmpdir(), 'nodriver-'));
const chrome = spawn(
  chromePath,
  [`--remote-debugging-port=0`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--window-size=1280,800', '--js-flags=--expose-gc', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion', 'about:blank'],
  { stdio: 'ignore' },
);
const portFile = path.join(profile, 'DevToolsActivePort');
for (let i = 0; i < 100 && !existsSync(portFile); i++) await new Promise((r) => setTimeout(r, 200));
const [dbgPort, wsPath] = readFileSync(portFile, 'utf8').trim().split(/\r?\n/);

const ws = new WebSocket(`ws://127.0.0.1:${dbgPort}${wsPath}`);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
let nextId = 1;
const pending = new Map();
const listeners = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) reject(new Error(`${m.error.message}`));
    else resolve(m.result);
  } else if (m.method) for (const l of listeners) l(m);
};
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

const { targetId } = await send('Target.createTarget', { url: `http://127.0.0.1:${port}/?e2e=1&tiles=tiles/city/`, newWindow: true });
await send('Target.activateTarget', { targetId }); // a visible foreground tab of its own window; checked per sample (visibilityState, hasFocus)
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const evalPage = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.exceptionDetails) throw new Error(`page: ${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ''}`);
  return r.result.value;
};
for (let i = 0; i < 600; i++) {
  if (await evalPage("typeof window.__milanoIsoSetView === 'function' && window.__milanoIso?.tiles?.loaded > 0")) break;
  await new Promise((r) => setTimeout(r, 200));
}

// the closed path of memory-session.mjs (same poseAt), scripted by requestAnimationFrame inside the page
if (motion === 'path') {
  await evalPage(`(() => {
    const t0 = performance.now();
    const closedPath = ${closed};
    const poseAt = (s) => {
      const [p1, p2, p3, p4] = closedPath ? [100, 50, 100, 25] : [97, 41, 83, 53];
      const x = 3500 * Math.sin((2 * Math.PI * s) / p1) - 2500 * Math.sin((2 * Math.PI * s) / p2);
      const z = 3000 * Math.cos((2 * Math.PI * s) / p3) + 2500 * Math.sin((2 * Math.PI * s) / p4);
      const u = 0.5 - 0.5 * Math.cos((2 * Math.PI * s) / 50);
      return [x, z, 250 * Math.pow(4000 / 250, u)];
    };
    const frame = () => {
      const [x, z, w] = poseAt((performance.now() - t0) / 1000);
      window.__milanoIsoSetView(x, z, w);
      window.__memFrames = (window.__memFrames ?? 0) + 1;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    return true;
  })()`);
} else if (motion !== 'still') throw new Error(`unknown --motion ${motion}`);

// OS sampler (Windows): one long-lived PowerShell, as in memory-session.mjs
if (process.platform !== 'win32') throw new Error('the no-driver sampler is Windows only');
const PS_LOOP =
  'while (($l = [Console]::In.ReadLine()) -ne $null) { $r = (Get-Process -Id ($l -split ",") -ErrorAction SilentlyContinue | Measure-Object -Property PrivateMemorySize64 -Sum).Sum; Write-Output ("R " + $r) }';
const ps = spawn('powershell', ['-NoProfile', '-NoLogo', '-Command', PS_LOOP], { stdio: ['pipe', 'pipe', 'ignore'] });
let psBuf = '';
let psWaiting = null;
ps.stdout.on('data', (d) => {
  psBuf += d.toString();
  const m = /R (\d*)\r?\n/.exec(psBuf);
  if (m && psWaiting) {
    psBuf = psBuf.slice(m.index + m[0].length);
    const w = psWaiting;
    psWaiting = null;
    w(Number(m[1]));
  }
});
const privateMB = (pids) =>
  new Promise((resolve) => {
    psWaiting = (v) => resolve(v / 1048576);
    ps.stdin.write(`${pids.join(',')}\n`);
  });

async function memoryDump() {
  const done = new Promise((resolve) => listeners.push((m) => m.method === 'Tracing.tracingComplete' && resolve(m.params)));
  await send('Tracing.start', {
    traceConfig: { includedCategories: ['disabled-by-default-memory-infra'], memoryDumpConfig: { triggers: [] } },
    transferMode: 'ReturnAsStream',
  });
  await send('Tracing.requestMemoryDump', { deterministic: true, levelOfDetail: 'detailed' });
  await send('Tracing.end');
  const { stream } = await done;
  let text = '';
  for (;;) {
    const c = await send('IO.read', { handle: stream, size: 1 << 20 });
    text += c.base64Encoded ? Buffer.from(c.data, 'base64').toString('utf8') : c.data;
    if (c.eof) break;
  }
  await send('IO.close', { handle: stream });
  return text;
}
/** Same summary as memory-session.mjs (kept in step by hand). */
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

const samples = [];
const started = Date.now();
for (let i = 1; i * SAMPLE_S <= durationS; i++) {
  const wait = started + i * SAMPLE_S * 1000 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const { processInfo } = await send('SystemInfo.getProcessInfo');
  const of = (type) => processInfo.filter((p) => p.type === type).map((p) => p.id);
  const heap = await send('Runtime.getHeapUsage', {}, sessionId);
  const st = await evalPage(`(() => { const m = window.__milanoIso; return {
    frames: window.__memFrames ?? 0, visibility: document.visibilityState, hasFocus: document.hasFocus(),
    tilesLoaded: m.tiles.loaded, tilesStarted: m.tiles.started, tilesCompleted: m.tiles.completed, tilesInScene: m.gpu.tilesInScene,
    shardsLoaded: m.tiles.shards?.loaded ?? 0, level: m.tiles.level, widthM: m.camera.visibleWidth,
    geometries: m.gpu.geometries, textures: m.gpu.textures, programs: m.gpu.programs }; })()`);
  const s = {
    t: Math.round((Date.now() - started) / 1000),
    rendererMB: await privateMB(of('renderer')),
    gpuProcessMB: await privateMB(of('GPU')),
    heapUsedMB: heap.usedSize / 1048576,
    ...st,
  };
  samples.push(s);
  console.log(`t=${s.t}s rend ${s.rendererMB.toFixed(0)} gpu ${s.gpuProcessMB.toFixed(0)} MB frames ${s.frames} fetched ${s.tilesStarted} shards ${s.shardsLoaded} L${s.level} ${s.visibility} focus ${s.hasFocus} heap ${s.heapUsedMB.toFixed(1)} geoms ${s.geometries} tex ${s.textures}`);
  while (dumpTimes.length && s.t >= dumpTimes[0]) {
    const at = dumpTimes.shift();
    const text = await memoryDump();
    const summary = { atS: at, sampleT: s.t, rendererMBFromOS: s.rendererMB, traceChars: text.length, ...summariseDump(text, of('renderer')) };
    if (out) writeFileSync(`${out}.dump${at}.json`, JSON.stringify(summary, null, 2));
    console.log(`dump at ${at}s: trace ${(text.length / 1048576).toFixed(1)} MB`);
  }
}

// least-squares slope over the samples after the 180 s warm-up (as the renderer rule of ADR-0043)
const pts = samples.filter((s) => s.t > 180);
const slope = (key) => {
  const mt = pts.reduce((a, p) => a + p.t, 0) / pts.length;
  const my = pts.reduce((a, p) => a + p[key], 0) / pts.length;
  let num = 0;
  let den = 0;
  for (const p of pts) {
    num += (p.t - mt) * (p[key] - my);
    den += (p.t - mt) ** 2;
  }
  return (60 * num) / den;
};
const win = (lo, hi, key) => {
  const q = samples.filter((x) => x.t > lo * 60 && x.t <= hi * 60);
  if (q.length < 3) return null;
  const mt = q.reduce((a, p) => a + p.t, 0) / q.length;
  const my = q.reduce((a, p) => a + p[key], 0) / q.length;
  let num = 0;
  let den = 0;
  for (const p of q) {
    num += (p.t - mt) * (p[key] - my);
    den += (p.t - mt) ** 2;
  }
  return (60 * num) / den;
};
const windows = {};
for (const [lo, hi] of [[4, 20], [20, 40], [40, 60]]) windows[`min${lo}-${hi}`] = win(lo, hi, 'rendererMB');
const analysis = { rendererSlopeByWindowMBPerMin: windows, driver: 'none (raw CDP: createTarget, Runtime.evaluate, browser-level SystemInfo and Tracing)', motion, closed, rendererSlopeMBPerMin: slope('rendererMB'), gpuSlopeMBPerMin: slope('gpuProcessMB'), samplesAfterWarmup: pts.length };
// ADR-0044 (a): the pass rule (visible samples, 30 minutes, frames within 25 % of the reference, slope from minute 20)
const refRun = JSON.parse(readFileSync(arg('reference', DEFAULT_REFERENCE), 'utf8'));
analysis.rule = judgeNoDriver(samples, durationS, { frames: refRun.samples.at(-1).frames, t: refRun.samples.at(-1).t });
const result = { durationS, sampleS: SAMPLE_S, analysis, samples };
if (out) writeFileSync(out, JSON.stringify(result, null, 2));
console.log(JSON.stringify(analysis, null, 2));
ps.kill();
await send('Browser.close').catch(() => {}); // closes every Chrome process this script started
await new Promise((r) => setTimeout(r, 2000));
chrome.kill();
process.exit(analysis.rule.pass ? 0 : 1);
