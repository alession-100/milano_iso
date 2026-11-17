import * as THREE from 'three';
import { LIGHT_COLOURS, NIGHT_LIGHT_COLOURS, type StyleMode } from './palette';

/**
 * STYLE constants of the lighting (not data). One fixed sun, no time of day (Phase 4).
 *
 * The camera sits at azimuth 45 degrees, so the two visible wall faces have outward normals +Z
 * (facing left on screen) and +X (facing right). The sun comes mostly from the +Z side, slightly
 * from -X, so the +Z walls are well lit and the +X walls fall back to the fill light. Shadows then
 * fall to the right on screen.
 */
export const SUN_DIRECTION: readonly [number, number, number] = (() => {
  const v = new THREE.Vector3(-0.35, 0.75, 0.7).normalize();
  return [v.x, v.y, v.z] as const;
})();
export const SUN_INTENSITY = 2.6;
export const FILL_INTENSITY = 1.3;
/** Night (style): a cool low moon key and a dim fill; same direction, so the shadow fit is shared. */
export const MOON_INTENSITY = 1.8;
export const NIGHT_FILL_INTENSITY = 1.4;

/** Shadow map resolution (style/budget constant, at most 2048). */
export const SHADOW_MAP_SIZE = 2048;
/**
 * Tallest thing that may cast a shadow, for fitting the shadow frustum. Style constant chosen
 * above the tallest pilot building (100.2 m, ADR-0022); taller casters are simply not fitted.
 */
export const SHADOW_CASTER_MAX_HEIGHT_M = 150;
const SHADOW_PAD_M = 20;

/** `?shadows=0` turns shadows off; anything else (or absent) leaves them on. */
export function parseShadows(search: string): boolean {
  return new URLSearchParams(search).get('shadows') !== '0';
}

export interface Lights {
  sun: THREE.DirectionalLight;
  fill: THREE.HemisphereLight;
}

export function createLights(shadows: boolean): Lights {
  const sun = new THREE.DirectionalLight(LIGHT_COLOURS.sun, SUN_INTENSITY);
  sun.position.set(...SUN_DIRECTION).multiplyScalar(1000);
  sun.castShadow = shadows;
  sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.3;
  const fill = new THREE.HemisphereLight(
    LIGHT_COLOURS.skyFill,
    LIGHT_COLOURS.groundFill,
    FILL_INTENSITY,
  );
  return { sun, fill };
}

/** Switches the sun/moon and fill lights to the day or night values. */
export function applyLightMode(lights: Lights, mode: StyleMode): void {
  const night = mode === 'night';
  const c = night ? NIGHT_LIGHT_COLOURS : LIGHT_COLOURS;
  lights.sun.color.set(c.sun);
  lights.sun.intensity = night ? MOON_INTENSITY : SUN_INTENSITY;
  lights.fill.color.set(c.skyFill);
  lights.fill.groundColor.set(c.groundFill);
  lights.fill.intensity = night ? NIGHT_FILL_INTENSITY : FILL_INTENSITY;
}

export function configureShadowRenderer(renderer: THREE.WebGLRenderer, shadows: boolean): void {
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = THREE.PCFShadowMap;
}

export interface GroundBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Ground (y = 0) points seen at the four corners of an orthographic camera's viewport. */
export function viewFootprint(camera: THREE.OrthographicCamera): THREE.Vector3[] {
  camera.updateMatrixWorld();
  const dir = camera.getWorldDirection(new THREE.Vector3());
  const out: THREE.Vector3[] = [];
  for (const [x, y] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    const p = new THREE.Vector3(x, y, -1).unproject(camera);
    const t = -p.y / dir.y;
    out.push(p.addScaledVector(dir, t));
  }
  return out;
}

/**
 * Fits the sun's orthographic shadow frustum to the ground footprint of the current view
 * (clipped to `bounds`, the area that has content), extended upwards by the tallest caster.
 * Call after the camera moved; cheap (a few vector operations).
 */
export function fitSunShadow(
  sun: THREE.DirectionalLight,
  camera: THREE.OrthographicCamera,
  bounds?: GroundBounds,
): void {
  const foot = viewFootprint(camera);
  let minX = Math.min(...foot.map((p) => p.x));
  let maxX = Math.max(...foot.map((p) => p.x));
  let minZ = Math.min(...foot.map((p) => p.z));
  let maxZ = Math.max(...foot.map((p) => p.z));
  if (bounds) {
    minX = Math.max(minX, bounds.minX);
    maxX = Math.min(maxX, bounds.maxX);
    minZ = Math.max(minZ, bounds.minZ);
    maxZ = Math.min(maxZ, bounds.maxZ);
    if (minX > maxX || minZ > maxZ) {
      // View entirely outside the content: keep a tiny frustum at the view centre.
      minX = maxX = (foot[0].x + foot[2].x) / 2;
      minZ = maxZ = (foot[0].z + foot[2].z) / 2;
    }
  }
  const pts: THREE.Vector3[] = [];
  for (const y of [-1, SHADOW_CASTER_MAX_HEIGHT_M]) {
    for (const x of [minX, maxX]) for (const z of [minZ, maxZ]) pts.push(new THREE.Vector3(x, y, z));
  }

  // Light basis: w points to the sun, u and v span the shadow map.
  const w = new THREE.Vector3(...SUN_DIRECTION);
  const u = new THREE.Vector3(0, 1, 0).cross(w).normalize();
  const v = new THREE.Vector3().crossVectors(w, u);
  let uMin = Infinity,
    uMax = -Infinity,
    vMin = Infinity,
    vMax = -Infinity,
    wMin = Infinity,
    wMax = -Infinity;
  for (const p of pts) {
    const pu = p.dot(u),
      pv = p.dot(v),
      pw = p.dot(w);
    uMin = Math.min(uMin, pu);
    uMax = Math.max(uMax, pu);
    vMin = Math.min(vMin, pv);
    vMax = Math.max(vMax, pv);
    wMin = Math.min(wMin, pw);
    wMax = Math.max(wMax, pw);
  }
  const half = (wMax - wMin) / 2;
  const centre = new THREE.Vector3()
    .addScaledVector(u, (uMin + uMax) / 2)
    .addScaledVector(v, (vMin + vMax) / 2)
    .addScaledVector(w, (wMin + wMax) / 2);
  const dist = half + SHADOW_PAD_M;
  sun.target.position.copy(centre);
  sun.position.copy(centre).addScaledVector(w, dist);
  const cam = sun.shadow.camera;
  cam.left = -(uMax - uMin) / 2 - SHADOW_PAD_M;
  cam.right = (uMax - uMin) / 2 + SHADOW_PAD_M;
  cam.bottom = -(vMax - vMin) / 2 - SHADOW_PAD_M;
  cam.top = (vMax - vMin) / 2 + SHADOW_PAD_M;
  cam.near = SHADOW_PAD_M / 2;
  cam.far = 2 * half + 2 * SHADOW_PAD_M;
  cam.updateProjectionMatrix();
  sun.target.updateMatrixWorld();
  sun.updateMatrixWorld();
}
