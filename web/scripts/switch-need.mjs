/* global process, console, window */
// T-6.5b: was the budget switch needed? For every view of a sweep where the switch fired, the same view is measured with
// the switch off (`?budget=off`): the draw calls the level of the 1-pixel rule really issues. The switch was needed where that
// count is over 300 (the budget). Views with fewer calls were switched by a plan that overestimates.
//
//   node scripts/switch-need.mjs --port 4204 --in a.json,b.json --out ../reports/artifacts/T-6.5b/switch_need.json [--only 1920x1080,...]
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const port = Number(arg('port', 4204));
const only = arg('only', '') ? arg('only', '').split(',') : null;
const views = arg('in', '').split(',').filter(Boolean).flatMap((f) => JSON.parse(readFileSync(f, 'utf8')).data);
const switched = views.filter((v) => v.budgetSwitched === true && v.settled && (!only || only.includes(v.window)));
const groups = new Map();
for (const v of switched) {
  const k = [v.window, v.x, v.z, v.step].join('|');
  const g = groups.get(k) ?? new Map();
  g.set(v.requestedWidth, v);
  groups.set(k, g);
}
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const rows = [];
for (const [k, g] of groups) {
  const [win, x, z, step] = k.split('|');
  const [w, h] = win.split('x').map(Number);
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${port}/?e2e=1&budget=off`, { timeout: 120000 });
  await page.waitForFunction(() => typeof window.__milanoIsoSetView === 'function' && window.__milanoIso?.tiles?.loaded > 0, null, { timeout: 180000 });
  for (const width of [...g.keys()].sort((a, b) => a - b)) {
    const args = [Number(x), Number(z), width, Number(step)];
    await page.evaluate(([px, pz, pw, ps]) => window.__milanoIsoSetView(px, pz, pw, ps), args);
    let last = -1;
    let same = 0;
    let st;
    const t0 = Date.now();
    while (Date.now() - t0 < 240000) {
      await page.waitForTimeout(250);
      await page.evaluate(([px, pz, pw, ps]) => window.__milanoIsoSetView(px, pz, pw, ps), args);
      await page.waitForTimeout(100);
      st = await page.evaluate(() => ({ r: window.__milanoIso.render, t: window.__milanoIso.tiles }));
      const done = st.t.loading === 0 && st.t.pending === 0 && st.t.failed === 0 && st.t.inScene === st.t.loaded && st.t.estimatedCalls !== null && st.r.calls === last;
      same = done ? same + 1 : 0;
      last = st.r.calls;
      if (same >= 3) break;
    }
    const v = g.get(width);
    rows.push({
      window: win,
      x: Number(x),
      z: Number(z),
      step: Number(step),
      width,
      order: v.order,
      baseLevel: v.baseLevel,
      switchedTo: v.level,
      callsSwitched: v.calls,
      estimatedSwitched: v.estimatedCalls,
      levelOff: st.t.level,
      callsOff: st.r.calls,
      estimatedOff: st.t.estimatedCalls,
      settled: same >= 3,
      needed: st.r.calls > 300,
      errorPx: v.errorPx,
    });
    console.log(JSON.stringify(rows[rows.length - 1]));
  }
  await ctx.close();
}
await browser.close();
const needed = rows.filter((r) => r.needed).length;
const by = {};
for (const r of rows) {
  const key = `${r.window} L${r.baseLevel}->L${r.switchedTo}`;
  const e = (by[key] ??= { views: 0, needed: 0, maxOff: 0, minOff: Infinity, maxErr: 0 });
  e.views += 1;
  e.needed += r.needed ? 1 : 0;
  e.maxOff = Math.max(e.maxOff, r.callsOff);
  e.minOff = Math.min(e.minOff, r.callsOff);
  e.maxErr = Math.max(e.maxErr, r.errorPx);
}
const out = { views: rows.length, needed, notNeeded: rows.length - needed, by, rows };
if (arg('out', '')) writeFileSync(arg('out', ''), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ views: rows.length, needed, by }, null, 1));
