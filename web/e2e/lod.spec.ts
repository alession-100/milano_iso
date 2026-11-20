import path from 'node:path';
import { type Page, expect, test } from '@playwright/test';
import { collectProblems, routeFixtureTiles, setView, settleRendered, tilesState } from './support';

// T-6.2: levels of detail on the synthetic fixture with coarse levels (tiles-lod, made by
// `make_fixture_tiles.py --lod`). The visual-regression fixture has none, so its baselines never meet
// a coarse level. Levels: 0 (250 m tiles), 1 (500 m, tolerance 0.5 m), 2 (1 km, 1.5 m), 3 (2 km, 3 m).
// Nothing here asserts a duration: every wait polls the test state until it settles.

const LOD_DIR = path.resolve(process.cwd(), 'e2e', 'fixtures', 'tiles-lod');

async function open(page: Page): Promise<string[]> {
  const problems = collectProblems(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await routeFixtureTiles(page, LOD_DIR);
  return problems;
}

async function start(page: Page): Promise<void> {
  await page.goto('/?e2e=1&tiles=tiles/pilot/');
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
      [400, 0], // mpp 0.31
      [600, 0], // 0.47
      [700, 1], // 0.55
      [1800, 1], // 1.41
      [2000, 2], // 1.56
      [4000, 3], // 3.13
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
    await setView(page, 0, 0, 700); // mpp 0.55: level 1
    await settleRendered(page);
    expect((await tilesState(page)).level).toBe(1);
    await setView(page, 0, 0, 600); // mpp 0.47: the base would do, level 1 is kept
    await settleRendered(page);
    expect((await tilesState(page)).level).toBe(1);
    await setView(page, 0, 0, 500); // mpp 0.39: well under, back to the base level
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
    await setView(page, 0, 0, 800); // level 1 is wanted but held back
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
    await page.route(/\/tiles\/pilot\/0_0\.(glb|json)(\?.*)?$/, async (route) => {
      await gate;
      await route.fallback();
    });
    await start(page);
    // T-6.3: a tile in flight when the level changes is cancelled, so the three base tiles that are not
    // held back must have arrived before the view goes to level 1 (0_0 stays in flight, then cancelled).
    await setView(page, 0, 0, 500);
    await expect.poll(async () => (await tilesState(page)).loadedByLevel?.[0], { timeout: 20_000 }).toBe(3);
    await setView(page, 0, 0, 800);
    await expect
      .poll(async () => {
        const s = await tilesState(page);
        return s.level === 1 && s.pending === 0 && JSON.stringify(await drawnLevels(page)) === '[1]';
      })
      .toBe(true);
    await setView(page, 0, 0, 500); // the base tiles are wanted again; 0_0 is held back
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
    await setView(page, 0, 0, 800);
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
      [150, 0], // mpp 0.36 (under the hysteresis band of level 1, which the 600 m start view entered)
      [300, 1], // 0.73
      [600, 1], // 1.46
      [700, 2], // 1.70
      [1200, 2], // 2.91
      [2400, 3], // 5.83
    ] as const) {
      await setView(page, 0, 0, width);
      await settleRendered(page);
      const s = await tilesState(page);
      expect(s.level, `width ${width}`).toBe(level);
      expect(await drawnLevels(page)).toEqual([level]);
    }
  });
});

// T-6.3: a tile that is no longer wanted is cancelled; it never reaches the scene and can load again.
test.describe('cancelling tiles that are no longer wanted', () => {
  test('a base tile in flight when the view moves to a coarser level is cancelled and never drawn; it loads again later', async ({
    page,
  }) => {
    const problems = await open(page);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let held = 0;
    // Hold every base tile (not the L1_.. blocks, not the shards): they stay in flight until released.
    await page.route(/\/tiles\/pilot\/-?\d+_-?\d+\.(glb|json)(\?.*)?$/, async (route) => {
      held += 1;
      await gate;
      await route.fallback().catch(() => undefined); // the page may have cancelled it by now
    });
    await start(page);
    await expect.poll(async () => (await tilesState(page)).loading, { timeout: 20_000 }).toBeGreaterThan(0);
    expect(held).toBeGreaterThan(0);
    const before = await tilesState(page);
    expect(before.cancelled ?? 0).toBe(0);

    await setView(page, 0, 0, 4000); // level 3 replaces level 0 before a single base tile has arrived
    await expect.poll(async () => (await tilesState(page)).level).toBe(3);
    await expect.poll(async () => (await tilesState(page)).cancelled, { timeout: 20_000 }).toBeGreaterThan(0);
    release(); // the held requests are let go after the page cancelled them
    await settleRendered(page);
    const s = await tilesState(page);
    expect(s.failed).toBe(0);
    expect(Object.keys(s.loadedByLevel ?? {}), 'no cancelled base tile is in the scene').toEqual(['3']);
    expect(s.inScene, 'what is in the scene is exactly what was loaded').toBe(s.loaded);
    expect(s.unwantedInFlight).toBe(0);
    expect(await drawnLevels(page)).toEqual([3]);
    // every request that was started is accounted for: completed, cancelled, or still in flight (none)
    expect(s.started).toBe((s.completed ?? 0) + (s.cancelled ?? 0));

    await setView(page, 0, 0, 400); // back to the base level: the cancelled tiles load again
    await settleRendered(page);
    const again = await tilesState(page);
    expect(again.level).toBe(0);
    expect(again.loadedByLevel?.[0] ?? 0).toBeGreaterThan(0);
    expect(await drawnLevels(page)).toEqual([0]);
    expect(again.failed).toBe(0);
    expect(problems).toEqual([]);
  });

  test('shard requests are made for the level in view only', async ({ page }) => {
    await open(page);
    const shards: string[] = [];
    page.on('request', (r) => {
      const m = /\/shards\/(S\d+)_/.exec(r.url());
      if (m) shards.push(m[1]);
    });
    await start(page);
    await setView(page, 0, 0, 400);
    await settleRendered(page);
    expect(new Set(shards)).toEqual(new Set(['S0'])); // base level only
    await setView(page, 0, 0, 4000);
    await settleRendered(page);
    expect(new Set(shards)).toEqual(new Set(['S0', 'S3']));
  });
});
