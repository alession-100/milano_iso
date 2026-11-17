/* global process, console, document, Image */
// T-5.4 evidence: the approved map look did not change. Compares the old and the regenerated win32
// visual baselines pixel by pixel, EXCLUDING the rectangles where the UI is drawn (the day/night toggle
// top right, the attribution along the bottom, and the info card when it is open). Anything left
// is map, and must be identical.
// Usage: node web/scripts/compare-baselines.mjs <old-dir> <new-dir>
// Both directories hold the *-win32.png files of web/e2e/visual.spec.ts-snapshots.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const [oldDir, newDir] = process.argv.slice(2);
if (!oldDir || !newDir) {
  console.error('usage: compare-baselines.mjs <old-dir> <new-dir>');
  process.exit(2);
}

/** Rectangles (x0, y0, x1, y1) that hold UI in a baseline of this size and kind; generous on purpose. */
function masks(w, h, name) {
  const narrow = w <= 600;
  const out = [
    [w - 110, 0, w, 60], // the day/night toggle (old 32 px tall, new 44 px)
    [0, h - 130, w, h], // the attribution (wraps to up to three lines at 412 px)
  ];
  if (name.startsWith('info-card')) out.push(narrow ? [0, h - 560, w, h] : [w - 320, 90, w, 420]);
  return out;
}

// Software GL leaves sub-visible noise between two renders of the same scene (at most 2 of 255 on a channel,
// in a few hundred pixels); the visual tests themselves tolerate more (threshold 0.02, ratio 0.001).
const NOISE_MAX_DELTA = 2;
const browser = await chromium.launch();
const page = await browser.newPage();
const toData = (file) => 'data:image/png;base64,' + readFileSync(file).toString('base64');
const results = [];
let total = 0;
let differing = 0;
// The mask function cannot be sent to the page, so the rectangles are computed here and sent as data.
for (const f of readdirSync(newDir).filter((n) => n.endsWith('-win32.png')).sort()) {
  const oldFile = path.join(oldDir, f);
  const newFile = path.join(newDir, f);
  const probe = await page.evaluate(async (u) => {
    const img = new Image();
    img.src = u;
    await img.decode();
    return [img.width, img.height];
  }, toData(newFile));
  const rects = masks(probe[0], probe[1], f);
  const r = await page.evaluate(
    async ([a, b, m]) => {
      const load = async (u) => {
        const img = new Image();
        img.src = u;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        return g.getImageData(0, 0, c.width, c.height);
      };
      const A = await load(a);
      const B = await load(b);
      if (A.width !== B.width || A.height !== B.height) return { size: false };
      const w = A.width;
      const h = A.height;
      let diff = 0;
      let masked = 0;
      let maxDelta = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (m.some(([x0, y0, x1, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1)) {
            masked++;
            continue;
          }
          const i = (y * w + x) * 4;
          const d = Math.max(Math.abs(A.data[i] - B.data[i]), Math.abs(A.data[i + 1] - B.data[i + 1]), Math.abs(A.data[i + 2] - B.data[i + 2]));
          if (d > 0) diff++;
          if (d > maxDelta) maxDelta = d;
        }
      }
      return { size: true, w, h, diff, masked, maxDelta };
    },
    [toData(oldFile), toData(newFile), rects],
  );
  total += 1;
  if (!r.size || r.maxDelta > NOISE_MAX_DELTA) differing += 1;
  results.push({ file: f, ...r });
  console.log(`${f.padEnd(46)} ${r.size ? `${r.w}x${r.h} outside the UI boxes: ${r.diff} differing pixels (max channel delta ${r.maxDelta}); masked ${r.masked} px` : 'SIZE DIFFERS'}`);
}
await browser.close();
console.log(`${total} images compared, ${differing} with a channel difference above ${NOISE_MAX_DELTA}/255 outside the UI boxes`);
process.exit(differing === 0 ? 0 : 1);
