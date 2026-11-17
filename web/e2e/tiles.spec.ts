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

/** e2e-only camera setter exposed by the app when `e2e=1` (testhook.ts). */
async function setView(page: import('@playwright/test').Page, x: number, z: number, w: number) {
  await page.waitForFunction(
    () => typeof (window as unknown as { __milanoIsoSetView?: unknown }).__milanoIsoSetView === 'function',
  );
  await page.evaluate(
    ([a, b, c]) =>
      (
        window as unknown as { __milanoIsoSetView: (x: number, z: number, w: number) => void }
      ).__milanoIsoSetView(a, b, c),
    [x, z, w],
  );
}

test('the fixture tiles load, attribution comes from the manifest, draw calls within budget', async ({
  page,
}) => {
  mkdirSync(OUT, { recursive: true });
  const problems = collectProblems(page);
  await routeFixtureTiles(page);
  const manifest = readFixtureManifest();
  const expected = manifest.tiles.length;

  // 1200 m wide covers all fixture tiles (they span about 500 m around the origin).
  await page.goto('/?e2e=1');
  await expect(page.locator('canvas')).toHaveCount(1);
  await setView(page, 0, 0, 1200);
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
  await page.goto('/?e2e=1');
  await setView(page, 0, 0, 1200);
  await expect(page.locator('#attribution')).toContainText('OpenStreetMap contributors');
  await expect(page.locator('#attribution')).toBeInViewport();
});

test('a tile that keeps failing is retried once, then a dismissible notice appears and the app survives', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await routeFixtureTiles(page);
  const manifest = readFixtureManifest() as unknown as {
    tiles: { id: string; glb: { file: string } }[];
  };
  const bad = manifest.tiles[0];
  let hits = 0;
  // Registered after the fixture route, so it takes precedence for this one file.
  await page.route(`**/tiles/pilot/${bad.glb.file}`, async (route) => {
    hits += 1;
    await route.fulfill({ status: 404, body: 'not found' });
  });
  await page.goto('/?e2e=1');
  await expect(page.locator('canvas')).toHaveCount(1);
  await setView(page, 0, 0, 1200);
  await expect.poll(async () => (await state(page)).tiles.failed, { timeout: 20_000 }).toBe(1);
  expect(hits).toBe(2); // first try plus exactly one retry
  const s = await state(page);
  expect(s.tiles.loaded).toBe(manifest.tiles.length - 1);
  const notice = page.locator('#tiles-notice');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('Alcune zone della mappa non sono state caricate');
  await expect(page.locator('#attribution')).toBeInViewport();
  const nb = await notice.boundingBox();
  const ab = await page.locator('#attribution').boundingBox();
  expect(nb && ab && (nb.x + nb.width <= ab.x || nb.y + nb.height <= ab.y)).toBe(true);
  // Exactly one app console error per finally-failed tile; the browser's own network-failure
  // lines ("Failed to load resource") are not app errors and are counted separately.
  const appErrors = errors.filter((e) => !e.startsWith('Failed to load resource'));
  expect(appErrors).toHaveLength(1);
  expect(appErrors[0]).toContain(`tile ${bad.id} failed to load`);
  expect(pageErrors).toEqual([]);
  // The app still reacts after the failure; the notice can be dismissed.
  await page.keyboard.press('ArrowLeft');
  await notice.getByRole('button').click();
  await expect(notice).toHaveCount(0);
});
