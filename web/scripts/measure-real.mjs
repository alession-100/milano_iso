/* global process, console, window, requestAnimationFrame */
// T-4.1 evidence: draw calls and screenshots on the REAL pilot tiles (web/public/tiles/pilot).
// Usage (a preview server must already run on E2E_PORT, tiles copied by `make web-tiles`):
//   E2E_PORT=4181 node web/scripts/measure-real.mjs <out-dir> <park-x> <park-z>
// Not part of the test suite. The numbers it prints are the numbers quoted in the report.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 4173);
const [outDir, px, pz] = [process.argv[2], Number(process.argv[3]), Number(process.argv[4])];
if (!outDir || Number.isNaN(px) || Number.isNaN(pz)) {
  console.error('usage: measure-real.mjs <out-dir> <park-x> <park-z>');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const results = {};

async function settle(page) {
  await page.waitForFunction(() => {
    const s = window.__milanoIso?.tiles;
    return s && s.loading === 0 && s.visible > 0 && s.loaded >= s.visible;
  }, null, { timeout: 120_000 });
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
  await page.waitForTimeout(500);
}

for (const [name, w, h] of [
  ['desktop-1280x720', 1280, 720],
  ['mobile-412x915', 412, 915],
]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`http://localhost:${port}/?e2e=1`);
  await page.waitForFunction(() => typeof window.__milanoIsoSetView === 'function');
  await settle(page);
  const state = () => page.evaluate(() => ({ render: window.__milanoIso.render, tiles: window.__milanoIso.tiles, camera: window.__milanoIso.camera }));
  results[`${name}/default`] = await state();
  await page.screenshot({ path: path.join(outDir, `default-${name}.png`) });

  await page.evaluate(([x, z]) => window.__milanoIsoSetView(x, z, 150), [px, pz]);
  await settle(page);
  results[`${name}/park150`] = await state();
  await page.screenshot({ path: path.join(outDir, `park-150m-${name}.png`) });

  await page.evaluate(() => window.__milanoIsoSetView(0, 0, 4000));
  await settle(page);
  results[`${name}/wide4000`] = await state();
  await page.close();
}
await browser.close();
console.log(JSON.stringify(results, null, 2));
