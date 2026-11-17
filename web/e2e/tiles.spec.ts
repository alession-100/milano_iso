import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { collectProblems, readFixtureManifest, routeFixtureTiles } from './support';

const OUT = path.resolve(process.cwd(), process.env.E2E_OUT_DIR ?? 'e2e-output');

interface TestState {
  tiles: { loaded: number; loading: number; failed: number; visible: number };
  render: { calls: number; triangles: number };
}

const state = (page: import('@playwright/test').Page): Promise<TestState> =>
  page.evaluate(() => {
    const s = (window as unknown as { __milanoIso: TestState }).__milanoIso;
    return { tiles: { ...s.tiles }, render: { ...s.render } };
  });

test('the fixture tiles load, attribution comes from the manifest, draw calls within budget', async ({
  page,
}) => {
  mkdirSync(OUT, { recursive: true });
  const problems = collectProblems(page);
  await routeFixtureTiles(page);
  const manifest = readFixtureManifest();
  const expected = manifest.tiles.length;

  // 1200 m wide covers all fixture tiles (they span about 500 m around the origin).
  await page.goto('/?e2e=1&view=0,0,1200');
  await expect(page.locator('canvas')).toHaveCount(1);
  await expect
    .poll(async () => (await state(page)).tiles.loaded, { timeout: 20_000 })
    .toBe(expected);

  const s = await state(page);
  expect(s.tiles.visible).toBe(expected);
  expect(s.tiles.failed).toBe(0);
  expect(s.tiles.loading).toBe(0);
  expect(s.render.calls).toBeGreaterThan(0);
  expect(s.render.calls).toBeLessThanOrEqual(300);
  expect(s.render.triangles).toBeGreaterThan(0);

  const attribution = page.locator('#attribution');
  await expect(attribution).toContainText('OpenStreetMap contributors');
  await expect(attribution).toContainText('Comune di Milano');
  await expect(attribution).toContainText('Dati');
  await expect(attribution.locator('a')).toHaveCount(manifest.attribution.length);
  await expect(attribution).toBeInViewport();

  await page.screenshot({ path: path.join(OUT, 'tiles-fixture.png') });
  await page.waitForTimeout(300);
  expect(problems).toEqual([]);
});

test('a manifest with an unexpected format shows an error and stops', async ({ page }) => {
  await page.route('**/tiles/pilot/tiles.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"format_version":2}' }),
  );
  await page.goto('/?e2e=1');
  await expect(page.locator('#error')).toBeVisible();
  const s = await state(page);
  expect(s.tiles.loaded).toBe(0);
});

test('the attribution is visible on a mobile viewport', async ({ page }) => {
  await routeFixtureTiles(page);
  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto('/?e2e=1&view=0,0,1200');
  await expect(page.locator('#attribution')).toContainText('OpenStreetMap contributors');
  await expect(page.locator('#attribution')).toBeInViewport();
});
