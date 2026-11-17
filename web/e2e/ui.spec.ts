import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { type Page, expect, test } from '@playwright/test';
import { dictionary } from '../src/i18n';
import { collectProblems, frameRendered, routeFixtureTiles, setView, settleRendered, stableCalls } from './support';

// T-5.4: the G5 checklist (VERIFICATION 4a) on the synthetic fixture, at 1280x720 and 412x915, by day
// and by night. Every wait polls state until it settles; no assertion has a wall-clock limit.

const OUT = path.resolve(process.cwd(), process.env.E2E_OUT_DIR ?? 'e2e-output');
const SIZES = [
  { name: 'desktop-1280x720', width: 1280, height: 720 },
  { name: 'mobile-412x915', width: 412, height: 915 },
] as const;
const MODES = ['day', 'night'] as const;

type Win = { __milanoIso: Record<string, unknown>; __milanoIsoSelect: (ref: unknown, source: string) => void };
interface Cam {
  target: [number, number];
  visibleWidth: number;
  azimuthDeg: number;
  azimuthStep: number;
}
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const cam = (page: Page): Promise<Cam> =>
  page.evaluate(() => (window as unknown as Win).__milanoIso.camera as Cam);
const card = (page: Page): Promise<{ open: boolean; title: string; type: string; heightSource: string | null }> =>
  page.evaluate(() => (window as unknown as { __milanoIso: { selection: { card: never } } }).__milanoIso.selection.card);

const B3 = { layer: 'buildings', key: 'fix:B3' };
const LANDMARK = { layer: 'landmark', landmarkId: 'fixture_landmark' };

interface OpenOptions {
  query?: string;
  reduced?: boolean;
  /** Make one tile fail for good so the tiles notice shows. */
  failTile?: boolean;
}

async function open(page: Page, o: OpenOptions = {}): Promise<string[]> {
  const problems = collectProblems(page);
  await page.emulateMedia({ reducedMotion: o.reduced === false ? 'no-preference' : 'reduce' });
  await routeFixtureTiles(page);
  if (o.failTile) await page.route('**/tiles/pilot/-1_0.glb', (route) => route.fulfill({ status: 404, body: 'x' }));
  await page.goto(`/?e2e=1${o.query ?? ''}`);
  await expect(page.locator('canvas')).toHaveCount(1);
  await setView(page, 0, 0, 600);
  await settleRendered(page);
  if (o.failTile) await expect(page.locator('#tiles-notice')).toBeVisible({ timeout: 20_000 });
  return problems;
}

/** Problems that are not the 404 the tests provoke on purpose (the browser logs it itself). */
const real = (problems: string[]): string[] => problems.filter((p) => !p.includes('Failed to load resource') && !p.includes('-1_0'));

/** Selects a feature and waits until its card has settled (open, final title, no pending data, laid out). */
async function selectFeature(page: Page, ref: unknown, title: string): Promise<void> {
  await page.evaluate((r) => (window as unknown as Win).__milanoIsoSelect(r, 'search'), ref);
  await expect.poll(async () => (await card(page)).open).toBe(true);
  await expect.poll(async () => (await card(page)).title).toBe(title);
  await frameRendered(page);
}

const boxOf = async (page: Page, sel: string): Promise<Box | null> => {
  const l = page.locator(sel);
  return (await l.count()) > 0 && (await l.first().isVisible()) ? await l.first().boundingBox() : null;
};

const overlap = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

// --- 7. Language ------------------------------------------------------------------------------

/** Every UI string in the page: text nodes and the text-bearing attributes of the UI containers. */
async function uiStrings(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [document.title, document.getElementById('app')?.getAttribute('aria-label') ?? ''];
    const roots = ['#toolbar-zone', '#mode-toggle', '#rotation-controls', '#info-card', '#attribution'];
    for (const sel of roots) {
      const root = document.querySelector(sel);
      if (!root) continue;
      const els = [root, ...root.querySelectorAll('*')];
      for (const el of els) {
        for (const a of ['aria-label', 'title', 'placeholder', 'alt']) {
          const v = el.getAttribute(a);
          if (v) out.push(v);
        }
        // Feature names and data links are data: skip the result names, the card title, attribution links.
        if (el.matches('.name, #info-card-title, #attribution a, svg *')) continue;
        for (const n of el.childNodes) {
          if (n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '') out.push((n.textContent ?? '').trim());
        }
      }
    }
    return out;
  });
}

