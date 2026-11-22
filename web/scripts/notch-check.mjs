/* global process, console, window */
// T-6.5b: the zoom notch at 1280x720: 600 m, then 630 m, then 600 m again, each settled. The view must end on level 0
// (T-6.5a: the budget switch went to level 1 at 630 m and stayed there at 600 m).
//
//   node scripts/notch-check.mjs --port 4204 [--width 1280 --height 720] [--out file.json]
import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const port = Number(arg('port', 4204));
const w = Number(arg('width', 1280));
const h = Number(arg('height', 720));
const out = arg('out', '');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
const page = await ctx.newPage();
await page.goto(`http://127.0.0.1:${port}/?e2e=1`, { timeout: 180000 });
await page.waitForFunction(() => typeof window.__milanoIsoSetView === 'function' && window.__milanoIso?.tiles?.loaded > 0, null, { timeout: 180000 });
const rows = [];
for (const width of [600, 630, 600, 570, 600]) {
  const args = [0, 0, width, 0];
  await page.evaluate(([a, b, c, d]) => window.__milanoIsoSetView(a, b, c, d), args);
  let last = -1;
  let same = 0;
  let st;
  const t0 = Date.now();
  while (Date.now() - t0 < 240000) {
    await page.waitForTimeout(250);
    await page.evaluate(([a, b, c, d]) => window.__milanoIsoSetView(a, b, c, d), args);
    await page.waitForTimeout(100);
    st = await page.evaluate(() => ({ r: window.__milanoIso.render, t: window.__milanoIso.tiles }));
    const done = st.t.loading === 0 && st.t.pending === 0 && st.t.failed === 0 && st.t.inScene === st.t.loaded && st.t.estimatedCalls !== null && st.r.calls === last;
    same = done ? same + 1 : 0;
    last = st.r.calls;
    if (same >= 3) break;
  }
  rows.push({ width, level: st.t.level, baseLevel: st.t.baseLevel, budgetSwitched: st.t.budgetSwitched, estimatedCalls: st.t.estimatedCalls, calls: st.r.calls, settled: same >= 3 });
  console.log(JSON.stringify(rows[rows.length - 1]));
}
await browser.close();
const ok = rows.every((r) => r.settled && r.level === 0 && r.calls <= 300);
console.log(ok ? 'notch ends on level 0 (all steps level 0)' : 'NOTCH NOT ON LEVEL 0');
if (out) writeFileSync(out, JSON.stringify({ window: `${w}x${h}`, ok, rows }, null, 1));
process.exit(ok ? 0 : 1);
