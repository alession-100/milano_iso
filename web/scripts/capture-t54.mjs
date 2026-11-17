/* global process, console, window, document, requestAnimationFrame */
// T-5.4 evidence: screenshots and accessibility snapshots of the UI on the REAL pilot tiles
// (web/public/tiles/pilot), at 1280x720 and 412x915, by day and by night.
// Usage (a preview server must already run on E2E_PORT, tiles copied by `make web-tiles`):
//   E2E_PORT=4181 node web/scripts/capture-t54.mjs <out-dir>
// Not part of the test suite. The draw-call counts it prints are the numbers quoted in the report.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 4173);
const outDir = process.argv[2];
if (!outDir) {
  console.error('usage: capture-t54.mjs <out-dir>');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });
const base = `http://localhost:${port}`;
const VIEWPORTS = [
  ['desktop-1280x720', 1280, 720],
  ['mobile-412x915', 412, 915],
];
const MODES = ['day', 'night'];
const calls = {};

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

/** Tiles settled and the draw-call count equal on three consecutive polls (two frames apart). */
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
  return prev;
}

async function openPage(vpName, w, h, mode, lang) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('GPU stall due to ReadPixels')) problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  await page.goto(`${base}/?e2e=1&time=${mode}&lang=${lang}`);
  await page.waitForFunction(() => typeof window.__milanoIsoSetView === 'function' && window.__milanoIso.camera.bounds.maxX !== 500, null, { timeout: 60_000 });
  return { ctx, page, problems };
}

async function chooseDuomo(page) {
  await page.locator('#search-input').fill('duomo');
  await page.locator('#search-list').waitFor({ state: 'visible', timeout: 30_000 });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__milanoIso.selection.card.open, null, { timeout: 30_000 });
}

for (const [vpName, w, h] of VIEWPORTS) {
  for (const mode of MODES) {
    const shot = async (page, name) => page.screenshot({ path: path.join(outDir, `${name}-${vpName}-${mode}.png`) });

    // 1. Default view (and the draw calls there).
    {
      const { ctx, page, problems } = await openPage(vpName, w, h, mode, 'it');
      calls[`${vpName}/${mode}`] = await settle(page);
      await shot(page, 'default');
      if (mode === 'day') {
        writeFileSync(path.join(outDir, `a11y-default-${vpName}.txt`), await page.locator('body').ariaSnapshot());
      }
      // Focus on the day/night toggle, by keyboard: from the map, one Tab.
      await page.locator('#app').focus();
      await page.keyboard.press('Tab');
      if (!(await page.evaluate(() => document.activeElement?.id === 'mode-toggle'))) throw new Error('Tab from the map did not reach the toggle');
      await shot(page, 'focus-toggle');
      if (problems.length) console.error(vpName, mode, 'console problems', problems);
      await ctx.close();
    }
    // 2. Info card open.
    {
      const { ctx, page } = await openPage(vpName, w, h, mode, 'it');
      await chooseDuomo(page);
      await settle(page);
      await shot(page, 'card');
      if (mode === 'day') {
        writeFileSync(path.join(outDir, `a11y-card-${vpName}.txt`), await page.locator('body').ariaSnapshot());
      }
      // 3. Search results open, with the card still open and the tiles notice not shown.
      await page.locator('#search-input').fill('via');
      await page.locator('#search-list').waitFor({ state: 'visible' });
      await page.keyboard.press('ArrowDown');
      await shot(page, 'search');
      if (mode === 'day') {
        writeFileSync(path.join(outDir, `a11y-search-${vpName}.txt`), await page.locator('body').ariaSnapshot());
      }
      // 4. Help open.
      await page.locator('#help-button').click();
      await page.locator('#help-panel').waitFor({ state: 'visible' });
      await shot(page, 'help');
      await ctx.close();
    }
    // 5. English UI: card open and the layers panel.
    {
      const { ctx, page } = await openPage(vpName, w, h, mode, 'en');
      await chooseDuomo(page);
      await settle(page);
      await page.locator('#layers-button').click();
      await page.locator('#layers-panel').waitFor({ state: 'visible' });
      await shot(page, 'english');
      await ctx.close();
    }
    console.error(`captured ${vpName} ${mode}`);
  }
}
await browser.close();
writeFileSync(path.join(outDir, 'draw-calls.json'), JSON.stringify(calls, null, 2) + '\n');
console.log(JSON.stringify(calls, null, 2));