const italianOnly = new Set<string>(
  Object.keys(dictionary.it)
    .filter((k) => dictionary.it[k as keyof typeof dictionary.it] !== dictionary.en[k as keyof typeof dictionary.en])
    .map((k) => dictionary.it[k as keyof typeof dictionary.it]),
);
const englishOnly = new Set<string>(
  Object.keys(dictionary.en)
    .filter((k) => dictionary.it[k as keyof typeof dictionary.it] !== dictionary.en[k as keyof typeof dictionary.en])
    .map((k) => dictionary.en[k as keyof typeof dictionary.en]),
);

test.describe('language (VERIFICATION 4a item 7)', () => {
  test('Italian by default; the switch changes every string live, including aria-labels, notice and card', async ({ page }) => {
    const problems = await open(page, { failTile: true });
    await expect(page.locator('html')).toHaveAttribute('lang', 'it');
    await expect(page.locator('#lang-toggle')).toHaveText('EN');
    await expect(page.locator('#tiles-notice')).toContainText('Alcune zone della mappa non sono state caricate');
    // Open everything that holds strings: card, search results, layers panel.
    await selectFeature(page, B3, 'Fixture B3');
    await page.locator('#search-input').fill('fixture');
    await expect(page.locator('#search-list')).toBeVisible();
    const it = await uiStrings(page);
    expect(it.filter((s) => englishOnly.has(s))).toEqual([]);
    expect(it).toContain('Tipo');

    await page.locator('#lang-toggle').click(); // closes the results (focus leaves the search box)
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('#lang-toggle')).toHaveText('IT');
    await expect(page.locator('#lang-toggle')).toHaveAttribute('aria-label', 'Switch to Italian (Italiano)');
    await expect(page.locator('#toolbar')).toHaveAttribute('aria-label', 'Map tools');
    await expect(page.locator('#search-input')).toHaveAttribute('placeholder', 'Search a place');
    await expect(page.locator('#search-input')).toHaveAttribute('aria-label', 'Search the map');
    await expect(page.locator('#layers-button')).toHaveText('Layers');
    await expect(page.locator('#help-button')).toHaveText('Help');
    await expect(page.locator('#minimap')).toHaveAttribute('aria-label', /^Overview map/);
    await expect(page.locator('#mode-toggle')).toHaveText('Night');
    await expect(page.locator('#rotate-left')).toHaveAttribute('aria-label', 'Rotate left');
    await expect(page.locator('#rotate-right')).toHaveAttribute('aria-label', 'Rotate right');
    await expect(page.locator('#app')).toHaveAttribute('aria-label', /^Isometric map of Milan/);
    await expect(page.locator('#attribution')).toContainText('Data:');
    await expect(page.locator('#tiles-notice')).toContainText('Some map areas could not be loaded');
    await expect(page.locator('#tiles-notice button')).toHaveAttribute('aria-label', 'Close');
    // The info card: labels, type, height source and the close button, live, without reselecting.
    await expect(page.locator('#info-card dt').first()).toHaveText('Type');
    await expect(page.locator('#info-card-height-source')).toHaveText('synthetic test data');
    await expect(page.locator('#info-card .close')).toHaveAttribute('aria-label', 'Close');
    // Search results and the status line are re-labelled too.
    await page.locator('#search-input').fill('zzzz');
    await expect(page.locator('#search-status')).toHaveText('No results');
    await page.locator('#search-input').fill('fixture b');
    await expect(page.locator('#search-opt-0 .kind')).toHaveText('Building');
    await page.locator('#layers-button').click();
    await expect(page.locator('#layers-panel label').first()).toContainText('Buildings');
    const en = await uiStrings(page);
    expect(en.filter((s) => italianOnly.has(s))).toEqual([]);
    expect(en).toContain('Type');
    expect(await page.title()).toBe('Milano Iso');

    // And back, live.
    await page.locator('#lang-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'it');
    await expect(page.locator('#layers-button')).toHaveText('Livelli');
    await expect(page.locator('#info-card-height-source')).toHaveText('dato sintetico di prova');
    await expect(page.locator('#tiles-notice')).toContainText('Alcune zone');
    expect(real(problems)).toEqual([]);
  });

  test('?lang= sets the initial language; the choice is remembered; the URL wins over the remembered choice', async ({ page }) => {
    const problems = await open(page, { query: '&lang=en' });
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('#layers-button')).toHaveText('Layers');
    // The parameter alone does not remember anything; a click does.
    expect(await page.evaluate(() => window.localStorage.getItem('milano-iso.lang'))).toBeNull();
    await page.locator('#lang-toggle').click(); // en -> it
    expect(await page.evaluate(() => window.localStorage.getItem('milano-iso.lang'))).toBe('it');
    await page.locator('#lang-toggle').click(); // it -> en
    expect(await page.evaluate(() => window.localStorage.getItem('milano-iso.lang'))).toBe('en');
    await page.goto('/?e2e=1'); // no parameter: the remembered English
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.goto('/?e2e=1&lang=it'); // the URL wins
    await expect(page.locator('html')).toHaveAttribute('lang', 'it');
    await expect(page.locator('#layers-button')).toHaveText('Livelli');
    await page.evaluate(() => window.localStorage.removeItem('milano-iso.lang'));
    expect(real(problems)).toEqual([]);
  });

  test('feature names are not translated', async ({ page }) => {
    await open(page);
    await page.locator('#search-input').fill('fixture landmark');
    await expect(page.locator('#search-opt-0 .name')).toHaveText('Fixture Landmark');
    const nameIt = await page.locator('#search-opt-0 .name').textContent();
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await card(page)).open).toBe(true);
    // The card first shows what the tile holds, then the index name: wait for it to settle (T-5.4 lesson).
    await expect.poll(async () => (await card(page)).title).toBe('Fixture Landmark');
    const titleIt = (await card(page)).title;
    await page.locator('#lang-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    expect((await card(page)).title).toBe(titleIt);
    await page.locator('#search-input').fill('fixture landmark');
    expect(await page.locator('#search-opt-0 .name').textContent()).toBe(nameIt);
    await page.evaluate(() => window.localStorage.removeItem('milano-iso.lang'));
  });
});

