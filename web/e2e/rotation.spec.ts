import { type Page, expect, test } from '@playwright/test';
import { collectProblems, readFixtureManifest, routeFixtureTiles } from './support';

// T-5.2: rotation in 90-degree steps. Azimuths: step 0 = 45, 1 = 135, 2 = 225, 3 = 315.
// Q turns the city counter-clockwise (azimuth +90), E clockwise (azimuth -90).

interface CameraState {
  target: [number, number];
  visibleWidth: number;
  elevationDeg: number;
  azimuthDeg: number;
  azimuthStep: number;
}
interface TilesState {
  loaded: number;
  loading: number;
  failed: number;
  visible: number;
}

const DEG = Math.PI / 180;

const cam = (page: Page): Promise<CameraState> =>
  page.evaluate(() => (window as unknown as { __milanoIso: { camera: CameraState } }).__milanoIso.camera);
const tiles = (page: Page): Promise<TilesState> =>
  page.evaluate(() => (window as unknown as { __milanoIso: { tiles: TilesState } }).__milanoIso.tiles);
const azimuth = async (page: Page): Promise<number> => (await cam(page)).azimuthDeg;

async function open(
  page: Page,
  reduced: boolean,
  query = '',
  beforeGoto?: () => Promise<unknown>,
): Promise<void> {
  await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await routeFixtureTiles(page);
  if (beforeGoto) await beforeGoto();
  await page.goto(`/?e2e=1${query}`);
  await expect(page.locator('canvas')).toHaveCount(1);
  await page.waitForFunction(
    () =>
      (window as unknown as { __milanoIso: { camera: { bounds: { maxX: number } } } }).__milanoIso.camera
        .bounds.maxX !== 500,
  );
}

async function settle(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const s = await tiles(page);
      return s.loading === 0 && s.loaded + s.failed >= s.visible;
    }, { timeout: 20_000 })
    .toBe(true);
}

test('Q and E rotate in opposite directions, four steps return to the start view', async ({ page }) => {
  const problems = collectProblems(page);
  await open(page, false);
  await page.locator('#app').focus();
  expect(await azimuth(page)).toBe(45);
  await page.keyboard.press('e');
  await expect.poll(() => azimuth(page)).toBe(315);
  await page.keyboard.press('q');
  await expect.poll(() => azimuth(page)).toBe(45);
  await page.keyboard.press('Q');
  await expect.poll(() => azimuth(page)).toBe(135);
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Q');
    await expect.poll(async () => (await cam(page)).azimuthStep).toBe((2 + i) % 4);
    await expect.poll(() => azimuth(page)).toBe([225, 315, 45][i]);
  }
  const end = await cam(page);
  expect(end.azimuthDeg).toBe(45);
  expect(end.target).toEqual([0, 0]);
  await page.waitForTimeout(300);
  expect(problems).toEqual([]);
});

test('both buttons rotate, are labelled in Italian, reachable by keyboard and at least 44x44', async ({
  page,
}) => {
  const problems = collectProblems(page);
  await open(page, true);
  const left = page.getByRole('button', { name: 'Ruota a sinistra' });
  const right = page.getByRole('button', { name: 'Ruota a destra' });
  for (const b of [left, right]) {
    const box = await b.boundingBox();
    expect(box && box.width >= 44 && box.height >= 44).toBe(true);
  }
  await left.click();
  expect(await azimuth(page)).toBe(135);
  await right.click();
  await right.click();
  expect(await azimuth(page)).toBe(315);
  // Keyboard: Tab reaches the buttons and Enter activates them.
  await right.focus();
  await page.keyboard.press('Enter');
  expect(await azimuth(page)).toBe(225);
  await left.focus();
  await page.keyboard.press('Space');
  expect(await azimuth(page)).toBe(315);
  expect(problems).toEqual([]);
});

test('reduced motion gives an instant step, normal motion ends exactly on the view', async ({ page }) => {
  await open(page, true);
  await page.locator('#app').focus();
  await page.keyboard.press('e');
  expect((await cam(page)).azimuthDeg).toBe(315); // no waiting: instant
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.keyboard.press('e'); // animated
  await expect.poll(() => azimuth(page)).toBe(225);
});

test('rapid presses during an animation still end on an exact view', async ({ page }) => {
  await open(page, false);
  await page.locator('#app').focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press('q'); // 5 steps, 45 + 450 = 495 -> 135
  await expect.poll(() => azimuth(page), { timeout: 5000 }).toBe(135);
  expect([45, 135, 225, 315]).toContain((await cam(page)).azimuthDeg);
});

