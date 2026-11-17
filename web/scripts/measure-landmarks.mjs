/* global process, console, window, requestAnimationFrame */
// T-4.2 evidence: draw calls and landmark screenshots on the REAL pilot tiles (web/public/tiles/pilot).
// Usage (a preview server must already run on E2E_PORT, tiles copied by `make web-tiles`):
//   E2E_PORT=4185 node web/scripts/measure-landmarks.mjs <out-dir> <name:x:z> [<name:x:z> ...]
// x and z are client-frame metres (x = E - E0, z = -(N - N0)), taken from tests/landmarks.yaml.
// Not part of the test suite. The numbers it prints are the numbers quoted in the report.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 4173);
const outDir = process.argv[2];
const targets = process.argv.slice(3).map((a) => {
  const [name, x, z] = a.split(':');
  return { name, x: Number(x), z: Number(z) };
});
if (!outDir || targets.length === 0 || targets.some((t) => Number.isNaN(t.x) || Number.isNaN(t.z))) {
  console.error('usage: measure-landmarks.mjs <out-dir> <name:x:z> ...');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const results = {};

async function settle(page) {
  await page.waitForFunction(
    () => {
      const s = window.__milanoIso?.tiles;
      return s && s.loading === 0 && s.visible > 0 && s.loaded >= s.visible;
    },
    null,
    { timeout: 120_000 },
  );
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  await page.waitForTimeout(500);
}

for (const [size, w, h] of [
  ['desktop-1280x720', 1280, 720],
  ['mobile-412x915', 412, 915],
]) {
  for (const mode of ['day', 'night']) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`http://localhost:${port}/?e2e=1${mode === 'night' ? '&time=night' : ''}`);
    await page.waitForFunction(() => typeof window.__milanoIsoSetView === 'function');
    await settle(page);
    const state = () =>
      page.evaluate(() => ({ render: window.__milanoIso.render, tiles: window.__milanoIso.tiles }));
    if (mode === 'day') {
      results[`${size}/default`] = await state();
      await page.evaluate(() => window.__milanoIsoSetView(0, 0, 4000));
      await settle(page);
      results[`${size}/wide4000`] = await state();
      await page.evaluate(() => window.__milanoIsoSetView(0, 0, 600));
      await settle(page);
    }
    for (const t of targets) {
      await page.evaluate(([x, z]) => window.__milanoIsoSetView(x, z, 150), [t.x, t.z]);
      await settle(page);
      results[`${size}/${mode}/${t.name}`] = await state();
      await page.screenshot({ path: path.join(outDir, `${t.name}-150m-${mode}-${size}.png`) });
    }
    await page.close();
  }
}
await browser.close();
console.log(JSON.stringify(results, null, 2));
