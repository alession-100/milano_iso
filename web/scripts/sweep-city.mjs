/* global process, console, window */
// T-6.5: settled-view sweep of the real city tileset. Draw calls, triangles, level and tiles drawn per
// level for every (window, centre, rotation step, visible width) view, each measured once the view has
// settled (no tile pending or loading, scene equal to loaded, draw calls unchanged for three reads).
// Not part of the default e2e run (`npm run sweep:city`); it needs the built site served already:
//
//   npm run build -- --outDir <dir> && npm run serve -- --dir <dir> --port 4197
//   node scripts/sweep-city.mjs --port 4197 --out ../reports/artifacts/T-6.5/sweep_after.json
//        [--windows 1280x720,1920x1080] [--widths 3830,4000] [--centres 0:0,1000:-1000] [--steps 0,1] [--label text]
//
// Software GL (SwiftShader, headless): draw calls, triangles and levels do not depend on the GPU.
// One page per (window, centre, step); the widths run in ascending order on it, so the level
// hysteresis is the same on every run (zooming out never waits for a threshold). The result JSON is a
// list of views; `--summary file.md` also writes the table (max per window, every view over the cap).
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const port = Number(arg('port', 4197));
const out = arg('out', '');
const summaryOut = arg('summary', '');
const label = arg('label', '');
const CAP = Number(arg('cap', 300));
// T-6.5a: 16:10 windows (1440x900, 1680x1050, 1920x1200) and 3440x1440 added.
// `--merge-only` (T-6.5b): measure nothing; --base then lists result files (comma separated) to put together and summarise.
const mergeOnly = process.argv.includes('--merge-only');
const windows = mergeOnly ? [] : arg('windows', '360x640,412x915,768x1024,1280x720,1366x768,1440x900,1680x1050,1920x1080,1920x1200,2560x1440,3440x1440')
  .split(',')
  .map((s) => s.split('x').map(Number));
// `--dense` (T-6.5a): every 40 m from 520 to 1,320 m, added to --widths.
const dense = process.argv.includes('--dense');
const widths = [...new Set([
  ...arg('widths', '300,600,1200,1800,2400,2800,3000,3300,3600,3830,4000').split(',').filter(Boolean).map(Number),
  ...(dense ? Array.from({ length: 21 }, (_, i) => 520 + 40 * i) : []),
])].sort((a, b) => a - b);
// `--orders asc,desc`: each group runs its widths in these orders one after the other on the same page, so the
// hysteresis paths of zooming out and in are both covered (T-6.5a). Default asc only (T-6.5).
const orders = arg('orders', 'asc').split(',');
// `--query '&budget=off'`: extra query string, e.g. the switch disabled to measure the level the 1-pixel rule would draw.
const query = arg('query', '');
// The origin, the two reviewer centres, and two more points inside the comune (a tile exists there at
// every level: east of the centre, and the north-west quarter).
const centres = arg('centres', '0:0,1000:-1000,-1250:750,2500:2000,-3500:-2500')
  .split(',')
  .map((s) => s.split(':').map(Number));
const steps = arg('steps', '0,1').split(',').map(Number);

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const views = [];
let n = 0;
for (const [w, h] of windows) {
  for (const [x, z] of centres) {
    for (const step of steps) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      const errs = [];
      page.on('console', (m) => {
        // the software GL driver's ReadPixels stall note is not an app problem (ADR-0012)
        if ((m.type() === 'error' || m.type() === 'warning') && !/GPU stall due to ReadPixels/.test(m.text())) errs.push(m.text());
      });
      page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
      await page.goto(`http://127.0.0.1:${port}/?e2e=1${query}`, { timeout: 180000 });
      await page.waitForFunction(() => typeof window.__milanoIsoSetView === 'function' && window.__milanoIso?.tiles?.loaded > 0, null, { timeout: 180000 });
      for (const order of orders) for (const width of order === 'desc' ? [...widths].reverse() : widths) {
        const set = ([px, pz, pw, ps]) => window.__milanoIsoSetView(px, pz, pw, ps);
        await page.evaluate(set, [x, z, width, step]);
        let last = -1;
        let same = 0;
        let st;
        const t0 = Date.now();
        while (Date.now() - t0 < 240000) {
          await page.waitForTimeout(250);
          await page.evaluate(set, [x, z, width, step]); // request a frame
          await page.waitForTimeout(100);
          st = await page.evaluate(() => ({ r: window.__milanoIso.render, t: window.__milanoIso.tiles, c: window.__milanoIso.camera }));
          const done = st.t.loading === 0 && st.t.pending === 0 && st.t.failed === 0 && st.t.inScene === st.t.loaded && st.t.estimatedCalls !== null && st.r.calls === last; // T-6.5b: a plan still unknown means shards of the level are on the way
          same = done ? same + 1 : 0;
          last = st.r.calls;
          if (same >= 3) break;
        }
        const v = {
          window: `${w}x${h}`,
          order,
          x,
          z,
          step,
          requestedWidth: width,
          width: st.c.visibleWidth,
          calls: st.r.calls,
          triangles: st.r.triangles,
          level: st.t.level,
          baseLevel: st.t.baseLevel ?? null,
          budgetSwitched: st.t.budgetSwitched ?? null,
          estimatedCalls: st.t.estimatedCalls ?? null,
          // error of the level drawn, in CSS pixels: its tolerance over the metres per pixel (ADR-0037 allows 1)
          mpp: st.t.mpp,
          errorPx: st.t.tolerances ? st.t.tolerances[st.t.level] / st.t.mpp : null,
          drawnByLevel: st.t.drawnByLevel,
          visible: st.t.visible,
          loaded: st.t.loaded,
          failedTiles: st.t.failed,
          settled: same >= 3,
          problems: errs.length,
          problemMessages: errs.slice(0, 3).map((e) => e.slice(0, 200)),
        };
        views.push(v);
        n += 1;
        if (n % 10 === 0) console.log(`${n} views, last ${JSON.stringify(v)}`);
      }
      await ctx.close();
    }
  }
}
await browser.close();

