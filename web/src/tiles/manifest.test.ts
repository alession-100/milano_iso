import { describe, expect, it } from 'vitest';
import {
  type Manifest,
  ManifestError,
  allTiles,
  attributionUrl,
  contentBounds,
  indexUrl,
  levelSpecs,
  minimapUrl,
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

const SHA = 'a'.repeat(64);

describe('index and minimap entries (T-5.3a)', () => {
  const base = new URL('https://example.test/tiles/pilot/');
  function withFiles(): Record<string, unknown> {
    const m = valid();
    m.index = { file: 'index.json', bytes: 10, gzip9_bytes: 5, sha256: SHA };
    m.minimap = { file: 'minimap.svg', bytes: 20, gzip9_bytes: 8, sha256: SHA };
    return m;
  }
  it('exposes both files and resolves their URLs next to the tiles', () => {
    const m = parseManifest(withFiles());
    expect(m.index?.file).toBe('index.json');
    expect(m.minimap?.gzip9_bytes).toBe(8);
    expect(indexUrl(m, base)?.href).toBe('https://example.test/tiles/pilot/index.json');
    expect(minimapUrl(m, base)?.href).toBe('https://example.test/tiles/pilot/minimap.svg');
  });
  it('still accepts a manifest without them (older tilesets)', () => {
    const m = parseManifest(valid());
    expect(m.index).toBeUndefined();
    expect(indexUrl(m, base)).toBeUndefined();
    expect(minimapUrl(m, base)).toBeUndefined();
  });
  it('rejects a malformed entry', () => {
    const m = withFiles();
    m.index = { file: 'index.json', bytes: 10, gzip9_bytes: 5, sha256: 'xyz' };
    expect(() => parseManifest(m)).toThrow(/index entry invalid/);
    const n = withFiles();
    n.minimap = { bytes: 1 };
    expect(() => parseManifest(n)).toThrow(/minimap entry invalid/);
  });
});

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

describe('levels of detail (T-6.2)', () => {
  const coarse = (id: string) => ({
    id,
    i: 0,
    j: 0,
    bbox_local: [0, -500, 500, 0],
    content_bbox_local: { min: [-5, 0, -500], max: [500, 30, 3] },
    glb: { file: `${id}.glb` },
    features: { file: `${id}.json` },
  });
  function withLevels(): Record<string, unknown> {
    const m = valid();
    m.levels = [
      { level: 0, tolerance_m: 0.2, block_m: 250 },
      { level: 1, tolerance_m: 1, block_m: 500, tiles: [coarse('L1_0_0')] },
    ];
    return m;
  }
  it('a manifest without levels has the base level only', () => {
    const m = parseManifest(valid());
    expect(levelSpecs(m)).toEqual([{ level: 0, tolerance_m: 0 }]);
    expect(allTiles(m).map((t) => t.level)).toEqual([0, 0]);
  });
  it('lists the levels with their tolerance and stamps every tile with its level', () => {
    const m = parseManifest(withLevels());
    expect(levelSpecs(m)).toEqual([
      { level: 0, tolerance_m: 0.2 },
      { level: 1, tolerance_m: 1 },
    ]);
    expect(allTiles(m).map((t) => `${t.id}:${t.level}`)).toEqual(['0_0:0', '1_0:0', 'L1_0_0:1']);
  });
  it('rejects levels out of order, without a tolerance, without tiles or with a falling tolerance', () => {
    const bad = (mutate: (l: Record<string, unknown>[]) => void): void => {
      const m = withLevels();
      mutate(m.levels as Record<string, unknown>[]);
      expect(() => parseManifest(m)).toThrow(ManifestError);
    };
    bad((l) => {
      l[1].level = 3;
    });
    bad((l) => {
      delete l[1].tolerance_m;
    });
    bad((l) => {
      l[1].tiles = [];
    });
    bad((l) => {
      l[1].tolerance_m = 0.1;
    });
    bad((l) => {
      (l[1].tiles as Record<string, unknown>[])[0].glb = {};
    });
  });
});
