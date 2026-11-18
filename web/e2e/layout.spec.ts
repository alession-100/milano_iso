import { type Page, expect, test } from '@playwright/test';
import { collectProblems, routeFixtureTiles, setView, settleRendered } from './support';

// T-5.7 (G5 blocker B2): the reserved attribution band, swept over a grid of sizes. At every size from
// 360x360 up, in every state (card or not; results, layers, help or the minimap open; the tile notice
// present), the blocks of the UI never overlap, stay inside the viewport, end above the band, the page does
// not scroll, and every link, button and check box is the element under its own centre; for the attribution
// links also under four inset corners (the attribution is a licence obligation, ODbL, hard rule 10).
// The fixture tileset is used. One page per language and height; the widths are walked in-page (the
// viewport is resized, which is what a window resize does), and the states are switched in-page.

type Win = { __milanoIsoSelect: (ref: unknown, source: string) => void };

/** Everything that is a block of the UI (a yielded notice draws nothing and is left out in the page). */
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
  '#debug-overlay',
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
  '#debug-close',
];

/** The whole audit, run in the page (one round trip per state). Returns the problems found. */
function audit(args: { blocks: string[]; hit: string[]; label: string }): string[] {
  const { blocks, hit, label } = args;
  const bad: string[] = [];
  const W = window.innerWidth;
  const H = window.innerHeight;
  const attrEl = document.getElementById('attribution');
  const attrBox = attrEl ? attrEl.getBoundingClientRect() : null;
  const bandVar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--band'));
  if (!attrBox || attrBox.height === 0) bad.push(`${label}: no attribution`);
  else if (!(Math.abs(bandVar - (attrBox.height + 12)) <= 1)) {
    bad.push(`${label}: --band ${bandVar} is not the attribution height ${attrBox.height} + 12`);
  }
  const present: { sel: string; r: DOMRect }[] = [];
  for (const sel of blocks) {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el || el.hidden || el.getClientRects().length === 0) continue;
    if (el.hasAttribute('data-yield')) continue; // text in the live region, nothing drawn
    present.push({ sel, r: el.getBoundingClientRect() });
  }
  const bandTop = H - bandVar;
  for (let i = 0; i < present.length; i++) {
    const a = present[i];
    if (a.r.left < -0.5) bad.push(`${label}: ${a.sel} left edge ${a.r.left}`);
    if (a.r.top < -0.5) bad.push(`${label}: ${a.sel} top edge ${a.r.top}`);
    if (a.r.right > W + 0.5) bad.push(`${label}: ${a.sel} right edge ${a.r.right} > ${W}`);
    if (a.r.bottom > H + 0.5) bad.push(`${label}: ${a.sel} bottom edge ${a.r.bottom} > ${H}`);
    if (a.sel !== '#attribution' && !(a.r.bottom <= bandTop + 0.5)) {
      bad.push(`${label}: ${a.sel} reaches into the band (bottom ${a.r.bottom} > ${bandTop})`);
    }
    for (let j = i + 1; j < present.length; j++) {
      const b = present[j];
      if (a.r.left < b.r.right && b.r.left < a.r.right && a.r.top < b.r.bottom && b.r.top < a.r.bottom) {
        bad.push(`${label}: ${a.sel} overlaps ${b.sel}`);
      }
    }
  }
  const de = document.documentElement;
  if (de.scrollWidth > W) bad.push(`${label}: horizontal scroll ${de.scrollWidth} > ${W}`);
  if (de.scrollHeight > H) bad.push(`${label}: vertical scroll ${de.scrollHeight} > ${H}`);
  const name = (e: Element | null): string => (e ? (e.id ? '#' + e.id : e.tagName) : 'nothing');
  for (const sel of hit) {
    document.querySelectorAll<HTMLElement>(sel).forEach((el, i) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || el.closest('[data-yield]') || el.closest('[hidden]')) return;
      // A check box inside a scrolling panel, scrolled out of sight, is reached by scrolling the panel.
      const panel = el.closest<HTMLElement>('#layers-panel');
      if (panel) {
        const p = panel.getBoundingClientRect();
        if (r.bottom > p.bottom + 0.5 || r.top < p.top - 0.5) return;
      }
      const points: [number, number][] = [[r.left + r.width / 2, r.top + r.height / 2]];
      if (sel === '#attribution a') {
        const d = 3;
        points.push([r.left + d, r.top + d], [r.right - d, r.top + d], [r.left + d, r.bottom - d], [r.right - d, r.bottom - d]);
      }
      for (const [x, y] of points) {
        const top = document.elementFromPoint(x, y);
        if (!top || !(top === el || el.contains(top))) {
          bad.push(`${label}: ${sel}[${i}] at ${Math.round(x)},${Math.round(y)} is covered by ${name(top)}`);
        }
      }
    });
  }
  return bad;
}

async function frames(page: Page, n = 4): Promise<void> {
  await page.evaluate(
    (k) =>
      new Promise<void>((resolve) => {
        const step = (left: number): void => {
          if (left === 0) resolve();
          else requestAnimationFrame(() => step(left - 1));
        };
        step(k);
      }),
    n,
  );
}

