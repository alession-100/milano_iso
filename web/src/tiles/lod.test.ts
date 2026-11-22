import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CameraRig, createCamera } from '../camera';
import { cullTiles, frustumOf } from './culling';
import { LodController } from './lod';
import type { TileStreamer } from './loader';
import { type Manifest, type ShardRecord, type TileEntry, parseManifest } from './manifest';

function entry(id: string, level: number, x0: number, z0: number, x1: number, z1: number): TileEntry {
  return {
    id,
    i: 0,
    j: 0,
    level,
    bbox_local: [x0, z0, x1, z1],
    content_bbox_local: { min: [x0, 0, z0], max: [x1, 20, z1] },
    glb: { file: `${id}.glb` },
    features: { file: `${id}.json` },
  };
}

// Two base tiles side by side (z from -250 to 0) and one 500 m block over both.
const BASE = [entry('0_0', 0, 0, -250, 250, 0), entry('1_0', 0, 250, -250, 500, 0)];
const BLOCK = entry('L1_0_0', 1, 0, -500, 500, 0);

const SHA = 'c'.repeat(64);

function shardRecord(level: number, id: string, tiles: TileEntry[]): ShardRecord {
  const min = [Math.min(...tiles.map((t) => t.content_bbox_local.min[0])), 0, Math.min(...tiles.map((t) => t.content_bbox_local.min[2]))];
  const max = [Math.max(...tiles.map((t) => t.content_bbox_local.max[0])), 20, Math.max(...tiles.map((t) => t.content_bbox_local.max[2]))];
  return {
    level,
    id,
    file: `shards/${id}.json`,
    bytes: 100,
    sha256: SHA,
    tiles: tiles.length,
    content_bbox_local: { min, max } as ShardRecord['content_bbox_local'],
  };
}

// One shard per level: the base tiles, and the block.
const SHARDS = new Map<string, TileEntry[]>([
  ['S0_0_-1', BASE],
  ['S1_0_-1', [BLOCK]],
]);

function manifest(withLevels = true): Manifest {
  return parseManifest({
    format_version: 2,
    axis: 'x=E-E0, y=up, z=-(N-N0)',
    quantization: { unit_m: 0.02, anchor: 'tile_center' },
    tile_size_m: 250,
    layers: ['buildings'],
    attribution: [{ source: 'OpenStreetMap', licence: 'ODbL 1.0', text: '(c) OpenStreetMap contributors' }],
    bounds_local: [0, -250, 500, 0],
    shards: [shardRecord(0, 'S0_0_-1', BASE), ...(withLevels ? [shardRecord(1, 'S1_0_-1', [BLOCK])] : [])],
    ...(withLevels
      ? {
          levels: [
            { level: 0, tolerance_m: 0.2, block_m: 250 },
            { level: 1, tolerance_m: 1, block_m: 500 },
          ],
        }
      : {}),
  });
}

/** Shard fetches that answer at once; `requested` lists the shards asked for. */
function shardOptions() {
  const requested: string[] = [];
  let changed = 0;
  return {
    requested,
    changes: () => changed,
    opts: {
      fetchShard: (rec: ShardRecord) => {
        requested.push(rec.id);
        return Promise.resolve((SHARDS.get(rec.id) ?? []).map((t) => ({ ...t, level: rec.level })));
      },
      onShardsChanged: () => {
        changed += 1;
      },
    },
  };
}

const flush = async (): Promise<void> => {
  for (let k = 0; k < 5; k++) await Promise.resolve();
};

/** A streamer stand-in: tiles are "loaded" when the test says so; update() records what was asked. */
function fakeStreamer() {
  const loaded = new Map<string, THREE.Group>();
  const asked: { wanted: string[]; visible: string[] }[] = [];
  const streamer = {
    update: (wanted: string[], visible: Iterable<string>) => asked.push({ wanted, visible: [...visible] }),
    addTiles: () => undefined,
    loadedIds: () => [...loaded.keys()],
    isLoaded: (id: string) => loaded.has(id),
    isFailed: () => false,
    stats: { completed: 0, failed: 0 },
    get: (id: string) => loaded.get(id),
  };
  return { loaded, asked, streamer: streamer as unknown as TileStreamer<THREE.Object3D> };
}

function view(width: number): THREE.Frustum {
  const cam = createCamera(16 / 9, 30);
  const rig = new CameraRig(cam, 30);
  rig.setBounds({ minX: -1e5, maxX: 1e5, minZ: -1e5, maxZ: 1e5 });
  rig.target = [250, -125];
  rig.visibleWidth = width;
  rig.apply();
  return frustumOf(cam);
}

