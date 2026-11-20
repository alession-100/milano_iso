import { expect, test } from '@playwright/test';
import { collectProblems, routeFixtureTiles } from './support';

interface Bench {
  status: string;
  results: Record<string, number> | null;
}

const benchState = (page: import('@playwright/test').Page): Promise<Bench | null> =>
  page.evaluate(
    () => (window as unknown as { __milanoIso?: { bench?: Bench } }).__milanoIso?.bench ?? null,
  ) as Promise<Bench | null>;

test('?debug shows the overlay with numeric draw calls, and it can be closed', async ({ page }) => {
  const problems = collectProblems(page);
  await routeFixtureTiles(page);
  await page.goto('/?debug&e2e=1&tiles=tiles/pilot/');
  const overlay = page.locator('#debug-overlay');
  await expect(overlay).toBeVisible();
  await expect(page.locator('#debug-live')).toHaveText(/draw calls \d+\s+triangles \d+/);
  await expect(page.locator('#debug-live')).toHaveText(/tiles loaded \d+ loading \d+ failed \d+ visible \d+/);
  // The overlay must not cover the attribution.
  await expect(page.locator('#attribution')).not.toBeEmpty();
  const o = await overlay.boundingBox();
  const a = await page.locator('#attribution').boundingBox();
  expect(o && a && (o.x + o.width <= a.x || o.y + o.height <= a.y)).toBe(true);
  await page.locator('#debug-close').click();
  await expect(overlay).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(problems).toEqual([]);
});

test('the benchmark button works with the keyboard', async ({ page }) => {
  await routeFixtureTiles(page);
  await page.goto('/?debug&e2e=1&tiles=tiles/pilot/');
  await expect(page.locator('#debug-overlay')).toBeVisible();
  await page.locator('#debug-bench').focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await benchState(page))?.status).toMatch(/running|done/); // a starved page may answer only after the 10 s run is over
});

test('?debug=bench completes with numeric results', async ({ page }) => {
  test.setTimeout(300_000);
  const problems = collectProblems(page);
  await routeFixtureTiles(page);
  await page.goto('/?debug=bench&e2e=1&tiles=tiles/pilot/');
  // App start-up (module load, first frames) is CPU-bound under parallel software GL; the limits below
  // only stop a run that never ends (the benchmark itself lasts 10 s of app time; no duration is asserted).
  await expect.poll(async () => (await benchState(page))?.status, { timeout: 120_000 }).toMatch(/running|done/); // the run lasts 10 s of app time: a starved page may answer only after it
  await expect.poll(async () => (await benchState(page))?.status, { timeout: 120_000 }).toBe('done');
  const r = ((await benchState(page)) as Bench).results as Record<string, number>;
  for (const k of [
    'frames',
    'meanFps',
    'p5Fps',
    'meanFrameMs',
    'p95FrameMs',
    'maxDrawCalls',
    'maxTriangles',
  ]) {
    expect(Number.isFinite(r[k]), k).toBe(true);
  }
  expect(r.frames).toBeGreaterThan(0);
  expect(r.maxDrawCalls).toBeGreaterThan(0);
  await expect(page.locator('#debug-bench-results')).toContainText('fps mean');
  expect(problems).toEqual([]);
});

test('without ?debug there is no overlay in the DOM', async ({ page }) => {
  await routeFixtureTiles(page);
  await page.goto('/?e2e=1&tiles=tiles/pilot/');
  await expect(page.locator('canvas')).toHaveCount(1);
  await page.waitForTimeout(300);
  await expect(page.locator('#debug-overlay')).toHaveCount(0);
});
