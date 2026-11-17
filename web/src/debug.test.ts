import { describe, expect, it } from 'vitest';
import { BENCH_DURATION_S, BENCH_KEYFRAMES, benchPose, mean, percentile, summarise } from './debug';

describe('statistics', () => {
  it('mean', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(mean([])).toBeNaN();
  });

  it('percentile on known arrays (linear interpolation)', () => {
    const a = Array.from({ length: 101 }, (_, i) => i); // 0..100
    expect(percentile(a, 5)).toBe(5);
    expect(percentile(a, 95)).toBe(95);
    expect(percentile([10, 20, 30, 40], 50)).toBe(25);
    expect(percentile([40, 10, 30, 20], 0)).toBe(10); // unsorted input
    expect(percentile([40, 10, 30, 20], 100)).toBe(40);
    expect(percentile([7], 95)).toBe(7);
  });

  it('summarise', () => {
    const ms = [10, 10, 10, 20]; // fps 100,100,100,50
    const r = summarise(ms, 12, 3456);
    expect(r.frames).toBe(4);
    expect(r.meanFrameMs).toBe(12.5);
    expect(r.meanFps).toBeCloseTo(80, 9);
    expect(r.p5Fps).toBeCloseTo(50 + 0.15 * 50, 9); // pos 0.15 between 50 and 100
    expect(r.p95FrameMs).toBeCloseTo(10 + 0.85 * 10, 9); // pos 2.85 between 10 and 20
    expect(r.durationS).toBeCloseTo(0.05, 12);
    expect(r.maxDrawCalls).toBe(12);
    expect(r.maxTriangles).toBe(3456);
  });
});

describe('benchmark path', () => {
  it('has fixed keyframes from 600 m to 4000 m and back over 10 s', () => {
    expect(BENCH_DURATION_S).toBe(10);
    expect(BENCH_KEYFRAMES.map((k) => [k.t, k.x, k.z, k.width])).toEqual([
      [0, -400, -400, 600],
      [5, 400, 400, 4000],
      [10, -400, -400, 600],
    ]);
  });

  it('is deterministic and hits the keyframes', () => {
    expect(benchPose(0)).toEqual({ x: -400, z: -400, width: 600 });
    expect(benchPose(5)).toEqual({ x: 400, z: 400, width: 4000 });
    expect(benchPose(10)).toEqual({ x: -400, z: -400, width: 600 });
    expect(benchPose(99)).toEqual({ x: -400, z: -400, width: 600 });
    const a = Array.from({ length: 101 }, (_, i) => benchPose(i / 10));
    const b = Array.from({ length: 101 }, (_, i) => benchPose(i / 10));
    expect(a).toEqual(b);
    const mid = benchPose(2.5);
    expect(mid.x).toBeCloseTo(0, 9);
    expect(mid.width).toBeCloseTo(Math.sqrt(600 * 4000), 6);
  });
});
