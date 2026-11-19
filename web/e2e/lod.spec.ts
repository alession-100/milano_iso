import path from 'node:path';
import { type Page, expect, test } from '@playwright/test';
import { collectProblems, routeFixtureTiles, setView, settleRendered, tilesState } from './support';

// T-6.2: levels of detail on the synthetic fixture with coarse levels (tiles-lod, made by
// `make_fixture_tiles.py --lod`). The visual-regression fixture has none, so its baselines never meet
// a coarse level. Levels: 0 (250 m tiles), 1 (500 m, tolerance 1 m), 2 (1 km, 2 m), 3 (2 km, 5 m).
// Nothing here asserts a duration: every wait polls the test state until it settles.

const LOD_DIR = path.resolve(process.cwd(), 'e2e', 'fixtures', 'tiles-lod');

async function open(page: Page): Promise<string[]> {
  const problems = collectProblems(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await routeFixtureTiles(page, LOD_DIR);
  return problems;
}

async function start(page: Page): Promise<void> {
  await page.goto('/?e2e=1');
  await expect(page.locator('canvas')).toHaveCount(1);
}

/** The levels that have a tile drawn right now. */
async function drawnLevels(page: Page): Promise<number[]> {
  const s = await tilesState(page);
  return Object.entries(s.drawnByLevel ?? {})
    .filter(([, n]) => n > 0)
    .map(([lv]) => Number(lv))
    .sort();
}

test.describe('level selection (desktop 1280x720)', () => {
  test('the level follows the metres per pixel, and only that level is drawn', async ({ page }) => {
    const problems = await open(page);
    await start(page);
    // [visible width, expected level]; mpp = width / 1280
    for (const [width, level] of [
      [600, 0],
      [1200, 0],
      [1400, 1],
      [3000, 2],
      [4000, 2],
    ] as const) {
      await setView(page, 0, 0, width);
      await settleRendered(page);
      const s = await tilesState(page);
      expect(s.level, `width ${width}`).toBe(level);
      expect(await drawnLevels(page), `width ${width}`).toEqual([level]);
      expect(s.pending).toBe(0);
    }
    expect(problems).toEqual([]);
  });

  test('hysteresis: a view just under a threshold keeps the coarser level', async ({ page }) => {
    await open(page);
    await start(page);
    await setView(page, 0, 0, 1400); // mpp 1.09: level 1
    await settleRendered(page);
    expect((await tilesState(page)).level).toBe(1);
    await setView(page, 0, 0, 1250); // mpp 0.98: the base would do, level 1 is kept
    await settleRendered(page);
    expect((await tilesState(page)).level).toBe(1);
    await setView(page, 0, 0, 1000); // mpp 0.78: well under, back to the base level
    await settleRendered(page);
    expect((await tilesState(page)).level).toBe(0);
  });

  test('the base level keeps drawing until the coarse blocks have loaded, then only they are drawn', async ({
    page,
  }) => {
    await open(page);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    await page.route(/\/tiles\/pilot\/L1_/, async (route) => {
      await gate;
      await route.fallback();
    });
    await start(page);
    await setView(page, 0, 0, 600);
    await settleRendered(page);
    const base = (await tilesState(page)).loaded;
    expect(base).toBeGreaterThan(0);
    await setView(page, 0, 0, 1400); // level 1 is wanted but held back
    await expect.poll(async () => (await tilesState(page)).level).toBe(1);
    for (let k = 0; k < 5; k += 1) {
      const s = await tilesState(page);
      expect(s.pending, 'blocks are still missing').toBeGreaterThan(0);
      expect(await drawnLevels(page), 'no hole: the base tiles stay').toEqual([0]);
      await page.waitForTimeout(100);
    }
    release();
    await settleRendered(page);
    expect(await drawnLevels(page), 'the blocks replace the base tiles').toEqual([1]);
  });

  test('a coarse block stays until the base tile inside it has loaded, and a parent and its child are never drawn together', async ({
    page,
  }) => {
    await open(page);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    // Every L1 block of the fixture has exactly one base tile inside it. Hold back tile 0_0 (block L1_0_0).
    await page.route(/\/tiles\/pilot\/0_0\.(glb|json)$/, async (route) => {
      await gate;
      await route.fallback();
    });
    await start(page);
    await setView(page, 0, 0, 1400);
    await expect
      .poll(async () => {
        const s = await tilesState(page);
        return s.level === 1 && s.pending === 0 && JSON.stringify(await drawnLevels(page)) === '[1]';
      })
      .toBe(true);
    await setView(page, 0, 0, 600); // the base tiles are wanted again; 0_0 is held back
    await expect.poll(async () => (await tilesState(page)).level).toBe(0);
    for (let k = 0; k < 5; k += 1) {
      const s = await tilesState(page);
      // the three loaded base tiles are drawn; block L1_0_0 stands in for the missing 0_0, and the
      // loaded tiles under the other blocks replaced them (one of the two, never both)
      expect(s.drawnByLevel).toEqual({ 0: 3, 1: 1 });
      expect(s.pending).toBeGreaterThan(0);
      await page.waitForTimeout(100);
    }
    release();
    await expect
      .poll(async () => {
        const s = await tilesState(page);
        return s.pending === 0 && JSON.stringify(s.drawnByLevel) === '{"0":4}';
      })
      .toBe(true);
  });

  test('a building in a coarse block opens the same card as at full detail', async ({ page }) => {
    await open(page);
    await start(page);
    await setView(page, 0, 0, 1400);
    await settleRendered(page);
    expect((await tilesState(page)).level).toBe(1);
    const p = await page.evaluate(() => {
      const w = window as unknown as {
        __milanoIsoScreenOf: (x: number, y: number, z: number) => { x: number; y: number };
      };
      return w.__milanoIsoScreenOf(40, 10, -35);
    });
    await page.mouse.click(p.x, p.y);
    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            (window as unknown as { __milanoIso: { selection: { current: { key?: string } | null } } }).__milanoIso
              .selection.current?.key,
        ),
      )
      .toBe('fix:B1');
    const card = await page.evaluate(
      () =>
        (window as unknown as { __milanoIso: { selection: { card: { open: boolean; title: string; height: string | null } } } })
          .__milanoIso.selection.card,
    );
    expect(card).toMatchObject({ open: true, title: 'Fixture B1', height: '10 m' });
  });
});

test.describe('level selection (mobile 412x915)', () => {
  test.use({ viewport: { width: 412, height: 915 } });

  test('the coarsest level is used at the widest zoom on a narrow screen', async ({ page }) => {
    await open(page);
    await start(page);
    for (const [width, level] of [
      [600, 1], // mpp 1.46
      [1200, 2], // 2.9
      [2400, 3], // 5.8
    ] as const) {
      await setView(page, 0, 0, width);
      await settleRendered(page);
      const s = await tilesState(page);
      expect(s.level, `width ${width}`).toBe(level);
      expect(await drawnLevels(page)).toEqual([level]);
    }
  });
});
