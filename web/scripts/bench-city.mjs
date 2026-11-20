/* global process, console, document */
// T-6.4: runs `?debug=bench` (the fixed city path) in a HEADED Chromium with the machine's real GPU
// (no SwiftShader flags) against a server that already runs (`npm run serve -- --port 4191`).
//
//   node scripts/bench-city.mjs [--port 4191] [--out file.json] [--tiles tiles/pilot/] [--trace trace.json]
//        [--width 1280 --height 720] [--unlimited]
//
// --unlimited adds --disable-frame-rate-limit --disable-gpu-vsync: the frame rate is then not capped by
// the display, which shows the headroom (a 60 Hz display cannot show more than 60 fps otherwise).
// --trace writes a Chromium performance trace of the run. Prints the GPU as WebGL reports it
// (UNMASKED_RENDERER) and the ANGLE backend from chrome://gpu, then the bench results as JSON.
import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const port = Number(arg('port', 4191));
const out = arg('out', '');
const tiles = arg('tiles', '');
const trace = arg('trace', '');
const width = Number(arg('width', 1280));
const height = Number(arg('height', 720));
const unlimited = process.argv.includes('--unlimited');
const profileOut = arg('profile', '');

const args = ['--enable-precise-memory-info'];
if (unlimited) args.push('--disable-frame-rate-limit', '--disable-gpu-vsync');
const browser = await chromium.launch({ headless: false, channel: arg('channel', 'chrome'), args }); // the bundled Chromium cannot start headed in some sandboxes; --channel chromium is not accepted, use msedge or chrome
const page = await browser.newPage({ viewport: { width, height } });
const problems = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

const gpu = await page.evaluate(() => {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2');
  if (!gl) return { error: 'no webgl2' };
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
    renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
  };
});
const sys = await (await browser.newBrowserCDPSession()).send('SystemInfo.getInfo');
const backend = {
  devices: sys.gpu.devices.map((d) => `${d.vendorString} ${d.deviceString} (driver ${d.driverVersion})`),
  glRenderer: sys.gpu.auxAttributes?.glRenderer ?? null,
  glImplementation: sys.gpu.auxAttributes?.glImplementationParts ?? null,
  featureStatus: sys.gpu.featureStatus,
  browser: browser.version(),
};

// --profile <file>: a V8 sampling profile of the page (CDP Profiler) for the timed run, summarised by self time
let cdp = null;
if (profileOut) {
  cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
}
if (trace) await browser.startTracing(page, { path: trace, categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'gpu', 'v8', 'blink', 'cc'] });
await page.goto(`http://127.0.0.1:${port}/?debug=bench${tiles ? `&tiles=${tiles}` : ''}`);
await page.waitForFunction(() => document.getElementById('debug-bench-results')?.dataset.json, null, { timeout: 400_000, polling: 1000 });
const results = JSON.parse(await page.evaluate(() => document.getElementById('debug-bench-results').dataset.json));
if (trace) await browser.stopTracing();
if (cdp) {
  const { profile } = await cdp.send('Profiler.stop');
  const dt = new Map();
  profile.samples.forEach((id, i) => dt.set(id, (dt.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0)));
  const total = [...dt.values()].reduce((a, b) => a + b, 0);
  const byFn = new Map();
  for (const n of profile.nodes) {
    const f = n.callFrame;
    const key = `${f.functionName || '(anonymous)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}`;
    byFn.set(key, (byFn.get(key) ?? 0) + (dt.get(n.id) ?? 0));
  }
  const top = [...byFn.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, v]) => ({ fn: k, selfMs: v / 1000, pct: (100 * v) / total }));
  writeFileSync(profileOut, JSON.stringify({ totalMs: total / 1000, top }, null, 2));
}
await browser.close();

const summary = { gpu, backend, viewport: [width, height], unlimited, results, problems };
if (out) writeFileSync(out, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
