import { type Page, expect, test } from '@playwright/test';
import { collectProblems, routeFixtureTiles } from './support';

// T-5.1: picking, hover highlight and the info card, on the synthetic fixture (never real data).
// Every wait polls the test state until it settles; nothing is read one frame after an action.

interface Ref {
  layer: string;
  tile?: string;
  key?: string;
  osmType?: string;
  osmId?: number;
  landmarkId?: string;
}
interface CardState {
  open: boolean;
  title: string;
  named: boolean;
  type: string;
  height: string | null;
  heightSource: string | null;
  osmUrl: string | null;
  note: string | null;
  pending: boolean;
}
interface SelectionState {
  current: Ref | null;
  source: string | null;
  hover: Ref | null;
  hoverCount: number;
  card: CardState;
  pick: { count: number; lastMs: number; maxMs: number };
  lastLayer: string | null;
}

const selection = (page: Page): Promise<SelectionState> =>
  page.evaluate(() => (window as unknown as { __milanoIso: { selection: SelectionState } }).__milanoIso.selection);

async function open(page: Page, width = 600, x = 0, z = 0, hold?: () => Promise<void>, query = ''): Promise<string[]> {
  const problems = collectProblems(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await routeFixtureTiles(page);
  if (hold) await hold();
  await page.goto(`/?e2e=1${query}`);
  await expect(page.locator('canvas')).toHaveCount(1);
  await page.waitForFunction(
    () =>
      typeof (window as unknown as { __milanoIsoSetView?: unknown }).__milanoIsoSetView === 'function' &&
      (window as unknown as { __milanoIso: { camera: { bounds: { maxX: number } } } }).__milanoIso.camera.bounds.maxX !== 500,
  );
  await setView(page, x, z, width);
  if (!hold) await settleRendered(page);
  return problems;
}

async function setView(page: Page, x: number, z: number, w: number): Promise<void> {
  await page.evaluate(
    ([a, b, c]) =>
      (window as unknown as { __milanoIsoSetView: (x: number, z: number, w: number) => void }).__milanoIsoSetView(a, b, c),
    [x, z, w],
  );
}

async function settle(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const s = (window as unknown as { __milanoIso: { tiles: { loading: number; visible: number; loaded: number; failed: number } } }).__milanoIso.tiles;
          return s.visible > 0 && s.loading === 0 && s.loaded + s.failed >= s.visible;
        }),
      { timeout: 20_000 },
    )
    .toBe(true);
}

/**
 * Tiles settled AND rendered: the tile counts are final and the draw-call count is the same on
 * several consecutive polls (after a frame), so a value read next is the settled one.
 */
async function settleRendered(page: Page): Promise<void> {
  await settle(page);
  let prev = -1;
  let same = 0;
  await expect
    .poll(
      async () => {
        const st = await page.evaluate(
          () =>
            new Promise<{ calls: number; loading: number; ok: boolean }>((r) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => {
                  const w = (window as unknown as { __milanoIso: { render: { calls: number }; tiles: { loading: number; visible: number; loaded: number; failed: number } } }).__milanoIso;
                  r({ calls: w.render.calls, loading: w.tiles.loading, ok: w.tiles.visible > 0 && w.tiles.loaded + w.tiles.failed >= w.tiles.visible });
                }),
              ),
            ),
        );
        same = st.calls === prev && st.calls > 1 && st.ok && st.loading === 0 ? same + 1 : 0;
        prev = st.calls;
        return same >= 3;
      },
      { timeout: 20_000 },
    )
    .toBe(true);
}

/** Client pixel of a point (x, y up, z) in client metres, from the app's own camera. */
async function screenOf(page: Page, x: number, y: number, z: number): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ([a, b, c]) =>
      (window as unknown as { __milanoIsoScreenOf: (x: number, y: number, z: number) => { x: number; y: number } }).__milanoIsoScreenOf(a, b, c),
    [x, y, z],
  );
}

/** First ground point (world grid, 5 m) where a pick gives a ref with the given layer and id fields. */
async function findPoint(page: Page, want: Partial<Ref>): Promise<{ x: number; y: number }> {
  const p = await page.evaluate((w) => {
    const win = window as unknown as {
      __milanoIsoScreenOf: (x: number, y: number, z: number) => { x: number; y: number };
      __milanoIsoPickAt: (x: number, y: number) => { ref: Record<string, unknown> | null };
    };
    for (let x = -240; x <= 240; x += 5) {
      for (let z = -240; z <= 240; z += 5) {
        const s = win.__milanoIsoScreenOf(x, 0.2, z);
        // Stay clear of the right-hand card and the control buttons.
        if (s.x < 0 || s.y < 0 || s.x > window.innerWidth - 360 || s.y > window.innerHeight) continue;
        const r = win.__milanoIsoPickAt(s.x, s.y).ref;
        if (r && Object.entries(w).every(([k, v]) => r[k] === v)) return s;
      }
    }
    return null;
  }, want);
  expect(p, `no pickable point for ${JSON.stringify(want)}`).not.toBeNull();
  return p as { x: number; y: number };
}

