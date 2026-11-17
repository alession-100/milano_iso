import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { collectProblems, readFixtureManifest, routeFixtureTiles, settleRendered } from './support';

// Screenshots go to a gitignored folder so e2e never rewrites tracked files.
const OUT = path.resolve(process.cwd(), process.env.E2E_OUT_DIR ?? 'e2e-output');
const ELEVATIONS = ['30', '35.264'];

test('renders a canvas with no console errors or warnings, at both elevations, and composes side-by-side.png', async ({
  page,
}) => {
  mkdirSync(OUT, { recursive: true });
  await routeFixtureTiles(page); // the page now streams tiles; serve the synthetic fixture
  const problems = collectProblems(page); // ADR-0012 filter, see support.ts
  const expectedTiles = readFixtureManifest().tiles.length;

  for (const elev of ELEVATIONS) {
    await page.goto(`/?e2e=1&elev=${elev}`);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __milanoIso: { tiles: { loaded: number } } }).__milanoIso.tiles
              .loaded,
        ),
      )
      .toBe(expectedTiles);
    await expect(page.locator('canvas')).toHaveCount(1);
    await settleRendered(page);
    await expect(page.locator('#attribution')).not.toBeEmpty();
    await page.screenshot({ path: path.join(OUT, `elev-${elev}.png`) });
  }
  await page.waitForTimeout(300);
  expect(problems).toEqual([]);

  // Compose side-by-side.png from the two screenshots.
  const figures = ELEVATIONS.map((elev) => {
    const b64 = readFileSync(path.join(OUT, `elev-${elev}.png`)).toString('base64');
    return `<figure><img src="data:image/png;base64,${b64}"><figcaption>elevation ${elev}&deg;</figcaption></figure>`;
  }).join('');
  await page.setViewportSize({ width: 2580, height: 780 });
  await page.setContent(
    `<style>body{margin:10px;display:flex;gap:20px;background:#fff;font:bold 28px sans-serif}
    figure{margin:0}img{width:1280px;height:720px;display:block}figcaption{padding:6px 0}</style>${figures}`,
  );
  await page.locator('img').last().evaluate((i: HTMLImageElement) => i.decode());
  await page.screenshot({ path: path.join(OUT, 'side-by-side.png') });
});
