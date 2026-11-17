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

/**
 * Style/UX constants of the viewer (not data). Changing them changes feel, not geometry.
 */
export const VIEW_DEFAULTS = {
  /** Initial ground target (x, z) in client metres: the origin, the Duomo (ADR-0004/0021). */
  target: [0, 0] as readonly [number, number],
  /** Initial visible ground width across the viewport, metres. */
  visibleWidthM: 600,
  minWidthM: 60,
  maxWidthM: 4000,
  /** Half-size of the square the target is clamped to until setBounds() is called. */
  fallbackBoundsHalfM: 500,
  /**
   * Camera distance from the target along the view direction, and the clip planes.
   * Visible depth around the target: ground at +-(H/2)/tan(el) with H the visible height. For the
   * largest zoom (4000 m wide) on a tall phone viewport (aspect ~0.46) that is about +-7.5 km, and
   * buildings add up to 350 m. Distance 20 km with near 10 km and far 30 km leaves +-10 km, so
   * nothing is clipped, and depth resolution stays about 1.2 mm over the 20 km range at 24 bits.
   */
  cameraDistanceM: 20000,
  near: 10000,
  far: 30000,
  /** Inertia time constant (exponential velocity decay), ms. */
  inertiaTauMs: 250,
  /** Inertia stops when the speed falls below this fraction of the visible width per second. */
  inertiaStopWidthFractionPerS: 0.005,
  /** Only pointer samples this recent (ms) count towards the release velocity. */
  velocityWindowMs: 100,
  /** Keyboard pan step as a fraction of the visible width, and keyboard zoom factor. */
  keyPanFraction: 0.1,
  keyZoomFactor: 1.25,
  /** Wheel zoom: factor = exp(-deltaY * wheelZoomPerPx) (deltaY in pixels). */
  wheelZoomPerPx: 0.0015,
} as const;

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export function createCamera(
  aspect: number,
  elevationDeg: number = DEFAULT_ELEVATION_DEG,
): THREE.OrthographicCamera {
  const camera = new THREE.OrthographicCamera(
    -1,
    1,
    1,
    -1,
    VIEW_DEFAULTS.near,
    VIEW_DEFAULTS.far,
  );
  camera.userData.visibleWidth = VIEW_DEFAULTS.visibleWidthM;
  placeCamera(camera, VIEW_DEFAULTS.target[0], VIEW_DEFAULTS.target[1], elevationDeg);
  resizeCamera(camera, aspect);
  return camera;
}

function placeCamera(
  camera: THREE.OrthographicCamera,
  tx: number,
  tz: number,
  elevationDeg: number,
): void {
  const [x, y, z] = cameraDirection(AZIMUTH_DEG, elevationDeg);
  const d = VIEW_DEFAULTS.cameraDistanceM;
  camera.position.set(tx + x * d, y * d, tz + z * d);
  camera.lookAt(tx, 0, tz);
}

