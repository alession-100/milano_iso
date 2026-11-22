/* global process, console, window, performance, WebGL2RenderingContext, WebGLRenderingContext, Event */
// T-6.5b: the most draw calls in any frame while zooming from 600 m to 4,000 m under a network throttle (the frames while
// a new level loads). Recorded, not capped (owner, 2026-11-22: the 300 budget is for settled views). Raw GL draw calls
// are counted per animation frame (drawElements and the others), so the shadow pass is included.
//
//   node scripts/transit-max.mjs --port 4204 --width 1280 --height 720 [--kbps 10000] [--latency 40] [--x 0 --z 0 --step 0]
//        [--mode steps|jump|wheel] [--out file.json]
//
// steps: the width grows by 12 % every 120 ms from 600 to 4,000 m (a quick zoom); jump: 4,000 m at once; wheel: 40 wheel
// notches of 100 ms. Software GL (SwiftShader, headless); the view is settled at 600 m before the throttle starts.
import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const port = Number(arg('port', 4204));
const w = Number(arg('width', 1280));
const h = Number(arg('height', 720));
const x = Number(arg('x', 0));
const z = Number(arg('z', 0));
const step = Number(arg('step', 0));
const kbps = Number(arg('kbps', 10000));
const lat = Number(arg('latency', 40));
const mode = arg('mode', 'steps');
const out = arg('out', '');

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
const page = await ctx.newPage();
await page.addInitScript(() => {
  window.__fr = { cur: 0, frames: [] };
  for (const C of [WebGL2RenderingContext, WebGLRenderingContext]) {
    for (const f of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements']) {
      const o = C.prototype[f];
      if (!o) continue;
      C.prototype[f] = function (...a) {
        window.__fr.cur++;
        return o.apply(this, a);
      };
    }
  }
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) =>
    raf((t) => {
      window.__fr.cur = 0;
      cb(t);
      if (window.__fr.cur > 0) {
        const s = window.__milanoIso?.tiles;
        window.__fr.frames.push([Math.round(performance.now()), window.__fr.cur, s?.level ?? -1, s?.drawnByLevel ? JSON.stringify(s.drawnByLevel) : '', s?.pending ?? -1]);
      }
    });
});
const errs = [];
page.on('console', (m) => {
  if ((m.type() === 'error' || m.type() === 'warning') && !/GPU stall due to ReadPixels/.test(m.text())) errs.push(m.text());
});
await page.goto(`http://127.0.0.1:${port}/?e2e=1`, { timeout: 180000 });
await page.waitForFunction(() => typeof window.__milanoIsoSetView === 'function' && window.__milanoIso?.tiles?.loaded > 0, null, { timeout: 180000 });
const set = ([a, b, c, d]) => window.__milanoIsoSetView(a, b, c, d);
await page.evaluate(set, [x, z, 600, step]);
for (let i = 0; i < 400; i++) {
  await page.waitForTimeout(250);
  const t = await page.evaluate(() => window.__milanoIso.tiles);
  if (t.pending === 0 && t.loading === 0 && t.inScene === t.loaded && i > 4) break;
}
const cdp = await ctx.newCDPSession(page);
await cdp.send('Network.enable');
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: lat, downloadThroughput: (kbps * 1000) / 8, uploadThroughput: (kbps * 1000) / 8 });
await page.evaluate(() => {
  window.__fr.frames = [];
});
const t0 = Date.now();
if (mode === 'jump') await page.evaluate(set, [x, z, 4000, step]);
else if (mode === 'steps') {
  for (let wd = 600; wd < 4000; wd = Math.min(4000, wd * 1.12)) {
    await page.evaluate(set, [x, z, wd, step]);
    await page.waitForTimeout(120);
  }
  await page.evaluate(set, [x, z, 4000, step]);
} else if (mode === 'wheel') {
  await page.mouse.move(w / 2, h / 2);
  for (let i = 0; i < 40; i++) {
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(100);
  }
}
let settledAt = null;
for (let i = 0; i < 2400; i++) {
  await page.waitForTimeout(150);
  await page.evaluate(() => window.__milanoIso && window.dispatchEvent(new Event('resize')));
  const t = await page.evaluate(() => window.__milanoIso.tiles);
  if (t.pending === 0 && t.loading === 0 && t.inScene === t.loaded && Date.now() - t0 > 3000) {
    settledAt = Date.now() - t0;
    break;
  }
}
await page.waitForTimeout(500);
const fr = await page.evaluate(() => window.__fr.frames);
const st = await page.evaluate(() => ({ r: window.__milanoIso.render, t: window.__milanoIso.tiles, c: window.__milanoIso.camera }));
const max = fr.reduce((m, f) => (f[1] > m[1] ? f : m), [0, 0]);
const res = {
  window: `${w}x${h}`,
  x,
  z,
  step,
  mode,
  kbps,
  latencyMs: lat,
  frames: fr.length,
  maxFrame: max,
  framesOver300: fr.filter((f) => f[1] > 300).length,
  framesOver280: fr.filter((f) => f[1] > 280).length,
  levelsSeen: [...new Set(fr.map((f) => f[2]))],
  settledMs: settledAt,
  finalCalls: st.r.calls,
  finalLevel: st.t.level,
  finalWidth: st.c.visibleWidth,
  errs,
};
console.log(JSON.stringify(res));
if (out) writeFileSync(out, JSON.stringify({ ...res, frameLog: fr }, null, 1));
await browser.close();