// --base <json>: the views of this run replace the same views (window, centre, step, width) of an earlier
// result, which is then written out whole. Used to run again a group of views that did not settle.
let all = views;
if (arg('base', '')) {
  const key = (v) => [v.window, v.order ?? 'asc', v.x, v.z, v.step, v.requestedWidth].join('|');
  const merged = new Map(arg('base', '').split(',').flatMap((f) => JSON.parse(readFileSync(f, 'utf8')).data).map((v) => [key(v), v]));
  for (const v of views) merged.set(key(v), v);
  all = [...merged.values()];
}
const over = all.filter((v) => v.calls > CAP);
const unsettled = all.filter((v) => !v.settled);
const maxBy = {};
for (const v of all) if (!maxBy[v.window] || v.calls > maxBy[v.window].calls) maxBy[v.window] = v;
const switched = all.filter((v) => v.budgetSwitched === true).length;
const worstPx = all.filter((v) => v.budgetSwitched === true).sort((a, b) => b.errorPx - a.errorPx)[0] ?? null;
// plan minus real, per window (min, median, max) over the settled views that have a plan (T-6.5a)
const diffsBy = {};
for (const v of all) if (v.settled && v.estimatedCalls != null) (diffsBy[v.window] ??= []).push(v.estimatedCalls - v.calls);
const dist = (a) => {
  const s = [...a].sort((p, q) => p - q);
  return { min: s[0], median: s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2, max: s[s.length - 1], n: s.length };
};
const planMinusReal = Object.fromEntries(Object.entries(diffsBy).map(([k, a]) => [k, dist(a)]));
const planMinusRealAll = Object.values(diffsBy).flat().length ? dist(Object.values(diffsBy).flat()) : null;
const planBelowReal = all.filter((v) => v.settled && v.estimatedCalls != null && v.estimatedCalls < v.calls).length;
const switchedByWindow = {};
for (const v of all) if (v.budgetSwitched === true) (switchedByWindow[v.window] ??= []).push(`(${v.x},${v.z}) s${v.step} ${v.order ?? 'asc'} ${Math.round(v.width)} m L${v.baseLevel}->L${v.level} est ${v.estimatedCalls} real ${v.calls} err ${v.errorPx.toFixed(2)} px`);
const result = { label, planBelowReal, planMinusRealAll, planMinusReal, switchedByWindow, cap: CAP, views: all.length, unsettled: unsettled.length, over: over.length, budgetSwitchedViews: all.some((v) => v.budgetSwitched !== null) ? switched : null, worstErrorPxOnSwitchedViews: worstPx, maxByWindow: maxBy, data: all };
if (out) writeFileSync(out, JSON.stringify(result, null, 1));
const lines = [
  `Sweep ${label}: ${all.length} views, ${unsettled.length} not settled, ${over.length} over ${CAP} draw calls, budget switch fired on ${result.budgetSwitchedViews ?? 'n/a (no switch in this build)'}.`,
  worstPx ? `Worst error on a view where the budget switched the level: ${worstPx.errorPx.toFixed(2)} px (${worstPx.window}, (${worstPx.x}, ${worstPx.z}), step ${worstPx.step}, ${Math.round(worstPx.width)} m, level ${worstPx.level} from base ${worstPx.baseLevel}).` : '',
  '',
  `Plan minus real, all settled views: ${planMinusRealAll ? `min ${planMinusRealAll.min}, median ${planMinusRealAll.median}, max ${planMinusRealAll.max} (n ${planMinusRealAll.n})` : 'n/a'}; views with plan below real: ${planBelowReal}.`,
  '',
  '| Window | Max draw calls | At (centre, step, order, width m) | Level | Views over cap | Switch fired | Worst px (switched) | Plan - real min / median / max |',
  '|---|---:|---|---:|---:|---:|---:|---|',
  ...Object.entries(maxBy).map(([k, v]) => {
    const sw = all.filter((o) => o.window === k && o.budgetSwitched === true);
    const pr = planMinusReal[k];
    return `| ${k} | ${v.calls} | (${v.x}, ${v.z}) step ${v.step} ${v.order ?? 'asc'} ${Math.round(v.width)} | ${v.level} | ${over.filter((o) => o.window === k).length} | ${sw.length} | ${sw.length ? Math.max(...sw.map((o) => o.errorPx)).toFixed(2) : '-'} | ${pr ? `${pr.min} / ${pr.median} / ${pr.max}` : 'n/a'} |`;
  }),
];
const swLines = Object.entries(switchedByWindow);
if (swLines.length) {
  lines.push('', 'Views where the switch fired:');
  for (const [k, a] of swLines) lines.push('', `- ${k} (${a.length})`, ...a.map((t) => `  - ${t}`));
}
if (over.length) {
  lines.push('', '| Window | Centre | Step | Width m | Level | Draw calls |', '|---|---|---:|---:|---:|---:|');
  for (const v of over) lines.push(`| ${v.window} | (${v.x}, ${v.z}) | ${v.step} | ${Math.round(v.width)} | ${v.level} | ${v.calls} |`);
}
console.log(lines.join('\n'));
if (summaryOut) writeFileSync(summaryOut, `${lines.join('\n')}\n`);
process.exit(unsettled.length ? 1 : 0);