async function clickAt(page: Page, p: { x: number; y: number }): Promise<void> {
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.up();
}

const BUILDINGS: [string, string, number, number, number, string, string][] = [
  // key, name, x, y(roof), z, type label, height text
  ['fix:B1', 'Fixture B1', 40, 10, -35, 'Edificio residenziale', '10 m'],
  ['fix:B2', 'Fixture B2', -60, 15, -50, 'Edificio commerciale o per uffici', '15 m'],
  ['fix:B3', 'Fixture B3', 80, 20, 80, 'Edificio civico o religioso', '20 m'],
  ['fix:B4', 'Fixture B4', -72.5, 30, 57.5, 'Edificio industriale', '30 m'],
  ['fix:B5', 'Fixture B5', -30, 12, 70, 'Edificio', '12 m'],
];

test.describe('picking (desktop 1280x720)', () => {
  test('each building colour group opens its card with the right name, type and height', async ({ page }) => {
    const problems = await open(page);
    for (const [key, name, x, y, z, type, height] of BUILDINGS) {
      const p = await screenOf(page, x, y, z);
      await clickAt(page, p);
      await expect.poll(async () => (await selection(page)).current?.key).toBe(key);
      const s = await selection(page);
      expect(s.source).toBe('pick');
      expect(s.card).toMatchObject({
        open: true,
        title: name,
        named: true,
        type,
        height,
        heightSource: 'dato sintetico di prova',
        pending: false,
      });
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAttribute('aria-labelledby', 'info-card-title');
      await expect(page.locator('#info-card-title')).toHaveText(name);
    }
    expect(problems).toEqual([]);
  });

  test('hover changes the highlight state and clears on leave; draw calls do not change', async ({ page }) => {
    const problems = await open(page);
    const before = await page.evaluate(() => (window as unknown as { __milanoIso: { render: { calls: number } } }).__milanoIso.render.calls);
    const p = await screenOf(page, 40, 10, -35);
    await page.mouse.move(p.x - 30, p.y + 200);
    await page.mouse.move(p.x, p.y, { steps: 4 });
    await expect.poll(async () => (await selection(page)).hover?.key).toBe('fix:B1');
    expect((await selection(page)).hoverCount).toBe(1);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __milanoIso: { render: { calls: number } } }).__milanoIso.render.calls))
      .toBe(before);
    // Hovering does not select.
    expect((await selection(page)).current).toBeNull();
    // Off the content (left edge of a wide view): the hover clears.
    await page.mouse.move(3, 360, { steps: 4 });
    await expect.poll(async () => (await selection(page)).hover).toBeNull();
    expect((await selection(page)).hoverCount).toBe(0);
    // Leaving the page area also clears it.
    await page.mouse.move(p.x, p.y, { steps: 2 });
    await expect.poll(async () => (await selection(page)).hover?.key).toBe('fix:B1');
    await page.mouse.move(p.x, -5);
    await expect.poll(async () => (await selection(page)).hover).toBeNull();
    expect(problems).toEqual([]);
  });

  test('a landmark detail selects the landmark, never the detail', async ({ page }) => {
    const problems = await open(page, 300, -20, -45);
    // The spire of the fixture landmark stands at (-22.5, 8..16, -47.5); aim at its axis, below the tip.
    const p = await screenOf(page, -22.5, 11, -47.5);
    const picked = await page.evaluate(
      ([x, y]) => (window as unknown as { __milanoIsoPickAt: (x: number, y: number) => { layer: string | null } }).__milanoIsoPickAt(x, y),
      [p.x, p.y],
    );
    expect(picked.layer).toBe('landmark_details');
    await clickAt(page, p);
    await expect.poll(async () => (await selection(page)).current?.layer).toBe('landmark');
    // The name comes from index.json, fetched on the first selection: poll until it has arrived.
    await expect.poll(async () => (await selection(page)).card.title).toBe('Fixture Landmark');
    const s = await selection(page);
    expect(s.current).toMatchObject({ layer: 'landmark', landmarkId: 'fixture_landmark' });
    expect(s.card.title).toBe('Fixture Landmark');
    expect(s.card.type).toBe('Punto di riferimento');
    expect(s.card.note).toContain('stilizzati');
    expect(s.card.height).toBeNull();
    await expect(page.locator('#info-card-note')).toBeVisible();
    // The body selects the same landmark.
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await selection(page)).current).toBeNull();
    const body = await screenOf(page, -22.5, 8, -40);
    await clickAt(page, body);
    await expect.poll(async () => (await selection(page)).current?.landmarkId).toBe('fixture_landmark');
    expect(problems).toEqual([]);
  });

  test('roads show the street name from the index or "Senza nome", with the road class', async ({ page }) => {
    const problems = await open(page);
    await clickAt(page, await findPoint(page, { layer: 'roads', osmId: 3001 }));
    await expect.poll(async () => (await selection(page)).current?.osmId).toBe(3001);
    await expect.poll(async () => (await selection(page)).card.title).toBe('Via Fixture');
    let s = await selection(page);
    expect(s.card).toMatchObject({ title: 'Via Fixture', named: true, type: 'Strada residenziale' });
    expect(s.card.height).toBeNull();
    expect(s.card.osmUrl).toBe('https://www.openstreetmap.org/way/3001');
    await clickAt(page, await findPoint(page, { layer: 'roads', osmId: 3002 }));
    await expect.poll(async () => (await selection(page)).current?.osmId).toBe(3002);
    s = await selection(page);
    expect(s.card).toMatchObject({ title: 'Senza nome', named: false, type: 'Strada terziaria' });
    expect(problems).toEqual([]);
  });

  test('green, water and land use give their kind; the park name comes from the index', async ({ page }) => {
    const problems = await open(page);
    await clickAt(page, await findPoint(page, { layer: 'green', osmId: 2001 }));
    await expect.poll(async () => (await selection(page)).current?.layer).toBe('green');
    await expect.poll(async () => (await selection(page)).card.title).toBe('Parco Fixture');
    expect((await selection(page)).card).toMatchObject({ title: 'Parco Fixture', type: 'Parco' });
    await clickAt(page, await findPoint(page, { layer: 'water', osmId: 2003 }));
    await expect.poll(async () => (await selection(page)).current?.layer).toBe('water');
    expect((await selection(page)).card).toMatchObject({ title: 'Senza nome', type: 'Bacino' });
    await clickAt(page, await findPoint(page, { layer: 'landuse', osmId: 2002 }));
    await expect.poll(async () => (await selection(page)).current?.layer).toBe('landuse');
    expect((await selection(page)).card).toMatchObject({ title: 'Senza nome', type: 'Zona residenziale' });
    expect(problems).toEqual([]);
  });

  test('a mapped tree is pickable with its height source; a fill tree is not', async ({ page }) => {
    const problems = await open(page, 300, 20, -30);
    // Mapped tree 5002 (12 m, OSM height tag) at (90, -30).
    const mapped = await screenOf(page, 90, 5, -30);
    await clickAt(page, mapped);
    await expect.poll(async () => (await selection(page)).current?.layer).toBe('trees');
    const s = await selection(page);
    expect(s.current).toMatchObject({ osmType: 'n', osmId: 5002 });
    expect(s.card).toMatchObject({ type: 'Albero mappato in OSM', height: '12 m', heightSource: 'OSM (altezza indicata)' });
    // Fill trees stand in the park of tile -1_0: the ray goes through them to the park or nothing.
    await setView(page, -150, -130, 120);
    await settle(page);
    const hits = await page.evaluate(() => {
      const win = window as unknown as {
        __milanoIsoScreenOf: (x: number, y: number, z: number) => { x: number; y: number };
        __milanoIsoPickAt: (x: number, y: number) => { ref: { layer: string; osmId?: number } | null };
      };
      // Fill tree rows of the fixture, crown height about 5 m.
      const fill: [number, number][] = [[-136.35, -108.65], [-138.58, -120.07], [-125.0, -105.97], [-147.65, -131.17], [-149.27, -120.69]];
      return fill.map(([x, z]) => {
        const s = win.__milanoIsoScreenOf(x, 4, z);
        return win.__milanoIsoPickAt(s.x, s.y).ref;
      });
    });
    for (const r of hits) {
      expect(r?.layer).not.toBe('trees');
    }
    expect(hits.some((r) => r?.layer === 'green')).toBe(true);
    expect(problems).toEqual([]);
  });

  test('a drag does not select', async ({ page }) => {
    const problems = await open(page);
    const p = await screenOf(page, 40, 10, -35);
    const cam0 = await page.evaluate(() => (window as unknown as { __milanoIso: { camera: { target: number[] } } }).__milanoIso.camera.target);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x - 60, p.y + 20, { steps: 8 });
    await page.mouse.up();
    // Poll that the pan happened, then check nothing was selected.
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __milanoIso: { camera: { target: number[] } } }).__milanoIso.camera.target))
      .not.toEqual(cam0);
    expect((await selection(page)).current).toBeNull();
    expect((await selection(page)).card.open).toBe(false);
    expect(problems).toEqual([]);
  });

  test('a click on empty ground clears the selection; Escape closes the card and restores focus', async ({ page }) => {
    const problems = await open(page);
    await page.locator('#app').focus();
    const p = await screenOf(page, 40, 10, -35);
    await clickAt(page, p);
    await expect.poll(async () => (await selection(page)).card.open).toBe(true);
    // Focus moved into the card.
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('info-card');
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await selection(page)).card.open).toBe(false);
    expect((await selection(page)).current).toBeNull();
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('app');
    // Empty ground (left edge, far from the content) clears an open card.
    await clickAt(page, p);
    await expect.poll(async () => (await selection(page)).card.open).toBe(true);
    await clickAt(page, { x: 3, y: 360 });
    await expect.poll(async () => (await selection(page)).card.open).toBe(false);
    // The close button closes and restores focus too.
    await page.locator('#app').focus();
    await clickAt(page, p);
    await expect.poll(async () => (await selection(page)).card.open).toBe(true);
    await page.getByRole('button', { name: 'Chiudi' }).click();
    await expect.poll(async () => (await selection(page)).card.open).toBe(false);
    expect((await selection(page)).current).toBeNull();
    expect(problems).toEqual([]);
  });

  test('the desktop card sits below the rotation buttons and covers neither them nor the attribution', async ({ page }) => {
    const problems = await open(page);
    await clickAt(page, await screenOf(page, 40, 10, -35));
    await expect.poll(async () => (await selection(page)).card.open).toBe(true);
    const box = async (sel: string) => (await page.locator(sel).boundingBox()) as { x: number; y: number; width: number; height: number };
    const card = await box('#info-card');
    const rot = await box('#rotation-controls');
    const attr = await box('#attribution');
    const mode = await box('#mode-toggle');
    expect(card.y).toBeGreaterThanOrEqual(rot.y + rot.height);
    expect(card.y).toBeGreaterThanOrEqual(mode.y + mode.height);
    expect(card.y + card.height).toBeLessThanOrEqual(attr.y);
    expect(card.x + card.width).toBeLessThanOrEqual(1280);
    expect(problems).toEqual([]);
  });

  test('a search selection of a tile that is not loaded shows the index data first, then fills in', async ({ page }) => {
    // Hold the files of tile 0_-1 (Fixture B3) back until released: its data arrives late.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const problems = await open(page, 1200, 0, 0, async () => {
      await page.route('**/tiles/pilot/0_-1.*', async (route) => {
        await gate;
        await route.fallback();
      });
    });
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __milanoIso: { tiles: { loaded: number; loading: number } } }).__milanoIso.tiles))
      .toEqual({ loaded: 3, loading: 1, failed: 0, visible: 4 });
    await page.evaluate(() =>
      (window as unknown as { __milanoIsoSelect: (r: unknown, s: string) => void }).__milanoIsoSelect({ layer: 'buildings', key: 'fix:B3' }, 'search'),
    );
    await expect.poll(async () => (await selection(page)).card.open).toBe(true);
    let s = await selection(page);
    expect(s.source).toBe('search');
    await expect.poll(async () => (await selection(page)).card.title).toBe('Fixture B3'); // index.json arrives
    s = await selection(page);
    expect(s.card).toMatchObject({ title: 'Fixture B3', pending: true, height: null });
    release();
    await settle(page);
    await expect.poll(async () => (await selection(page)).card.pending).toBe(false);
    s = await selection(page);
    expect(s.card).toMatchObject({ title: 'Fixture B3', height: '20 m', type: 'Edificio civico o religioso' });
    // A ref that matches nothing must not crash.
    await page.evaluate(() =>
      (window as unknown as { __milanoIsoSelect: (r: unknown, s: string) => void }).__milanoIsoSelect({ layer: 'buildings', key: 'nope' }, 'search'),
    );
    await expect.poll(async () => (await selection(page)).card.open).toBe(true);
    expect(problems).toEqual([]);
  });

  test('hover picking stays cheap on the fixture', async ({ page }) => {
    await open(page);
    const p = await screenOf(page, 40, 10, -35);
    for (let i = 0; i < 6; i++) await page.mouse.move(p.x + (i % 2) * 3, p.y, { steps: 2 });
    await expect.poll(async () => (await selection(page)).pick.count).toBeGreaterThan(0);
    expect((await selection(page)).pick.maxMs).toBeLessThan(50);
  });
});

