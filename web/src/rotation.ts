import { type CameraRig, ROTATION_STEP_DEG, wrapStep } from './camera';
import { prefersReducedMotion } from './controls';
import { mountBeforeAttribution } from './dom';
import { type Key, onLangChange, t } from './i18n';

/** Style constant (feel, not data): duration of one 90-degree step, at most 400 ms (T-5.2). */
export const ROTATION_DURATION_MS = 300;

/** +1 = clockwise (the city turns clockwise on screen, E), -1 = counter-clockwise (Q). */
export type RotationDir = 1 | -1;

/** Smoothstep easing, 0..1 -> 0..1. */
export function ease(p: number): number {
  const x = Math.min(1, Math.max(0, p));
  return x * x * (3 - 2 * x);
}

/** Azimuth `elapsedMs` into a rotation from `from` to `to` degrees; exactly `to` at the end. */
export function azimuthAt(from: number, to: number, elapsedMs: number, durationMs: number): number {
  if (durationMs <= 0 || elapsedMs >= durationMs) return to;
  return from + (to - from) * ease(elapsedMs / durationMs);
}

/**
 * Next rotation step. The camera azimuth is measured from +Z towards +X, which turns
 * counter-clockwise on screen when it grows, so the city turns clockwise (E) when the azimuth
 * decreases.
 */
export function nextStep(step: number, dir: RotationDir): number {
  return wrapStep(step - dir);
}

interface Animation {
  from: number;
  to: number;
  toStep: number;
  start: number;
}

export interface RotationOptions {
  requestRender: () => void;
  /** Injectable for tests. */
  reducedMotion?: () => boolean;
  now?: () => number;
  durationMs?: number;
}

/**
 * Animates the rig azimuth in 90-degree steps about the (fixed) target. A step pressed during an
 * animation first snaps the running one to its end state, so the final azimuth is always exactly
 * one of the four values. Frames are requested only while animating.
 */
export class RotationAnimator {
  private anim: Animation | null = null;
  private rafId = 0;
  private readonly reduced: () => boolean;
  private readonly now: () => number;
  private readonly duration: number;

  constructor(
    private readonly rig: CameraRig,
    private readonly opts: RotationOptions,
  ) {
    this.reduced = opts.reducedMotion ?? prefersReducedMotion;
    this.now = opts.now ?? (() => performance.now());
    this.duration = Math.min(400, opts.durationMs ?? ROTATION_DURATION_MS);
  }

  get animating(): boolean {
    return this.anim !== null;
  }

  rotate(dir: RotationDir): void {
    this.finish();
    const toStep = nextStep(this.rig.azimuthStep, dir);
    this.rig.azimuthStep = toStep;
    if (this.reduced() || this.duration <= 0) {
      this.rig.setStep(toStep);
      this.changed();
      return;
    }
    const from = this.rig.azimuthDeg;
    this.anim = { from, to: from - dir * ROTATION_STEP_DEG, toStep, start: this.now() };
    this.rafId = requestAnimationFrame(this.tick);
  }

  /** Jumps to the end state of a running animation, if any. */
  finish(): void {
    if (!this.anim) return;
    const { toStep } = this.anim;
    this.anim = null;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.rig.setStep(toStep);
    this.changed();
  }

  private changed(): void {
    this.rig.apply();
    this.opts.requestRender();
  }

  private readonly tick = (): void => {
    this.rafId = 0;
    const a = this.anim;
    if (!a) return;
    const elapsed = this.now() - a.start;
    if (elapsed >= this.duration) {
      this.finish();
      return;
    }
    this.rig.azimuthDeg = azimuthAt(a.from, a.to, elapsed, this.duration);
    this.changed();
    this.rafId = requestAnimationFrame(this.tick);
  };
}

// --- T-5.2 rotation ---
/**
 * Two rotate buttons, top right under the day/night toggle (the tiles notice is top left and the
 * attribution bottom right, so none is covered). Native buttons, 44x44 CSS px, labelled in IT/EN
 * (re-labelled live when the language changes). Look: the shared `.tb-btn` style in index.html.
 */
export function createRotationButtons(onRotate: (dir: RotationDir) => void): HTMLElement {
  const box = document.createElement('div');
  box.id = 'rotation-controls';
  const make = (id: string, glyph: string, key: Key, dir: RotationDir): void => {
    const b = document.createElement('button');
    b.id = id;
    b.type = 'button';
    b.className = 'tb-btn rot-btn';
    b.textContent = glyph;
    const label = (): void => {
      b.title = t(key);
      b.setAttribute('aria-label', t(key));
    };
    label();
    onLangChange(label);
    b.addEventListener('click', () => onRotate(dir));
    box.append(b);
  };
  make('rotate-left', '↶', 'rotateLeft', -1);
  make('rotate-right', '↷', 'rotateRight', 1);
  mountBeforeAttribution(box);
  return box;
}
// --- end T-5.2 rotation ---
