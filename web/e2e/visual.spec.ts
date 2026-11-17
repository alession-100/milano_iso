import path from 'node:path';
import { expect, test } from '@playwright/test';
import { frameRendered, readFixtureManifest, routeFixtureTiles, setView, settleRendered } from './support';

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
          expect(expected).toBeGreaterThan(0);
          // Every tile the view needs is loaded, nothing is in flight, and the last render has landed.
          await settleRendered(page);
          await expect(page).toHaveScreenshot(
            `${mode === 'night' ? 'night-' : ''}${viewName}-${sizeName}.png`,
            { stylePath: path.resolve(process.cwd(), 'e2e', 'visual-hide-controls.css') },
          );
        });
      }
    });
  }
});

// T-5.1: the info card open on the fixture building B1, at both sizes. The baseline is recorded on
// win32 only (no Linux baseline exists for it yet), so the test is skipped elsewhere.
test.describe('visual regression: info card (fixture tiles)', () => {
  test.skip(process.platform !== 'win32', 'info card baseline is win32 only');
  for (const [sizeName, width, height] of SIZES) {
    test.describe(sizeName, () => {
      test.use({ viewport: { width, height } });

      test('info card open on B1', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await routeFixtureTiles(page);
        await page.goto('/?e2e=1');
        await expect(page.locator('canvas')).toHaveCount(1);
        await setView(page, 30, -30, 150);
        await settleRendered(page);
        const p = await page.evaluate(() =>
          (
            window as unknown as {
              __milanoIsoScreenOf: (x: number, y: number, z: number) => { x: number; y: number };
            }
          ).__milanoIsoScreenOf(40, 10, -35),
        );
        await page.mouse.click(p.x, p.y);
        await expect
          .poll(() =>
            page.evaluate(
              () =>
                (window as unknown as { __milanoIso: { selection: { card: { open: boolean } } } })
                  .__milanoIso.selection.card.open,
            ),
          )
          .toBe(true);
        // Park the pointer away from the building so the hover tint does not mix with the selection.
        await page.mouse.move(2, 2);
        await frameRendered(page);
        await expect(page).toHaveScreenshot(`info-card-${sizeName}.png`, {
          stylePath: path.resolve(process.cwd(), 'e2e', 'visual-hide-controls.css'),
        });
      });
    });
  }
});