/** Boxes of every visible fixed UI element that must not overlap the card. */
async function overlaps(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const card = document.getElementById('info-card')?.getBoundingClientRect();
    if (!card) return ['no card'];
    const bad: string[] = [];
    for (const sel of ['#toolbar-zone', '#minimap', '#tiles-notice', '#debug-overlay', '#rotation-controls', '#mode-toggle', '#attribution']) {
      for (const el of Array.from(document.querySelectorAll(sel))) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === 'hidden') continue;
        const hit = r.left < card.right && r.right > card.left && r.top < card.bottom && r.bottom > card.top;
        if (hit) bad.push(`${sel} ${JSON.stringify(r)} vs card ${JSON.stringify(card)}`);
      }
    }
    return bad;
  });
}

test('with the ?debug overlay open, the desktop card overlaps no other control', async ({ page }) => {
  const problems = await open(page, 600, 0, 0, undefined, '&debug');
  await expect(page.locator('#debug-overlay')).toBeVisible();
  await clickAt(page, await screenOf(page, 40, 10, -35));
  await expect.poll(async () => (await selection(page)).card.open).toBe(true);
  expect(await overlaps(page)).toEqual([]);
  expect(problems).toEqual([]);
});

test('a layer hidden by a toggle is not pickable; a street search ref shows the street name', async ({ page }) => {
  const problems = await open(page, 600, 0, 0, undefined, '&layers=roads,trees');
  const p = await screenOf(page, 40, 10, -35);
  const picked = await page.evaluate(
    ([x, y]) => (window as unknown as { __milanoIsoPickAt: (x: number, y: number) => { ref: Ref | null } }).__milanoIsoPickAt(x, y),
    [p.x, p.y],
  );
  expect(picked.ref?.layer).not.toBe('buildings');
  await page.evaluate(() =>
    (window as unknown as { __milanoIsoSelect: (r: unknown, s: string) => void }).__milanoIsoSelect(
      { layer: 'roads', streetName: 'Via Fixture', osmType: 'w', osmId: 3001 },
      'search',
    ),
  );
  await expect.poll(async () => (await selection(page)).card.open).toBe(true);
  await expect.poll(async () => (await selection(page)).card.title).toBe('Via Fixture');
  expect((await selection(page)).card).toMatchObject({ title: 'Via Fixture', type: 'Strada residenziale', pending: false });
  expect(problems).toEqual([]);
});

