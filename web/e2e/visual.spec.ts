import path from 'node:path';
import { type Page, expect, test } from '@playwright/test';
import { readFixtureManifest, routeFixtureTiles } from './support';

// Visual regression (VERIFICATION section 4). Baselines are per platform (see
// playwright.config.ts snapshotPathTemplate) and live in visual.spec.ts-snapshots/. They are
// captured under ?e2e=1 (no MSAA, ADR-0027) from the synthetic fixture tileset, reduced motion.

// Fixture camera views: [name, ground x (m), ground z (m), visible width (m)].
// The optional fifth element is the rotation step (`?rot=`, T-5.2).
const VIEWS: [string, number, number, number, number?][] = [
  ['default', 0, 0, 600],
  ['close', 0, 0, 150],
  ['wide', 0, 0, 1200],
  // Offset close view: keeps the industrial and other buildings in frame on the narrow mobile size.
  ['west', -40, 40, 150],
  // T-5.2: the default view turned by 90, 180 and 270 degrees (derived views of the approved look).
  ['default-rot1', 0, 0, 600, 1],
  ['default-rot2', 0, 0, 600, 2],
  ['default-rot3', 0, 0, 600, 3],
];

// Night candidates (T-4.3): default and close views only, `?time=night`. Names are prefixed night-.
const NIGHT_VIEWS = new Set(['default', 'close']);

const SIZES: [string, number, number][] = [
  ['desktop-1280x720', 1280, 720],
  ['mobile-412x915', 412, 915],
];

async function setView(page: Page, x: number, z: number, w: number): Promise<void> {
  await page.waitForFunction(
    () =>
      typeof (window as unknown as { __milanoIsoSetView?: unknown }).__milanoIsoSetView ===
      'function',
  );
  await page.evaluate(
    ([a, b, c]) =>
      (
        window as unknown as { __milanoIsoSetView: (x: number, z: number, w: number) => void }
      ).__milanoIsoSetView(a, b, c),
    [x, z, w],
  );
}

test.describe('visual regression (fixture tiles)', () => {
  for (const [sizeName, width, height] of SIZES) {
    test.describe(sizeName, () => {
      test.use({ viewport: { width, height } });

      for (const [mode, viewName, x, z, w, rot] of VIEWS.flatMap(([n, a, b, c, r]) =>
        (['day', 'night'] as const)
          .filter((m) => m === 'day' || NIGHT_VIEWS.has(n))
          .map((m) => [m, n, a, b, c, r ?? 0] as const),
      )) {
        test(`${mode === 'night' ? 'night ' : ''}${viewName} view`, async ({ page }) => {
          await page.emulateMedia({ reducedMotion: 'reduce' });
          await routeFixtureTiles(page);
          const expected = readFixtureManifest().tiles.length;
          await page.goto(
            `/?e2e=1${mode === 'night' ? '&time=night' : ''}${rot ? `&rot=${rot}` : ''}`,
          );
          await expect(page.locator('canvas')).toHaveCount(1);
          await setView(page, x, z, w);
          await expect
            .poll(
              async () =>
                page.evaluate(
                  () =>
                    (window as unknown as { __milanoIso: { tiles: { loaded: number } } }).__milanoIso
                      .tiles.loaded,
                ),
              { timeout: 20_000 },
            )
            .toBeGreaterThan(0);
          // Wait until every tile the view needs is loaded and nothing is in flight.
          await expect
            .poll(
              async () =>
                page.evaluate(() => {
                  const s = (
                    window as unknown as {
                      __milanoIso: { tiles: { loading: number; visible: number; loaded: number } };
                    }
                  ).__milanoIso.tiles;
                  return s.loading === 0 && s.loaded >= s.visible;
                }),
              { timeout: 20_000 },
            )
            .toBe(true);
          expect(expected).toBeGreaterThan(0);
          // Let the last render land.
          await page.evaluate(
            () =>
              new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
          );
          await expect(page).toHaveScreenshot(
            `${mode === 'night' ? 'night-' : ''}${viewName}-${sizeName}.png`,
            { stylePath: path.resolve(process.cwd(), 'e2e', 'visual-hide-controls.css') },
          );
        });
      }
    });
  }
});
