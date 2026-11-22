/* global process, console, window, document, Image, Buffer */
// T-6.5: the look of the coarse levels before and after a change, with a pixel-difference count per pair,
// and the features that picking reports (hover) at a grid of points, before and after.
//
//   node scripts/look-diff.mjs --before 4197 --after 4196 --out ../reports/artifacts/T-6.5/look
//
// Two servers of two builds of the same tileset (headless software GL, 1280x720). Every view is chosen so
// that the 1-pixel rule picks the level, and the draw-call budget does not switch it, in both builds.
// Output: <view>_before.png, <view>_after.png, <view>_diff.png (red where they differ), look.json, look.md.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const before = Number(arg('before', 4197));
const after = Number(arg('after', 4196));
// T-6.5b: --views l0 compares level-0 views; --phase before|after captures one build (--port) and writes picks_<phase>.json,
// --phase compare reads both captures and compares them (one server at a time, so two builds need not run together).
const viewSet = arg('views', 'coarse');
const phase = arg('phase', 'both');
const phasePort = Number(arg('port', 4204));
const out = arg('out', '');
if (!out) {
  console.error('usage: look-diff.mjs --before <port> --after <port> --out <dir>');
  process.exit(2);
}
mkdirSync(out, { recursive: true });

// name, level expected, centre, width, step, mode
const VIEWS_COARSE = [
  ['l1-day', 1, 0, 0, 1500, 0, 'day'],
  ['l1-night', 1, 0, 0, 1500, 0, 'night'],
  ['l2-day', 2, 0, 0, 3000, 0, 'day'],
  ['l2-night', 2, 0, 0, 3000, 0, 'night'],
  ['l3-day', 3, -1250, 750, 4000, 0, 'day'],
  ['l3-night', 3, -1250, 750, 4000, 0, 'night'],
  ['l2-east-rot1-day', 2, 2500, 2000, 2400, 1, 'day'],
  ['l1-water-day', 1, 1000, -1000, 1200, 0, 'day'],
];
// level-0 views (T-6.5b): the default view, a close view, a rotated view, night, a view over water and a wide view
const VIEWS_L0 = [
  ['l0-default-day', 0, 0, 0, 600, 0, 'day'],
  ['l0-default-night', 0, 0, 0, 600, 0, 'night'],
  ['l0-close-day', 0, 0, 0, 250, 0, 'day'],
  ['l0-rot1-day', 0, 0, 0, 600, 1, 'day'],
  ['l0-rot2-day', 0, 300, -200, 500, 2, 'day'],
  ['l0-water-day', 0, 1000, -1000, 450, 0, 'day'],
  ['l0-east-rot3-day', 0, 2500, 2000, 500, 3, 'day'],
  ['l0-west-day', 0, -1250, 750, 600, 0, 'day'],
];
const VIEWS = viewSet === 'l0' ? VIEWS_L0 : VIEWS_COARSE;
const GRID = [];
for (let r = 1; r <= 5; r++) for (let c = 1; c <= 9; c++) GRID.push([Math.round((c * 1280) / 10), Math.round((r * 720) / 6)]);

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

