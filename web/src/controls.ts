import { type CameraRig, VIEW_DEFAULTS } from './camera';

/** One pointer position sample (container-relative CSS pixels, time in ms). */
export interface Sample {
  t: number;
  x: number;
  y: number;
}

export interface Velocity {
  vx: number;
  vy: number;
}

/**
 * Release velocity (px/s) from the samples inside the window ending at `now`.
 * Returns null when reduced motion is on (no inertia), when too few recent samples exist, or when
 * the pointer rested before release.
 */
export function releaseVelocity(
  samples: readonly Sample[],
  now: number,
  reducedMotion: boolean,
  windowMs: number = VIEW_DEFAULTS.velocityWindowMs,
): Velocity | null {
  if (reducedMotion) return null;
  const recent = samples.filter((s) => now - s.t <= windowMs);
  if (recent.length < 2) return null;
  const first = recent[0];
  const last = recent[recent.length - 1];
  const dt = last.t - first.t;
  if (dt <= 0) return null;
  return { vx: ((last.x - first.x) / dt) * 1000, vy: ((last.y - first.y) / dt) * 1000 };
}

/**
 * Advances the inertia by dtMs with exponential velocity decay v(t) = v0 * exp(-t / tau).
 * The displacement is the exact integral over the step, so it does not depend on the frame rate.
 * `done` is true when the speed has dropped below stopSpeed (px/s).
 */
