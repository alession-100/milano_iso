/* global process, console */
// T-6.6: puts the sweep parts together and says, per window, how often the budget switch fired, on how many of those views it was needed
// (the level of the 1-pixel rule really issues more than the cap with the switch off: `switch-need.mjs`), the worst error of a
// switched view, the maximum draw calls, and count minus real.
//
//   node scripts/sweep-t66-report.mjs --parts a.json,b.json,... --need need.json --out ../reports/artifacts/T-6.6/sweep.json --md ../reports/artifacts/T-6.6/sweep.md
import { readFileSync, writeFileSync } from 'node:fs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const CAP = 280;
const parts = arg('parts', '').split(',').filter(Boolean).map((f) => JSON.parse(readFileSync(f, 'utf8')));
const need = arg('need', '') ? JSON.parse(readFileSync(arg('need', ''), 'utf8')) : null;
const all = parts.flatMap((p) => p.data);
const key = (v) => [v.window, v.x, v.z, v.step, v.requestedWidth].join('|');
const needBy = new Map((need?.rows ?? []).map((r) => [[r.window, r.x, r.z, r.step, r.width].join('|'), r]));
const dist = (a) => {
  const s = [...a].sort((p, q) => p - q);
  if (!s.length) return null;
  return { min: s[0], median: s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2, max: s[s.length - 1], n: s.length };
};
const windows = [...new Set(all.map((v) => v.window))];
const rows = {};
for (const w of windows) {
  const vs = all.filter((v) => v.window === w);
  const sw = vs.filter((v) => v.budgetSwitched === true);
  const nd = sw.map((v) => needBy.get(key(v))).filter(Boolean);
  const exact = vs.filter((v) => v.settled && v.estimatedExact === true);
  rows[w] = {
    views: vs.length,
    unsettled: vs.filter((v) => !v.settled).length,
    over300: vs.filter((v) => v.calls > 300).length,
    over280: vs.filter((v) => v.calls > CAP).length,
    maxCalls: Math.max(...vs.map((v) => v.calls)),
    fired: sw.length,
    firedMeasured: nd.length,
    needed: nd.filter((r) => r.needed).length,
    needed300: nd.filter((r) => r.needed300).length,
    notNeeded: nd.filter((r) => !r.needed).length,
    notNeededInHysteresisBand: nd.filter((r) => !r.needed && r.inHysteresisBand).length,
    notNeededBelowBand: nd.filter((r) => !r.needed && !r.inHysteresisBand).length,
    worstErrorPxSwitched: sw.length ? Math.max(...sw.map((v) => v.errorPx)) : null,
    worstErrorPxNeeded: nd.filter((r) => r.needed).length ? Math.max(...nd.filter((r) => r.needed).map((r) => r.errorPx)) : null,
    // views that were not switched yet cost more than the cap: the switch was needed and did not fire
    notSwitchedOverCap: vs.filter((v) => v.budgetSwitched !== true && v.calls > CAP).length,
    exactViews: exact.length,
    countMinusReal: dist(exact.map((v) => v.estimatedCalls - v.calls)),
    countBelowReal: exact.filter((v) => v.estimatedCalls < v.calls).length,
    countBelowGl: exact.filter((v) => v.gl != null && v.estimatedCalls < v.gl).length,
    glMinusCalls: dist(vs.filter((v) => v.gl != null).map((v) => v.gl - v.calls)),
  };
}
const exactAll = all.filter((v) => v.settled && v.estimatedExact === true);
const total = {
  views: all.length,
  unsettled: all.filter((v) => !v.settled).length,
  over300: all.filter((v) => v.calls > 300).length,
  maxCalls: Math.max(...all.map((v) => v.calls)),
  fired: all.filter((v) => v.budgetSwitched === true).length,
  exactViews: exactAll.length,
  notExactViews: all.filter((v) => v.settled && v.estimatedExact !== true).length,
  countMinusReal: dist(exactAll.map((v) => v.estimatedCalls - v.calls)),
  countBelowReal: exactAll.filter((v) => v.estimatedCalls < v.calls).length,
  problems: all.filter((v) => v.problems > 0).length,
};
// level drawn and error at each probed width, for the windows with few views (R2)
const result = { cap: CAP, total, byWindow: rows, data: all };
if (arg('out', '')) writeFileSync(arg('out', ''), JSON.stringify(result, null, 1));
const f = (x) => (x == null ? '-' : typeof x === 'number' ? (Number.isInteger(x) ? String(x) : x.toFixed(2)) : x);
const lines = [
  `Sweep T-6.6: ${total.views} views, ${total.unsettled} not settled, ${total.over300} over 300, max ${total.maxCalls} calls, switch fired on ${total.fired}, problems ${total.problems}.`,
  `Count minus real (settled views with an exact count, ${total.exactViews} of ${total.views - total.unsettled}): ${total.countMinusReal ? `min ${total.countMinusReal.min}, median ${total.countMinusReal.median}, max ${total.countMinusReal.max}` : 'n/a'}; count below real on ${total.countBelowReal} views.`,
  '',
  '| Window | Views | Max calls | Over 300 | Over 280 | Fired | Needed (cap 280) | Not needed (in 252-280 band / below) | Switched over cap not fired | Worst px switched | Worst px needed | Count - real min / median / max | Count < real |',
  '|---|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|---|---:|',
  ...windows.map((w) => {
    const r = rows[w];
    const cr = r.countMinusReal;
    return `| ${w} | ${r.views} | ${r.maxCalls} | ${r.over300} | ${r.over280} | ${r.fired} | ${need ? r.needed : 'n/a'} | ${need ? `${r.notNeeded} (${r.notNeededInHysteresisBand} / ${r.notNeededBelowBand})` : 'n/a'} | ${r.notSwitchedOverCap} | ${f(r.worstErrorPxSwitched)} | ${f(r.worstErrorPxNeeded)} | ${cr ? `${cr.min} / ${cr.median} / ${cr.max}` : 'n/a'} | ${r.countBelowReal} |`;
  }),
];
console.log(lines.join('\n'));
if (arg('md', '')) writeFileSync(arg('md', ''), `${lines.join('\n')}\n`);
