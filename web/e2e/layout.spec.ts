import { type Page, expect, test } from '@playwright/test';
import { collectProblems, frameRendered, routeFixtureTiles, setView, settleRendered } from './support';

// T-5.5 (G5 blocker B1): width and height sweep. At every size the blocks of the UI never overlap, stay
// inside the viewport, the page does not scroll, and every link and check box is the element under its own
// centre (nothing covers it: the attribution is a licence obligation, ODbL, hard rule 10). The fixture is
// used; states are the worst ones (card + results + notice; card + layers; card + help; minimap open).
// Day and night share one layout (only colours differ), so the sweep runs by day; the language changes the
// text widths, so a few sizes also run in English.

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
type Win = { __milanoIsoSelect: (ref: unknown, source: string) => void };

const BLOCKS = [
  '#search-input',
  '#layers-button',
  '#help-button',
  '#lang-toggle',
  '#minimap-button',
  '#search-list',
  '#search-status.visible',
  '#layers-panel',
  '#help-panel',
  '#minimap',
  '#tiles-notice',
  '#info-card',
  '#attribution',
  '#mode-toggle',
  '#rotate-left',
  '#rotate-right',
];
/** Elements that must be the topmost element at their own centre. */
const HIT = [
  '#search-input',
  '#layers-button',
  '#help-button',
  '#lang-toggle',
  '#minimap-button',
  '#mode-toggle',
  '#rotate-left',
  '#rotate-right',
  '#tiles-notice button',
  '#info-card .close',
  '#info-card a',
  '#attribution a',
  '#layers-panel input',
];

const overlap = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function boxOf(page: Page, sel: string): Promise<Box | null> {
  const l = page.locator(sel);
  return (await l.count()) > 0 && (await l.first().isVisible()) ? await l.first().boundingBox() : null;
}

async function check(page: Page, label: string, w: number, h: number): Promise<void> {
  await frameRendered(page); // the resize observers have re-fitted the card
  await frameRendered(page);
  const present: { sel: string; box: Box }[] = [];
  for (const sel of BLOCKS) {
    const b = await boxOf(page, sel);
    if (b) present.push({ sel, box: b });
  }
  for (let i = 0; i < present.length; i++) {
    const a = present[i];
    expect(a.box.x, `${label}: ${a.sel} left edge`).toBeGreaterThanOrEqual(-0.5);
    expect(a.box.y, `${label}: ${a.sel} top edge`).toBeGreaterThanOrEqual(-0.5);
    expect(a.box.x + a.box.width, `${label}: ${a.sel} right edge`).toBeLessThanOrEqual(w + 0.5);
    expect(a.box.y + a.box.height, `${label}: ${a.sel} bottom edge`).toBeLessThanOrEqual(h + 0.5);
    for (let j = i + 1; j < present.length; j++) {
      expect(overlap(a.box, present[j].box), `${label}: ${a.sel} overlaps ${present[j].sel}`).toBe(false);
    }
  }
  const scroll = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    sh: document.documentElement.scrollHeight,
    iw: window.innerWidth,
    ih: window.innerHeight,
  }));
  expect(scroll.sw, `${label}: no horizontal scroll`).toBeLessThanOrEqual(scroll.iw);
  expect(scroll.sh, `${label}: no vertical scroll`).toBeLessThanOrEqual(scroll.ih);
  // Nothing covers a link, a check box or a button: the topmost element at its centre is itself.
  const covered = await page.evaluate((sels) => {
    const bad: string[] = [];
    for (const sel of sels) {
      document.querySelectorAll<HTMLElement>(sel).forEach((el, i) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return; // hidden
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        const top = document.elementFromPoint(x, y);
        if (!top || !(top === el || el.contains(top))) {
          bad.push(`${sel}[${i}] at ${Math.round(x)},${Math.round(y)} is covered by ${top ? (top.id ? '#' + top.id : top.tagName) : 'nothing'}`);
        }
      });
    }
    return bad;
  }, HIT);
  expect(covered, `${label}: covered controls`).toEqual([]);
}

async function open(page: Page, lang: string): Promise<string[]> {
  const problems = collectProblems(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await routeFixtureTiles(page);
  await page.route('**/tiles/pilot/-1_0.glb', (route) => route.fulfill({ status: 404, body: 'x' }));
  await page.goto(`/?e2e=1&lang=${lang}`);
  await expect(page.locator('canvas')).toHaveCount(1);
  await setView(page, 0, 0, 600);
  await settleRendered(page);
  await expect(page.locator('#tiles-notice')).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => (await page.locator('#minimap svg').count()) > 0).toBe(true);
  return problems;
}

const WIDTHS = Array.from({ length: 28 }, (_, i) => 360 + 40 * i); // 360 .. 1440
const SIZES: [number, number, string][] = [
  ...WIDTHS.map((w): [number, number, string] => [w, 700, 'it']),
  [915, 412, 'it'],
  [768, 1024, 'it'],
  [800, 728, 'it'],
  [1024, 600, 'it'],
  [1280, 720, 'it'],
  [412, 915, 'it'],
  [360, 640, 'it'],
  // the edges of the two layouts (width 700, height 600)
  [699, 700, 'it'],
  [700, 700, 'it'],
  [700, 600, 'it'],
  [700, 599, 'it'],
  [1440, 599, 'it'],
  // English texts are wider in places
  [915, 412, 'en'],
  [800, 728, 'en'],
  [360, 640, 'en'],
  [412, 915, 'en'],
  [700, 600, 'en'],
  [1024, 600, 'en'],
];

for (const [w, h, lang] of SIZES) {
  test(`layout ${w}x${h} ${lang}: no overlap, all inside, nothing covers a link or a check box`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    const problems = await open(page, lang);
    const tag = `${w}x${h}`;

    // Card + results + notice.
    await page.evaluate((r) => (window as unknown as Win).__milanoIsoSelect(r, 'search'), {
      layer: 'landmark',
      landmarkId: 'fixture_landmark',
    });
    await expect(page.locator('#info-card')).toBeVisible();
    await expect(page.locator('#info-card-title')).toHaveText('Fixture Landmark');
    await page.locator('#search-input').fill('fixture');
    await expect(page.locator('#search-list')).toBeVisible();
    await check(page, `${tag} card+results+notice`, w, h);

    // Card + layers.
    await page.locator('#layers-button').click();
    await expect(page.locator('#layers-panel')).toBeVisible();
    await check(page, `${tag} card+layers+notice`, w, h);

    // Card + help.
    await page.locator('#help-button').click();
    await expect(page.locator('#help-panel')).toBeVisible();
    await check(page, `${tag} card+help+notice`, w, h);

    // Minimap open (a panel behind its button where the layout needs one, always there otherwise).
    if (await page.locator('#minimap-button').isVisible()) {
      await page.locator('#minimap-button').click();
    }
    await expect(page.locator('#minimap')).toBeVisible();
    await check(page, `${tag} card+minimap+notice`, w, h);

    expect(problems.filter((p) => !p.includes('Failed to load resource') && !p.includes('-1_0'))).toEqual([]);
  });
}
