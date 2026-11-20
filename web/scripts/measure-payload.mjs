/* global process, console, window, requestAnimationFrame, setTimeout, URL */
// T-6.3 evidence: bytes on the wire, JS size, time to first render and to the complete view, and the
// requests of a scripted pan and zoom path, on the CITY tileset, served by `npm run serve`.
//
// Usage (the server must already run; build with `npm run build:prod` after `make web-tiles EXTENT=city`):
//   npm run serve -- --port 4189                      # brotli and gzip
//   node scripts/measure-payload.mjs --label br --port 4189
//   npm run serve -- --port 4189 --encodings gzip     # a client without brotli
//   node scripts/measure-payload.mjs --label gzip --port 4189
// Results of each label are merged into reports/artifacts/T-6.3/measurements.json and the tables are
// rewritten to measurements.md. Every number in the tables comes from this script's output.
//
// Method. Playwright Chromium (SwiftShader software GL, so rendering is slower than on a GPU: the times
// are an upper bound), a fresh browser context per run (cold HTTP cache), network throttled with CDP
// Network.emulateNetworkConditions: 40 Mbit/s down (5,000,000 B/s), 20 Mbit/s up, 20 ms latency.
// Bytes are CDP encodedDataLength (what crossed the connection: compressed body plus response
// headers) of every request from navigation until the default view (origin, 600 m wide) is complete
// and nothing is in flight. Times are in-page performance.now() since navigation start: first render
// = a frame with triangles was drawn and a tile is drawn; complete = every tile and shard of the view
// loaded, nothing in flight, draw calls unchanged for 300 ms (the time reported is when they stopped
// changing).
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { chromium } from '@playwright/test';
import { brotli } from './precompress.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const label = arg('label', 'br');
const port = Number(arg('port', 4189));
const runs = Number(arg('runs', 3));
const dist = path.resolve(arg('dist', path.join(here, '..', 'dist')));
const outDir = path.resolve(arg('out', path.join(here, '..', '..', 'reports', 'artifacts', 'T-6.3')));
const only = arg('only', ''); // 'initial' or 'path' to run one part
const base = `http://127.0.0.1:${port}`;
const URL_QUERY = '?e2e=1&tiles=tiles/city/';

const PROFILE = { latency: 20, downloadThroughput: 5_000_000, uploadThroughput: 2_500_000 };
const VIEWPORTS = [
  ['1280x720', 1280, 720],
  ['412x915', 412, 915],
];

// The scripted path: x, z in client metres (x = E - E0, z = -(N - N0)), width in metres. It goes out to
// the widest zoom, along the city to the east, in to 300 m, back, west to the stadium and in to 150 m,
// then home: 27 steps over all four levels. The points are inside the comune (T-6.2 used the same).
const PATH = [
  [0, 0, 1200],
  [0, 0, 2400],
  [400, -300, 2400],
  [1200, -500, 4000],
  [2500, -800, 4000],
  [4000, -1000, 4000],
  [4500, 0, 2400],
  [4500, 0, 1200],
  [4500, 0, 600],
  [4500, 0, 300],
  [4300, 200, 300],
  [4100, 400, 300],
  [3500, 300, 600],
  [2500, 300, 1200],
  [1500, 200, 1200],
  [800, 100, 2400],
  [0, 0, 2400],
  [0, 0, 1200],
  [0, 0, 600],
  [-300, 100, 600],
  [-1500, 0, 1200],
  [-3000, -500, 2400],
  [-5291, -1529, 1200],
  [-5291, -1529, 300],
  [-5291, -1529, 150],
  [-2000, -500, 1200],
  [0, 0, 600],
];
const DWELL_MS = 150; // "scrubbing": the next step comes before the last view has loaded

