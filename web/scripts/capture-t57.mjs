/* global process, console, window, document, getComputedStyle, requestAnimationFrame */
// T-5.7 evidence: screenshots on the REAL pilot tiles (web/public/tiles/pilot, copied by `make web-tiles`).
// 640x360, 667x375, 600x412 and 360x600, each with the Duomo card open and (a) the layers panel open,
// (b) the minimap open with the tile notice (one real tile is made to fail so the notice appears);
// plus 1280x720 and 412x915 by default. For each shot it writes what the page measured: the band, the
// attribution box, and elementFromPoint at the centre and four inset corners of every attribution link.
// Usage (a preview server must already run on E2E_PORT):
//   E2E_PORT=4186 node web/scripts/capture-t57.mjs <out-dir>
// Not part of the test suite.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 4173);
const outDir = process.argv[2];
if (!outDir) {
  console.error('usage: capture-t57.mjs <out-dir>');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });
const base = `http://localhost:${port}`;
const SMALL = [
  [640, 360],
  [667, 375],
  [600, 412],
  [360, 600],
];
const DEFAULT = [
  [1280, 720],
  [412, 915],
];
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

const measure = (page) =>
  page.evaluate(() => {
    const rect = (e) => {
      const r = e.getBoundingClientRect();
      return [r.left, r.top, r.right, r.bottom].map((n) => Math.round(n * 10) / 10);
    };
    const box = (sel) => {
      const e = document.querySelector(sel);
      if (!e || e.hidden || e.getClientRects().length === 0) return null;
      return e.hasAttribute('data-yield') ? 'yielded (text in the live region)' : rect(e);
    };
    const links = [...document.querySelectorAll('#attribution a')].map((a) => {
      const r = a.getBoundingClientRect();
      const d = 3;
      const pts = [
        ['centre', r.left + r.width / 2, r.top + r.height / 2],
        ['top-left', r.left + d, r.top + d],
        ['top-right', r.right - d, r.top + d],
        ['bottom-left', r.left + d, r.bottom - d],
        ['bottom-right', r.right - d, r.bottom - d],
      ];
      return {
        text: (a.textContent ?? '').slice(0, 24),
        box: rect(a),
        hits: pts.map(([n, x, y]) => {
          const top = document.elementFromPoint(x, y);
          return `${n}: ${top === a || a.contains(top) ? 'the link' : top?.id || top?.tagName}`;
        }),
      };
    });
    return {
      band: getComputedStyle(document.documentElement).getPropertyValue('--band'),
      attribution: box('#attribution'),
      links,
      minimap: box('#minimap'),
      layers: box('#layers-panel'),
      card: box('#info-card'),
      notice: box('#tiles-notice'),
      noticeRegionText: document.getElementById('notice-region')?.textContent ?? null,
      zone: box('#toolbar-zone'),
      scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
    };
  });

async function openPage(w, h, failOne) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  if (failOne) {
    let victim = null;
    await page.route('**/tiles/pilot/*.glb', (route) => {
      const name = route.request().url().split('/').pop();
      victim ??= name;
      if (name === victim) return route.fulfill({ status: 404, body: 'x' });
      return route.continue();
    });
  }
  await page.goto(`${base}/?e2e=1&lang=it`);
  await page.waitForFunction(() => typeof window.__milanoIsoSetView === 'function' && window.__milanoIso.camera.bounds.maxX !== 500, null, { timeout: 60_000 });
  return { ctx, page };
}

async function selectDuomo(page) {
  await page.locator('#search-input').fill('duomo');
  await page.locator('#search-list').waitFor({ state: 'visible', timeout: 30_000 });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__milanoIso.selection.card.open, null, { timeout: 30_000 });
  await settle(page);
  await page.locator('#info-card-height').waitFor({ state: 'visible', timeout: 30_000 }).catch(() => undefined);
}

for (const [w, h] of SMALL) {
  // (a) layers open
  {
    const { ctx, page } = await openPage(w, h, false);
    await selectDuomo(page);
    await page.locator('#layers-button').click();
    await page.locator('#layers-panel').waitFor({ state: 'visible' });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    const name = `${w}x${h}-layers`;
    facts[name] = await measure(page);
    await page.screenshot({ path: path.join(outDir, `${name}.png`) });
    await ctx.close();
    console.error(`captured ${name}`);
  }
  // (b) minimap open + notice
  {
    const { ctx, page } = await openPage(w, h, true);
    await selectDuomo(page);
    await page.locator('#tiles-notice').waitFor({ state: 'attached', timeout: 60_000 });
    if (await page.locator('#minimap-button').isVisible()) await page.locator('#minimap-button').click();
    await page.locator('#minimap').waitFor({ state: 'visible' });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    const name = `${w}x${h}-minimap-notice`;
    facts[name] = await measure(page);
    await page.screenshot({ path: path.join(outDir, `${name}.png`) });
    await ctx.close();
    console.error(`captured ${name}`);
  }
}
for (const [w, h] of DEFAULT) {
  const { ctx, page } = await openPage(w, h, false);
  await settle(page);
  const name = `${w}x${h}-default`;
  facts[name] = await measure(page);
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  await ctx.close();
  console.error(`captured ${name}`);
}
await browser.close();
writeFileSync(path.join(outDir, 'facts.json'), JSON.stringify(facts, null, 2) + '\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(facts).map(([k, v]) => [k, v.links.map((l) => l.hits.every((x) => x.endsWith('the link')))])), null, 1));
