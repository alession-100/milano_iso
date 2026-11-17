import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CameraRig, azimuthOfStep, createCamera, parseRotation, wrapStep } from './camera';
import { ROTATION_DURATION_MS, RotationAnimator, azimuthAt, nextStep } from './rotation';
import { cullTiles, frustumOf } from './tiles/culling';
import type { TileEntry } from './tiles/manifest';

const VW = 1280;
const VH = 720;

describe('step arithmetic', () => {
  it('maps steps to exactly 45, 135, 225, 315 and wraps both ways', () => {
    expect([0, 1, 2, 3].map(azimuthOfStep)).toEqual([45, 135, 225, 315]);
    expect(azimuthOfStep(4)).toBe(45);
    expect(azimuthOfStep(-1)).toBe(315);
    expect(wrapStep(-5)).toBe(3);
    expect(wrapStep(7)).toBe(3);
  });
  it('always ends on one of the four values after any press sequence', () => {
    const rig = new CameraRig(null, 30);
    const seq: (1 | -1)[] = [1, 1, -1, 1, 1, 1, -1, -1, -1, -1, -1, 1, 1];
    for (const d of seq) {
      rig.setStep(nextStep(rig.azimuthStep, d));
      expect([45, 135, 225, 315]).toContain(rig.azimuthDeg);
    }
  });
  it('four presses either way return to the start', () => {
    for (const d of [1, -1] as const) {
      let s = 0;
      for (let i = 0; i < 4; i++) s = nextStep(s, d);
      expect(s).toBe(0);
    }
  });
  it('parseRotation accepts 0..3 only', () => {
    expect(parseRotation('?rot=2')).toBe(2);
    for (const q of ['', '?rot=4', '?rot=-1', '?rot=x', '?rot=1.5']) expect(parseRotation(q)).toBe(0);
  });
});

describe('rotation about the target', () => {
  it('keeps the target and the view centre fixed in every view', () => {
    const rig = new CameraRig(null, 30);
    rig.setBounds({ minX: -1000, maxX: 1000, minZ: -1000, maxZ: 1000 });
    rig.target = [123.5, -45.25];
    for (let s = 0; s < 4; s++) {
      rig.setStep(s);
      expect(rig.target).toEqual([123.5, -45.25]);
      const [gx, gz] = rig.screenToGround(VW / 2, VH / 2, VW, VH);
      expect(gx).toBeCloseTo(123.5, 9);
      expect(gz).toBeCloseTo(-45.25, 9);
    }
  });
  it('the three.js camera looks at the same ground point in every view', () => {
    const camera = createCamera(VW / VH, 30);
    const rig = new CameraRig(camera, 30);
    rig.setBounds({ minX: -1000, maxX: 1000, minZ: -1000, maxZ: 1000 });
    rig.target = [80, -30];
    for (let s = 0; s < 4; s++) {
      rig.setStep(s);
      rig.apply();
      camera.updateMatrixWorld();
      const dir = camera.getWorldDirection(new THREE.Vector3());
      const k = -camera.position.y / dir.y;
      expect(camera.position.x + dir.x * k).toBeCloseTo(80, 6);
      expect(camera.position.z + dir.z * k).toBeCloseTo(-30, 6);
    }
  });
});

describe('pan follows the screen in every azimuth', () => {
  for (let s = 0; s < 4; s++) {
    it(`step ${s}: dragging right moves the content right, dragging down moves it down`, () => {
      const rig = new CameraRig(null, 30);
      rig.setBounds({ minX: -1e5, maxX: 1e5, minZ: -1e5, maxZ: 1e5 });
      rig.setStep(s);
      const p: [number, number] = [10, -20];
      const before = rig.groundToScreen(p[0], p[1], VW, VH);
      rig.panByScreen(50, 0, VW);
      const afterRight = rig.groundToScreen(p[0], p[1], VW, VH);
      expect(afterRight[0] - before[0]).toBeCloseTo(50, 9);
      expect(afterRight[1] - before[1]).toBeCloseTo(0, 9);
      rig.panByScreen(0, 30, VW);
      const afterDown = rig.groundToScreen(p[0], p[1], VW, VH);
      expect(afterDown[0] - afterRight[0]).toBeCloseTo(0, 9);
      expect(afterDown[1] - afterRight[1]).toBeCloseTo(30, 9);
    });
    it(`step ${s}: panGround(right, away) moves the view centre right / up on screen`, () => {
      const rig = new CameraRig(null, 30);
      rig.setBounds({ minX: -1e5, maxX: 1e5, minZ: -1e5, maxZ: 1e5 });
      rig.setStep(s);
      const t0 = [...rig.target] as [number, number];
      rig.panGround(20, 0);
      const [sx, sy] = rig.groundToScreen(t0[0], t0[1], VW, VH);
      expect(sx).toBeLessThan(VW / 2); // old centre now left of the new one
      expect(sy).toBeCloseTo(VH / 2, 9);
      rig.panGround(0, 20);
      const [, sy2] = rig.groundToScreen(t0[0], t0[1], VW, VH);
      expect(sy2).toBeGreaterThan(VH / 2); // old centre now below the new one
    });
  }
});

