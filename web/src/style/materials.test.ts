import { describe, expect, it } from 'vitest';
import { LOOKUP_WIDTH, colourIndices, layerOf, packLookup } from './materials';
import { paletteIndex } from './palette';

describe('colourIndices', () => {
  it('gives the palette index of each building, landmark first', () => {
    const idx = colourIndices('buildings', [
      { building_type: 'apartments', landmark_id: null },
      { building_type: 'yes', landmark_id: null },
      { building_type: 'church', landmark_id: 'lm:x' },
      { building_type: null, landmark_id: null },
    ]);
    expect(Array.from(idx)).toEqual([
      paletteIndex('buildingResidential'),
      paletteIndex('buildingOther'),
      paletteIndex('landmark'),
      paletteIndex('buildingOther'),
    ]);
  });

  it('gives the palette index of each road class group', () => {
    const idx = colourIndices('roads', [{ class: 'primary' }, { class: 'service' }, { class: 'steps' }]);
    expect(Array.from(idx)).toEqual([
      paletteIndex('roadMajor'),
      paletteIndex('roadMinor'),
      paletteIndex('roadPedestrian'),
    ]);
  });
});

describe('packLookup', () => {
  it('packs one byte per feature into a zero-padded W x H array', () => {
    const { data, width, height } = packLookup(Uint8Array.from([9, 13, 14]), 4);
    expect([width, height]).toEqual([4, 1]);
    expect(Array.from(data)).toEqual([9, 13, 14, 0]);
  });

  it('wraps into rows after LOOKUP_WIDTH features', () => {
    const n = LOOKUP_WIDTH + 2;
    const src = Uint8Array.from({ length: n }, (_, i) => i % 7);
    const { data, width, height } = packLookup(src);
    expect([width, height, data.length]).toEqual([LOOKUP_WIDTH, 2, 2 * LOOKUP_WIDTH]);
    expect(data[LOOKUP_WIDTH + 1]).toBe(src[LOOKUP_WIDTH + 1]);
    expect(data[2 * LOOKUP_WIDTH - 1]).toBe(0);
  });

  it('is never empty', () => {
    expect(packLookup(new Uint8Array(0)).data.length).toBe(LOOKUP_WIDTH);
  });
});

describe('layerOf', () => {
  it('strips the chunk suffix', () => {
    expect(layerOf('buildings#2')).toBe('buildings');
    expect(layerOf('roads')).toBe('roads');
  });
});