function kindOf(url, type) {
  const u = new URL(url);
  const p = u.pathname;
  if (type === 'Document' || p.endsWith('/') || p.endsWith('.html')) return 'html';
  if (p.endsWith('.js') || p.endsWith('.mjs')) return 'js';
  if (/\/tiles\/[^/]+\/tiles\.json$/.test(p) || /\/shards\/S\d+_/.test(p)) return 'manifest';
  if (p.endsWith('/minimap.svg')) return 'minimap';
  if (/\/tiles\//.test(p) && /\.(glb|json)$/.test(p)) return /\/index\.json$/.test(p) ? 'other' : 'tiles';
  return 'other';
}

/** Watches the network through CDP: every request with its kind, bytes, and how it ended. */
async function watch(ctx, page) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, ...PROFILE });
  const reqs = new Map();
  cdp.on('Network.requestWillBeSent', (e) => {
    if (e.request.url.startsWith('data:')) return;
    if (reqs.has(e.requestId)) return; // a redirect: keep the first
    reqs.set(e.requestId, {
      url: e.request.url,
      kind: kindOf(e.request.url, e.type),
      status: 0,
      encoding: '',
      received: 0,
      total: 0,
      end: null,
    });
  });
  cdp.on('Network.responseReceived', (e) => {
    const r = reqs.get(e.requestId);
    if (!r) return;
    r.status = e.response.status;
    r.encoding = e.response.headers['content-encoding'] ?? e.response.headers['Content-Encoding'] ?? '';
    r.cacheControl = e.response.headers['cache-control'] ?? e.response.headers['Cache-Control'] ?? '';
    r.fromCache = Boolean(e.response.fromDiskCache || e.response.fromPrefetchCache);
  });
  cdp.on('Network.dataReceived', (e) => {
    const r = reqs.get(e.requestId);
    if (r) r.received += e.encodedDataLength;
  });
  cdp.on('Network.loadingFinished', (e) => {
    const r = reqs.get(e.requestId);
    if (r) {
      r.end = 'finished';
      r.total = e.encodedDataLength;
    }
  });
  cdp.on('Network.loadingFailed', (e) => {
    const r = reqs.get(e.requestId);
    if (r) r.end = e.canceled ? 'cancelled' : `failed:${e.errorText}`;
  });
  return { cdp, reqs };
}

const WATCHER = `(() => {
  const t = { first: null, complete: null, maxUnwanted: 0, sceneMismatch: 0, samples: 0 };
  window.__t = t;
  let stableSince = null;
  let lastCalls = null;
  setInterval(() => {
    const m = window.__milanoIso;
    if (!m || !m.tiles || !m.render) return;
    const s = m.tiles;
    const r = m.render;
    const now = performance.now();
    t.samples += 1;
    if ((s.unwantedInFlight || 0) > t.maxUnwanted) t.maxUnwanted = s.unwantedInFlight;
    if (s.inScene !== undefined && s.inScene !== s.loaded) t.sceneMismatch += 1;
    const drawn = Object.values(s.drawnByLevel || {}).some((n) => n > 0);
    if (t.first === null && r.triangles > 0 && drawn) t.first = now;
    const ok = t.first !== null && s.visible > 0 && s.loading === 0 && s.pending === 0 && (!s.shards || s.shards.loading === 0);
    if (!ok) { stableSince = null; return; }
    if (stableSince === null || r.calls !== lastCalls) { stableSince = now; lastCalls = r.calls; }
    if (now - stableSince >= 300 && t.complete === null) t.complete = stableSince;
  }, 10);
})();`;

