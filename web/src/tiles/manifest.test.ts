import { describe, expect, it } from 'vitest';
import {
  type Manifest,
  ManifestError,
  attributionUrl,
  contentBounds,
  parseManifest,
  resolveTilesBase,
} from './manifest';

function valid(): Record<string, unknown> {
  return {
    format_version: 1,
    axis: 'x=E-E0, y=up, z=-(N-N0)',
    quantization: { unit_m: 0.02, anchor: 'tile_center' },
    tile_size_m: 250,
    layers: ['buildings'],
    attribution: [{ source: 'OpenStreetMap', licence: 'ODbL 1.0', text: '(c) OpenStreetMap contributors' }],
    tiles: [
      {
        id: '0_0',
        i: 0,
        j: 0,
        content_bbox_local: { min: [-5, 0, -250], max: [250, 30, 3] },
        glb: { file: '0_0.glb' },
        features: { file: '0_0.json' },
      },
      {
        id: '1_0',
        i: 1,
        j: 0,
        content_bbox_local: { min: [250, 0, -260], max: [500, 12, 0] },
        glb: { file: '1_0.glb' },
        features: { file: '1_0.json' },
      },
    ],
  };
}

describe('parseManifest', () => {
  it('accepts a valid manifest', () => {
    expect(parseManifest(valid()).tiles).toHaveLength(2);
  });
  it('rejects a wrong format_version', () => {
    const m = valid();
    m.format_version = 2;
    expect(() => parseManifest(m)).toThrow(ManifestError);
  });
  it('rejects a wrong quantization unit', () => {
    const m = valid();
    m.quantization = { unit_m: 0.01, anchor: 'tile_center' };
    expect(() => parseManifest(m)).toThrow(/unit_m/);
  });
  it('rejects a different axis convention', () => {
    const m = valid();
    m.axis = 'x=E, y=N, z=up';
    expect(() => parseManifest(m)).toThrow(/axis/);
  });
  it('rejects a tile without a valid content box', () => {
    const m = valid();
    (m.tiles as Record<string, unknown>[])[0].content_bbox_local = { min: [0, 0], max: [1, 1, 1] };
    expect(() => parseManifest(m)).toThrow(/content_bbox_local/);
  });
  it('rejects non-objects and empty tile lists', () => {
    expect(() => parseManifest(null)).toThrow(ManifestError);
    expect(() => parseManifest([])).toThrow(ManifestError);
    const m = valid();
    m.tiles = [];
    expect(() => parseManifest(m)).toThrow(/tiles/);
  });
});

describe('contentBounds', () => {
  it('is the union of the content boxes on x and z', () => {
    const m = parseManifest(valid()) as Manifest;
    expect(contentBounds(m)).toEqual({ minX: -5, maxX: 500, minZ: -260, maxZ: 3 });
  });
});

describe('resolveTilesBase', () => {
  it('defaults to tiles/pilot/ relative to the page', () => {
    expect(resolveTilesBase('', 'http://h/app/index.html').href).toBe('http://h/app/tiles/pilot/');
  });
  it('honours ?tiles= and adds a trailing slash', () => {
    expect(resolveTilesBase('?tiles=/fx/tiles', 'http://h/').href).toBe('http://h/fx/tiles/');
  });
});

describe('attributionUrl', () => {
  it('links OpenStreetMap and CC BY 4.0, uses an own http(s) url, ignores unsafe ones', () => {
    expect(attributionUrl({ source: 'OpenStreetMap', licence: 'ODbL 1.0', text: 'x' })).toBe(
      'https://www.openstreetmap.org/copyright',
    );
    expect(attributionUrl({ source: 'DBT', licence: 'CC BY 4.0', text: 'x' })).toBe(
      'https://creativecommons.org/licenses/by/4.0/',
    );
    expect(attributionUrl({ source: 'a', licence: 'b', text: 'x', url: 'https://e.org/' })).toBe(
      'https://e.org/',
    );
    expect(attributionUrl({ source: 'a', licence: 'b', text: 'x', url: 'javascript:alert(1)' })).toBe(
      undefined,
    );
  });
});
