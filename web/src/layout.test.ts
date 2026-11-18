import { describe, expect, it } from 'vitest';
import { CARD_FLOOR_PX, allocate, minimapWidthFor } from './layout';

describe('allocate (the toolbar zone and the card share the area above the band)', () => {
  it('gives the zone all the room when there is no bottom sheet', () => {
    expect(allocate(300, 200, null)).toEqual({ zoneMax: 300, cardMax: 0, short: false });
    expect(allocate(300, 340, null).short).toBe(true);
  });
  it('keeps both at their natural size when they fit with the 6 px gap', () => {
    expect(allocate(400, 200, 194)).toEqual({ zoneMax: 200, cardMax: 194, short: false });
  });
  it('serves the zone first and shrinks the card, down to its floor', () => {
    const a = allocate(400, 250, 200);
    expect(a.zoneMax).toBe(250);
    expect(a.cardMax).toBe(144); // 400 - 6 - 250
    const b = allocate(400, 380, 200);
    expect(b.cardMax).toBe(CARD_FLOOR_PX);
    expect(b.zoneMax).toBe(400 - 6 - CARD_FLOOR_PX);
    expect(b.short).toBe(true); // the zone has to scroll, shrink or yield
  });
  it('lets a card smaller than the floor keep its own height', () => {
    expect(allocate(100, 90, 40).cardMax).toBe(40);
  });
  it('never returns a negative zone height', () => {
    expect(allocate(10, 500, 500).zoneMax).toBeGreaterThanOrEqual(0);
  });
});

describe('minimapWidthFor', () => {
  it('is the width that makes the box the given height, within 80..200 px', () => {
    expect(minimapWidthFor(122, 1)).toBe(122); // (122 - 2) * 1 + 2
    expect(minimapWidthFor(20, 1)).toBe(80);
    expect(minimapWidthFor(900, 1)).toBe(200);
    expect(minimapWidthFor(102, 1.5)).toBe(152);
  });
});
