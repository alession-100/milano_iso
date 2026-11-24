/* global process, console */
// T-6.9: side by side workload and memory of two runs (JSON files of memory-nodriver.mjs / memory-session.mjs).
//   node workload_compare.mjs nodriver.json playwright.json [window-minutes]
import { readFileSync } from 'node:fs';

const [fa, fb] = process.argv.slice(2);
const W = Number(process.argv[4] ?? 20) * 60; // compare the first W seconds of both
const load = (f) => JSON.parse(readFileSync(f, 'utf8')).samples;
const slope = (pts, key) => {
  if (pts.length < 3) return NaN;
  const mt = pts.reduce((a, p) => a + p.t, 0) / pts.length;
  const my = pts.reduce((a, p) => a + p[key], 0) / pts.length;
  let num = 0;
  let den = 0;
  for (const p of pts) {
    num += (p.t - mt) * (p[key] - my);
    den += (p.t - mt) ** 2;
  }
  return (60 * num) / den;
};
const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
function summary(samples, label) {
  const s = samples.filter((x) => x.t <= W);
  const first = s[0];
  const last = s.at(-1);
  const minutes = (last.t - first.t) / 60;
  const levels = {};
  for (const x of s) levels[`L${x.level}`] = (levels[`L${x.level}`] ?? 0) + 1;
  const vis = {};
  for (const x of s) vis[x.visibility] = (vis[x.visibility] ?? 0) + 1;
  const fetched = last.tilesStarted - first.tilesStarted;
  return {
    label,
    samples: s.length,
    framesPerMin: (last.frames - first.frames) / minutes,
    tileFetchesPerMin: fetched / minutes,
    totalFrames: last.frames,
    totalTileFetches: last.tilesStarted,
    shardsLast: last.shardsLoaded,
    levelSamples: levels,
    visibility: vis,
    focusFalseSamples: s.filter((x) => x.hasFocus === false).length,
    geometriesMedian: med(s.map((x) => x.geometries)),
    texturesMedian: med(s.map((x) => x.textures)),
    rendererMedianMin4to20: med(s.filter((x) => x.t > 240 && x.t <= 1200).map((x) => x.rendererMB)),
    rendererSlopeMin4to20: slope(s.filter((x) => x.t > 240 && x.t <= 1200), 'rendererMB'),
  };
}
const A = summary(load(fa), 'no driver');
const B = summary(load(fb), 'Playwright');
console.log(JSON.stringify({ comparedSeconds: W, A, B, ratio: { frames: A.framesPerMin / B.framesPerMin, tileFetches: A.tileFetchesPerMin / B.tileFetchesPerMin } }, null, 2));
const full = load(fa);
for (const [lo, hi] of [[4, 20], [20, 40], [40, 60]]) {
  const pts = full.filter((x) => x.t > lo * 60 && x.t <= hi * 60);
  console.log(`no-driver renderer slope minutes ${lo}-${hi}: ${slope(pts, 'rendererMB').toFixed(2)} MB/min, median ${med(pts.map((x) => x.rendererMB)).toFixed(0)} MB, gpu slope ${slope(pts, 'gpuProcessMB').toFixed(2)}, heap slope ${slope(pts, 'heapUsedMB').toFixed(2)}`);
}
