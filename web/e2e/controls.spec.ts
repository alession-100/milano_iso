import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { type CDPSession, type Page, expect, test } from '@playwright/test';
import { collectProblems, fixtureContentBounds, routeFixtureTiles } from './support';

const OUT = path.resolve(process.cwd(), process.env.E2E_OUT_DIR ?? 'e2e-output');

interface CameraState {
  target: [number, number];
  visibleWidth: number;
  elevationDeg: number;
  azimuthDeg: number;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

const DEG = Math.PI / 180;



async function cam(page: Page): Promise<CameraState> {
  return page.evaluate(
    () => (window as unknown as { __milanoIso: { camera: CameraState } }).__milanoIso.camera,
  );
}

/** Independent re-implementation of the screen -> ground mapping, used to check the app. */
function ground(c: CameraState, px: number, py: number, vw: number, vh: number): [number, number] {
  const az = c.azimuthDeg * DEG;
  const sinEl = Math.sin(c.elevationDeg * DEG);
  const mpp = c.visibleWidth / vw;
  const xv = (px - vw / 2) * mpp;
  const yv = ((vh / 2 - py) * mpp) / sinEl;
  return [
    c.target[0] + Math.cos(az) * xv - Math.sin(az) * yv,
    c.target[1] - Math.sin(az) * xv - Math.cos(az) * yv,
  ];
}

async function open(page: Page, reduced: boolean): Promise<void> {
  await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await routeFixtureTiles(page);
  await page.goto('/?e2e=1');
  await expect(page.locator('canvas')).toHaveCount(1);
  await page.waitForFunction(() => '__milanoIso' in window);
  // The camera bounds come from the manifest: wait until they replace the 500 m fallback.
  await page.waitForFunction(
    () =>
      (window as unknown as { __milanoIso: { camera: { bounds: { maxX: number } } } }).__milanoIso
        .camera.bounds.maxX !== 500,
  );
}

/** Drags with real mouse events, then rests 150 ms so no release velocity is measured. */
async function mouseDrag(
  page: Page,
  from: [number, number],
  to: [number, number],
  steps = 8,
): Promise<void> {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps });
  await page.waitForTimeout(150);
  await page.mouse.up();
}

