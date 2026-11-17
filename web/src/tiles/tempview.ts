import * as THREE from 'three';
import { AZIMUTH_DEG, cameraDirection } from '../camera';

/**
 * TEMPORARY (T-3.2): sets the camera over the real tile area until T-3.1's controls exist.
 * `?view=<x>,<z>,<width>` looks at ground point (x, z) with `width` metres across the viewport.
 * The orchestrator removes this file when T-3.1 is merged (the controls own the camera then).
 */
export interface View {
  x: number;
  z: number;
  width: number;
}

/** Same defaults as T-3.1 ("style/UX constants"): the origin, 600 m wide. */
export const DEFAULT_VIEW: View = { x: 0, z: 0, width: 600 };
const DISTANCE_M = 3000;

export function parseView(search: string): View {
  const raw = new URLSearchParams(search).get('view');
  if (raw === null) return DEFAULT_VIEW;
  const p = raw.split(',').map(Number);
  if (p.length !== 3 || p.some((n) => !Number.isFinite(n)) || !(p[2] > 0)) return DEFAULT_VIEW;
  return { x: p[0], z: p[1], width: p[2] };
}

export function applyView(
  camera: THREE.OrthographicCamera,
  aspect: number,
  view: View,
  elevationDeg: number,
): void {
  const [dx, dy, dz] = cameraDirection(AZIMUTH_DEG, elevationDeg);
  const hw = view.width / 2;
  camera.left = -hw;
  camera.right = hw;
  camera.top = hw / aspect;
  camera.bottom = -hw / aspect;
  camera.near = 1;
  camera.far = DISTANCE_M * 2.2;
  camera.position.set(
    view.x + dx * DISTANCE_M,
    dy * DISTANCE_M,
    view.z + dz * DISTANCE_M,
  );
  camera.lookAt(view.x, 0, view.z);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}