/** Sets the frustum from the aspect and the camera's current visible width (userData). */
export function resizeCamera(camera: THREE.OrthographicCamera, aspect: number): void {
  const w = (camera.userData.visibleWidth as number | undefined) ?? VIEW_DEFAULTS.visibleWidthM;
  camera.userData.aspect = aspect;
  camera.left = -w / 2;
  camera.right = w / 2;
  camera.top = w / 2 / aspect;
  camera.bottom = -w / 2 / aspect;
  camera.updateProjectionMatrix();
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Camera state and exact screen <-> ground mapping for the orthographic camera.
 * Screen axes on the ground: "right" r = (cos az, -sin az) and "away" f = (-sin az, -cos az) in
 * (x, z). A ground step g along f appears g*sin(el) up on screen; a step along r appears 1:1.
 * All pixel arguments are CSS pixels inside a viewport of vw x vh.
 */
export class CameraRig {
  target: [number, number] = [VIEW_DEFAULTS.target[0], VIEW_DEFAULTS.target[1]];
  visibleWidth: number = VIEW_DEFAULTS.visibleWidthM;
  bounds: Bounds;
  readonly elevationDeg: number;
  readonly azimuthDeg = AZIMUTH_DEG;
  private readonly camera: THREE.OrthographicCamera | null;

  constructor(
    camera: THREE.OrthographicCamera | null = null,
    elevationDeg: number = DEFAULT_ELEVATION_DEG,
  ) {
    this.camera = camera;
    this.elevationDeg = elevationDeg;
    const h = VIEW_DEFAULTS.fallbackBoundsHalfM;
    this.bounds = { minX: -h, maxX: h, minZ: -h, maxZ: h };
  }

  private axes(): { r: [number, number]; f: [number, number]; sinEl: number } {
    const az = AZIMUTH_DEG * DEG;
    return {
      r: [Math.cos(az), -Math.sin(az)],
      f: [-Math.sin(az), -Math.cos(az)],
      sinEl: Math.sin(this.elevationDeg * DEG),
    };
  }

  /** Metres of ground width per CSS pixel. */
  metresPerPixel(vw: number): number {
    return this.visibleWidth / vw;
  }

  screenToGround(px: number, py: number, vw: number, vh: number): [number, number] {
    const { r, f, sinEl } = this.axes();
    const mpp = this.metresPerPixel(vw);
    const xv = (px - vw / 2) * mpp;
    const yv = ((vh / 2 - py) * mpp) / sinEl;
    return [this.target[0] + r[0] * xv + f[0] * yv, this.target[1] + r[1] * xv + f[1] * yv];
  }

  groundToScreen(gx: number, gz: number, vw: number, vh: number): [number, number] {
    const { r, f, sinEl } = this.axes();
    const mpp = this.metresPerPixel(vw);
    const dx = gx - this.target[0];
    const dz = gz - this.target[1];
    const xv = dx * r[0] + dz * r[1];
    const yv = (dx * f[0] + dz * f[1]) * sinEl;
    return [vw / 2 + xv / mpp, vh / 2 - yv / mpp];
  }

  /** Moves the content by (dxPx, dyPx) on screen, i.e. moves the target the opposite way. */
  panByScreen(dxPx: number, dyPx: number, vw: number): void {
    const { r, f, sinEl } = this.axes();
    const mpp = this.metresPerPixel(vw);
    const xv = dxPx * mpp;
    const yv = (-dyPx * mpp) / sinEl;
    this.target[0] -= r[0] * xv + f[0] * yv;
    this.target[1] -= r[1] * xv + f[1] * yv;
    this.clampTarget();
  }

  /** Moves the target by a ground displacement along the screen-aligned ground axes. */
  panGround(right: number, away: number): void {
    const { r, f } = this.axes();
    this.target[0] += r[0] * right + f[0] * away;
    this.target[1] += r[1] * right + f[1] * away;
    this.clampTarget();
  }

  /** factor > 1 zooms in. The ground point under (px, py) stays under it (unless clamped). */
  zoomAt(factor: number, px: number, py: number, vw: number, vh: number): void {
    const before = this.screenToGround(px, py, vw, vh);
    this.visibleWidth = clamp(
      this.visibleWidth / factor,
      VIEW_DEFAULTS.minWidthM,
      VIEW_DEFAULTS.maxWidthM,
    );
    const after = this.screenToGround(px, py, vw, vh);
    this.target[0] += before[0] - after[0];
    this.target[1] += before[1] - after[1];
    this.clampTarget();
  }

  setBounds(b: Bounds): void {
    this.bounds = { ...b };
    this.clampTarget();
  }

  clampTarget(): void {
    this.target[0] = clamp(this.target[0], this.bounds.minX, this.bounds.maxX);
    this.target[1] = clamp(this.target[1], this.bounds.minZ, this.bounds.maxZ);
  }

  reset(): void {
    this.target = [VIEW_DEFAULTS.target[0], VIEW_DEFAULTS.target[1]];
    this.visibleWidth = VIEW_DEFAULTS.visibleWidthM;
    this.clampTarget();
  }

  /** Writes the state into the three.js camera (position, look-at, frustum). */
  apply(): void {
    const cam = this.camera;
    if (!cam) return;
    cam.userData.visibleWidth = this.visibleWidth;
    placeCamera(cam, this.target[0], this.target[1], this.elevationDeg);
    resizeCamera(cam, (cam.userData.aspect as number | undefined) ?? 1);
  }

  snapshot(): {
    target: [number, number];
    visibleWidth: number;
    elevationDeg: number;
    azimuthDeg: number;
    bounds: Bounds;
  } {
    return {
      target: [this.target[0], this.target[1]],
      visibleWidth: this.visibleWidth,
      elevationDeg: this.elevationDeg,
      azimuthDeg: this.azimuthDeg,
      bounds: { ...this.bounds },
    };
  }
}
