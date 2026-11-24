/* global process, console */
// T-6.9: compare two memory-infra dump summaries written by `memory-session.mjs --dumps`.
//   node scripts/memory-dump-compare.mjs early.json late.json [--min-mb 0.5]
// The page's renderer process is the one that has a `webgl` allocator (the other renderers are about:blank
// and Playwright helpers). Prints, in MB: its private footprint, the top-level allocator categories and every
// allocator (depth <= 4) whose size changed by at least --min-mb, sorted by change. Output is Markdown.
import { readFileSync } from 'node:fs';

const [earlyPath, latePath] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const minIdx = process.argv.indexOf('--min-mb');
const minMB = minIdx >= 0 ? Number(process.argv[minIdx + 1]) : 0.5;
const load = (p) => JSON.parse(readFileSync(p, 'utf8'));
const early = load(earlyPath);
const late = load(latePath);
const pageProc = (d) => d.processes.find((p) => Object.keys(p.allocators).some((k) => k === 'webgl' || k.startsWith('webgl/')));
const e = pageProc(early);
const l = pageProc(late);
if (!e || !l) throw new Error('no renderer process with a webgl allocator in one of the dumps');
const MB = 1048576;
const mb = (b) => (b ?? 0) / MB;
const fmt = (x) => x.toFixed(1).padStart(8);
console.log(`early: ${earlyPath} (t=${early.sampleT}s, pid ${e.pid})  late: ${latePath} (t=${late.sampleT}s, pid ${l.pid})`);
console.log(`same pid: ${e.pid === l.pid}`);
console.log(`private footprint (memory-infra): early ${mb(e.totals.private_footprint_bytes).toFixed(1)} MB, late ${mb(l.totals.private_footprint_bytes).toFixed(1)} MB, change ${(mb(l.totals.private_footprint_bytes) - mb(e.totals.private_footprint_bytes)).toFixed(1)} MB`);
const minutes = (late.sampleT - early.sampleT) / 60;
const names = [...new Set([...Object.keys(e.allocators), ...Object.keys(l.allocators)])];
const rows = names.map((n) => {
  const a = mb(e.allocators[n]?.sizeBytes);
  const b = mb(l.allocators[n]?.sizeBytes);
  return { n, a, b, d: b - a, depth: n.split('/').length };
});
const table = (title, list) => {
  console.log(`\n### ${title}\n\n| allocator | early MB | late MB | change MB | MB/min |\n|---|---|---|---|---|`);
  for (const r of list) console.log(`| ${r.n} | ${fmt(r.a)} | ${fmt(r.b)} | ${fmt(r.d)} | ${(r.d / minutes).toFixed(2).padStart(6)} |`);
};
table('Top-level allocators', rows.filter((r) => r.depth === 1).sort((x, y) => y.d - x.d));
table(`All allocators (depth <= 4) with |change| >= ${minMB} MB`, rows.filter((r) => Math.abs(r.d) >= minMB).sort((x, y) => y.d - x.d));
