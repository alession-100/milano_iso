import { describe, expect, it } from 'vitest';
import {
  type Manifest,
  ManifestError,
  assetUrl,
  attributionUrl,
  contentBounds,
  indexUrl,
  levelSpecs,
  minimapUrl,
  parseManifest,
  parseShard,
  resolveTilesBase,
} from './manifest';

const SHA = 'a'.repeat(64);

const SHARD_REC = {
  level: 0,
  id: 'S0_0_-1',
  file: 'shards/S0_0_-1.json',
  bytes: 900,
  sha256: 'b'.repeat(64),
  tiles: 2,
  content_bbox_local: { min: [-5, 0, -260], max: [500, 30, 3] },
};

function valid(): Record<string, unknown> {
  return {
    format_version: 2,
    axis: 'x=E-E0, y=up, z=-(N-N0)',
    quantization: { unit_m: 0.02, anchor: 'tile_center' },
    tile_size_m: 250,
    layers: ['buildings'],
    attribution: [{ source: 'OpenStreetMap', licence: 'ODbL 1.0', text: '(c) OpenStreetMap contributors' }],
    bounds_local: [-5, -260, 500, 3],
    shards: [{ ...SHARD_REC }],
  };
}

function shardDoc(): Record<string, unknown> {
  return {
    format_version: 2,
    id: 'S0_0_-1',
    level: 0,
    tiles: [
      {
        id: '0_0',
        i: 0,
        j: 0,
        content_bbox_local: { min: [-5, 0, -250], max: [250, 30, 3] },
        glb: { file: '0_0.glb', sha256: SHA },
        features: { file: '0_0.json', sha256: SHA },
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
    expect(indexUrl(m, base)?.href).toBe('https://example.test/tiles/pilot/index.json?v=aaaaaaaaaaaa');
    expect(minimapUrl(m, base)?.href).toBe('https://example.test/tiles/pilot/minimap.svg?v=aaaaaaaaaaaa');
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
  it('accepts a valid root manifest', () => {
    expect(parseManifest(valid()).shards).toHaveLength(1);
  });
  it('rejects a wrong format_version (the old single-file format 1 included)', () => {
    const m = valid();
    m.format_version = 1;
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
  it('rejects non-objects, missing shards and bad bounds', () => {
    expect(() => parseManifest(null)).toThrow(ManifestError);
    expect(() => parseManifest([])).toThrow(ManifestError);
    const m = valid();
    m.shards = [];
    expect(() => parseManifest(m)).toThrow(/shards/);
    const n = valid();
    n.bounds_local = [1, 2, 3];
    expect(() => parseManifest(n)).toThrow(/bounds_local/);
  });
  it('rejects a malformed shard record', () => {
    const bad = (mutate: (r: Record<string, unknown>) => void): void => {
      const m = valid();
      mutate((m.shards as Record<string, unknown>[])[0]);
      expect(() => parseManifest(m)).toThrow(/shard record invalid/);
    };
    bad((r) => {
      r.file = '../tiles.json';
    });
    bad((r) => {
      r.file = 'S0_0_0.json';
    });
    bad((r) => {
      r.sha256 = 'xyz';
    });
    bad((r) => {
      r.level = -1;
    });
    bad((r) => {
      r.content_bbox_local = { min: [0, 0], max: [1, 1, 1] };
    });
  });
});

describe('parseShard', () => {
  it('returns the tile entries stamped with the level of the shard', () => {
    const tiles = parseShard(shardDoc(), SHARD_REC as never);
    expect(tiles.map((t) => `${t.id}:${t.level}`)).toEqual(['0_0:0', '1_0:0']);
  });
  it('rejects a shard that does not match its record, or has a bad tile', () => {
    const rec = SHARD_REC as never;
    expect(() => parseShard({ ...shardDoc(), id: 'S0_1_1' }, rec)).toThrow(/differs from the root/);
    expect(() => parseShard({ ...shardDoc(), level: 1 }, rec)).toThrow(/differs from the root/);
    expect(() => parseShard({ ...shardDoc(), format_version: 1 }, rec)).toThrow(ManifestError);
    expect(() => parseShard({ ...shardDoc(), tiles: [] }, rec)).toThrow(/tiles missing/);
    const d = shardDoc();
    (d.tiles as Record<string, unknown>[])[0].content_bbox_local = { min: [0, 0], max: [1, 1, 1] };
    expect(() => parseShard(d, rec)).toThrow(/content_bbox_local/);
    const e = shardDoc();
    (e.tiles as Record<string, unknown>[])[1].glb = {};
    expect(() => parseShard(e, rec)).toThrow(/glb.file/);
  });
});

describe('assetUrl (cache busting by content hash, T-6.3)', () => {
  const base = new URL('https://example.test/tiles/city/');
  it('adds the first 12 hex digits of the sha256 as ?v=', () => {
    expect(assetUrl(base, '0_0.glb', SHA).href).toBe('https://example.test/tiles/city/0_0.glb?v=aaaaaaaaaaaa');
    expect(assetUrl(base, 'shards/S0_0_0.json', 'c0ffee'.padEnd(64, '1')).search).toBe('?v=c0ffee111111');
  });
  it('leaves the URL plain when there is no valid hash', () => {
    expect(assetUrl(base, '0_0.glb').href).toBe('https://example.test/tiles/city/0_0.glb');
    expect(assetUrl(base, '0_0.glb', 'xyz').search).toBe('');
  });
  it('a different content gives a different URL', () => {
    expect(assetUrl(base, 'a.glb', 'a'.repeat(64)).href).not.toBe(assetUrl(base, 'a.glb', 'b'.repeat(64)).href);
  });
});

describe('contentBounds', () => {
  it('is the extent of the base tiles given by the root (bounds_local)', () => {
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
  function withLevels(): Record<string, unknown> {
    const m = valid();
    m.levels = [
      { level: 0, tolerance_m: 0.2, block_m: 250 },
      { level: 1, tolerance_m: 1, block_m: 500 },
    ];
    return m;
  }
  it('a manifest without levels has the base level only', () => {
    expect(levelSpecs(parseManifest(valid()))).toEqual([{ level: 0, tolerance_m: 0 }]);
  });
  it('lists the levels with their tolerance', () => {
    expect(levelSpecs(parseManifest(withLevels()))).toEqual([
      { level: 0, tolerance_m: 0.2 },
      { level: 1, tolerance_m: 1 },
    ]);
  });
  it('rejects levels out of order, without a tolerance or with a falling tolerance', () => {
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
      l[1].tolerance_m = 0.1;
    });
  });
});
