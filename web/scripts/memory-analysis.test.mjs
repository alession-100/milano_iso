import { describe, expect, it } from 'vitest';
import { analyse, judgeNoDriver } from './memory-analysis.mjs';

const SAMPLE_S = 7;
/** Synthetic Playwright-style samples: every counter flat, `rendererSlope` and `heapSlope` (MB/min) are added linearly. */
function pwSamples(durationS, { rendererSlope = 0, heapSlope = 0 } = {}) {
  const out = [];
  for (let t = SAMPLE_S; t <= durationS; t += SAMPLE_S) {
    const phaseS = t % 50;
    out.push({
      t,
      phaseS,
      heapUsedMB: 10 + (heapSlope * t) / 60,
      heapAdjMB: 10 + (heapSlope * t) / 60,
      externalMB: 5,
      rendererMB: 300 + (rendererSlope * t) / 60,
      gpuProcessMB: 250,
      widthM: phaseS < 25 ? 250 + phaseS : 3900,
      maxGeomsPerTile: 5,
      cacheLimit: 64,
      peakWanted: 40,
      geometries: 100,
      tileGeometries: 100,
      textures: 150,
      tileTextures: 150,
      shardsLoaded: 52,
      tilesInScene: 64,
      programs: 6,
      domNodes: 74,
      nodes: 129,
    });
  }
  return out;
}
const run = (opts, durationS = 1200) => analyse(pwSamples(durationS, opts), durationS, SAMPLE_S);

describe('analyse (ADR-0043, renderer process amended by ADR-0044 b)', () => {
  it('passes a clean run', () => {
    const a = run({});
    expect(a.coverageOk).toBe(true);
    expect(a.pass).toBe(true);
  });
  it('fails a heap leak', () => {
    const a = run({ heapSlope: 2 });
    expect(a.heapAdjusted.pass).toBe(false);
    expect(a.pass).toBe(false);
  });
  it('passes a renderer slope of 3.5 MB/min with the driver as information', () => {
    const a = run({ rendererSlope: 3.5 });
    expect(a.rendererProcess.slopeMBPerMin).toBeCloseTo(3.5, 3);
    expect(a.rendererProcess.informationOnly).toMatch(/network agent/);
    expect(a.pass).toBe(true);
  });
  it('fails 5 MB/min with the driver (above the 250 MB/h ceiling)', () => {
    const a = run({ rendererSlope: 5 });
    expect(a.rendererProcess.pass).toBe(false);
    expect(a.pass).toBe(false);
  });
});

const REF = { frames: 120000, t: 1200 }; // 100 frames/s
function ndSamples(durationS, { rendererSlope = 0, hiddenAt = null, fps = 100 } = {}) {
  const out = [];
  for (let t = SAMPLE_S; t <= durationS; t += SAMPLE_S) {
    out.push({ t, rendererMB: 260 + (rendererSlope * t) / 60, frames: fps * t, visibility: t === hiddenAt ? 'hidden' : 'visible' });
  }
  return out;
}

describe('judgeNoDriver (ADR-0044 a)', () => {
  it('passes a flat 40-minute run with matching frames', () => {
    const j = judgeNoDriver(ndSamples(2400), 2400, REF);
    expect(j.valid).toBe(true);
    expect(j.pass).toBe(true);
  });
  it('is invalid with one hidden sample', () => {
    const j = judgeNoDriver(ndSamples(2400, { hiddenAt: 700 }), 2400, REF);
    expect(j.valid).toBe(false);
    expect(j.pass).toBe(false);
  });
  it('is invalid when the run is under 20 minutes', () => {
    expect(judgeNoDriver(ndSamples(1000), 1000, REF).valid).toBe(false);
  });
  it('is invalid when the frame count is more than 25 % off', () => {
    expect(judgeNoDriver(ndSamples(2400, { fps: 140 }), 2400, REF).valid).toBe(false);
    expect(judgeNoDriver(ndSamples(2400, { fps: 120 }), 2400, REF).valid).toBe(true);
  });
  it('fails 1.5 MB/min', () => {
    const j = judgeNoDriver(ndSamples(2400, { rendererSlope: 1.5 }), 2400, REF);
    expect(j.valid).toBe(true);
    expect(j.pass).toBe(false);
    expect(j.rendererSlopeFromMinute20MBPerMin).toBeCloseTo(1.5, 3);
  });
});
