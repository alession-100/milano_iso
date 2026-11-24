/* global process, console, window, requestAnimationFrame */
// T-7.2 evidence: screenshots of the REAL pilot tiles (web/public/tiles/pilot, copied by `make web-tiles`) served
// by `npm run serve`: the default view at 1280x720 (the README screenshot), and the About dialog open at
// 1280x720 and 412x915, in Italian and English, by day and by night.
// Usage (a server must already run on PORT, serving web/dist with the pilot tiles):
//   PORT=4218 node web/scripts/capture-t72.mjs <out-dir>
// Not part of the test suite.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const port = Number(process.env.PORT ?? 4174);
const outDir = process.argv[2];
if (!outDir) {
  console.error('usage: capture-t72.mjs <out-dir>');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });
const base = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

async function settle(page) {
  await page.waitForFunction(
    () => {
      const s = window.__milanoIso.tiles;
      return s.visible > 0 && s.loading === 0 && s.loaded + s.failed >= s.visible;
    },
    null,
    { timeout: 120_000 },
  );
  let prev = -1;
  let same = 0;
  for (let i = 0; i < 80 && same < 3; i++) {
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    const c = await page.evaluate(() => window.__milanoIso.render.calls);
    same = c === prev ? same + 1 : 0;
    prev = c;
  }
}

async function shot(width, height, query, name, openAbout) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
  });
  await page.goto(`${base}/?e2e=1&tiles=tiles/pilot/${query}`);
  await page.waitForSelector('canvas');
  await settle(page);
  if (openAbout) {
    await page.locator('#about-button').click();
    await page.getByRole('dialog').waitFor();
  }
  await page.screenshot({ path: path.join(outDir, name) });
  console.log(name, problems.length ? JSON.stringify(problems) : 'no console problems');
  await ctx.close();
}

await shot(1280, 720, '', 'pilot-1280x720-default.png', false);
for (const [w, h] of [
  [1280, 720],
  [412, 915],
]) {
  for (const lang of ['it', 'en']) {
    for (const mode of ['day', 'night']) {
      await shot(w, h, `&lang=${lang}&time=${mode}`, `about-${w}x${h}-${lang}-${mode}.png`, true);
    }
  }
}
await browser.close();