// --- 1, 2. Keyboard and focus -----------------------------------------------------------------

/** Focused element, described for the order check, and its focus ring as computed by the browser. */
async function focusStop(page: Page): Promise<{ id: string; ring: { width: string; style: string; color: string; shadow: string } }> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    const id = el.id || (el.tagName === 'A' ? `a:${el.textContent?.slice(0, 12)}` : el.className ? `.${el.className}` : el.tagName);
    // The checkboxes draw their ring on the row; the map draws it on a pseudo-element.
    const host = el.matches('#layers-panel input') ? (el.parentElement as HTMLElement) : el;
    const cs = getComputedStyle(host, el.id === 'app' ? '::after' : null);
    const outline = el.id === 'app' || el.matches('#layers-panel input') ? cs : getComputedStyle(el);
    return {
      id,
      ring: {
        width: outline.outlineWidth,
        style: outline.outlineStyle,
        color: outline.outlineColor,
        shadow: cs.boxShadow,
      },
    };
  });
}

for (const size of SIZES) {
  test.describe(`keyboard and focus, ${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    for (const mode of MODES) {
      test(`${mode}: Tab reaches every control in a logical order, each with a visible focus ring, and never traps`, async ({ page }) => {
        const problems = await open(page, { query: `&time=${mode}`, failTile: true });
        await selectFeature(page, B3, 'Fixture B3');
        await page.locator('#layers-button').click(); // opens the layers panel: its six rows are controls
        await expect(page.locator('#layers-panel')).toBeVisible();
        await page.locator('#search-input').focus();
        const narrow = size.width <= 600;
        const expected = [
          'search-input',
          'layers-button',
          'help-button',
          'lang-toggle',
          ...(narrow ? ['minimap-button'] : []),
          'layer-buildings',
          'layer-trees',
          'layer-markings',
          'layer-roads',
          'layer-waterGreen',
          'layer-landmarkDetails',
          '.tb-btn', // the notice's close button (no id)
          'app',
          'mode-toggle',
          'rotate-left',
          'rotate-right',
          '.close', // the info card's close button
          'a:(c) OpenStre',
          'a:Comune di Mi',
        ];
        const seen: string[] = [];
        const first = await focusStop(page);
        seen.push(first.id);
        const stops = [first];
        for (let i = 1; i < expected.length; i++) {
          await page.keyboard.press('Tab');
          stops.push(await focusStop(page));
          seen.push(stops[i].id);
        }
        expect(seen).toEqual(expected);
        // The focus ring: a solid 3 px outline in the focus colour, with the halo ring inside it.
        const ringColor = mode === 'night' ? 'rgb(255, 213, 79)' : 'rgb(8, 48, 107)';
        const halo = mode === 'night' ? 'rgb(38, 50, 56)' : 'rgb(255, 255, 255)';
        for (const s of stops) {
          if (s.id === 'app') {
            // The map draws its ring on a pseudo-element over the canvas: two inset shadows.
            expect(s.ring.shadow, 'map ring').toContain(ringColor);
            expect(s.ring.shadow, 'map halo').toContain(halo);
            continue;
          }
          expect(s.ring.style, `${s.id} outline style`).toBe('solid');
          expect(s.ring.width, `${s.id} outline width`).toBe('3px');
          expect(s.ring.color, `${s.id} outline colour`).toBe(ringColor);
          // The check box rows draw the ring inside the row, on the panel's own background: no halo.
          if (!s.id.startsWith('layer-')) expect(s.ring.shadow, `${s.id} halo`).toContain(halo);
        }
        // No trap: further Tab presses keep moving (the attribution is the last stop, then focus leaves
        // the page or wraps), and Shift+Tab goes back to the map.
        let prev = seen[seen.length - 1];
        for (let i = 0; i < 4; i++) {
          await page.keyboard.press('Tab');
          const cur = (await focusStop(page)).id;
          expect(cur, 'focus moved on').not.toBe(prev);
          prev = cur;
        }
        expect(real(problems)).toEqual([]);
      });
    }
  });
}

test.describe('keyboard on the map, escape and focus return', () => {
  test('the map is focusable and labelled; the keys of the help work; Tab leaves the map', async ({ page }) => {
    const problems = await open(page);
    const app = page.locator('#app');
    await expect(app).toHaveAttribute('tabindex', '0');
    await expect(app).toHaveAttribute('aria-label', /Mappa isometrica di Milano/);
    await page.locator('#help-button').click();
    await expect(page.locator('#help-panel')).toBeVisible();
    await expect(page.locator('#help-panel li')).toHaveCount(6);
    await expect(page.locator('#help-button')).toHaveAttribute('aria-expanded', 'true');
    // Every key the help lists does what it says.
    await app.focus();
    const c0 = await cam(page);
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await cam(page)).target[0]).not.toBe(c0.target[0]);
    await page.keyboard.press('+');
    await expect.poll(async () => (await cam(page)).visibleWidth).toBeLessThan(c0.visibleWidth);
    await page.keyboard.press('-');
    await page.keyboard.press('e');
    await expect.poll(async () => (await cam(page)).azimuthStep).toBe(3);
    await page.keyboard.press('q');
    await expect.poll(async () => (await cam(page)).azimuthStep).toBe(0);
    await page.keyboard.press('0');
    await expect.poll(async () => (await cam(page)).target).toEqual(c0.target);
    await expect.poll(async () => (await cam(page)).visibleWidth).toBeCloseTo(c0.visibleWidth, 3);
    // Tab leaves the map (no trap).
    await page.keyboard.press('Tab');
    await expect(page.locator('#mode-toggle')).toBeFocused();
    // Escape closes the help and returns focus to its button.
    await page.locator('#help-button').focus();
    await page.keyboard.press('Escape');
    await expect(page.locator('#help-panel')).toBeHidden();
    await expect(page.locator('#help-button')).toBeFocused();
    await expect(page.locator('#help-button')).toHaveAttribute('aria-expanded', 'false');
    expect(real(problems)).toEqual([]);
  });

  test('focus moves into the info card when it opens and back to where it was when it closes (Escape and the close button)', async ({ page }) => {
    const problems = await open(page);
    // From the search box (a keyboard pick).
    await page.locator('#search-input').fill('fixture b3');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await card(page)).open).toBe(true);
    await expect(page.locator('#info-card')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await card(page)).open).toBe(false);
    await expect(page.locator('#search-input')).toBeFocused();
    // From the map, closed with the close button.
    await page.locator('#app').focus();
    await selectFeature(page, LANDMARK, 'Fixture Landmark');
    await expect(page.locator('#info-card')).toBeFocused();
    await page.locator('#info-card .close').click();
    await expect.poll(async () => (await card(page)).open).toBe(false);
    await expect(page.locator('#app')).toBeFocused();
    // Escape closes the search results too, with the box keeping the focus.
    await page.locator('#search-input').fill('fixture');
    await expect(page.locator('#search-list')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#search-list')).toBeHidden();
    await expect(page.locator('#search-input')).toBeFocused();
    expect(real(problems)).toEqual([]);
  });
});

// --- 4, 5. Touch targets and layout -----------------------------------------------------------

/** Every visible control the user can press or type in, with its box. */
async function targets(page: Page): Promise<{ id: string; box: Box }[]> {
  const found = await page.evaluate(() => {
    const out: { id: string; x: number; y: number; width: number; height: number }[] = [];
    const sel = 'button, a[href], input, [role="option"], [tabindex="0"], #minimap';
    for (const el of document.querySelectorAll<HTMLElement>(sel)) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none') continue;
      if (el.closest('[hidden]')) continue;
      const rect = el.matches('#layers-panel input') ? (el.parentElement as HTMLElement).getBoundingClientRect() : r;
      out.push({ id: el.id || el.className || el.tagName, x: rect.x, y: rect.y, width: rect.width, height: rect.height });
    }
    return out;
  });
  return found.map((f) => ({ id: f.id, box: { x: f.x, y: f.y, width: f.width, height: f.height } }));
}

/** The boxes that must not overlap: each is a control or a block of the UI. */
const LAYOUT_BLOCKS = [
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
  '#debug-overlay',
];

async function expectLayoutOk(page: Page, label: string, w: number, h: number): Promise<void> {
  await frameRendered(page); // resize observers have re-fitted the card and the overlay
  const present: { sel: string; box: Box }[] = [];
  for (const sel of LAYOUT_BLOCKS) {
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
    x: window.scrollX,
  }));
  expect(scroll.sw, `${label}: no horizontal page scroll`).toBeLessThanOrEqual(scroll.iw);
  expect(scroll.x).toBe(0);
  expect(scroll.sh, `${label}: no vertical page scroll`).toBeLessThanOrEqual(scroll.ih);
}

for (const size of SIZES) {
  test.describe(`layout and touch targets, ${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    for (const mode of MODES) {
      for (const lang of ['it', 'en'] as const) {
        test(`${mode}/${lang}: the info card, search results and the tiles notice together; then the panels`, async ({ page }) => {
          const problems = await open(page, { query: `&time=${mode}&lang=${lang}`, failTile: true });
          const narrow = size.width <= 600;
          // Card + notice + search results.
          await selectFeature(page, LANDMARK, 'Fixture Landmark');
          await page.locator('#search-input').fill('fixture');
          await expect(page.locator('#search-list')).toBeVisible();
          await expectLayoutOk(page, 'card+results+notice', size.width, size.height);
          for (const t of await targets(page)) {
            expect(t.box.width, `${t.id} width`).toBeGreaterThanOrEqual(44);
            expect(t.box.height, `${t.id} height`).toBeGreaterThanOrEqual(44);
          }
          // Card + notice + layers panel.
          await page.locator('#layers-button').click();
          await expect(page.locator('#layers-panel')).toBeVisible();
          await expectLayoutOk(page, 'card+layers+notice', size.width, size.height);
          for (const t of await targets(page)) {
            expect(t.box.width, `${t.id} width`).toBeGreaterThanOrEqual(44);
            expect(t.box.height, `${t.id} height`).toBeGreaterThanOrEqual(44);
          }
          // Card + notice + help panel.
          await page.locator('#help-button').click();
          await expect(page.locator('#help-panel')).toBeVisible();
          await expectLayoutOk(page, 'card+help+notice', size.width, size.height);
          // Card + notice + minimap (a panel behind a button when narrow, always there when wide).
          if (narrow) {
            await page.locator('#minimap-button').click();
            await expect(page.locator('#minimap')).toBeVisible();
          }
          await expectLayoutOk(page, 'card+minimap+notice', size.width, size.height);
          // The card fits on screen.
          const c = await boxOf(page, '#info-card');
          expect(c).not.toBeNull();
          expect(real(problems)).toEqual([]);
        });
      }
    }

    test('with ?debug the overlay does not cover the tiles notice, the card or the attribution', async ({ page }) => {
      const problems = await open(page, { query: '&debug', failTile: true });
      await expect(page.locator('#debug-overlay')).toBeVisible();
      await selectFeature(page, LANDMARK, 'Fixture Landmark');
      await page.locator('#layers-button').click();
      await expectLayoutOk(page, 'debug', size.width, size.height);
      const notice = await boxOf(page, '#tiles-notice');
      const dbg = await boxOf(page, '#debug-overlay');
      expect(notice && dbg && !overlap(notice, dbg)).toBe(true);
      expect(real(problems)).toEqual([]);
    });
  });
}

