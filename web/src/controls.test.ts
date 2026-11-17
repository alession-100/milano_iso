import { describe, expect, it } from 'vitest';
import { CameraRig, VIEW_DEFAULTS } from './camera';
import { type Velocity, releaseVelocity, stepInertia } from './controls';

const VW = 1280;
const VH = 720;

describe('screen <-> ground mapping', () => {
  for (const elev of [30, 35.264]) {
    it(`round-trips at elevation ${elev}`, () => {
      const rig = new CameraRig(null, elev);
      rig.target = [123.4, -56.7];
      rig.visibleWidth = 777;
      for (const [px, py] of [
        [0, 0],
        [640, 360],
        [1280, 720],
        [200.5, 611.25],
      ]) {
        const [gx, gz] = rig.screenToGround(px, py, VW, VH);
        const [sx, sy] = rig.groundToScreen(gx, gz, VW, VH);
        expect(Math.abs(sx - px)).toBeLessThan(1e-9);
        expect(Math.abs(sy - py)).toBeLessThan(1e-9);
      }
      const [cx, cz] = rig.screenToGround(VW / 2, VH / 2, VW, VH);
      expect(cx).toBeCloseTo(123.4, 9);
      expect(cz).toBeCloseTo(-56.7, 9);
    });
  }

  it('maps a horizontal pixel to visibleWidth / viewport width metres', () => {
    const rig = new CameraRig(null, 30);
    const a = rig.screenToGround(0, 360, VW, VH);
    const b = rig.screenToGround(VW, 360, VW, VH);
    expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeCloseTo(rig.visibleWidth, 9);
  });
});

describe('zoom', () => {
  for (const elev of [30, 35.264]) {
    it(`about the cursor keeps the ground point fixed at ${elev}`, () => {
      const rig = new CameraRig(null, elev);
      rig.target = [10, 20];
      const [px, py] = [900, 150];
      const before = rig.screenToGround(px, py, VW, VH);
      for (const factor of [1.25, 1.25, 0.8, 2, 0.5]) {
        rig.zoomAt(factor, px, py, VW, VH);
        const after = rig.screenToGround(px, py, VW, VH);
        expect(Math.abs(after[0] - before[0])).toBeLessThan(1e-6);
        expect(Math.abs(after[1] - before[1])).toBeLessThan(1e-6);
      }
    });
  }

  it('is clamped to the zoom limits', () => {
    const rig = new CameraRig(null, 30);
    for (let i = 0; i < 50; i++) rig.zoomAt(2, 640, 360, VW, VH);
    expect(rig.visibleWidth).toBe(VIEW_DEFAULTS.minWidthM);
    for (let i = 0; i < 50; i++) rig.zoomAt(0.5, 640, 360, VW, VH);
    expect(rig.visibleWidth).toBe(VIEW_DEFAULTS.maxWidthM);
  });
});

describe('bounds', () => {
  it('clamps to +-500 m before setBounds', () => {
    const rig = new CameraRig(null, 30);
    rig.panByScreen(-1e6, 0, VW);
    expect(Math.abs(rig.target[0])).toBeLessThanOrEqual(500);
    expect(Math.abs(rig.target[1])).toBeLessThanOrEqual(500);
    rig.panGround(1e6, 1e6);
    expect(Math.abs(rig.target[0])).toBeLessThanOrEqual(500);
    expect(Math.abs(rig.target[1])).toBeLessThanOrEqual(500);
  });

  it('clamps to the rectangle given to setBounds, also immediately', () => {
    const rig = new CameraRig(null, 30);
    rig.setBounds({ minX: -100, maxX: 300, minZ: -50, maxZ: 80 });
    expect(rig.target).toEqual([0, 0]);
    rig.panGround(1e6, 0);
    rig.panGround(0, 1e6);
    const [x, z] = rig.target;
    expect(x).toBeGreaterThanOrEqual(-100);
    expect(x).toBeLessThanOrEqual(300);
    expect(z).toBeGreaterThanOrEqual(-50);
    expect(z).toBeLessThanOrEqual(80);
    rig.target = [0, 0];
    rig.setBounds({ minX: 5, maxX: 6, minZ: 7, maxZ: 8 });
    expect(rig.target).toEqual([5, 7]);
  });
});

describe('inertia', () => {
  const stop = 0.005 * VW;
  it('decays to rest and travels v0 * tau in total', () => {
    let v: Velocity = { vx: 1000, vy: -400 };
    let sx = 0;
    let sy = 0;
    let steps = 0;
    let done = false;
    while (!done && steps < 10000) {
      const s = stepInertia(v, 16, VIEW_DEFAULTS.inertiaTauMs, stop);
      sx += s.dx;
      sy += s.dy;
      v = s.v;
      done = s.done;
      steps++;
    }
    expect(done).toBe(true);
    expect(v).toEqual({ vx: 0, vy: 0 });
    const tau = VIEW_DEFAULTS.inertiaTauMs / 1000;
    // Remaining distance at the stop threshold is at most stop * tau.
    expect(Math.abs(sx - 1000 * tau)).toBeLessThan(stop * tau);
    expect(Math.abs(sy + 400 * tau)).toBeLessThan(stop * tau);
  });

  it('does not depend on the frame rate', () => {
    const run = (dt: number): number => {
      let v: Velocity = { vx: 800, vy: 0 };
      let x = 0;
      for (let t = 0; t < 1000; t += dt) {
        const s = stepInertia(v, dt, VIEW_DEFAULTS.inertiaTauMs, 0);
        x += s.dx;
        v = s.v;
      }
      return x;
    };
    expect(Math.abs(run(8) - run(50))).toBeLessThan(1e-6);
  });

  const samples = [
    { t: 0, x: 0, y: 0 },
    { t: 50, x: 50, y: 0 },
    { t: 100, x: 100, y: 0 },
  ];
  it('is started from the recent release velocity', () => {
    const v = releaseVelocity(samples, 105, false);
    expect(v).not.toBeNull();
    expect(v?.vx).toBeCloseTo(1000, 6);
  });
  it('is disabled by prefers-reduced-motion (injected)', () => {
    expect(releaseVelocity(samples, 105, true)).toBeNull();
  });
  it('is not started when the pointer rested before release', () => {
    expect(releaseVelocity(samples, 400, false)).toBeNull();
  });
});