async function open(page: Page, lang: string, extra = ''): Promise<string[]> {
  const problems = collectProblems(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await routeFixtureTiles(page);
  await page.route('**/tiles/pilot/-1_0.glb', (route) => route.fulfill({ status: 404, body: 'x' }));
  await page.goto(`/?e2e=1&lang=${lang}${extra}`);
  await expect(page.locator('canvas')).toHaveCount(1);
  await setView(page, 0, 0, 600);
  await settleRendered(page);
  await expect(page.locator('#tiles-notice')).toHaveCount(1, { timeout: 20_000 });
  await expect.poll(async () => (await page.locator('#minimap svg').count()) > 0).toBe(true);
  return problems;
}

const LANDMARK = { layer: 'landmark', landmarkId: 'fixture_landmark' };
type Panel = 'results' | 'layers' | 'help' | 'minimap';
const PANELS: Panel[] = ['results', 'layers', 'help', 'minimap'];

/** Puts the page in a state: the card shown or not, and exactly one of the panels open. */
async function setState(page: Page, card: boolean, panel: Panel): Promise<void> {
  await page.evaluate(
    ([withCard, ref]) => {
      const w = window as unknown as Win;
      w.__milanoIsoSelect(withCard ? ref : null, 'search');
      const q = (s: string): HTMLElement | null => document.querySelector<HTMLElement>(s);
      for (const [btn, panelSel] of [
        ['#layers-button', '#layers-panel'],
        ['#help-button', '#help-panel'],
      ] as const) {
        const p = q(panelSel);
        if (p && !p.hidden) q(btn)?.click();
      }
      const mmBtn = q('#minimap-button');
      if (mmBtn && mmBtn.getAttribute('aria-expanded') === 'true') mmBtn.click();
      const input = q('#search-input') as HTMLInputElement | null;
      if (input && input.value !== '') {
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    },
    [card, LANDMARK] as const,
  );
  if (panel === 'results') {
    await page.locator('#search-input').fill('fixture');
    await expect(page.locator('#search-list')).toBeVisible();
  } else if (panel === 'layers') {
    await page.evaluate(() => document.querySelector<HTMLElement>('#layers-button')?.click());
  } else if (panel === 'help') {
    await page.evaluate(() => document.querySelector<HTMLElement>('#help-button')?.click());
  } else {
    await page.evaluate(() => {
      const b = document.querySelector<HTMLElement>('#minimap-button');
      if (b && getComputedStyle(b).display !== 'none') b.click();
    });
  }
  await frames(page);
}

const WIDTHS = [
  ...Array.from({ length: 28 }, (_, i) => 360 + 40 * i), // 360 .. 1440
  599,
  600,
  699,
  700,
  701,
].sort((a, b) => a - b);
const HEIGHTS = [360, 375, 390, 412, 480, 540, 599, 600, 640, 728, 915, 1024];

// T-5.8: the sweep is 26 independent tests, each with its own page; they run in parallel on the workers.
test.describe.configure({ mode: 'parallel' });

for (const lang of ['it', 'en']) {
  for (const h of HEIGHTS) {
    test(`band sweep ${lang} height ${h}: widths 360..1440, 8 states, nothing overlaps or covers the attribution`, async ({
      page,
    }) => {
      test.setTimeout(300_000);
      await page.setViewportSize({ width: WIDTHS[0], height: h });
      const problems = await open(page, lang);
      const found: string[] = [];
      for (const w of WIDTHS) {
        await page.setViewportSize({ width: w, height: h });
        for (const withCard of [true, false]) {
          for (const panel of PANELS) {
            await setState(page, withCard, panel);
            const label = `${w}x${h} ${lang} ${withCard ? 'card' : 'no card'}+${panel}+notice`;
            found.push(...(await page.evaluate(audit, { blocks: BLOCKS, hit: HIT, label })));
          }
        }
      }
      expect(found, 'layout problems').toEqual([]);
      expect(problems.filter((p) => !p.includes('Failed to load resource') && !p.includes('-1_0'))).toEqual([]);
    });
  }
}

// T-5.8 (N9): with ?debug the overlay is above the band and never covers or squeezes the zone or the card.
const DEBUG_WIDTHS = [360, 412, 640, 699, 700, 800, 940, 1280];
for (const h of [360, 412, 600, 915]) {
  test(`?debug sweep height ${h}: card + layers (and results), the overlay covers nothing`, async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: DEBUG_WIDTHS[0], height: h });
    const problems = await open(page, 'en', '&debug');
    await expect(page.locator('#debug-overlay')).toBeVisible();
    const found: string[] = [];
    for (const w of DEBUG_WIDTHS) {
      await page.setViewportSize({ width: w, height: h });
      for (const withCard of [true, false]) {
        for (const panel of ['layers', 'results'] as const) {
          await setState(page, withCard, panel);
          const label = `${w}x${h} debug ${withCard ? 'card' : 'no card'}+${panel}`;
          found.push(...(await page.evaluate(audit, { blocks: BLOCKS, hit: HIT, label })));
        }
      }
    }
    expect(found, 'layout problems').toEqual([]);
    expect(problems.filter((p) => !p.includes('Failed to load resource') && !p.includes('-1_0'))).toEqual([]);
  });
}