test('?rot= sets the initial view, the target stays put, pan follows the screen in every view', async ({
  page,
}) => {
  for (let rot = 0; rot < 4; rot++) {
    await open(page, true, `&rot=${rot}`);
    const c = await cam(page);
    expect(c.azimuthDeg).toBe(45 + 90 * rot);
    // Drag right by 100 px: the ground under the viewport centre moves left on screen, so the
    // target moves along the screen-left direction (-r) in ground axes.
    await page.mouse.move(640, 360);
    await page.mouse.down();
    await page.mouse.move(740, 360, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    const after = await cam(page);
    const az = c.azimuthDeg * DEG;
    const mpp = c.visibleWidth / 1280;
    const dx = after.target[0] - c.target[0];
    const dz = after.target[1] - c.target[1];
    // Component along screen-right r = (cos az, -sin az) is -100 mpp; along away f it is ~0.
    expect(dx * Math.cos(az) - dz * Math.sin(az)).toBeCloseTo(-100 * mpp, 0);
    expect(-dx * Math.sin(az) - dz * Math.cos(az)).toBeCloseTo(0, 0);
  }
});

test('tiles loaded and failed stay correct after every rotation', async ({ page }) => {
  const problems = collectProblems(page);
  await open(page, true);
  await page.evaluate(() =>
    (window as unknown as { __milanoIsoSetView: (x: number, z: number, w: number) => void }).__milanoIsoSetView(
      0,
      0,
      1200,
    ),
  );
  const total = readFixtureManifest().tiles.length;
  await page.locator('#app').focus();
  for (let i = 0; i < 4; i++) {
    await settle(page);
    const s = await tiles(page);
    expect(s.failed).toBe(0);
    expect(s.visible).toBe(total);
    expect(s.loaded).toBe(total);
    await page.keyboard.press('e');
  }
  expect((await cam(page)).azimuthDeg).toBe(45);
  expect(problems).toEqual([]);
});

test('a failed tile stays failed (and counted once) through all four views; controls do not overlap at 412 px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 412, height: 915 });
  const manifest = readFixtureManifest() as unknown as { tiles: { id: string; glb: { file: string } }[] };
  const bad = manifest.tiles[0];
  await open(page, true, '', () =>
    page.route(`**/tiles/pilot/${bad.glb.file}`, (route) =>
      route.fulfill({ status: 404, body: 'not found' }),
    ),
  );
  await page.evaluate(() =>
    (window as unknown as { __milanoIsoSetView: (x: number, z: number, w: number) => void }).__milanoIsoSetView(
      0,
      0,
      1200,
    ),
  );
  await expect.poll(async () => (await tiles(page)).failed, { timeout: 20_000 }).toBe(1);
  await page.locator('#app').focus();
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('e');
    await settle(page);
    const s = await tiles(page);
    expect(s.failed).toBe(1);
    expect(s.loaded).toBe(manifest.tiles.length - 1);
  }
  const boxes: Record<string, { x: number; y: number; width: number; height: number }> = {};
  for (const sel of ['#rotate-left', '#rotate-right', '#attribution', '#mode-toggle', '#tiles-notice']) {
    await expect(page.locator(sel)).toBeVisible();
    const b = await page.locator(sel).boundingBox();
    expect(b).not.toBeNull();
    boxes[sel] = b as { x: number; y: number; width: number; height: number };
  }
  const overlap = (a: (typeof boxes)[string], b: (typeof boxes)[string]): boolean =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  for (const r of ['#rotate-left', '#rotate-right']) {
    for (const o of ['#attribution', '#mode-toggle', '#tiles-notice']) {
      expect(overlap(boxes[r], boxes[o]), `${r} overlaps ${o}`).toBe(false);
    }
    expect(boxes[r].x + boxes[r].width).toBeLessThanOrEqual(412);
  }
  expect(overlap(boxes['#rotate-left'], boxes['#rotate-right'])).toBe(false);
});

test('__milanoIsoSetView takes an optional azimuth step', async ({ page }) => {
  await open(page, true);
  await page.evaluate(() =>
    (
      window as unknown as { __milanoIsoSetView: (x: number, z: number, w: number, s?: number) => void }
    ).__milanoIsoSetView(10, -20, 300, 2),
  );
  const c = await cam(page);
  expect(c.azimuthDeg).toBe(225);
  expect(c.target).toEqual([10, -20]);
});