// --- 4. Touch emulation at 412x915 ------------------------------------------------------------

test.describe('touch emulation, 412x915', () => {
  test.use({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });

  test('tap: the rotation buttons, search, layers, the minimap button and tap-to-pick all work', async ({ page }) => {
    const problems = await open(page);
    // Rotation buttons.
    await page.locator('#rotate-right').tap();
    await expect.poll(async () => (await cam(page)).azimuthStep).toBe(3);
    await page.locator('#rotate-left').tap();
    await expect.poll(async () => (await cam(page)).azimuthStep).toBe(0);
    // Search: tap the box, type, tap a result.
    await page.locator('#search-input').tap();
    await page.keyboard.type('fixture b3');
    await expect(page.locator('#search-opt-0')).toBeVisible();
    await page.locator('#search-opt-0').tap();
    await expect.poll(async () => (await cam(page)).target).toEqual([80, 80]);
    await expect.poll(async () => (await card(page)).title).toBe('Fixture B3');
    await page.locator('#info-card .close').tap();
    await expect.poll(async () => (await card(page)).open).toBe(false);
    // Layers: tap the button, tap a row (the whole 44 px row is the check box).
    await page.locator('#layers-button').tap();
    const row = page.locator('#layers-panel label', { hasText: 'Alberi' });
    await row.tap();
    await expect(page.locator('#layer-trees')).not.toBeChecked();
    await row.tap();
    await expect(page.locator('#layer-trees')).toBeChecked();
    await page.locator('#layers-button').tap();
    await expect(page.locator('#layers-panel')).toBeHidden();
    // The minimap button and a tap on the minimap.
    await page.locator('#minimap-button').tap();
    const svg = page.locator('#minimap svg');
    await expect(svg).toBeVisible();
    const before = (await cam(page)).target;
    const r = (await svg.boundingBox()) as Box;
    await page.touchscreen.tap(r.x + r.width * 0.2, r.y + r.height * 0.8);
    await expect.poll(async () => (await cam(page)).target).not.toEqual(before);
    await page.locator('#minimap-button').tap();
    // Tap-to-pick on the map: a building (B1 at 30,-30 seen close).
    await setView(page, 30, -30, 150);
    await settleRendered(page);
    const p = await page.evaluate(
      () => (window as unknown as { __milanoIsoScreenOf: (x: number, y: number, z: number) => { x: number; y: number } }).__milanoIsoScreenOf(40, 10, -35),
    );
    await page.touchscreen.tap(p.x, p.y);
    await expect.poll(async () => (await card(page)).open).toBe(true);
    expect((await card(page)).title).toBe('Fixture B1');
    expect(real(problems)).toEqual([]);
    // Pan and pinch under touch emulation are covered by controls.spec.ts (same viewport, CDP touch events).
  });
});

