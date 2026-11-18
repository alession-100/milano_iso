import { readFileSync } from 'node:fs';
import path from 'node:path';
import { type Page, expect, test } from '@playwright/test';
import { FIXTURE_DIR, collectProblems, fixtureContentBounds, routeFixtureTiles, settleTiles, stableCalls } from './support';

// T-5.3b: toolbar (search, layer toggles, minimap). Every wait on render state polls until it
// settles; nothing reads the state one frame after an action (R-5.2 amendment).

interface ToolbarState {
  query: string;
  resultCount: number;
  results: string[];
  status: string;
  indexRequested: boolean;
  layersOpen: boolean;
  minimapLoaded: boolean;
  minimapView: [number, number][] | null;
  layers: Record<string, boolean>;
  selection: { ref: Record<string, unknown>; source: string } | null;
}
interface Cam {
  target: [number, number];
  visibleWidth: number;
  azimuthDeg: number;
}

type Win = { __milanoIso: Record<string, unknown> };
const tb = (page: Page): Promise<ToolbarState> =>
  page.evaluate(() => (window as unknown as Win).__milanoIso.toolbar as ToolbarState);
const cam = (page: Page): Promise<Cam> =>
  page.evaluate(() => (window as unknown as Win).__milanoIso.camera as Cam);
const calls = (page: Page): Promise<number> =>
  page.evaluate(() => ((window as unknown as Win).__milanoIso.render as { calls: number }).calls);

async function open(page: Page, query = '', reduced = true): Promise<string[]> {
  const problems = collectProblems(page);
  await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await routeFixtureTiles(page);
  await page.goto(`/?e2e=1${query}`);
  await settleTiles(page);
  await expect.poll(async () => (await tb(page)).minimapLoaded).toBe(true);
  return problems;
}

const type = async (page: Page, text: string): Promise<void> => {
  const input = page.locator('#search-input');
  await input.focus();
  await input.fill('');
  await input.pressSequentially(text);
};

test('typing finds the fixture building, street and landmark, folding case and accents', async ({ page }) => {
  const problems = await open(page);
  await type(page, 'FIXTURE b1');
  await expect.poll(async () => (await tb(page)).results).toEqual(['Fixture B1']);
  await expect(page.getByRole('option')).toHaveText(['Fixture B1Edificio']);
  await type(page, 'via fixtúre');
  await expect.poll(async () => (await tb(page)).results).toEqual(['Via Fixture']);
  await expect(page.getByRole('option')).toHaveText(['Via FixtureVia']);
  await type(page, 'landmark');
  await expect.poll(async () => (await tb(page)).results).toEqual(['Fixture Landmark']);
  await expect(page.getByRole('option')).toHaveText(['Fixture LandmarkPunto di riferimento']);
  await type(page, 'fixture');
  await expect.poll(async () => (await tb(page)).resultCount).toBeGreaterThan(5);
  expect((await tb(page)).resultCount).toBeLessThanOrEqual(8);
  expect(problems).toEqual([]);
});

test('the search box is an ARIA combobox with a listbox, and "no results" is announced', async ({ page }) => {
  await open(page);
  const input = page.locator('#search-input');
  await expect(input).toHaveAttribute('role', 'combobox');
  await expect(input).toHaveAttribute('aria-expanded', 'false');
  await type(page, 'fixt');
  await expect(input).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#search-list')).toHaveAttribute('role', 'listbox');
  await expect(page.locator('#search-status')).toHaveAttribute('role', 'status');
  await input.press('ArrowDown');
  await expect(input).toHaveAttribute('aria-activedescendant', 'search-opt-0');
  await expect(page.locator('#search-opt-0')).toHaveAttribute('aria-selected', 'true');
  await input.press('Escape');
  await expect(input).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#search-list')).toBeHidden();
  await type(page, 'zzzz');
  await expect(page.locator('#search-status')).toHaveText('Nessun risultato');
  await expect(page.locator('#search-status')).toBeVisible();
  expect((await tb(page)).resultCount).toBe(0);
});