describe('LodController', () => {
  /** A controller whose shards of the first update have arrived, and the second update done. */
  async function ready(width: number, mpp: number, withLevels = true) {
    const f = fakeStreamer();
    const sh = shardOptions();
    const lod = new LodController(manifest(withLevels), f.streamer, sh.opts);
    lod.update(view(width), mpp, 250, -125); // asks for the shards of the level
    await flush();
    return { ...f, ...sh, lod, again: () => lod.update(view(width), mpp, 250, -125) };
  }

  it('asks for the shards of the level in view first, and for its tiles once they are known', async () => {
    const { lod, asked, requested, changes, again } = await ready(400, 0.3);
    expect(requested).toEqual(['S0_0_-1']); // only the base level's shard
    expect(asked[0].wanted).toEqual([]); // the tile entries were not known yet
    expect(lod.state()).toMatchObject({ level: 0, shardsPending: 0, pending: 0 });
    expect(changes()).toBe(1); // the arrival asks the caller to cull again
    again();
    expect(asked[1].wanted.every((id) => !id.startsWith('L1'))).toBe(true);
    expect(asked[1].wanted).toContain('0_0');
    expect(lod.state().tolerances).toEqual([0.2, 1]);
  });

  it('asks for the tiles in view first, nearest first, and the prefetch ring only after them', async () => {
    // a row of 8 base tiles along x; the view (about 400 m wide) sees the middle ones only
    const row = Array.from({ length: 8 }, (_, k) => entry(`${k}_0`, 0, k * 250, -250, (k + 1) * 250, 0));
    const f = fakeStreamer();
    const lod = new LodController(
      parseManifest({
        format_version: 2,
        axis: 'x=E-E0, y=up, z=-(N-N0)',
        quantization: { unit_m: 0.02, anchor: 'tile_center' },
        tile_size_m: 250,
        layers: ['buildings'],
        attribution: [{ source: 'OpenStreetMap', licence: 'ODbL 1.0', text: '(c) OpenStreetMap contributors' }],
        bounds_local: [0, -250, 2000, 0],
        shards: [shardRecord(0, 'S0_0_-1', row)],
      }),
      f.streamer,
      { fetchShard: () => Promise.resolve(row.map((t) => ({ ...t, level: 0 }))) },
    );
    const frustum = view(400);
    lod.update(frustum, 0.3, 1000, -125);
    await flush();
    lod.update(frustum, 0.3, 1000, -125);
    const { visible, wanted } = cullTiles(row, frustum, 250);
    expect(visible.length).toBeGreaterThan(0);
    expect(wanted.length).toBeGreaterThan(visible.length); // there is a ring
    const asked = f.asked[f.asked.length - 1].wanted;
    expect(asked).toHaveLength(wanted.length);
    expect(new Set(asked.slice(0, visible.length))).toEqual(new Set(visible)); // the view first
    const dist = (id: string): number => {
      const t = row.find((r) => r.id === id) as TileEntry;
      return Math.abs((t.content_bbox_local.min[0] + t.content_bbox_local.max[0]) / 2 - 1000);
    };
    const sorted = (ids: string[]): boolean => ids.every((id, k) => k === 0 || dist(ids[k - 1]) <= dist(id));
    expect(sorted(asked.slice(0, visible.length))).toBe(true); // each part nearest first
    expect(sorted(asked.slice(visible.length))).toBe(true);
  });

  it('counts a shard that is still on its way as pending, so the view is not complete', () => {
    const f = fakeStreamer();
    const lod = new LodController(manifest(), f.streamer, {
      fetchShard: () => new Promise<TileEntry[]>(() => undefined), // never answers
    });
    lod.update(view(400), 0.3, 250, -125);
    expect(lod.state()).toMatchObject({ visible: 0, pending: 1, shardsPending: 1 });
    expect(lod.state().shards).toMatchObject({ started: 1, completed: 0, loading: 1 });
  });

  it('uses the coarse level where the metres per pixel reach its tolerance', async () => {
    const { lod, asked, requested, again } = await ready(1400, 1.1);
    expect(lod.state().level).toBe(1);
    expect(requested).toEqual(['S1_0_-1']); // not the base shard
    again();
    expect(asked[1].wanted).toContain('L1_0_0');
  });

  it('cancels the shard request of a level the view has left, and can ask for it again', () => {
    const f = fakeStreamer();
    const signals: AbortSignal[] = [];
    const lod = new LodController(manifest(), f.streamer, {
      fetchShard: (_rec, signal) => {
        signals.push(signal);
        return new Promise<TileEntry[]>(() => undefined);
      },
    });
    lod.update(view(400), 0.3, 250, -125); // base shard requested
    lod.update(view(1400), 1.1, 250, -125); // the coarse level replaces it before it arrived
    expect(signals.map((s) => s.aborted)).toEqual([true, false]);
    expect(lod.state().shards).toMatchObject({ started: 2, cancelled: 1, loading: 1 });
    lod.update(view(400), 0.3, 250, -125); // back: the base shard is requested again
    expect(signals.map((s) => s.aborted)).toEqual([true, true, false]);
    expect(lod.state().shards).toMatchObject({ started: 3, cancelled: 2 });
  });

  it('keeps the base tiles drawn until the block has loaded, then hides them', async () => {
    const { lod, loaded, again } = await ready(1400, 1.1); // level 1 chosen; its shard is in
    // the base shard is not loaded here, so register the base tiles through a base-level view
    lod.update(view(400), 0.3, 250, -125);
    await flush();
    for (const t of BASE) loaded.set(t.id, group(true));
    lod.update(view(1400), 1.1, 250, -125); // level 1 chosen, block missing
    expect(loaded.get('0_0')?.visible).toBe(true);
    expect(loaded.get('1_0')?.visible).toBe(true);
    expect(lod.state()).toMatchObject({ level: 1, pending: 1, drawnByLevel: { 0: 2 } });
    loaded.set('L1_0_0', group(true)); // the block arrives
    expect(lod.apply()).toBe(true);
    expect(loaded.get('L1_0_0')?.visible).toBe(true);
    expect(loaded.get('0_0')?.visible).toBe(false);
    expect(loaded.get('1_0')?.visible).toBe(false);
    expect(lod.state()).toMatchObject({ pending: 0, drawnByLevel: { 1: 1 }, loadedByLevel: { 0: 2, 1: 1 } });
    again();
  });

  it('a manifest without levels behaves as before: base tiles only, all drawn', async () => {
    const { lod, loaded, again } = await ready(4000, 9, false);
    for (const t of BASE) loaded.set(t.id, group(false));
    again();
    expect(lod.state().level).toBe(0);
    expect(loaded.get('0_0')?.visible).toBe(true);
  });
});

/** A loaded tile stand-in: an empty group (no mesh, so the count uses the manifest). */
function group(visible: boolean): THREE.Group {
  const g = new THREE.Group();
  g.visible = visible;
  return g;
}
