/* global process, console, window, document, requestAnimationFrame */
// T-5.5 evidence: screenshots on the REAL pilot tiles (web/public/tiles/pilot, copied by `make web-tiles`).
// Sizes of the G5 findings: 800x728, 768x1024, 915x412, 640x700 (card + results), plus the Duomo card at
// 1280x720 and 412x915; day and night. For each shot it also writes the layout facts it measured (the
// attribution OSM link box, what elementFromPoint returns on it, the minimap box) to facts.json.
// Usage (a preview server must already run on E2E_PORT):
//   E2E_PORT=4186 node web/scripts/capture-t55.mjs <out-dir>
// Not part of the test suite.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 4173);
const outDir = process.argv[2];
if (!outDir) {
  console.error('usage: capture-t55.mjs <out-dir>');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });
const base = `http://localhost:${port}`;
const SIZES = [
  [800, 728],
  [768, 1024],
  [915, 412],
  [640, 700],
  [1280, 720],
  [412, 915],
];
const MODES = ['day', 'night'];
const facts = {};
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

/** Boxes and hit tests of the layout, read from the page. */
const measure = (page) =>
  page.evaluate(() => {
    const box = (sel) => {
      const e = document.querySelector(sel);
      if (!e || e.hidden) return null;
      const r = e.getBoundingClientRect();
      if (r.width === 0) return null;
      return [r.left, r.top, r.right, r.bottom].map((n) => Math.round(n));
    };
    const link = [...document.querySelectorAll('#attribution a')].find((a) => /OpenStreetMap/.test(a.textContent ?? ''));
    let osm = null;
    if (link) {
      const r = link.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      osm = { box: [r.left, r.top, r.right, r.bottom].map((n) => Math.round(n)), hit: top === link || link.contains(top) ? 'the OSM link' : (top?.id || top?.tagName) };
    }
    return {
      osmLink: osm,
      attribution: box('#attribution'),
      minimap: box('#minimap'),
      card: box('#info-card'),
      results: box('#search-list'),
      cardHeight: document.querySelector('#info-card-height')?.textContent ?? null,
      cardHeightSource: document.querySelector('#info-card-height-source')?.textContent ?? null,
    };
  });

for (const [w, h] of SIZES) {
  for (const mode of MODES) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(`${base}/?e2e=1&time=${mode}&lang=it`);
    await page.waitForFunction(() => typeof window.__milanoIsoSetView === 'function' && window.__milanoIso.camera.bounds.maxX !== 500, null, { timeout: 60_000 });
    // Duomo card (landmark: height and source from the DBT body feature).
    await page.locator('#search-input').fill('duomo');
    await page.locator('#search-list').waitFor({ state: 'visible', timeout: 30_000 });
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__milanoIso.selection.card.open, null, { timeout: 30_000 });
    await settle(page);
    // The card is complete once the landmark tile is loaded: wait for the height row.
    await page.locator('#info-card-height').waitFor({ state: 'visible', timeout: 30_000 }).catch(() => undefined);
    const name = `${w}x${h}-${mode}`;
    if (w === 640 || w === 800 || w === 768 || (w === 915 && h === 412)) {
      // card + results open at the same time (the worst state of N1b)
      await page.locator('#search-input').fill('via');
      await page.locator('#search-list').waitFor({ state: 'visible' });
      await page.keyboard.press('ArrowDown');
    }
    facts[name] = await measure(page);
    await page.screenshot({ path: path.join(outDir, `${name}.png`) });
    if (w === 915 && h === 412) {
      await page.locator('#search-input').fill('');
      await page.keyboard.press('Escape');
      await page.locator('#layers-button').click();
      await page.locator('#layers-panel').waitFor({ state: 'visible' });
      facts[`${name}-layers`] = await measure(page);
      await page.screenshot({ path: path.join(outDir, `${name}-layers.png`) });
    }
    await ctx.close();
    console.error(`captured ${name}`);
  }
}
await browser.close();
writeFileSync(path.join(outDir, 'facts.json'), JSON.stringify(facts, null, 2) + '\n');
console.log(JSON.stringify(facts, null, 2));
