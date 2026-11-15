import * as THREE from 'three';

export const DEFAULT_ELEVATION_DEG = 30;
export const AZIMUTH_DEG = 45;
export const ALLOWED_ELEVATIONS: readonly number[] = [30, 35.264];

const DEG = Math.PI / 180;

/**
 * Unit vector pointing from the scene centre towards the camera.
 * Y is up; azimuth is measured in the XZ plane from +Z towards +X.
 */
export function cameraDirection(
  azimuthDeg: number,
  elevationDeg: number,
): [number, number, number] {
  const az = azimuthDeg * DEG;
  const el = elevationDeg * DEG;
  return [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
}

/** Parse the `?elev=` query; only 30 or 35.264 are accepted, anything else gives the default. */
export function parseElevation(search: string): number {
  const raw = new URLSearchParams(search).get('elev');
  if (raw === null || raw.trim() === '') return DEFAULT_ELEVATION_DEG;
  const value = Number(raw);
  return ALLOWED_ELEVATIONS.includes(value) ? value : DEFAULT_ELEVATION_DEG;
}

const VIEW_HEIGHT_M = 24;

export function createCamera(
  aspect: number,
  elevationDeg: number = DEFAULT_ELEVATION_DEG,
): THREE.OrthographicCamera {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  const [x, y, z] = cameraDirection(AZIMUTH_DEG, elevationDeg);
  camera.position.set(x * 50, y * 50, z * 50);
  camera.lookAt(0, 0, 0);
  resizeCamera(camera, aspect);
  return camera;
}

export function resizeCamera(camera: THREE.OrthographicCamera, aspect: number): void {
  const h = VIEW_HEIGHT_M / 2;
  camera.left = -h * aspect;
  camera.right = h * aspect;
  camera.top = h;
  camera.bottom = -h;
  camera.updateProjectionMatrix();
}
