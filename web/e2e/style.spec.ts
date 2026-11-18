import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { collectProblems, readFixtureManifest, routeFixtureTiles, setView, settleRendered, tilesState } from './support';

const OUT = path.resolve(process.cwd(), process.env.E2E_OUT_DIR ?? 'e2e-output');

type Page = import('@playwright/test').Page;

async function load(page: Page, query: string): Promise<void> {
  await routeFixtureTiles(page);
  await page.goto(`/?e2e=1${query}`);
  await setView(page, 0, 0, 600);
  const expected = readFixtureManifest().tiles.length;
  await expect
    .poll(async () => (await tilesState(page)).loaded, { timeout: 20_000 })
    .toBe(expected);
  await settleRendered(page);
}

const calls = (page: Page): Promise<number> =>
  page.evaluate(
    () => (window as unknown as { __milanoIso: { render: { calls: number } } }).__milanoIso.render.calls,
  );

// Not a regression baseline yet: baselines come after the owner approves the look (T-3.3).
for (const shadows of ['1', '0']) {
  test(`style: fixture at a fixed camera, shadows=${shadows}, saves a screenshot`, async ({ page }) => {
    mkdirSync(OUT, { recursive: true });
    const problems = collectProblems(page);
    await load(page, `&shadows=${shadows}`);
    const png = await page.screenshot({ path: path.join(OUT, `style-fixture-shadows-${shadows}.png`) });
    expect(png.length).toBeGreaterThan(5_000);
    expect(await calls(page)).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });
}
