import { describe, expect, it } from 'vitest';
import { DEFAULT_ELEVATION_DEG, cameraDirection, parseElevation } from './camera';

describe('cameraDirection', () => {
  for (const elev of [30, 35.264]) {
    it(`matches trigonometry at elevation ${elev}`, () => {
      const el = (elev * Math.PI) / 180;
      const s = Math.SQRT1_2;
      const [x, y, z] = cameraDirection(45, elev);
      expect(Math.abs(x - Math.cos(el) * s)).toBeLessThan(1e-9);
      expect(Math.abs(y - Math.sin(el))).toBeLessThan(1e-9);
      expect(Math.abs(z - Math.cos(el) * s)).toBeLessThan(1e-9);
      expect(Math.abs(Math.hypot(x, y, z) - 1)).toBeLessThan(1e-9);
    });
  }
});

describe('parseElevation', () => {
  it('accepts 30 and 35.264', () => {
    expect(parseElevation('?elev=30')).toBe(30);
    expect(parseElevation('?elev=35.264')).toBe(35.264);
  });
  it('rejects other values and falls back to the default', () => {
    expect(DEFAULT_ELEVATION_DEG).toBe(30);
    for (const q of ['', '?elev=45', '?elev=abc', '?elev=', '?elev=35.26', '?elev=30.0001']) {
      expect(parseElevation(q)).toBe(DEFAULT_ELEVATION_DEG);
    }
  });
});
