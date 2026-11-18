/**
 * `?debug` overlay and benchmark mode (T-3.4). Loaded by dynamic import from main.ts only when
 * the `debug` query parameter is present, so it costs nothing otherwise.
 */
import { onLangChange, t } from './i18n';
import { SHEET_QUERY, requestFit } from './layout';
import { registerTestState } from './testhook';

export const BENCH_DURATION_S = 10;

export interface Keyframe {
  /** Seconds from the start of the run. */
  t: number;
  /** Look-at ground point in client metres. */
  x: number;
  z: number;
  /** Visible ground width, metres. */
  width: number;
}

/**
 * Fixed benchmark path: a diagonal pan across the pilot area while zooming from 600 m to 4000 m
 * and back to 600 m. Positions are clamped to the manifest bounds by the camera rig.
 */
export const BENCH_KEYFRAMES: readonly Keyframe[] = [
  { t: 0, x: -400, z: -400, width: 600 },
  { t: 5, x: 400, z: 400, width: 4000 },
  { t: BENCH_DURATION_S, x: -400, z: -400, width: 600 },
];

/** Deterministic camera pose at time t (seconds): linear in position, geometric in width. */
export function benchPose(
  tSec: number,
  keys: readonly Keyframe[] = BENCH_KEYFRAMES,
): { x: number; z: number; width: number } {
  const first = keys[0] as Keyframe;
  const last = keys[keys.length - 1] as Keyframe;
  if (tSec <= first.t) return { x: first.x, z: first.z, width: first.width };
  if (tSec >= last.t) return { x: last.x, z: last.z, width: last.width };
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1] as Keyframe;
    const b = keys[i] as Keyframe;
    if (tSec <= b.t) {
      const u = (tSec - a.t) / (b.t - a.t);
      return {
        x: a.x + (b.x - a.x) * u,
        z: a.z + (b.z - a.z) * u,
        width: a.width * Math.pow(b.width / a.width, u),
      };
    }
  }
  return { x: last.x, z: last.z, width: last.width };
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

/** Percentile p (0..100) with linear interpolation between order statistics. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const pos = ((s.length - 1) * p) / 100;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return (s[lo] as number) + ((s[hi] as number) - (s[lo] as number)) * (pos - lo);
}

export interface BenchResults {
  frames: number;
  durationS: number;
  meanFps: number;
  p5Fps: number;
  meanFrameMs: number;
  p95FrameMs: number;
  maxDrawCalls: number;
  maxTriangles: number;
}

/** Summarise per-frame times (ms between consecutive rendered frames). */
export function summarise(
  frameMs: readonly number[],
  maxDrawCalls: number,
  maxTriangles: number,
): BenchResults {
  const total = frameMs.reduce((a, b) => a + b, 0);
  const meanMs = mean(frameMs);
  return {
    frames: frameMs.length,
    durationS: total / 1000,
    meanFps: 1000 / meanMs,
    p5Fps: percentile(
      frameMs.map((ms) => 1000 / ms),
      5,
    ),
    meanFrameMs: meanMs,
    p95FrameMs: percentile(frameMs, 95),
    maxDrawCalls,
    maxTriangles,
  };
}

export interface DebugContext {
  renderInfo: () => { calls: number; triangles: number };
  tiles: () => { loaded: number; loading: number; failed: number; visible: number };
  camera: () => { target: [number, number]; visibleWidth: number; azimuthDeg: number };
  canvas: HTMLCanvasElement;
  pixelRatio: () => number;
  /** Move the camera (clamped by the rig) and apply it. */
  setView: (x: number, z: number, width: number) => void;
  requestRender: () => void;
  addFrameHook: (hook: () => void) => void;
}

type BenchState = { status: 'idle' | 'running' | 'done'; results: BenchResults | null };