test('on desktop the card overlaps no toolbar, minimap, notice or button', async ({ page }) => {
  await open(page);
  await clickAt(page, await screenOf(page, 40, 10, -35));
  await expect.poll(async () => (await selection(page)).card.open).toBe(true);
  expect(await overlaps(page)).toEqual([]);
});

test.describe('picking (mobile 412x915, touch)', () => {
  test.use({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });

  test('a tap opens the card as a bottom sheet above the attribution', async ({ page }) => {
    const problems = await open(page, 300, 0, -30);
    const p = await screenOf(page, 40, 10, -35);
    await page.touchscreen.tap(p.x, p.y);
    await expect.poll(async () => (await selection(page)).current?.key).toBe('fix:B1');
    const s = await selection(page);
    expect(s.source).toBe('pick');
    expect(s.card).toMatchObject({ open: true, title: 'Fixture B1', height: '10 m' });
    const card = (await page.locator('#info-card').boundingBox()) as { x: number; y: number; width: number; height: number };
    const attr = (await page.locator('#attribution').boundingBox()) as { y: number };
    expect(card.x).toBeGreaterThanOrEqual(0);
    expect(card.x + card.width).toBeLessThanOrEqual(412);
    expect(card.y + card.height).toBeLessThanOrEqual(attr.y);
    expect(card.y).toBeGreaterThan(915 / 2); // a sheet at the bottom
    expect(await overlaps(page)).toEqual([]);
    // A tap on empty ground closes it.
    await page.touchscreen.tap(5, 300);
    await expect.poll(async () => (await selection(page)).card.open).toBe(false);
    expect(problems).toEqual([]);
  });
});