test('keyboard only: search, arrow, enter flies there and selects (reduced motion: instant)', async ({ page }) => {
  const problems = await open(page);
  // Reach the box with Tab alone: it is the first control of the page.
  await page.keyboard.press('Tab');
  await expect(page.locator('#search-input')).toBeFocused();
  await page.keyboard.type('fixture landmark');
  await expect.poll(async () => (await tb(page)).resultCount).toBe(1);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await cam(page)).target).toEqual([-22.5, -47.5]);
  const sel = (await tb(page)).selection;
  expect(sel).toEqual({ ref: { layer: 'landmark', landmarkId: 'fixture_landmark' }, source: 'search' });
  // A 25 m box fits within the lower zoom limit: 60 m.
  expect((await cam(page)).visibleWidth).toBe(60);
  await expect(page.locator('#search-list')).toBeHidden();
  expect(problems).toEqual([]);
});

test('choosing a street flies to its entry centre and builds the street ref; Enter picks the first hit', async ({
  page,
}) => {
  await open(page);
  await type(page, 'via fix');
  await expect.poll(async () => (await tb(page)).resultCount).toBe(1);
  await page.keyboard.press('Enter'); // nothing active yet: the first hit
  await expect.poll(async () => (await tb(page)).selection?.ref).toEqual({
    layer: 'roads',
    streetName: 'Via Fixture',
    osmType: 'w',
    osmId: 3001,
  });
  // The index centre is [-50, 150]; the camera clamps to the content bounds.
  const b = fixtureContentBounds();
  const c = (await cam(page)).target;
  expect(c[0]).toBeCloseTo(Math.min(Math.max(-50, b.minX), b.maxX), 3);
  expect(c[1]).toBeCloseTo(Math.min(Math.max(150, b.minZ), b.maxZ), 3);
});

test('choosing with the mouse works; a building and a green area map to their layers', async ({ page }) => {
  await open(page);
  await type(page, 'fixture b3');
  await page.getByRole('option', { name: /Fixture B3/ }).click();
  await expect.poll(async () => (await tb(page)).selection?.ref).toEqual({ layer: 'buildings', key: 'fix:B3' });
  await expect.poll(async () => (await cam(page)).target).toEqual([80, 80]);
  await type(page, 'parco');
  await page.getByRole('option').first().click();
  await expect
    .poll(async () => (await tb(page)).selection?.ref)
    .toEqual({ layer: 'green', osmType: 'w', osmId: 2001 });
});

test('with motion allowed the flight takes a few frames and ends exactly on target', async ({ page }) => {
  await open(page, '', false);
  await type(page, 'fixture b3');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await cam(page)).target, { timeout: 20_000 }).toEqual([80, 80]);
  // Fitted: 80 m box at azimuth 45 spans 80*sqrt(2) m across, with the 1.4 margin.
  expect((await cam(page)).visibleWidth).toBeCloseTo(80 * Math.SQRT2 * 1.4, 2);
  await settleTiles(page);
});

test('index.json is not fetched until the search box is used', async ({ page }) => {
  const seen: string[] = [];
  page.on('request', (r) => {
    if (/\/(index\.json|minimap\.svg)$/.test(new URL(r.url()).pathname)) seen.push(new URL(r.url()).pathname);
  });
  await open(page);
  await page.waitForTimeout(500);
  expect(seen.filter((p) => p.endsWith('index.json'))).toEqual([]);
  expect(seen.filter((p) => p.endsWith('minimap.svg'))).toHaveLength(1);
  expect((await tb(page)).indexRequested).toBe(false);
  await page.locator('#search-input').focus();
  await expect.poll(() => seen.filter((p) => p.endsWith('index.json')).length).toBe(1);
  await type(page, 'fix');
  await page.waitForTimeout(200);
  expect(seen.filter((p) => p.endsWith('index.json'))).toHaveLength(1); // fetched once
});

