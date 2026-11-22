/* global process, console, window*/
// T-6.5b: time until the default view (the view the app opens with) is complete, on the built site served already.
//
//   node scripts/time-default.mjs --port 4204 [--runs 5] [--width 1280 --height 720] [--out file.json]
//
// A fresh page per run (cold browser cache), software GL, no throttle. Reports, in ms from the start of the navigation:
// the first frame that draws anything (`firstDrawMs`), and the view complete (`completeMs`: no tile pending or loading, scene
// equal to loaded, the plan known, draw calls unchanged for three reads of 100 ms). The reads add 300 ms to `completeMs`.
import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const port = Number(arg('port', 4204));
const runs = Number(arg('runs', 5));
const w = Number(arg('width', 1280));
const h = Number(arg('height', 720));
const out = arg('out', '');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const rows = [];
for (let r = 0; r < runs; r++) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${port}/?e2e=1`, { timeout: 180000 });
  let firstDraw = null;
  let last = -1;
  let same = 0;
  let st = null;
  while (Date.now() - t0 < 120000) {
    st = await page.evaluate(() => (window.__milanoIso ? { r: window.__milanoIso.render, t: window.__milanoIso.tiles } : null));
    if (st && firstDraw === null && st.r.calls > 1) firstDraw = Date.now() - t0;
    const done = st && st.t.loading === 0 && st.t.pending === 0 && st.t.failed === 0 && st.t.inScene === st.t.loaded && st.t.loaded > 0 && st.t.estimatedCalls !== null && st.r.calls === last;
    same = done ? same + 1 : 0;
    last = st ? st.r.calls : -1;
    if (same >= 3) break;
    await page.waitForTimeout(100);
  }
  rows.push({ run: r + 1, firstDrawMs: firstDraw, completeMs: same >= 3 ? Date.now() - t0 : null, calls: st?.r.calls, level: st?.t.level, loaded: st?.t.loaded });
  console.log(JSON.stringify(rows[rows.length - 1]));
  await ctx.close();
}
await browser.close();
const med = (a) => {
  const s = a.filter((v) => v !== null).sort((p, q) => p - q);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};
const res = { window: `${w}x${h}`, runs: rows, medianFirstDrawMs: med(rows.map((x) => x.firstDrawMs)), medianCompleteMs: med(rows.map((x) => x.completeMs)) };
console.log(JSON.stringify({ medianFirstDrawMs: res.medianFirstDrawMs, medianCompleteMs: res.medianCompleteMs }));
if (out) writeFileSync(out, JSON.stringify(res, null, 1));