export function stepInertia(
  v: Velocity,
  dtMs: number,
  tauMs: number,
  stopSpeed: number,
): { v: Velocity; dx: number; dy: number; done: boolean } {
  const e = Math.exp(-dtMs / tauMs);
  const k = (tauMs / 1000) * (1 - e);
  const next = { vx: v.vx * e, vy: v.vy * e };
  const done = Math.hypot(next.vx, next.vy) < stopSpeed;
  return { v: done ? { vx: 0, vy: 0 } : next, dx: v.vx * k, dy: v.vy * k, done };
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export interface ControlsOptions {
  /** Called after every state change; the host coalesces and renders on demand. */
  requestRender: () => void;
  ariaLabel: string;
  /** Injectable for tests; defaults to the media query. */
  reducedMotion?: () => boolean;
}

interface Point {
  x: number;
  y: number;
}

/** Mouse, touch (Pointer Events), wheel and keyboard input for a CameraRig. */
export class Controls {
  private readonly pointers = new Map<number, Point>();
  private samples: Sample[] = [];
  private prevCentroid: Point | null = null;
  private prevDist = 0;
  private inertia: Velocity | null = null;
  private inertiaLast = 0;
  private rafId = 0;
  private readonly reduced: () => boolean;

  constructor(
    private readonly el: HTMLElement,
    private readonly rig: CameraRig,
    private readonly opts: ControlsOptions,
  ) {
    this.reduced = opts.reducedMotion ?? prefersReducedMotion;
    el.tabIndex = 0;
    el.setAttribute('role', 'application');
    el.setAttribute('aria-label', opts.ariaLabel);
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('keydown', this.onKey);
  }

  dispose(): void {
    this.stopInertia();
    this.el.removeEventListener('pointerdown', this.onDown);
    this.el.removeEventListener('pointermove', this.onMove);
    this.el.removeEventListener('pointerup', this.onUp);
    this.el.removeEventListener('pointercancel', this.onUp);
    this.el.removeEventListener('wheel', this.onWheel);
    this.el.removeEventListener('keydown', this.onKey);
  }

  private size(): { vw: number; vh: number } {
    const r = this.el.getBoundingClientRect();
    return { vw: r.width, vh: r.height };
  }

  private local(e: { clientX: number; clientY: number }): Point {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private changed(): void {
    this.rig.apply();
    this.opts.requestRender();
  }

  private measure(): { c: Point; d: number } {
    const pts = [...this.pointers.values()];
    const c = {
      x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
      y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
    };
    const d = pts.length >= 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    return { c, d };
  }

  private restartGesture(now: number): void {
    this.samples = [];
    if (this.pointers.size === 0) {
      this.prevCentroid = null;
      return;
    }
    const { c, d } = this.measure();
    this.prevCentroid = c;
    this.prevDist = d;
    this.samples.push({ t: now, x: c.x, y: c.y });
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.stopInertia();
    this.el.focus({ preventScroll: true });
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic or already released pointers cannot be captured; dragging still works.
    }
    this.pointers.set(e.pointerId, this.local(e));
    this.restartGesture(e.timeStamp);
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, this.local(e));
    const prev = this.prevCentroid;
    if (!prev) return;
    const { c, d } = this.measure();
    const { vw, vh } = this.size();
    if (this.pointers.size >= 2 && this.prevDist > 0 && d > 0) {
      // Pinch: zoom about the previous centroid, then move the ground point under it to the new one.
      this.rig.zoomAt(d / this.prevDist, prev.x, prev.y, vw, vh);
    }
    this.rig.panByScreen(c.x - prev.x, c.y - prev.y, vw);
    this.prevCentroid = c;
    this.prevDist = d;
    this.samples.push({ t: e.timeStamp, x: c.x, y: c.y });
    if (this.samples.length > 32) this.samples.shift();
    this.changed();
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return;
    const wasSingle = this.pointers.size === 1;
    const samples = this.samples;
    this.pointers.delete(e.pointerId);
    this.restartGesture(e.timeStamp);
    if (!wasSingle) return;
    const v = releaseVelocity(samples, e.timeStamp, this.reduced());
    if (v) this.startInertia(v);
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.stopInertia();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const factor = Math.exp(-e.deltaY * unit * VIEW_DEFAULTS.wheelZoomPerPx);
    const p = this.local(e);
    const { vw, vh } = this.size();
    // Zoom changes are always instant, so reduced motion needs no special case here.
    this.rig.zoomAt(factor, p.x, p.y, vw, vh);
    this.changed();
  };

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const step = this.rig.visibleWidth * VIEW_DEFAULTS.keyPanFraction;
    const { vw, vh } = this.size();
    switch (e.key) {
      case 'ArrowLeft':
        this.rig.panGround(-step, 0);
        break;
      case 'ArrowRight':
        this.rig.panGround(step, 0);
        break;
      case 'ArrowUp':
        this.rig.panGround(0, step);
        break;
      case 'ArrowDown':
        this.rig.panGround(0, -step);
        break;
      case '+':
      case '=':
        this.rig.zoomAt(VIEW_DEFAULTS.keyZoomFactor, vw / 2, vh / 2, vw, vh);
        break;
      case '-':
      case '_':
        this.rig.zoomAt(1 / VIEW_DEFAULTS.keyZoomFactor, vw / 2, vh / 2, vw, vh);
        break;
      case '0':
        this.rig.reset();
        break;
      default:
        return;
    }
    e.preventDefault();
    this.stopInertia();
    this.changed();
  };

  private startInertia(v: Velocity): void {
    this.inertia = v;
    this.inertiaLast = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  private stopInertia(): void {
    this.inertia = null;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  private readonly tick = (now: number): void => {
    this.rafId = 0;
    if (!this.inertia) return;
    const { vw } = this.size();
    const dt = Math.max(0, now - this.inertiaLast);
    this.inertiaLast = now;
    const stop = VIEW_DEFAULTS.inertiaStopWidthFractionPerS * vw;
    const s = stepInertia(this.inertia, dt, VIEW_DEFAULTS.inertiaTauMs, stop);
    this.rig.panByScreen(s.dx, s.dy, vw);
    this.changed();
    if (s.done) {
      this.inertia = null;
      return;
    }
    this.inertia = s.v;
    this.rafId = requestAnimationFrame(this.tick);
  };
}