// T-5.8 (N8): the active option of the results list stays fully visible on every arrow press, also where the
// list is squeezed by the band rule. Eight options of 44 px in a list that is 136 px or less.
for (const [w, h, withCard] of [
  [640, 412, true],
  [360, 360, false],
  [640, 412, false],
] as const) {
  test(`arrow keys keep the active search option fully visible at ${w}x${h}${withCard ? ' with the card' : ''}`, async ({
    page,
  }) => {
    const entries = Array.from({ length: 14 }, (_, i) => ({
      bbox: [i, i, i + 10, i + 10],
      centre: [i + 5, i + 5],
      kind: 'street',
      name: `Via ${String.fromCharCode(65 + i)}`,
      ref: { key: `syn:${i}` },
      tiles: ['0_0'],
    }));
    await routeFixtureTiles(page);
    await page.route('**/tiles/pilot/index.json', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries }) }),
    );
    await page.setViewportSize({ width: w, height: h });
    await page.goto('/?e2e=1&lang=en');
    await expect(page.locator('canvas')).toHaveCount(1);
    if (withCard) {
      await page.evaluate((ref) => (window as unknown as Win).__milanoIsoSelect(ref, 'search'), LANDMARK);
      await expect(page.locator('#info-card')).toBeVisible();
    }
    const input = page.locator('#search-input');
    await input.fill('via');
    await expect(page.locator('#search-list li')).toHaveCount(8);
    const visible = (i: number): Promise<number> =>
      page.evaluate((k) => {
        const list = document.getElementById('search-list') as HTMLElement;
        const li = document.getElementById(`search-opt-${k}`) as HTMLElement;
        const l = list.getBoundingClientRect();
        const r = li.getBoundingClientRect();
        const top = l.top + list.clientTop;
        const bottom = top + list.clientHeight;
        return Math.max(0, Math.min(r.bottom, bottom) - Math.max(r.top, top));
      }, i);
    for (let i = 0; i < 8; i++) {
      await input.press('ArrowDown');
      await expect(input).toHaveAttribute('aria-activedescendant', `search-opt-${i}`);
      // Poll until the layout has settled (no wall-clock threshold): the whole option is inside the list box.
      await expect
        .poll(() => visible(i), { message: `option ${i} visible px at ${w}x${h}` })
        .toBe(await page.locator(`#search-opt-${i}`).evaluate((e) => e.getBoundingClientRect().height));
    }
  });
}

// The notice yields only where there is no room, and its text is announced even then: a notice that
// arrives while a panel is open is written into the live region at once (the region's text changes).
for (const [w, h, drawn] of [
  [640, 360, false],
  [1280, 720, true],
] as const) {
  test(`the tile notice arriving while Layers is open is announced at ${w}x${h} (${drawn ? 'drawn' : 'yielded'})`, async ({
    page,
  }) => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await routeFixtureTiles(page);
    await page.route('**/tiles/pilot/-1_0.glb', async (route) => {
      await gate;
      await route.fulfill({ status: 404, body: 'x' });
    });
    await page.setViewportSize({ width: w, height: h });
    await page.goto('/?e2e=1&lang=en');
    await expect(page.locator('canvas')).toHaveCount(1);
    await page.evaluate(() => document.querySelector<HTMLElement>('#layers-button')?.click());
    await expect(page.locator('#layers-panel')).toBeVisible();
    // Record every text the live region takes.
    await page.evaluate(() => {
      const region = document.getElementById('notice-region') as HTMLElement;
      const log: string[] = [];
      (window as unknown as { __noticeLog: string[] }).__noticeLog = log;
      new MutationObserver(() => log.push(region.textContent ?? '')).observe(region, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    });
    await setView(page, 0, 0, 600);
    expect(await page.locator('#notice-region').textContent()).toBe('');
    release(); // the tile fails now, while the layers panel is open
    await expect(page.locator('#tiles-notice')).toHaveCount(1, { timeout: 20_000 });
    await frames(page);
    const region = page.locator('#notice-region');
    await expect(region).toHaveAttribute('aria-live', 'polite');
    await expect(region).toContainText('Some map areas could not be loaded');
    const log = await page.evaluate(() => (window as unknown as { __noticeLog: string[] }).__noticeLog);
    expect(log.some((t) => t.includes('Some map areas could not be loaded')), `${w}x${h} live region log`).toBe(true);
    await expect(page.locator('#layers-panel')).toBeVisible();
    const yielded = await page.locator('#tiles-notice').evaluate((n) => n.hasAttribute('data-yield'));
    expect(yielded, `${w}x${h} notice yields`).toBe(!drawn);
    if (drawn) await expect(page.locator('#tiles-notice')).toBeVisible();
  });
}