async function openPage(browser, vp) {
  const ctx = await browser.newContext({ viewport: { width: vp[1], height: vp[2] }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  await page.addInitScript(WATCHER);
  const net = await watch(ctx, page);
  return { ctx, page, problems, ...net };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitComplete(page, timeout = 300_000) {
  await page.waitForFunction(() => window.__t && window.__t.complete !== null, null, { timeout, polling: 50 });
}

function summarise(reqs, filter = () => true) {
  const out = {};
  for (const k of ['html', 'js', 'manifest', 'minimap', 'tiles', 'other']) out[k] = { requests: 0, bytes: 0 };
  for (const r of reqs.values()) {
    if (!filter(r)) continue;
    const o = out[r.kind];
    o.requests += 1;
    o.bytes += r.end === 'finished' ? r.total : r.received;
  }
  out.total = {
    requests: Object.values(out).reduce((a, b) => a + b.requests, 0),
    bytes: Object.values(out).reduce((a, b) => a + b.bytes, 0),
  };
  return out;
}

/** One cold load of the default view. */
async function initialRun(browser, vp) {
  const { ctx, page, reqs, problems } = await openPage(browser, vp);
  await page.goto(`${base}/${URL_QUERY}`);
  await waitComplete(page);
  // let anything still in flight (the minimap) end, so its bytes are counted
  for (let i = 0; i < 100 && [...reqs.values()].some((r) => r.end === null); i++) await sleep(50);
  const t = await page.evaluate(() => ({ ...window.__t }));
  const state = await page.evaluate(() => ({
    tiles: JSON.parse(JSON.stringify(window.__milanoIso.tiles)),
    camera: JSON.parse(JSON.stringify(window.__milanoIso.camera ?? null)),
  }));
  const res = {
    firstRenderMs: Math.round(t.first),
    completeMs: Math.round(t.complete),
    bytes: summarise(reqs),
    encodings: [...new Set([...reqs.values()].map((r) => r.encoding || 'identity'))].sort(),
    cacheControl: Object.fromEntries(
      [...new Map([...reqs.values()].map((r) => [r.kind, r.cacheControl])).entries()].sort(),
    ),
    tileRequests: [...reqs.values()].filter((r) => r.kind === 'tiles' && /\.glb$/.test(new URL(r.url).pathname)).length,
    level: state.tiles.level,
    tilesLoaded: state.tiles.loaded,
    visible: state.tiles.visible,
    cameraWidth: state.camera?.visibleWidth ?? state.camera?.width ?? null,
    problems,
  };
  await ctx.close();
  return res;
}

/** The scripted path. `settle`: wait for each view to complete before the next step; else scrub. */
async function pathRun(browser, vp, settle) {
  const { ctx, page, reqs, problems } = await openPage(browser, vp);
  await page.goto(`${base}/${URL_QUERY}`);
  await waitComplete(page);
  for (let i = 0; i < 100 && [...reqs.values()].some((r) => r.end === null); i++) await sleep(50);
  const startedBefore = new Set(reqs.keys());
  const before = await page.evaluate(() => JSON.parse(JSON.stringify(window.__milanoIso.tiles)));
  const levels = new Set();
  const frames = () =>
    page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  for (const [x, z, w] of PATH) {
    await page.evaluate(([a, b, c]) => window.__milanoIsoSetView(a, b, c), [x, z, w]);
    await frames();
    const s = await page.evaluate(() => ({ level: window.__milanoIso.tiles.level, u: window.__milanoIso.tiles.unwantedInFlight }));
    levels.add(s.level);
    if (settle) {
      await page.waitForFunction(
        () => {
          const s = window.__milanoIso.tiles;
          return s.visible > 0 && s.loading === 0 && s.pending === 0 && (!s.shards || s.shards.loading === 0);
        },
        null,
        { timeout: 300_000, polling: 50 },
      );
    } else {
      await sleep(DWELL_MS);
    }
  }
  // finally let the last view complete in both modes
  await page.waitForFunction(
    () => {
      const s = window.__milanoIso.tiles;
      return s.visible > 0 && s.loading === 0 && s.pending === 0 && (!s.shards || s.shards.loading === 0);
    },
    null,
    { timeout: 300_000, polling: 50 },
  );
  await sleep(300);
  for (let i = 0; i < 100 && [...reqs.values()].some((r) => r.end === null); i++) await sleep(50);
  const after = await page.evaluate(() => JSON.parse(JSON.stringify(window.__milanoIso.tiles)));
  const t = await page.evaluate(() => ({ ...window.__t }));
  const path = [...reqs.entries()].filter(([id]) => !startedBefore.has(id)).map(([, r]) => r);
  const isTileOrShard = (r) => r.kind === 'tiles' || r.kind === 'manifest';
  const group = (list) => ({
    started: list.length,
    completed: list.filter((r) => r.end === 'finished').length,
    cancelled: list.filter((r) => r.end === 'cancelled').length,
    failed: list.filter((r) => r.end !== null && r.end !== 'finished' && r.end !== 'cancelled').length,
    unfinished: list.filter((r) => r.end === null).length,
    fromCache: list.filter((r) => r.fromCache).length,
    bytesCompleted: list.filter((r) => r.end === 'finished').reduce((a, r) => a + r.total, 0),
    bytesCancelled: list.filter((r) => r.end === 'cancelled').reduce((a, r) => a + r.received, 0),
  });
  const glb = path.filter((r) => r.kind === 'tiles' && /\.glb$/.test(new URL(r.url).pathname));
  const res = {
    mode: settle ? 'settled' : `scrub ${DWELL_MS} ms`,
    steps: PATH.length,
    levelsVisited: [...levels].sort(),
    tileFilesAndShards: group(path.filter(isTileOrShard)),
    glb: group(glb),
    shards: group(path.filter((r) => r.kind === 'manifest')),
    app: {
      tilesStarted: after.started - before.started,
      tilesCompleted: after.completed - before.completed,
      tilesCancelled: after.cancelled - before.cancelled,
      shardsStarted: after.shards.started - before.shards.started,
      shardsCompleted: after.shards.completed - before.shards.completed,
      shardsCancelled: after.shards.cancelled - before.shards.cancelled,
      loadedAtEnd: after.loaded,
      inSceneAtEnd: after.inScene,
      unwantedInFlightAtEnd: after.unwantedInFlight,
    },
    // sampled every 10 ms for the whole session
    maxUnwantedInFlight: t.maxUnwanted,
    sceneMismatchSamples: t.sceneMismatch,
    samples: t.samples,
    failedAtEnd: after.failed,
    problems,
  };
  await ctx.close();
  return res;
}

function jsSizes() {
  const dir = path.join(dist, 'assets');
  const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
  const rows = files.map((f) => {
    const buf = readFileSync(path.join(dir, f));
    return {
      file: f,
      raw: buf.length,
      gzip: zlib.gzipSync(buf, { level: 9 }).length,
      brotli: brotli(buf).length,
    };
  });
  return rows;
}

const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

mkdirSync(outDir, { recursive: true });
const jsonPath = path.join(outDir, 'measurements.json');
const data = existsSync(jsonPath) ? JSON.parse(readFileSync(jsonPath, 'utf8')) : {};
data.meta = {
  profile: `${(PROFILE.downloadThroughput * 8) / 1e6} Mbit/s down, ${(PROFILE.uploadThroughput * 8) / 1e6} Mbit/s up, ${PROFILE.latency} ms latency (CDP Network.emulateNetworkConditions)`,
  node: process.version,
  runsPerCell: runs,
  pathSteps: PATH.length,
  dwellMs: DWELL_MS,
  date: new Date().toISOString().slice(0, 10),
};
data.js = jsSizes();
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
data.meta.chromium = browser.version();
data[label] = data[label] ?? {};
for (const vp of VIEWPORTS) {
  const cell = (data[label][vp[0]] = data[label][vp[0]] ?? {});
  if (only !== 'path') {
    cell.initial = [];
    for (let i = 0; i < runs; i++) {
      const r = await initialRun(browser, vp);
      cell.initial.push(r);
      console.log(JSON.stringify({ label, vp: vp[0], run: i, firstRenderMs: r.firstRenderMs, completeMs: r.completeMs, total: r.bytes.total, level: r.level }));
    }
  }
  if (only !== 'initial') {
    cell.path = [];
    for (const settle of [false, true]) {
      const r = await pathRun(browser, vp, settle);
      cell.path.push(r);
      console.log(JSON.stringify({ label, vp: vp[0], mode: r.mode, glb: r.glb, shards: r.shards, app: r.app, maxUnwanted: r.maxUnwantedInFlight, sceneMismatch: r.sceneMismatchSamples }));
    }
  }
}
await browser.close();
writeFileSync(jsonPath, JSON.stringify(data, null, 1) + '\n');

// --- tables ---------------------------------------------------------------------------------------------
const kb = (n) => (n / 1024).toFixed(1);
const lines = [];
lines.push('# T-6.3 measurements (city tileset, `npm run serve`, Playwright Chromium, cold cache)');
lines.push('');
lines.push(`Generated by \`web/scripts/measure-payload.mjs\` on ${data.meta.date}; Node ${data.meta.node}, Chromium ${data.meta.chromium}.`);
lines.push(`Network profile: ${data.meta.profile}. Software rendering (SwiftShader): times are an upper bound for a GPU browser.`);
lines.push(`Initial view: origin, 600 m wide (the default view), \`?tiles=tiles/city/\`. ${data.meta.runsPerCell} cold runs per cell; bytes are identical between runs (they are listed once, from the median run by completion time).`);
lines.push('');
lines.push('## JS bundle (budget 600 KB gzip)');
lines.push('');
lines.push('| file | raw B | gzip-9 B (Node zlib) | brotli-11 B (Node zlib) |');
lines.push('|---|---:|---:|---:|');
for (const j of data.js) lines.push(`| ${j.file} | ${j.raw} | ${j.gzip} | ${j.brotli} |`);
lines.push('');
for (const lb of ['br', 'gzip']) {
  if (!data[lb]) continue;
  lines.push(`## Initial payload until the default view is complete: client accepts ${lb === 'br' ? 'br, gzip' : 'gzip only'} (budget 3 MB = 3,145,728 B)`);
  lines.push('');
  lines.push('| viewport | level | HTML B | JS B | manifest B (tiles.json + shards) | minimap B | tiles B (glb + feature json) | other B | total B | total KB | requests | first render ms (runs) | complete ms (runs) |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|');
  for (const vp of VIEWPORTS) {
    const runsList = data[lb][vp[0]]?.initial;
    if (!runsList) continue;
    const byTime = [...runsList].sort((a, b) => a.completeMs - b.completeMs);
    const m = byTime[Math.floor(byTime.length / 2)];
    const b = m.bytes;
    lines.push(
      `| ${vp[0]} | ${m.level} | ${b.html.bytes} | ${b.js.bytes} | ${b.manifest.bytes} | ${b.minimap.bytes} | ${b.tiles.bytes} | ${b.other.bytes} | ${b.total.bytes} | ${kb(b.total.bytes)} | ${b.total.requests} | ${runsList.map((r) => r.firstRenderMs).join(' / ')} (median ${median(runsList.map((r) => r.firstRenderMs))}) | ${runsList.map((r) => r.completeMs).join(' / ')} (median ${median(runsList.map((r) => r.completeMs))}) |`,
    );
  }
  lines.push('');
}
for (const lb of ['br', 'gzip']) {
  if (!data[lb]) continue;
  lines.push(`## Scripted pan and zoom path (${PATH.length} steps over levels 0-3), client accepts ${lb === 'br' ? 'br, gzip' : 'gzip only'}`);
  lines.push('');
  lines.push('Counts are CDP network requests from the end of the initial load. "glb" = tile files (each tile also fetches its feature .json). Wasted = encoded bytes received by requests that ended cancelled.');
  lines.push('');
  lines.push('| viewport | mode | levels visited | glb started | glb completed | glb cancelled | glb from cache | shards started / completed / cancelled | cancelled bytes (tiles + shards) | completed bytes (tiles + shards) | app counters: tiles started / completed / cancelled | max unwanted in flight (10 ms samples) | scene != loaded samples | failed |');
  lines.push('|---|---|---|---:|---:|---:|---:|---|---:|---:|---|---:|---:|---:|');
  for (const vp of VIEWPORTS) {
    for (const p of data[lb][vp[0]]?.path ?? []) {
      const g = p.glb;
      const t = p.tileFilesAndShards;
      lines.push(
        `| ${vp[0]} | ${p.mode} | ${p.levelsVisited.join(',')} | ${g.started} | ${g.completed} | ${g.cancelled} | ${g.fromCache} | ${p.shards.started} / ${p.shards.completed} / ${p.shards.cancelled} | ${t.bytesCancelled} | ${t.bytesCompleted} | ${p.app.tilesStarted} / ${p.app.tilesCompleted} / ${p.app.tilesCancelled} | ${p.maxUnwantedInFlight} | ${p.sceneMismatchSamples} | ${p.failedAtEnd} |`,
      );
    }
  }
  lines.push('');
}
writeFileSync(path.join(outDir, 'measurements.md'), lines.join('\n') + '\n');
console.log(`wrote ${path.join(outDir, 'measurements.md')}`);
