import { type CameraRig, VIEW_DEFAULTS, clamp } from './camera';
import { prefersReducedMotion } from './controls';
import { ease } from './rotation';
import type { Bbox4 } from './search';

/** Style constant (feel, not data): fly-to duration, ms. */
export const FLY_DURATION_MS = 400;
/** Space left around the box when it is fitted (1.4 = box fills 1/1.4 of the viewport). */
export const FIT_MARGIN = 1.4;

const DEG = Math.PI / 180;

/**
 * Visible ground width (metres) that fits `bbox` [minX, minZ, maxX, maxZ] in a viewport of the
 * given aspect (w / h), within the zoom limits. On screen a ground box spans the "right" axis 1:1
 * and the "away" axis foreshortened by sin(elevation).
 */
export function fitWidth(
  bbox: Bbox4,
  azimuthDeg: number,
  elevationDeg: number,
  aspect: number,
  margin = FIT_MARGIN,
): number {
  const az = azimuthDeg * DEG;
  const r = [Math.cos(az), -Math.sin(az)];
  const f = [-Math.sin(az), -Math.cos(az)];
  const corners: [number, number][] = [
    [bbox[0], bbox[1]],
    [bbox[2], bbox[1]],
    [bbox[2], bbox[3]],
    [bbox[0], bbox[3]],
  ];
  const xs = corners.map(([x, z]) => x * r[0] + z * r[1]);
  const ys = corners.map(([x, z]) => (x * f[0] + z * f[1]) * Math.sin(elevationDeg * DEG));
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  const w = Math.max(spanX, spanY * aspect) * margin;
  return clamp(w, VIEW_DEFAULTS.minWidthM, VIEW_DEFAULTS.maxWidthM);
}

export interface FlyOptions {
  requestRender: () => void;
  reducedMotion?: () => boolean;
  now?: () => number;
  durationMs?: number;
}

/**
 * Moves the camera target and visible width to a goal: instantly under reduced motion, else eased
 * over FLY_DURATION_MS. If anything else moves the camera meanwhile (the user pans or zooms), the
 * flight stops where it is. Frames are requested only while flying.
 */
export class FlyAnimator {
  private raf = 0;
  private running = false;
  private readonly reduced: () => boolean;
  private readonly now: () => number;
  private readonly duration: number;
  private last: { target: [number, number]; width: number } | null = null;

  constructor(
    private readonly rig: CameraRig,
    private readonly opts: FlyOptions,
  ) {
    this.reduced = opts.reducedMotion ?? prefersReducedMotion;
    this.now = opts.now ?? (() => performance.now());
    this.duration = Math.min(400, opts.durationMs ?? FLY_DURATION_MS);
  }

  get flying(): boolean {
    return this.running;
  }

  cancel(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  flyTo(target: [number, number], width: number): void {
    this.cancel();
    const w = clamp(width, VIEW_DEFAULTS.minWidthM, VIEW_DEFAULTS.maxWidthM);
    if (this.reduced() || this.duration <= 0) {
      this.set(target, w);
      return;
    }
    const from = { target: [this.rig.target[0], this.rig.target[1]] as [number, number], width: this.rig.visibleWidth };
    const start = this.now();
    this.running = true;
    this.last = { target: [...from.target], width: from.width };
    const tick = (): void => {
      this.raf = 0;
      if (!this.running) return;
      const l = this.last;
      if (l && (this.rig.target[0] !== l.target[0] || this.rig.target[1] !== l.target[1] || this.rig.visibleWidth !== l.width)) {
        this.running = false; // the user moved the camera: stop
        return;
      }
      const p = Math.min(1, (this.now() - start) / this.duration);
      const e = p >= 1 ? 1 : ease(p);
      this.set(
        [from.target[0] + (target[0] - from.target[0]) * e, from.target[1] + (target[1] - from.target[1]) * e],
        from.width + (w - from.width) * e,
      );
      if (p >= 1) {
        this.running = false;
        return;
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private set(target: [number, number], width: number): void {
    this.rig.target = [target[0], target[1]];
    this.rig.visibleWidth = width;
    this.rig.clampTarget();
    this.rig.apply();
    this.last = { target: [this.rig.target[0], this.rig.target[1]], width: this.rig.visibleWidth };
    this.opts.requestRender();
  }
}