test.describe('desktop 1280x720', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('mouse drag of 200 px moves the target by the expected metres (within 2%)', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await open(page, true);
    const before = await cam(page);
    await mouseDrag(page, [400, 300], [600, 300]);
    const after = await cam(page);
    const metres = (200 * before.visibleWidth) / 1280;
    const az = before.azimuthDeg * DEG;
    // Dragging right moves the content right, so the target moves along -right = (-cos, +sin).
    const ex = -Math.cos(az) * metres;
    const ez = Math.sin(az) * metres;
    const tol = 0.02 * metres;
    expect(Math.abs(after.target[0] - before.target[0] - ex)).toBeLessThan(tol);
    expect(Math.abs(after.target[1] - before.target[1] - ez)).toBeLessThan(tol);
    expect(
      Math.hypot(after.target[0] - before.target[0], after.target[1] - before.target[1]),
    ).toBeCloseTo(metres, 0);
    expect(problems).toEqual([]);
  });

  test('vertical drag keeps the ground point under the cursor', async ({ page }) => {
    await open(page, true);
    const before = await cam(page);
    const g0 = ground(before, 640, 300, 1280, 720);
    await mouseDrag(page, [640, 300], [640, 420]);
    const after = await cam(page);
    const g1 = ground(after, 640, 420, 1280, 720);
    expect(Math.hypot(g1[0] - g0[0], g1[1] - g0[1])).toBeLessThan(0.5);
  });

  test('wheel zooms within limits and keeps the ground point under the cursor', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await open(page, true);
    const [px, py] = [900, 200];
    const before = await cam(page);
    const g0 = ground(before, px, py, 1280, 720);
    await page.mouse.move(px, py);
    await page.mouse.wheel(0, -300);
    const after = await cam(page);
    expect(after.visibleWidth).toBeLessThan(before.visibleWidth);
    expect(after.visibleWidth).toBeGreaterThanOrEqual(60);
    const g1 = ground(after, px, py, 1280, 720);
    expect(Math.hypot(g1[0] - g0[0], g1[1] - g0[1])).toBeLessThan(1);

    for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -2000);
    expect((await cam(page)).visibleWidth).toBe(60);
    for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 2000);
    expect((await cam(page)).visibleWidth).toBe(4000);
    expect(problems).toEqual([]);
  });

  test('arrow keys pan by 10% of the width, +/- zoom by 1.25, 0 resets', async ({ page }) => {
    const problems = collectProblems(page);
    await open(page, true);
    await page.locator('#app').focus();
    const label = await page.locator('#app').getAttribute('aria-label');
    expect(label).toBeTruthy();
    expect(await page.locator('#app').getAttribute('tabindex')).toBe('0');

    const c0 = await cam(page);
    const step = c0.visibleWidth * 0.1;
    await page.keyboard.press('ArrowRight');
    const c1 = await cam(page);
    expect(c1.target[0] - c0.target[0]).toBeCloseTo(step * Math.cos(45 * DEG), 6);
    expect(c1.target[1] - c0.target[1]).toBeCloseTo(-step * Math.sin(45 * DEG), 6);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowUp');
    const c2 = await cam(page);
    expect(c2.target[0] - c0.target[0]).toBeCloseTo(-step * Math.sin(45 * DEG), 6);
    expect(c2.target[1] - c0.target[1]).toBeCloseTo(-step * Math.cos(45 * DEG), 6);

    await page.keyboard.press('+');
    expect((await cam(page)).visibleWidth).toBeCloseTo(c0.visibleWidth / 1.25, 6);
    await page.keyboard.press('-');
    expect((await cam(page)).visibleWidth).toBeCloseTo(c0.visibleWidth, 6);

    await page.keyboard.press('0');
    const c3 = await cam(page);
    expect(c3.target).toEqual([0, 0]);
    expect(c3.visibleWidth).toBe(600);
    expect(problems).toEqual([]);
  });

  test('dragging far beyond the bounds clamps the target', async ({ page }) => {
    const problems = collectProblems(page);
    await open(page, true);
    for (let i = 0; i < 6; i++) await mouseDrag(page, [100, 360], [1200, 360], 4);
    const c = await cam(page);
    // The bounds are the content rectangle of the tile manifest, not the 500 m fallback.
    expect(c.bounds).toEqual(fixtureContentBounds());
    expect(c.target[0]).toBeCloseTo(c.bounds.minX, 6);
    expect(c.target[1]).toBeCloseTo(c.bounds.maxZ, 6);
    for (let i = 0; i < 6; i++) await mouseDrag(page, [1200, 100], [100, 700], 4);
    const d = await cam(page);
    for (const [v, lo, hi] of [
      [d.target[0], d.bounds.minX, d.bounds.maxX],
      [d.target[1], d.bounds.minZ, d.bounds.maxZ],
    ]) {
      expect(v).toBeGreaterThanOrEqual(lo);
      expect(v).toBeLessThanOrEqual(hi);
    }
    expect(problems).toEqual([]);
  });

  test('inertia continues a fast drag after release, then stops (no reduced motion)', async ({
    page,
  }) => {
    await open(page, false);
    // Events carry explicit timestamps 10 ms apart (CDP `timestamp`, seconds), so the release
    // velocity does not depend on how long the machine takes to deliver them (T-3.6).
    const cdp = await page.context().newCDPSession(page);
    const t0 = Date.now() / 1000;
    const send = (type: 'mousePressed' | 'mouseMoved' | 'mouseReleased', x: number, i: number) =>
      cdp.send('Input.dispatchMouseEvent', {
        type,
        x,
        y: 360,
        button: type === 'mouseMoved' ? 'none' : 'left',
        buttons: type === 'mouseReleased' ? 0 : 1,
        clickCount: type === 'mouseMoved' ? 0 : 1,
        timestamp: t0 + i * 0.01,
      });
    await send('mousePressed', 300, 0);
    for (let i = 1; i <= 10; i++) await send('mouseMoved', 300 + i * 20, i);
    const atRelease = await cam(page);
    await send('mouseReleased', 500, 11);
    // Wait for the inertia to start, then to settle (target unchanged for 300 ms), with timeouts.
    await expect
      .poll(async () => (await cam(page)).target, { timeout: 20_000 })
      .not.toEqual(atRelease.target);
    let prev = (await cam(page)).target;
    await expect
      .poll(
        async () => {
          await page.waitForTimeout(300);
          const cur = (await cam(page)).target;
          const same = cur[0] === prev[0] && cur[1] === prev[1];
          prev = cur;
          return same;
        },
        { timeout: 15_000 },
      )
      .toBe(true);
  });

  test('reduced motion: no inertia after a fast drag', async ({ page }) => {
    await open(page, true);
    await page.mouse.move(300, 360);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(300 + i * 20, 360);
      await page.waitForTimeout(10);
    }
    await page.mouse.up();
    const atRelease = await cam(page);
    await page.waitForTimeout(600);
    expect((await cam(page)).target).toEqual(atRelease.target);
  });

  test('screenshot after a pan and zoom', async ({ page }) => {
    mkdirSync(OUT, { recursive: true });
    const problems = collectProblems(page);
    await open(page, true);
    await mouseDrag(page, [500, 360], [560, 330]);
    await page.mouse.move(640, 360);
    for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -300);
    const c = await cam(page);
    expect(c.visibleWidth).toBeLessThan(200);
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUT, 'pan-zoom-desktop.png') });
    expect(problems).toEqual([]);
  });
});

