/* global process, console, document, Image, Buffer */
// T-6.5b: pixel difference of PNG pairs (decoded in Chromium). For each pair `<name>`: before/<name>, after/<name>
// -> <out>/<name>-diff.png (red where the pixels differ, the "before" image in grey elsewhere) and a count line.
//
//   node scripts/png-diff.mjs <before-dir> <after-dir> <out-dir> [name.png ...]     (all *.png of before-dir when no names)
//   node scripts/png-diff.mjs --pair <before.png> <after.png> <diff.png>
// Prints JSON lines: name, size, differing pixels (any channel), pixels over 16/255, max channel difference.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
let pairs;
if (args[0] === '--pair') {
  pairs = [{ name: path.basename(args[1]), a: args[1], b: args[2], out: args[3] }];
} else {
  const [beforeDir, afterDir, outDir, ...names] = args;
  if (!beforeDir || !afterDir || !outDir) {
    console.error('usage: png-diff.mjs <before-dir> <after-dir> <out-dir> [names...] | --pair <a> <b> <diff>');
    process.exit(2);
  }
  mkdirSync(outDir, { recursive: true });
  const list = names.length ? names : readdirSync(beforeDir).filter((f) => f.endsWith('.png'));
  pairs = list.map((n) => ({ name: n, a: path.join(beforeDir, n), b: path.join(afterDir, n), out: path.join(outDir, n.replace(/\.png$/, '-diff.png')) }));
}
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('about:blank');
const rows = [];
for (const p of pairs) {
  const r = await page.evaluate(async ([a, b]) => {
    const load = (s) =>
      new Promise((res) => {
        const img = new Image();
        img.onload = () => res(img);
        img.src = `data:image/png;base64,${s}`;
      });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    if (ia.width !== ib.width || ia.height !== ib.height) return { sizeMismatch: [ia.width, ia.height, ib.width, ib.height] };
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
      if (d > 16) big += 1;
      if (d > maxDiff) maxDiff = d;
      if (d > 0 && where.length < 12) where.push([(i / 4) % c.width, Math.floor(i / 4 / c.width), d]);
      const grey = Math.round(0.3 * da.data[i] + 0.59 * da.data[i + 1] + 0.11 * da.data[i + 2]);
      o.data[i] = d > 0 ? 255 : grey;
      o.data[i + 1] = d > 0 ? 0 : grey;
      o.data[i + 2] = d > 0 ? 0 : grey;
      o.data[i + 3] = 255;
    }
    g.putImageData(o, 0, 0);
    return { width: c.width, height: c.height, differ, big, maxDiff, where, png: c.toDataURL('image/png').split(',')[1] };
  }, [readFileSync(p.a).toString('base64'), readFileSync(p.b).toString('base64')]);
  if (r.png) writeFileSync(p.out, Buffer.from(r.png, 'base64'));
  const row = { name: p.name, ...r, png: undefined };
  rows.push(row);
  console.log(JSON.stringify(row));
}
await browser.close();