const TOGGLES: [string, string][] = [
  ['buildings', 'Edifici'],
  ['trees', 'Alberi'],
  ['markings', 'Segnaletica stradale'],
  ['roads', 'Strade e ferrovia'],
  ['waterGreen', 'Acqua e verde'],
  ['landmarkDetails', 'Dettagli dei monumenti'],
];

// One test per toggle (T-5.4): one test for all six took six reloads, which a loaded machine (ten copies of
// each test under --repeat-each) stretched past any limit. The toggles are independent of each other.
for (const [id, label] of TOGGLES) {
  test(`the ${id} toggle hides its layer (draw calls, test state) and survives a reload`, async ({ page }) => {
    const problems = await open(page);
    const base = await stableCalls(page);
    expect(base).toBeGreaterThan(5);
    await page.locator('#layers-button').click();
    await expect(page.locator('#layers-button')).toHaveAttribute('aria-expanded', 'true');
    const box = page.getByRole('checkbox', { name: label });
    await expect(box).toBeChecked();
    await box.uncheck();
    await expect.poll(async () => (await tb(page)).layers[id]).toBe(false);
    await expect.poll(() => calls(page), { message: `draw calls after hiding ${id}` }).toBeLessThan(base);
    const hidden = await stableCalls(page);
    // Reload: the choice is remembered.
    await page.reload();
    await settleTiles(page);
    expect((await tb(page)).layers[id]).toBe(false);
    expect(await stableCalls(page)).toBe(hidden);
    await page.locator('#layers-button').click();
    const again = page.getByRole('checkbox', { name: label });
    await expect(again).not.toBeChecked();
    await again.check();
    await expect.poll(async () => (await tb(page)).layers[id]).toBe(true);
    expect(await stableCalls(page)).toBe(base);
    expect(problems).toEqual([]);
  });
}

test('?layers= sets the toggles, tiles loaded later honour them, and the URL is not remembered', async ({
  page,
}) => {
  await open(page, '&layers=buildings,trees');
  const s = await tb(page);
  expect(s.layers).toEqual({
    buildings: true,
    trees: true,
    markings: false,
    roads: false,
    waterGreen: false,
    landmarkDetails: false,
  });
  const some = await stableCalls(page);
  await page.goto('/?e2e=1&layers=none');
  await settleTiles(page);
  expect(Object.values((await tb(page)).layers).every((v) => v === false)).toBe(true);
  // Only the ground plane is drawn; every tile was loaded after the state was set.
  expect(await stableCalls(page)).toBeLessThan(some);
  expect(await stableCalls(page)).toBeLessThanOrEqual(1);
  // A ?layers= value is for tests: it is not stored, so a plain reload shows everything again.
  await page.goto('/?e2e=1');
  await settleTiles(page);
  expect(Object.values((await tb(page)).layers).every((v) => v === true)).toBe(true);
});

test('a minimap click pans the camera there; the view polygon follows the camera and rotation', async ({
  page,
}) => {
  const problems = await open(page);
  const svg = page.locator('#minimap svg');
  await expect(svg).toBeVisible();
  const rect = await svg.boundingBox();
  expect(rect).not.toBeNull();
  if (!rect) return;
  // The fixture minimap viewBox is "-241 -240 482 482" (square, scale = width / 482).
  const k = rect.width / 482;
  const bounds = fixtureContentBounds();
  const wantX = 90;
  const wantZ = -60;
  await page.mouse.click(rect.x + (wantX + 241) * k, rect.y + (wantZ + 240) * k);
  await expect
    .poll(async () => {
      const [x, z] = (await cam(page)).target;
      return Math.abs(x - Math.min(Math.max(wantX, bounds.minX), bounds.maxX)) < 1.5 / k &&
        Math.abs(z - Math.min(Math.max(wantZ, bounds.minZ), bounds.maxZ)) < 1.5 / k;
    })
    .toBe(true);
  // The polygon has 4 corners and its centroid is the camera target.
  await expect.poll(async () => (await tb(page)).minimapView?.length).toBe(4);
  const poly = (await tb(page)).minimapView as [number, number][];
  const c = (await cam(page)).target;
  expect(poly.reduce((a, p) => a + p[0], 0) / 4).toBeCloseTo(c[0], 0);
  expect(poly.reduce((a, p) => a + p[1], 0) / 4).toBeCloseTo(c[1], 0);
  const pts = await page.locator('#minimap .mm-view').getAttribute('points');
  expect(pts?.split(' ')).toHaveLength(4);
  // Rotation turns the footprint (E = one step clockwise).
  await page.locator('#app').focus();
  await page.keyboard.press('e');
  await expect.poll(async () => (await cam(page)).azimuthDeg).toBe(315);
  await expect.poll(async () => (await tb(page)).minimapView).not.toEqual(poly);
  expect(problems).toEqual([]);
});

