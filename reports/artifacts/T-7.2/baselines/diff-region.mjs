/* global process, console, document, Image, Buffer */
// T-7.2 evidence: for each PNG pair (before dir, after dir), the number of differing pixels, the bounding box of
// the differing pixels, and how many differing pixels lie outside the bottom band (y >= height - bandPx).
// Writes <out>/<name>-diff.png (red where different, the "before" image in grey elsewhere).
//
//   node diff-region.mjs <playwright-module-url> <before-dir> <after-dir> <out-dir> <bandPx>
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [pw, beforeDir, afterDir, outDir, bandArg] = process.argv.slice(2);
const bandPx = Number(bandArg);
const { chromium } = await import(pw);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('about:blank');
for (const name of readdirSync(beforeDir).filter((f) => f.endsWith('.png')).sort()) {
  const r = await page.evaluate(
    async ([a, b, band]) => {
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
      const o = g.createImageData(c.width, c.height);
      let differ = 0;
      let outside = 0;
      let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
      for (let i = 0; i < da.data.length; i += 4) {
        const d = Math.max(Math.abs(da.data[i] - db.data[i]), Math.abs(da.data[i + 1] - db.data[i + 1]), Math.abs(da.data[i + 2] - db.data[i + 2]));
        const x = (i / 4) % c.width;
        const y = Math.floor(i / 4 / c.width);
        if (d > 0) {
          differ += 1;
          if (y < c.height - band) outside += 1;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
        const grey = Math.round(0.3 * da.data[i] + 0.59 * da.data[i + 1] + 0.11 * da.data[i + 2]);
        o.data[i] = d > 0 ? 255 : grey;
        o.data[i + 1] = d > 0 ? 0 : grey;
        o.data[i + 2] = d > 0 ? 0 : grey;
        o.data[i + 3] = 255;
      }
      g.putImageData(o, 0, 0);
      return { width: c.width, height: c.height, differ, outside, bbox: differ ? [x0, y0, x1, y1] : null, png: c.toDataURL('image/png').split(',')[1] };
    },
    [readFileSync(path.join(beforeDir, name)).toString('base64'), readFileSync(path.join(afterDir, name)).toString('base64'), bandPx],
  );
  if (r.png) writeFileSync(path.join(outDir, name.replace(/\.png$/, '-diff.png')), Buffer.from(r.png, 'base64'));
  console.log(JSON.stringify({ name, ...r, png: undefined }));
}
await browser.close();
