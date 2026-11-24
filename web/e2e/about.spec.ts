import { type Page, expect, test } from '@playwright/test';
import { dictionary } from '../src/i18n';
import { collectProblems, routeFixtureTiles, setView, settleRendered } from './support';

// T-7.2: the About dialog (VERIFICATION 4a: keyboard, focus, touch targets, layout) on the fixture tiles,
// at 1280x720 and 412x915, by day and by night. Waits poll state; no assertion has a wall-clock limit.

const SIZES = [
  { name: 'desktop-1280x720', width: 1280, height: 720 },
  { name: 'mobile-412x915', width: 412, height: 915 },
] as const;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function open(page: Page, query = ''): Promise<string[]> {
  const problems = collectProblems(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await routeFixtureTiles(page);
  await page.goto(`/?e2e=1&tiles=tiles/pilot/${query}`);
  await expect(page.locator('canvas')).toHaveCount(1);
  await setView(page, 0, 0, 600);
  await settleRendered(page);
  await expect(page.locator('#attribution')).toContainText('(c) OpenStreetMap contributors');
  return problems;
}

const box = async (page: Page, sel: string): Promise<Box> => {
  const b = await page.locator(sel).boundingBox();
  if (!b) throw new Error(`${sel} has no box`);
  return b;
};
const overlaps = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

for (const size of SIZES) {
  for (const mode of ['day', 'night'] as const) {
    test.describe(`About dialog, ${size.name}, ${mode}`, () => {
      test.use({ viewport: { width: size.width, height: size.height } });

      test('opens from the attribution line, shows the content, stays clear of the attribution', async ({ page }) => {
        const problems = await open(page, mode === 'night' ? '&time=night' : '');
        const button = page.locator('#attribution #about-button');
        await expect(button).toBeVisible();
        await expect(button).toHaveText(dictionary.it.aboutButton);
        await expect(button).toHaveAttribute('aria-expanded', 'false');
        await expect(page.locator('#about-overlay')).toBeHidden();

        await button.click();
        const dialog = page.getByRole('dialog', { name: dictionary.it.aboutTitle });
        await expect(dialog).toBeVisible();
        await expect(button).toHaveAttribute('aria-expanded', 'true');
        await expect(dialog).toBeFocused();

        // what the map is, the sources with their licences and links, the dates, the build, the repository
        await expect(dialog).toContainText(dictionary.it.aboutWhat);
        const items = dialog.locator('ul.about-sources > li');
        await expect(items).toHaveCount(3);
        await expect(items.nth(0)).toContainText('OpenStreetMap contributors');
        await expect(items.nth(0)).toContainText('ODbL 1.0');
        await expect(items.nth(1)).toContainText('CC BY 4.0');
        for (const [i, key] of (['aboutDateOsm', 'aboutDateDbt', 'aboutDateBoundary'] as const).entries()) {
          await expect(items.nth(i)).toContainText(`${dictionary.it.aboutDataDate}: ${dictionary.it[key]}`);
        }
        const hrefs = await dialog.locator('a').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
        expect(hrefs).toContain('https://www.openstreetmap.org/copyright');
        expect(hrefs).toContain('https://github.com/alession-100/milano_iso');
        expect(hrefs.every((h) => h.startsWith('https://'))).toBe(true);
        await expect(dialog.locator('.about-meta')).toHaveText(new RegExp(`^${dictionary.it.aboutVersion}: \\S+`));

        // layout: the dialog is on screen, the attribution is not covered, no horizontal page scroll
        const panel = await box(page, '#about-panel');
        const attr = await box(page, '#attribution');
        expect(panel.x).toBeGreaterThanOrEqual(0);
        expect(panel.y).toBeGreaterThanOrEqual(0);
        expect(panel.x + panel.width).toBeLessThanOrEqual(size.width);
        expect(panel.y + panel.height).toBeLessThanOrEqual(size.height);
        expect(overlaps(await box(page, '#about-overlay'), attr)).toBe(false);
        expect(overlaps(panel, attr)).toBe(false);
        // the point at the centre of each attribution link and of the About button hits that element, not the dialog
        const hit = await page.evaluate(() => {
          const a = document.getElementById('attribution') as HTMLElement;
          return [...a.querySelectorAll('a, button')].every((e) => {
            const r = e.getBoundingClientRect();
            return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === e;
          });
        });
        expect(hit).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

        // touch targets: every control and link in the dialog is at least 44 x 44 CSS px
        const small = await page.evaluate(() =>
          [...document.querySelectorAll('#about-panel button, #about-panel a')]
            .map((e) => {
              const r = e.getBoundingClientRect();
              return { name: e.textContent, w: r.width, h: r.height };
            })
            .filter((r) => r.w < 44 || r.h < 44),
        );
        expect(small).toEqual([]);
        // the rest of the page is inert behind the dialog
        expect(await page.evaluate(() => (document.getElementById('toolbar-zone') as HTMLElement).inert)).toBe(true);

        await page.locator('#about-close').click();
        await expect(page.locator('#about-overlay')).toBeHidden();
        await expect(button).toBeFocused();
        expect(await page.evaluate(() => (document.getElementById('toolbar-zone') as HTMLElement).inert)).toBe(false);
        expect(problems).toEqual([]);
      });
    });
  }

  test.describe(`About dialog keyboard and language, ${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('Tab reaches the button; Enter and Space open it; Escape closes it and returns focus; no trap', async ({ page }) => {
      const problems = await open(page);
      const button = page.locator('#about-button');
      let reached = false;
      for (let i = 0; i < 80 && !reached; i++) {
        await page.keyboard.press('Tab');
        reached = await button.evaluate((b) => b === document.activeElement);
      }
      expect(reached).toBe(true);
      // About is the last control of the page: after the attribution links, in the attribution line
      expect(await page.evaluate(() => document.activeElement?.parentElement?.id)).toBe('attribution');

      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog).toBeFocused();
      // Tab moves through the dialog (language, close, links) and then out of it: it is not a trap
      const seen: string[] = [];
      let left = false;
      for (let i = 0; i < 14 && !left; i++) {
        await page.keyboard.press('Tab');
        seen.push(await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName || ''));
        left = await page.evaluate(() => document.activeElement?.closest('#about-overlay') === null);
      }
      expect(seen.slice(0, 2)).toEqual(['about-lang', 'about-close']);
      expect(left).toBe(true);
      // Escape from inside the dialog
      await page.locator('#about-close').focus();
      await page.keyboard.press('Escape');
      await expect(page.locator('#about-overlay')).toBeHidden();
      await expect(button).toBeFocused();

      // Space opens, Escape from the About button itself closes
      await page.keyboard.press('Space');
      await expect(dialog).toBeVisible();
      await button.focus();
      await page.keyboard.press('Escape');
      await expect(page.locator('#about-overlay')).toBeHidden();
      await expect(button).toBeFocused();
      expect(problems).toEqual([]);
    });

    test('the language button switches every string of the dialog and the attribution label', async ({ page }) => {
      const problems = await open(page);
      await page.locator('#about-button').click();
      const dialog = page.getByRole('dialog', { name: dictionary.it.aboutTitle });
      await expect(dialog).toBeVisible();
      await page.locator('#about-lang').click();
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      const en = page.getByRole('dialog', { name: dictionary.en.aboutTitle });
      await expect(en).toBeVisible(); // still open, same dialog
      await expect(en).toContainText(dictionary.en.aboutWhat);
      await expect(en).toContainText(dictionary.en.aboutSources);
      await expect(en).toContainText(`${dictionary.en.aboutDataDate}: ${dictionary.en.aboutDateOsm}`);
      await expect(en).toContainText(`${dictionary.en.aboutLicence}: `);
      await expect(en.locator('.about-meta')).toContainText(`${dictionary.en.aboutVersion}:`);
      await expect(en.locator('#about-close')).toHaveText(dictionary.en.close);
      await expect(en.locator('#about-lang')).toHaveText('IT');
      await expect(page.locator('#about-button')).toHaveText(dictionary.en.aboutButton);
      await expect(page.locator('#attribution')).toContainText(`${dictionary.en.dataLabel}:`);
      await expect(page.locator('#attribution')).toContainText('(c) OpenStreetMap contributors');
      // the old Italian text is gone
      await expect(en).not.toContainText(dictionary.it.aboutWhat);
      // and back
      await page.locator('#about-lang').click();
      await expect(page.getByRole('dialog', { name: dictionary.it.aboutTitle })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', 'it');
      expect(problems).toEqual([]);
    });
  });
}

test('?lang=en opens the dialog in English', async ({ page }) => {
  await open(page, '&lang=en');
  await page.locator('#about-button').click();
  await expect(page.getByRole('dialog', { name: dictionary.en.aboutTitle })).toBeVisible();
});