test('the minimap is not a keyboard stop and carries an overview label', async ({ page }) => {
  await open(page);
  await expect(page.locator('#minimap')).toHaveAttribute('aria-label', /Panoramica/);
  await expect(page.locator('#minimap-button')).toBeHidden(); // desktop: always shown, no button
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    const inside = await page.evaluate(() => !!document.activeElement?.closest('#minimap'));
    expect(inside).toBe(false);
  }
});

test('Tab reaches search, layers, and the rotation and day/night buttons in order', async ({ page }) => {
  await open(page);
  const seen: string[] = [];
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    seen.push(await page.evaluate(() => document.activeElement?.id ?? ''));
  }
  expect(seen.slice(0, 2)).toEqual(['search-input', 'layers-button']);
  for (const id of ['rotate-left', 'rotate-right', 'mode-toggle']) expect(seen).toContain(id);
});

test('the minimap file is sanitised: scripts and on* attributes never reach the DOM', async ({ page }) => {
  const original = readFileSync(path.join(FIXTURE_DIR, 'minimap.svg'), 'utf-8');
  const evil = original
    .replace('<rect', '<script>window.__pwned = 1</script><rect onclick="window.__pwned = 2"')
    .replace('</svg>', '<a href="javascript:window.__pwned=3"><path d="M0 0l1 1" onmouseover="window.__pwned=4"/></a></svg>');
  await page.route('**/tiles/pilot/minimap.svg', (route) =>
    route.fulfill({ status: 200, contentType: 'image/svg+xml', body: evil }),
  );
  const problems = await open(page);
  expect(await page.locator('#minimap script').count()).toBe(0);
  expect(await page.locator('#minimap [onclick], #minimap [onmouseover]').count()).toBe(0);
  expect(await page.locator('#minimap a[href^="javascript"]').count()).toBe(0);
  expect(await page.locator('#minimap path').count()).toBeGreaterThan(3); // the drawing is kept
  await page.locator('#minimap svg').click();
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  expect(problems).toEqual([]);
});

const FILLS = {
  day: { ground: 'rgb(227, 222, 212)', building: 'rgb(214, 208, 200)' }, // 0xe3ded4, 0xd6d0c8
  night: { ground: 'rgb(46, 54, 80)', building: 'rgb(94, 99, 120)' }, // 0x2e3650, 55% 0x858899 + 45% ground
};
async function fills(page: Page): Promise<{ ground: string; building: string }> {
  return page.evaluate(() => {
    const f = (sel: string): string => getComputedStyle(document.querySelector(sel) as Element).fill;
    return { ground: f('#minimap .mm-ground'), building: f('#minimap .mm-building') };
  });
}

test('starting in night, the minimap ground and buildings use the night colours', async ({ page }) => {
  await open(page, '&time=night');
  await expect(page.locator('#minimap')).toHaveAttribute('data-mode', 'night');
  expect(await fills(page)).toEqual(FILLS.night);
});