test.describe('mobile Pixel 7-class, touch', () => {
  test.use({
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true,
  });

  async function touch(
    cdp: CDPSession,
    type: 'touchStart' | 'touchMove' | 'touchEnd',
    points: Array<{ x: number; y: number; id: number }>,
  ): Promise<void> {
    await cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : points,
    });
  }

  test('one-finger touch drag pans the target', async ({ page }) => {
    const problems = collectProblems(page);
    await open(page, true);
    const cdp = await page.context().newCDPSession(page);
    const before = await cam(page);
    await touch(cdp, 'touchStart', [{ x: 100, y: 400, id: 1 }]);
    for (let i = 1; i <= 8; i++) {
      await touch(cdp, 'touchMove', [{ x: 100 + i * 12.5, y: 400, id: 1 }]);
      await page.waitForTimeout(20);
    }
    await page.waitForTimeout(150);
    await touch(cdp, 'touchEnd', []);
    const after = await cam(page);
    const metres = (100 * before.visibleWidth) / 412;
    const az = before.azimuthDeg * DEG;
    const tol = 0.02 * metres;
    expect(Math.abs(after.target[0] - before.target[0] + Math.cos(az) * metres)).toBeLessThan(tol);
    expect(Math.abs(after.target[1] - before.target[1] - Math.sin(az) * metres)).toBeLessThan(tol);
    expect(problems).toEqual([]);
  });

  test('two-finger pinch zooms in about the midpoint', async ({ page }) => {
    const problems = collectProblems(page);
    await open(page, true);
    const cdp = await page.context().newCDPSession(page);
    const before = await cam(page);
    const [mx, my] = [206, 450];
    const g0 = ground(before, mx, my, 412, 915);
    await touch(cdp, 'touchStart', [
      { x: mx - 40, y: my, id: 1 },
      { x: mx + 40, y: my, id: 2 },
    ]);
    for (let i = 1; i <= 8; i++) {
      await touch(cdp, 'touchMove', [
        { x: mx - 40 - i * 10, y: my, id: 1 },
        { x: mx + 40 + i * 10, y: my, id: 2 },
      ]);
      await page.waitForTimeout(20);
    }
    await touch(cdp, 'touchEnd', []);
    const after = await cam(page);
    // Finger distance grew from 80 to 240 px: a factor of 3.
    expect(after.visibleWidth).toBeCloseTo(before.visibleWidth / 3, 0);
    const g1 = ground(after, mx, my, 412, 915);
    expect(Math.hypot(g1[0] - g0[0], g1[1] - g0[1])).toBeLessThan(1);
    expect(problems).toEqual([]);
  });

  test('screenshot after a touch pan and pinch', async ({ page }) => {
    mkdirSync(OUT, { recursive: true });
    await open(page, true);
    const cdp = await page.context().newCDPSession(page);
    await touch(cdp, 'touchStart', [{ x: 200, y: 450, id: 1 }]);
    for (let i = 1; i <= 6; i++) {
      await touch(cdp, 'touchMove', [{ x: 200 + i * 4, y: 450 + i * 6, id: 1 }]);
      await page.waitForTimeout(20);
    }
    await page.waitForTimeout(150);
    await touch(cdp, 'touchEnd', []);
    await touch(cdp, 'touchStart', [
      { x: 166, y: 486, id: 1 },
      { x: 246, y: 486, id: 2 },
    ]);
    for (let i = 1; i <= 8; i++) {
      await touch(cdp, 'touchMove', [
        { x: 166 - i * 12, y: 486, id: 1 },
        { x: 246 + i * 12, y: 486, id: 2 },
      ]);
      await page.waitForTimeout(20);
    }
    await touch(cdp, 'touchEnd', []);
    expect((await cam(page)).visibleWidth).toBeLessThan(200);
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUT, 'pan-zoom-mobile.png') });
  });
});
