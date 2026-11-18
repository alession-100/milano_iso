/* global process, console, window */
// T-5.6 evidence: the search list on the REAL pilot index, through the real client, at 1280x720,
// in Italian and English. Usage (a preview server must already run on E2E_PORT, real tiles
// copied to web/public/tiles/pilot before `npm run build`):
//   E2E_PORT=4188 node web/scripts/capture-t56.mjs <out-dir>
// Not part of the test suite. Prints one JSON line per query and language.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 4173);
const outDir = process.argv[2];
if (!outDir) {
  console.error('usage: capture-t56.mjs <out-dir>');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });
const QUERIES = ['duomo', 'galleria', 'missori', 'cordusio', 'largo augusto'];
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const lang of ['it', 'en']) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${port}/?e2e=1&time=day&lang=${lang}`);
  await page.waitForFunction(() => typeof window.__milanoIsoSetView === 'function', null, { timeout: 60_000 });
  for (const q of QUERIES) {
    await page.locator('#search-input').fill(q);
    await page.locator('#search-list').waitFor({ state: 'visible', timeout: 30_000 });
    const rows = await page.locator('#search-list [role=option]').allInnerTexts();
    console.log(JSON.stringify({ lang, q, rows: rows.map((r) => r.replace(/\s*\n\s*/g, ' | ')) }));
    await page.screenshot({ path: path.join(outDir, `search-${q.replace(' ', '-')}-${lang}.png`) });
  }
  await ctx.close();
}
await browser.close();
