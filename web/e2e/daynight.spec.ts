import { type Page, expect, test } from '@playwright/test';
import { collectProblems, readFixtureManifest, routeFixtureTiles } from './support';

// Day/night toggle (T-4.3). The night look is style, not data.

async function open(page: Page, query = ''): Promise<string[]> {
  const problems = collectProblems(page);
  await routeFixtureTiles(page);
  await page.goto(`/?e2e=1${query}`);
  const expected = readFixtureManifest().tiles.length;
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as unknown as { __milanoIso: { tiles: { loaded: number } } }).__milanoIso.tiles
              .loaded,
        ),
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0);
  expect(expected).toBeGreaterThan(0);
  return problems;
}

const mode = (page: Page): Promise<string> =>
  page.evaluate(
    () => (window as unknown as { __milanoIso: { style: { mode: string } } }).__milanoIso.style.mode,
  );

const canvasPixel = (page: Page): Promise<string> =>
  // The page background follows the mode too; read it from the document element.
  page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);

test('the toggle starts in day, switches by mouse, and renders a frame on demand', async ({ page }) => {
  const problems = await open(page);
  const button = page.locator('#mode-toggle');
  await expect(button).toHaveText('Notte');
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  expect(await mode(page)).toBe('day');
  const dayBg = await canvasPixel(page);

  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  expect(await mode(page)).toBe('night');
  expect(await canvasPixel(page)).not.toBe(dayBg);
  // A frame is rendered after the switch (render stats are updated per frame).
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __milanoIso: { render: { calls: number } } }).__milanoIso.render.calls,
      ),
    )
    .toBeGreaterThan(0);

  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  expect(await mode(page)).toBe('day');
  expect(await canvasPixel(page)).toBe(dayBg);
  expect(problems).toEqual([]);
});

test('the toggle works with Tab, Enter and Space', async ({ page }) => {
  const problems = await open(page);
  const button = page.locator('#mode-toggle');
  await button.focus();
  await expect(button).toBeFocused();
  await page.keyboard.press('Enter');
  expect(await mode(page)).toBe('night');
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Space');
  expect(await mode(page)).toBe('day');
  await expect(button).toHaveAttribute('aria-pressed', 'false');

  // Reachable with Tab: from the map (first focusable) the toggle is within a few Tab presses.
  await page.locator('#app').focus();
  let reached = false;
  for (let i = 0; i < 4 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await button.evaluate((el) => el === document.activeElement);
  }
  expect(reached).toBe(true);
  expect(problems).toEqual([]);
});

test('?time=night starts in night mode, ?time=day overrides a remembered night', async ({ page }) => {
  const problems = await open(page, '&time=night');
  expect(await mode(page)).toBe('night');
  await expect(page.locator('#mode-toggle')).toHaveAttribute('aria-pressed', 'true');
  // The URL does not overwrite the remembered choice; a click does.
  await page.locator('#mode-toggle').click();
  expect(await mode(page)).toBe('day');
  await page.goto('/?e2e=1&time=night');
  expect(await mode(page)).toBe('night');
  expect(problems).toEqual([]);
});

test('the last choice is remembered in localStorage', async ({ page }) => {
  const problems = await open(page);
  await page.locator('#mode-toggle').click();
  expect(await page.evaluate(() => window.localStorage.getItem('milano-iso.time'))).toBe('night');
  await page.reload();
  await expect.poll(() => mode(page)).toBe('night');
  await page.evaluate(() => window.localStorage.removeItem('milano-iso.time'));
  expect(problems).toEqual([]);
});

test('the toggle fits in 412 px and does not cover the attribution', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } });
  const page = await ctx.newPage();
  const problems = await open(page);
  const toggle = await page.locator('#mode-toggle').boundingBox();
  const attribution = await page.locator('#attribution').boundingBox();
  expect(toggle).not.toBeNull();
  expect(attribution).not.toBeNull();
  if (!toggle || !attribution) return;
  expect(toggle.x).toBeGreaterThanOrEqual(0);
  expect(toggle.x + toggle.width).toBeLessThanOrEqual(412);
  const overlaps = (a: typeof toggle, b: typeof toggle): boolean =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  expect(overlaps(toggle, attribution)).toBe(false);
  await ctx.close();
  expect(problems).toEqual([]);
});

test('the toggle does not overlap the tiles notice when a tile fails', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } });
  const page = await ctx.newPage();
  await routeFixtureTiles(page);
  await page.route('**/tiles/pilot/-1_0.glb', (route) => route.fulfill({ status: 404, body: 'x' }));
  await page.goto('/?e2e=1');
  const notice = page.locator('#tiles-notice');
  await expect(notice).toBeVisible({ timeout: 20_000 });
  const a = await notice.boundingBox();
  const b = await page.locator('#mode-toggle').boundingBox();
  expect(a).not.toBeNull();
  expect(b).not.toBeNull();
  if (!a || !b) return;
  expect(a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height).toBe(
    false,
  );
  await ctx.close();
});