test('day to night to day recolours the minimap (desktop: always visible)', async ({ page }) => {
  await open(page);
  expect(await fills(page)).toEqual(FILLS.day);
  await page.locator('#mode-toggle').click();
  await expect.poll(() => fills(page)).toEqual(FILLS.night);
  await page.locator('#mode-toggle').click();
  await expect.poll(() => fills(page)).toEqual(FILLS.day);
});

test.describe('minimap theming at 412 px, panel opened before or after the toggle', () => {
  test.use({ viewport: { width: 412, height: 915 } });
  test('opened before the toggle', async ({ page }) => {
    await open(page);
    await page.locator('#minimap-button').click();
    await expect(page.locator('#minimap')).toBeVisible();
    expect(await fills(page)).toEqual(FILLS.day);
    await page.locator('#mode-toggle').click();
    await expect.poll(() => fills(page)).toEqual(FILLS.night);
    await page.locator('#mode-toggle').click();
    await expect.poll(() => fills(page)).toEqual(FILLS.day);
  });
  test('opened after the toggle', async ({ page }) => {
    await open(page);
    await page.locator('#mode-toggle').click();
    await page.locator('#minimap-button').click();
    await expect(page.locator('#minimap')).toBeVisible();
    await expect.poll(() => fills(page)).toEqual(FILLS.night);
    await page.locator('#minimap-button').click(); // close
    await page.locator('#mode-toggle').click(); // back to day while closed
    await page.locator('#minimap-button').click();
    await expect(page.locator('#minimap')).toBeVisible();
    await expect.poll(() => fills(page)).toEqual(FILLS.day);
  });
});

type Box = { x: number; y: number; width: number; height: number };
const overlap = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function boxes(page: Page, sels: string[]): Promise<Record<string, Box>> {
  const out: Record<string, Box> = {};
  for (const s of sels) {
    const b = await page.locator(s).boundingBox();
    expect(b, `${s} has a box`).not.toBeNull();
    out[s] = b as Box;
  }
  return out;
}

function expectNoOverlaps(b: Record<string, Box>, vw: number): void {
  const names = Object.keys(b);
  for (let i = 0; i < names.length; i++) {
    expect(b[names[i]].x, `${names[i]} left edge`).toBeGreaterThanOrEqual(0);
    expect(b[names[i]].x + b[names[i]].width, `${names[i]} right edge`).toBeLessThanOrEqual(vw);
    for (let j = i + 1; j < names.length; j++) {
      expect(overlap(b[names[i]], b[names[j]]), `${names[i]} overlaps ${names[j]}`).toBe(false);
    }
  }
}

