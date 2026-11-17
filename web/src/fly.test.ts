import { describe, expect, it } from 'vitest';
import { CameraRig, VIEW_DEFAULTS } from './camera';
import { FIT_MARGIN, FlyAnimator, fitWidth } from './fly';

describe('fitWidth', () => {
  it('fits the wider screen axis with margin, at every azimuth', () => {
    // A 100 x 100 m box at azimuth 45: its screen width is 100*sqrt2 and its screen height is
    // 100*sqrt2*sin(30) = 70.7 m, on a 16:9 viewport the width decides.
    for (const az of [45, 135, 225, 315]) {
      const w = fitWidth([0, 0, 100, 100], az, 30, 16 / 9);
      expect(w).toBeCloseTo(Math.max(100 * Math.SQRT2, 100 * Math.SQRT2 * 0.5 * (16 / 9)) * FIT_MARGIN, 6);
    }
  });
  it('uses the height on a very wide viewport', () => {
    const w = fitWidth([0, 0, 100, 100], 45, 30, 4);
    expect(w).toBeCloseTo(100 * Math.SQRT2 * 0.5 * 4 * FIT_MARGIN, 6);
  });
  it('clamps to the zoom limits', () => {
    expect(fitWidth([0, 0, 5, 5], 45, 30, 1.7)).toBe(VIEW_DEFAULTS.minWidthM);
    expect(fitWidth([0, 0, 50000, 50000], 45, 30, 1.7)).toBe(VIEW_DEFAULTS.maxWidthM);
  });
});

describe('FlyAnimator', () => {
  const big = { minX: -5000, maxX: 5000, minZ: -5000, maxZ: 5000 };
  it('moves instantly with reduced motion', () => {
    const rig = new CameraRig(null, 30, 0);
    rig.setBounds(big);
    let renders = 0;
    const fly = new FlyAnimator(rig, { requestRender: () => (renders += 1), reducedMotion: () => true });
    fly.flyTo([100, -200], 150);
    expect(rig.target).toEqual([100, -200]);
    expect(rig.visibleWidth).toBe(150);
    expect(fly.flying).toBe(false);
    expect(renders).toBe(1);
  });
  it('clamps the width to the limits and the target to the bounds', () => {
    const rig = new CameraRig(null, 30, 0);
    const fly = new FlyAnimator(rig, { requestRender: () => undefined, reducedMotion: () => true });
    fly.flyTo([99999, 0], 1);
    expect(rig.visibleWidth).toBe(VIEW_DEFAULTS.minWidthM);
    expect(rig.target[0]).toBe(rig.bounds.maxX);
  });
});
