// Render minimap.svg to a PNG in headless Chromium (T-5.3a evidence).
// Run from the repo root: node reports/artifacts/T-5.3a/render_minimap.mjs <minimap.svg> <out.png>
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const require = createRequire(resolve('web/package.json'));
const { chromium } = require('@playwright/test');

const [svgPath, outPath] = process.argv.slice(2);
const svg = readFileSync(svgPath, 'utf-8');
const vb = /viewBox="(-?\d+) (-?\d+) (\d+) (\d+)"/.exec(svg);
const [w, h] = [Number(vb[3]), Number(vb[4])];
const width = 900;
const height = Math.round((width * h) / w);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height } });
await page.goto(pathToFileURL(resolve(svgPath)).href);
await page.evaluate(
  ([ww, hh]) => {
    const el = document.documentElement;
    el.setAttribute('width', String(ww));
    el.setAttribute('height', String(hh));
  },
  [width, height],
);
await page.screenshot({ path: outPath });
await browser.close();
console.log(`wrote ${outPath} (${width}x${height})`);