// --- 6. Reduced motion ------------------------------------------------------------------------

test.describe('reduced motion (VERIFICATION 4a item 6)', () => {
  // Read the camera in the same task as the action, so no frame can have run in between: an instant
  // change is already there, an animated one has not started. No timing is involved.
  test('rotation and the fly-to after a search are instant with reduced motion, animated without', async ({ page }) => {
    await open(page, { reduced: true });
    const rotated = await page.evaluate(() => {
      (document.getElementById('rotate-right') as HTMLButtonElement).click();
      return (window as unknown as Win).__milanoIso.camera as Cam;
    });
    expect(rotated.azimuthStep).toBe(3);
    expect(rotated.azimuthDeg).toBe(315);
    const flown = await page.evaluate(() => {
      const input = document.getElementById('search-input') as HTMLInputElement;
      input.value = 'fixture b3';
      input.dispatchEvent(new Event('input'));
      return new Promise<Cam>((resolve) => {
        // The index loads on the first input; wait for the list, then choose with Enter.
        const wait = (): void => {
          if (!document.getElementById('search-opt-0')) return void setTimeout(wait, 5);
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
          resolve((window as unknown as Win).__milanoIso.camera as Cam);
        };
        wait();
      });
    });
    expect(flown.target).toEqual([80, 80]);
  });

  test('without reduced motion the same fly-to and rotation have not moved yet in the same task', async ({ page }) => {
    await open(page, { reduced: false });
    const rotated = await page.evaluate(() => {
      (document.getElementById('rotate-right') as HTMLButtonElement).click();
      return (window as unknown as Win).__milanoIso.camera as Cam;
    });
    expect(rotated.azimuthDeg).toBe(45); // the animation starts on the next frame
    await expect.poll(async () => (await cam(page)).azimuthDeg).toBe(315);
    // The fly-to ends exactly on target.
    await page.locator('#search-input').fill('fixture b3');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await cam(page)).target).toEqual([80, 80]);
  });
  // Inertia: controls.spec.ts "reduced motion: no inertia after a fast drag" (and the inertia test
  // without reduced motion beside it).
});