test.describe('412 px layout', () => {
  test.use({ viewport: { width: 412, height: 915 } });

  test('toolbar, results, layers, minimap, notice, attribution and the top-right buttons never overlap', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await routeFixtureTiles(page);
    await page.route('**/tiles/pilot/-1_0.glb', (route) => route.fulfill({ status: 404, body: 'x' }));
    await page.goto('/?e2e=1');
    await expect(page.locator('#tiles-notice')).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await tb(page)).minimapLoaded).toBe(true);
    const fixed = ['#attribution', '#mode-toggle', '#rotation-controls', '#tiles-notice', '#toolbar'];

    // Collapsed: the minimap is behind its button.
    await expect(page.locator('#minimap')).toBeHidden();
    await expect(page.locator('#minimap-button')).toBeVisible();
    expectNoOverlaps(await boxes(page, fixed), 412);

    // Search results open.
    await type(page, 'fixture');
    await expect(page.locator('#search-list')).toBeVisible();
    expectNoOverlaps(await boxes(page, [...fixed, '#search-list']), 412);

    // Layers panel open.
    await page.locator('#layers-button').click();
    await expect(page.locator('#layers-panel')).toBeVisible();
    expectNoOverlaps(await boxes(page, [...fixed, '#layers-panel']), 412);

    // Minimap open (closes the layers panel).
    await page.locator('#minimap-button').click();
    await expect(page.locator('#minimap')).toBeVisible();
    await expect(page.locator('#layers-panel')).toBeHidden();
    expectNoOverlaps(await boxes(page, [...fixed, '#minimap']), 412);

    // No horizontal scroll.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(412);

    // Touch targets are at least 44 x 44 CSS px.
    await page.locator('#minimap-button').click(); // close it again
    await type(page, 'fixture');
    for (const sel of ['#search-input', '#layers-button', '#minimap-button', '#search-opt-0']) {
      const b = (await boxes(page, [sel]))[sel];
      expect(b.height, `${sel} height`).toBeGreaterThanOrEqual(44);
      expect(b.width, `${sel} width`).toBeGreaterThanOrEqual(44);
    }
    await page.locator('#layers-button').click();
    for (const [, label] of TOGGLES) {
      const b = await page.locator('label', { hasText: label }).boundingBox();
      expect(b?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    expect(problems.filter((p) => !p.includes('Failed to load resource') && !p.includes('-1_0'))).toEqual([]);
  });

  test('a minimap tap pans under touch emulation', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true });
    const page = await ctx.newPage();
    await open(page);
    await page.locator('#minimap-button').tap();
    const svg = page.locator('#minimap svg');
    await expect(svg).toBeVisible();
    const rect = (await svg.boundingBox()) as Box;
    const k = rect.width / 482;
    const bounds = fixtureContentBounds();
    await page.touchscreen.tap(rect.x + (-100 + 241) * k, rect.y + (50 + 240) * k);
    await expect
      .poll(async () => {
        const [x, z] = (await cam(page)).target;
        return (
          Math.abs(x - Math.min(Math.max(-100, bounds.minX), bounds.maxX)) < 1.5 / k &&
          Math.abs(z - Math.min(Math.max(50, bounds.minZ), bounds.maxZ)) < 1.5 / k
        );
      })
      .toBe(true);
    await ctx.close();
  });
});

test('desktop 1280x720: toolbar, minimap and top-right buttons do not overlap each other or the attribution', async ({
  page,
}) => {
  await open(page);
  await type(page, 'fixture');
  await expect(page.locator('#search-list')).toBeVisible();
  const b = await boxes(page, ['#toolbar', '#search-list', '#minimap', '#attribution', '#mode-toggle', '#rotation-controls']);
  expectNoOverlaps(b, 1280);
  expect(b['#minimap'].width).toBeCloseTo(160, 0);
  expect(b['#minimap'].x).toBeLessThan(20);
  expect(b['#minimap'].y + b['#minimap'].height).toBeGreaterThan(720 - 20);
});

test('the layers panel closes with Escape and returns focus to its button', async ({ page }) => {
  await open(page);
  await page.locator('#layers-button').click();
  await page.getByRole('checkbox', { name: 'Edifici' }).focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('#layers-panel')).toBeHidden();
  await expect(page.locator('#layers-button')).toBeFocused();
});

// Visual baseline (win32 only, see playwright.config.ts: baselines are per platform).
test.describe('toolbar visual baseline', () => {
  test.skip(process.platform !== 'win32', 'baseline exists for win32 only');
  for (const [name, w, h] of [
    ['desktop-1280x720', 1280, 720],
    ['mobile-412x915', 412, 915],
  ] as const) {
    test(`toolbar with results and minimap, ${name}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await open(page);
      await page.evaluate(() =>
        (window as unknown as { __milanoIsoSetView: (x: number, z: number, w: number) => void }).__milanoIsoSetView(0, 0, 600),
      );
      await settleTiles(page);
      if (w < 600) await page.locator('#minimap-button').click();
      await type(page, 'fixture');
      await expect(page.locator('#search-list')).toBeVisible();
      await page.evaluate(
        () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
      );
      await expect(page).toHaveScreenshot(`toolbar-${name}.png`);
    });
  }
});
