/* global process, console, window, Event */
// T-6.5a: the default view (origin, 600 m, rotation step 0) must draw level 0 and stay within 300 draw calls on
// the common windows. Each window is a fresh page on the built site, served already:
//
//   node scripts/default-view-check.mjs --port 4201 --out ../reports/artifacts/T-6.5a/default_view.json
//        [--windows 1280x720,...] [--shots dir]
//
// Measured twice per window: the view the app opens with (no setView), and the explicit view (0, 0, 600 m).
// Exit code 1 when any window is not on level 0, is over 300 calls, or does not settle.
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const port = Number(arg('port', 4201));
const out = arg('out', '');
const shots = arg('shots', '');
const query = arg('query', '');
const windows = arg('windows', '1280x720,1366x768,1440x900,1536x864,1600x900,1680x1050,1920x1080,1920x1200,2560x1440')
  .split(',')
  .map((s) => s.split('x').map(Number));
if (shots) mkdirSync(shots, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const rows = [];
for (const [w, h] of windows) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && !/GPU stall due to ReadPixels/.test(m.text())) errs.push(m.text());
  });
  page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
  await page.goto(`http://127.0.0.1:${port}/?e2e=1${query}`);
  await page.waitForFunction(() => typeof window.__milanoIsoSetView === 'function' && window.__milanoIso?.tiles?.loaded > 0, null, { timeout: 180000 });
  for (const kind of ['opening', 'explicit']) {
    const poke = async () => {
      if (kind === 'explicit') await page.evaluate(() => window.__milanoIsoSetView(0, 0, 600, 0));
      else await page.evaluate(() => window.dispatchEvent(new Event('resize'))); // asks for a frame, view unchanged
    };
    await poke();
    let last = -1;
    let same = 0;
    let st;
    const t0 = Date.now();
    while (Date.now() - t0 < 240000) {
      await page.waitForTimeout(250);
      await poke();
      await page.waitForTimeout(100);
      st = await page.evaluate(() => ({ r: window.__milanoIso.render, t: window.__milanoIso.tiles, c: window.__milanoIso.camera }));
      const done = st.t.loading === 0 && st.t.pending === 0 && st.t.failed === 0 && st.t.inScene === st.t.loaded && st.t.estimatedCalls !== null && st.r.calls === last; // T-6.5b: a plan still unknown means shards of the level are on the way
      same = done ? same + 1 : 0;
      last = st.r.calls;
      if (same >= 3) break;
    }
    const row = {
      window: `${w}x${h}`,
      kind,
      width: st.c.visibleWidth,
      level: st.t.level,
      baseLevel: st.t.baseLevel ?? null,
      budgetSwitched: st.t.budgetSwitched ?? null,
      estimatedCalls: st.t.estimatedCalls ?? null,
      calls: st.r.calls,
      settled: same >= 3,
      problems: errs.length,
    };
    row.ok = row.settled && row.level === 0 && row.calls <= 300 && row.problems === 0;
    rows.push(row);
    console.log(JSON.stringify(row));
    if (shots && kind === 'explicit') await page.screenshot({ path: `${shots}/default_${w}x${h}.png` });
  }
  await ctx.close();
}
await browser.close();
const bad = rows.filter((r) => !r.ok);
console.log(`${rows.length} checks, ${bad.length} not on level 0 within 300 calls`);
if (out) writeFileSync(out, JSON.stringify({ query, ok: bad.length === 0, rows }, null, 1));
process.exit(bad.length ? 1 : 0);