// --- 8. Screen readers ------------------------------------------------------------------------

test.describe('screen reader semantics (VERIFICATION 4a item 8)', () => {
  test('every control has an accessible name; the card is a dialog; search is a combobox with a listbox; notices are live regions', async ({ page }) => {
    mkdirSync(OUT, { recursive: true });
    const problems = await open(page, { failTile: true });
    await selectFeature(page, B3, 'Fixture B3');
    await page.locator('#search-input').fill('fixture');
    await expect(page.locator('#search-list')).toBeVisible();
    // Accessible name of every control, by the rules of the platform (aria-label, label, content).
    const unnamed = await page.evaluate(() => {
      const bad: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>('button, a[href], input, [role="option"], [role="combobox"], [role="dialog"], [role="application"], [role="listbox"]')) {
        const labelled = el.getAttribute('aria-labelledby');
        const byId = labelled ? (document.getElementById(labelled)?.textContent ?? '') : '';
        const label = (el as HTMLInputElement).labels?.[0]?.textContent ?? '';
        const name = (el.getAttribute('aria-label') ?? byId ?? '') || label || el.textContent || el.getAttribute('title') || '';
        if (name.trim() === '') bad.push(el.id || el.className || el.tagName);
      }
      return bad;
    });
    expect(unnamed).toEqual([]);
    // Roles and relations.
    await expect(page.locator('#search-input')).toHaveAttribute('role', 'combobox');
    await expect(page.locator('#search-input')).toHaveAttribute('aria-controls', 'search-list');
    await expect(page.locator('#search-list')).toHaveAttribute('role', 'listbox');
    await expect(page.locator('#search-opt-0')).toHaveAttribute('role', 'option');
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#search-input')).toHaveAttribute('aria-activedescendant', 'search-opt-0');
    await expect(page.locator('#info-card')).toHaveAttribute('role', 'dialog');
    await expect(page.locator('#info-card')).toHaveAttribute('aria-labelledby', 'info-card-title');
    await expect(page.locator('#notice-region')).toHaveAttribute('role', 'status');
    await expect(page.locator('#notice-region #tiles-notice')).toHaveCount(1);
    await expect(page.locator('#search-status')).toHaveAttribute('aria-live', 'polite');
    await page.locator('#search-input').fill('zzzz');
    await expect(page.locator('#search-status')).toHaveText('Nessun risultato');
    // The accessibility snapshot (attached to the report): default view, card, results, help.
    const snap = async (name: string): Promise<string> => {
      const text = await page.locator('body').ariaSnapshot();
      writeFileSync(path.join(OUT, `a11y-${name}.txt`), text);
      return text;
    };
    const withCard = await snap('card-and-notice');
    expect(withCard).toContain('dialog');
    expect(withCard).toContain('combobox');
    expect(withCard).toContain('Fixture B3');
    expect(withCard).toContain('Alcune zone della mappa non sono state caricate');
    await page.locator('#search-input').fill('fixture');
    expect(await snap('results')).toContain('listbox');
    await page.locator('#help-button').click();
    expect(await snap('help')).toContain('Comandi da tastiera della mappa');
    expect(real(problems)).toEqual([]);
  });
});

// --- 5. The 'stable' look: toggling the language does not redraw the map ----------------------

test('switching the language does not change the draw calls (the map is not touched)', async ({ page }) => {
  await open(page);
  const before = await stableCalls(page);
  await page.locator('#lang-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  expect(await stableCalls(page)).toBe(before);
  await page.evaluate(() => window.localStorage.removeItem('milano-iso.lang'));
});
