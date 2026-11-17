import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CameraRig, createCamera } from '../camera';
import {
  SHADOW_CASTER_MAX_HEIGHT_M,
  SHADOW_MAP_SIZE,
  SUN_DIRECTION,
  createLights,
  fitSunShadow,
  parseShadows,
  viewFootprint,
} from './lights';

describe('sun', () => {
  it('gives the two visible wall faces clearly different shades', () => {
    const l = new THREE.Vector3(...SUN_DIRECTION);
    const a = Math.max(0, l.dot(new THREE.Vector3(0, 0, 1)));
    const b = Math.max(0, l.dot(new THREE.Vector3(1, 0, 0)));
    expect(a).toBeGreaterThan(0.4);
    expect(a - b).toBeGreaterThan(0.3);
  });

  it('uses a bounded shadow map', () => {
    expect(SHADOW_MAP_SIZE).toBeLessThanOrEqual(2048);
    expect(createLights(true).sun.shadow.mapSize.x).toBe(SHADOW_MAP_SIZE);
  });
});

describe('parseShadows', () => {
  it('is off only for shadows=0', () => {
    expect(parseShadows('')).toBe(true);
    expect(parseShadows('?shadows=1')).toBe(true);
    expect(parseShadows('?shadows=0')).toBe(false);
  });
});

describe('fitSunShadow', () => {
  function project(sun: THREE.DirectionalLight, p: THREE.Vector3): THREE.Vector3 {
    const cam = sun.shadow.camera;
    cam.position.setFromMatrixPosition(sun.matrixWorld);
    cam.lookAt(sun.target.position);
    cam.updateMatrixWorld();
    return p.clone().project(cam);
  }

  for (const width of [150, 600, 4000]) {
    it(`contains the view footprint and its casters, ${width} m wide`, () => {
      const cam = createCamera(16 / 9);
      const rig = new CameraRig(cam);
      rig.target = [40, -30];
      rig.visibleWidth = width;
      rig.apply();
      const { sun } = createLights(true);
      fitSunShadow(sun, cam);
      for (const p of viewFootprint(cam)) {
        for (const y of [0, SHADOW_CASTER_MAX_HEIGHT_M]) {
          const q = project(sun, new THREE.Vector3(p.x, y, p.z));
          expect(Math.abs(q.x)).toBeLessThanOrEqual(1 + 1e-6);
          expect(Math.abs(q.y)).toBeLessThanOrEqual(1 + 1e-6);
          expect(q.z).toBeGreaterThanOrEqual(-1 - 1e-6);
          expect(q.z).toBeLessThanOrEqual(1 + 1e-6);
        }
      }
    });
  }

  it('shrinks to the content bounds', () => {
    const cam = createCamera(16 / 9);
    new CameraRig(cam).apply();
    const { sun } = createLights(true);
    cam.left = -2000;
    cam.right = 2000;
    cam.updateProjectionMatrix();
    fitSunShadow(sun, cam);
    const wide = sun.shadow.camera.right;
    fitSunShadow(sun, cam, { minX: -100, maxX: 100, minZ: -100, maxZ: 100 });
    expect(sun.shadow.camera.right).toBeLessThan(wide);
  });
});