async function capture(port, tag) {
  const res = {};
  for (const [name, level, x, z, width, step, mode] of VIEWS) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${port}/?e2e=1&time=${mode}`);
    await page.waitForFunction(() => typeof window.__milanoIsoSetView === 'function' && window.__milanoIso?.tiles?.loaded > 0, null, { timeout: 180000 });
    const set = ([px, pz, pw, ps]) => window.__milanoIsoSetView(px, pz, pw, ps);
    let last = -1;
    let same = 0;
    let st;
    for (let i = 0; i < 400 && same < 4; i++) {
      await page.evaluate(set, [x, z, width, step]);
      await page.waitForTimeout(300);
      st = await page.evaluate(() => ({ t: window.__milanoIso.tiles, r: window.__milanoIso.render }));
      const done = st.t.loading === 0 && st.t.pending === 0 && st.t.failed === 0 && st.t.inScene === st.t.loaded && st.r.calls === last;
      same = done ? same + 1 : 0;
      last = st.r.calls;
    }
    if (same < 4 || st.t.level !== level) throw new Error(`${tag} ${name}: not settled at level ${level} (level ${st.t.level}, same ${same})`);
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(out, `${name}_${tag}.png`) });
    // picking: hover over a grid of points; the feature under each (layer and identity) as the picker reports it
    const picks = [];
    for (const [px, py] of GRID) {
      await page.mouse.move(px, py);
      await page.waitForTimeout(60);
      const hover = await page.evaluate(() => window.__milanoIso.selection.hover);
      picks.push(hover ? [hover.layer, hover.key ?? hover.landmarkId ?? `${hover.osmType}${hover.osmId}`].join(':') : null);
    }
    res[name] = { calls: st.r.calls, level: st.t.level, drawnByLevel: st.t.drawnByLevel, picks };
    await ctx.close();
  }
  return res;
}

let resBefore;
let resAfter;
if (phase === 'before' || phase === 'after') {
  const res = await capture(phasePort, phase);
  writeFileSync(path.join(out, `picks_${phase}.json`), JSON.stringify(res, null, 1));
  await browser.close();
  process.exit(0);
}
if (phase === 'compare') {
  resBefore = JSON.parse(readFileSync(path.join(out, 'picks_before.json'), 'utf8'));
  resAfter = JSON.parse(readFileSync(path.join(out, 'picks_after.json'), 'utf8'));
} else {
  resBefore = await capture(before, 'before');
  resAfter = await capture(after, 'after');
}

// pixel comparison in a page: decode both PNGs, count the pixels that differ
const cmpPage = await browser.newPage();
await cmpPage.goto('about:blank');
const report = [];
for (const [name, level] of VIEWS) {
  const a = readFileSync(path.join(out, `${name}_before.png`)).toString('base64');
  const b = readFileSync(path.join(out, `${name}_after.png`)).toString('base64');
  const r = await cmpPage.evaluate(async ([a, b]) => {
    const load = (s) =>
      new Promise((res) => {
        const img = new Image();
        img.onload = () => res(img);
        img.src = `data:image/png;base64,${s}`;
      });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const c = document.createElement('canvas');
    c.width = ia.width;
    c.height = ia.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(ia, 0, 0);
    const da = g.getImageData(0, 0, c.width, c.height);
    g.drawImage(ib, 0, 0);
    const db = g.getImageData(0, 0, c.width, c.height);
    let differ = 0;
    let big = 0;
    let maxDiff = 0;
    const where = [];
    const o = g.createImageData(c.width, c.height);
    for (let i = 0; i < da.data.length; i += 4) {
      const d = Math.max(Math.abs(da.data[i] - db.data[i]), Math.abs(da.data[i + 1] - db.data[i + 1]), Math.abs(da.data[i + 2] - db.data[i + 2]));
      if (d > 0) differ += 1;
      if (d > 0 && where.length < 8) {
        const px = i / 4;
        where.push({ x: px % c.width, y: Math.floor(px / c.width), before: [da.data[i], da.data[i + 1], da.data[i + 2]], after: [db.data[i], db.data[i + 1], db.data[i + 2]] });
      }
      if (d > 16) big += 1;
      if (d > maxDiff) maxDiff = d;
      const grey = Math.round(0.3 * da.data[i] + 0.59 * da.data[i + 1] + 0.11 * da.data[i + 2]);
      o.data[i] = d > 0 ? 255 : grey;
      o.data[i + 1] = d > 0 ? 0 : grey;
      o.data[i + 2] = d > 0 ? 0 : grey;
      o.data[i + 3] = 255;
    }
    g.putImageData(o, 0, 0);
    return { width: c.width, height: c.height, differ, big, maxDiff, where, diffPng: c.toDataURL('image/png').split(',')[1] };
  }, [a, b]);
  writeFileSync(path.join(out, `${name}_diff.png`), Buffer.from(r.diffPng, 'base64'));
  const pb = resBefore[name].picks;
  const pa = resAfter[name].picks;
  const pickDiff = pb.filter((p, i) => p !== pa[i]).length;
  report.push({
    view: name,
    level,
    pixels: r.width * r.height,
    differ: r.differ,
    differOver16: r.big,
    maxChannelDiff: r.maxDiff,
    firstDifferingPixels: r.where,
    picksTested: pb.length,
    picksHit: pb.filter((p) => p !== null).length,
    picksDifferent: pickDiff,
    callsBefore: resBefore[name].calls,
    callsAfter: resAfter[name].calls,
  });
}
await browser.close();
writeFileSync(path.join(out, 'look.json'), JSON.stringify({ report, before: resBefore, after: resAfter }, null, 1));
const lines = [
  '| View | Level | Pixels | Differ (any channel) | Differ by more than 16/255 | Max channel diff | Pick points | Hits | Different picks | Calls before | Calls after |',
  '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ...report.map((r) => `| ${r.view} | ${r.level} | ${r.pixels} | ${r.differ} | ${r.differOver16} | ${r.maxChannelDiff} | ${r.picksTested} | ${r.picksHit} | ${r.picksDifferent} | ${r.callsBefore} | ${r.callsAfter} |`),
];
writeFileSync(path.join(out, 'look.md'), `${lines.join('\n')}\n`);
console.log(lines.join('\n'));
