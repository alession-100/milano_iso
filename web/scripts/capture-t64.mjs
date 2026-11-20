/* global process, console, window, requestAnimationFrame */
// T-6.4 evidence: screenshots of the coarsest level (L3, 3 m per pixel or more) for the before/after of
// ADR-0039 (no building shadows from level 3 on). Headed Chromium, real GPU, against a server on --port.
//   node scripts/capture-t64.mjs --port 4191 --out ../reports/artifacts/T-6.4/after
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const port = Number(arg('port', 4191));
const out = arg('out', '');
if (!out) {
  console.error('usage: capture-t64.mjs --port 4191 --out <dir>');
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: false, channel: 'chrome' });
for (const [name, w, h] of [
  ['desktop-1280x720', 1280, 720],
  ['phone-412x915', 412, 915],
]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`http://127.0.0.1:${port}/?e2e=1`);
  await page.waitForFunction(() => typeof window.__milanoIsoSetView === 'function' && window.__milanoIso?.tiles?.loaded > 0, null, { timeout: 120000 });
  for (const [view, x, z, width] of [
    ['l3-centre', 0, 0, 4000],
    ['l3-north-west', -2500, 1500, 4000],
    ['l2-centre', 0, 0, 2000],
  ]) {
    await page.evaluate(([x, z, width]) => window.__milanoIsoSetView(x, z, width), [x, z, width]);
    await page.waitForFunction(() => { const s = window.__milanoIso.tiles; return s.loading === 0 && s.pending === 0; }, null, { timeout: 120000 });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    await page.waitForTimeout(500);
    const info = await page.evaluate(() => ({ level: window.__milanoIso.tiles.level, calls: window.__milanoIso.render.calls, triangles: window.__milanoIso.render.triangles }));
    console.log(name, view, JSON.stringify(info));
    await page.screenshot({ path: path.join(out, `${view}-${name}.png`) });
  }
  await page.close();
}
await browser.close();