describe('animation', () => {
  it('stays within 400 ms and ends exactly on the target angle', () => {
    expect(ROTATION_DURATION_MS).toBeLessThanOrEqual(400);
    expect(azimuthAt(45, -45, 0, 300)).toBe(45);
    expect(azimuthAt(45, -45, 300, 300)).toBe(-45);
    expect(azimuthAt(45, -45, 150, 300)).toBeCloseTo(0, 9);
  });

  function setup(reduced: boolean) {
    let t = 0;
    const frames: (() => void)[] = [];
    globalThis.requestAnimationFrame = ((cb: () => void) => {
      frames.push(cb);
      return frames.length;
    }) as unknown as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
    const rig = new CameraRig(null, 30);
    const anim = new RotationAnimator(rig, {
      requestRender: () => {},
      reducedMotion: () => reduced,
      now: () => t,
    });
    const advance = (ms: number): void => {
      t += ms;
      frames.splice(0).forEach((f) => f());
    };
    return { rig, anim, advance };
  }

  it('reduced motion is instant', () => {
    const { rig, anim } = setup(true);
    anim.rotate(-1);
    expect(rig.azimuthDeg).toBe(135);
    expect(anim.animating).toBe(false);
  });

  it('animates, then lands exactly on the next view', () => {
    const { rig, anim, advance } = setup(false);
    anim.rotate(-1); // Q
    advance(100);
    expect(rig.azimuthDeg).toBeGreaterThan(45);
    expect(rig.azimuthDeg).toBeLessThan(135);
    advance(300);
    expect(rig.azimuthDeg).toBe(135);
    expect(rig.azimuthStep).toBe(1);
    expect(anim.animating).toBe(false);
  });

  it('a press during an animation snaps the first to its end, then animates the second', () => {
    const { rig, anim, advance } = setup(false);
    anim.rotate(-1);
    advance(50);
    anim.rotate(-1);
    expect(rig.azimuthDeg).toBe(135); // first one snapped to its end
    expect(rig.azimuthStep).toBe(2);
    advance(1000);
    advance(1000);
    expect(rig.azimuthDeg).toBe(225);
  });

  it('E turns the other way and wraps', () => {
    const { rig, anim, advance } = setup(false);
    anim.rotate(1);
    advance(500);
    advance(500);
    expect(rig.azimuthDeg).toBe(315);
    expect(rig.azimuthStep).toBe(3);
  });
});

describe('tile culling in all four views', () => {
  // A 5 x 5 grid of 200 m tiles with 12 m high content, centred on the origin.
  const tiles: TileEntry[] = [];
  for (let i = -2; i <= 2; i++)
    for (let j = -2; j <= 2; j++)
      tiles.push({
        id: `t_${i}_${j}`,
        content_bbox_local: {
          min: [i * 200 - 100, 0, j * 200 - 100],
          max: [i * 200 + 100, 12, j * 200 + 100],
        },
      } as unknown as TileEntry);
  const tileOf = (x: number, z: number): string => `t_${Math.round(x / 200)}_${Math.round(z / 200)}`;

  for (let s = 0; s < 4; s++) {
    for (const [cx, cz, w] of [
      [0, 0, 600],
      [250, -180, 300],
      [-300, 300, 800],
    ] as const) {
      it(`step ${s}, centre (${cx}, ${cz}), width ${w}: every tile with a ground point in view is visible`, () => {
        const camera = createCamera(VW / VH, 30);
        const rig = new CameraRig(camera, 30, s);
        rig.setBounds({ minX: -500, maxX: 500, minZ: -500, maxZ: 500 });
        rig.target = [cx, cz];
        rig.visibleWidth = w;
        rig.apply();
        const { visible, wanted } = cullTiles(tiles, frustumOf(camera), 200);
        let checked = 0;
        for (let px = 0; px <= VW; px += 40) {
          for (let py = 0; py <= VH; py += 40) {
            const [gx, gz] = rig.screenToGround(px, py, VW, VH);
            if (Math.abs(gx) > 499 || Math.abs(gz) > 499) continue;
            expect(visible, `ground (${gx.toFixed(0)}, ${gz.toFixed(0)})`).toContain(tileOf(gx, gz));
            checked++;
          }
        }
        expect(checked).toBeGreaterThan(20);
        for (const id of visible) expect(wanted).toContain(id);
      });
    }
  }
});