export function initDebug(ctx: DebugContext, bench: boolean): void {
  const root = document.createElement('section');
  root.id = 'debug-overlay';
  root.setAttribute('aria-label', t('debugTitle'));
  root.style.cssText =
    'position:fixed;right:6px;top:108px;z-index:10;box-sizing:border-box;max-width:min(380px,calc(100vw - 12px));' +
    'max-height:calc(100vh - 108px - var(--band, 56px));overflow:auto;background:rgba(20,24,28,0.85);color:#e8f5e9;' +
    'font:11px/1.35 monospace;padding:6px 8px;border-radius:3px;';

  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:4px;';
  const title = document.createElement('strong');
  title.textContent = t('debugTitle');
  title.style.flex = '1';
  const benchBtn = document.createElement('button');
  benchBtn.type = 'button';
  benchBtn.id = 'debug-bench';
  benchBtn.textContent = t('benchmark');
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.id = 'debug-close';
  closeBtn.textContent = '×';
  closeBtn.setAttribute('aria-label', t('close'));
  bar.append(title, benchBtn, closeBtn);

  const live = document.createElement('pre');
  live.id = 'debug-live';
  live.style.cssText = 'margin:0;white-space:pre-wrap;';
  const out = document.createElement('pre');
  out.id = 'debug-bench-results';
  out.style.cssText = 'margin:4px 0 0;white-space:pre-wrap;';
  root.append(bar, live, out);
  document.body.appendChild(root);

  /**
   * Above the attribution band (T-5.7, T-5.8), never in it, at every size: at the bottom, so it never covers
   * the toolbar zone, the card or the controls at the right (layout.ts keeps them above it). Narrow
   * screens: bottom left. Wide screens: bottom right. Where the room is short (a bottom sheet, or under
   * 600 px high) it is collapsed to its title bar, one line: the numbers are in the DOM but not drawn.
   */
  function place(): void {
    const sheet = window.matchMedia(SHEET_QUERY).matches;
    const compact = sheet || window.innerHeight < 600;
    live.style.display = compact ? 'none' : '';
    out.style.display = compact ? 'none' : '';
    bar.style.marginBottom = compact ? '0' : '4px';
    root.style.top = 'auto';
    root.style.bottom = 'var(--band, 56px)';
    root.style.left = sheet ? '6px' : 'auto';
    root.style.right = sheet ? 'auto' : '6px';
    root.style.maxHeight = compact ? 'none' : 'min(28vh, calc(100vh - var(--band, 56px) - 150px))';
    requestFit();
  }
  place();
  window.addEventListener('resize', place);
  const attributionEl = document.getElementById('attribution');
  if (attributionEl && typeof ResizeObserver !== 'undefined') new ResizeObserver(place).observe(attributionEl);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(requestFit).observe(root);
  onLangChange(() => {
    root.setAttribute('aria-label', t('debugTitle'));
    title.textContent = t('debugTitle');
    benchBtn.textContent = t('benchmark');
    closeBtn.setAttribute('aria-label', t('close'));
    drawResults();
  });

  let state: BenchState = { status: 'idle', results: null };
  registerTestState('bench', () => state);

  let lastFrameAt = 0;
  let lastFrameMs = 0;
  let runStart = 0;
  let frameMs: number[] = [];
  let maxCalls = 0;
  let maxTris = 0;

  const fmt = (n: number, d = 1): string => (Number.isFinite(n) ? n.toFixed(d) : '-');

  function drawLive(): void {
    const info = ctx.renderInfo();
    const tl = ctx.tiles();
    const cam = ctx.camera();
    live.textContent =
      `frame ${fmt(lastFrameMs)} ms (${fmt(lastFrameMs > 0 ? 1000 / lastFrameMs : NaN, 0)} fps)\n` +
      `draw calls ${info.calls}  triangles ${info.triangles}\n` +
      `tiles loaded ${tl.loaded} loading ${tl.loading} failed ${tl.failed} visible ${tl.visible}\n` +
      `target ${fmt(cam.target[0], 0)}, ${fmt(cam.target[1], 0)} m  width ${fmt(cam.visibleWidth, 0)} m  az ${fmt(cam.azimuthDeg, 0)}\n` +
      `dpr ${ctx.pixelRatio()} (device ${window.devicePixelRatio})  canvas ${ctx.canvas.width}x${ctx.canvas.height}`;
  }

  function drawResults(): void {
    const r = state.results;
    if (state.status === 'running') {
      out.textContent = t('benchRunning');
    } else if (r) {
      out.textContent =
        `fps mean ${fmt(r.meanFps)}  p5 ${fmt(r.p5Fps)}\n` +
        `frame ms mean ${fmt(r.meanFrameMs)}  p95 ${fmt(r.p95FrameMs)}\n` +
        `max draw calls ${r.maxDrawCalls}  max triangles ${r.maxTriangles}\n` +
        `frames ${r.frames} in ${fmt(r.durationS)} s`;
    } else {
      out.textContent = '';
    }
  }

  function startBench(): void {
    if (state.status === 'running') return;
    state = { status: 'running', results: null };
    frameMs = [];
    maxCalls = 0;
    maxTris = 0;
    runStart = 0;
    lastFrameAt = 0;
    benchBtn.disabled = true;
    drawResults();
    ctx.requestRender();
  }

  ctx.addFrameHook(() => {
    const now = performance.now();
    lastFrameMs = lastFrameAt > 0 ? now - lastFrameAt : 0;
    lastFrameAt = now;
    const info = ctx.renderInfo();
    if (state.status === 'running') {
      const first = runStart === 0;
      if (first) {
        runStart = now; // the first frame only sets the time origin
      } else {
        frameMs.push(lastFrameMs);
        maxCalls = Math.max(maxCalls, info.calls);
        maxTris = Math.max(maxTris, info.triangles);
      }
      const elapsed = (now - runStart) / 1000;
      if (!first && elapsed >= BENCH_DURATION_S) {
        state = { status: 'done', results: summarise(frameMs, maxCalls, maxTris) };
        benchBtn.disabled = false;
        drawResults();
      } else {
        const p = benchPose(elapsed);
        ctx.setView(p.x, p.z, p.width);
        ctx.requestRender(); // continuous rendering only while the benchmark runs
      }
    }
    drawLive();
  });

  benchBtn.addEventListener('click', startBench); // Enter on the focused button also clicks
  closeBtn.addEventListener('click', () => root.remove());

  drawLive();
  ctx.requestRender();
  if (bench) startBench();
}
