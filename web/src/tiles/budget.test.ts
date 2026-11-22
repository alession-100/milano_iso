import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CameraRig, createCamera } from '../camera';
import { frustumOf } from './culling';
import {
  BUDGET_HYSTERESIS,
  BUDGET_MAX_LEVEL,
  type Cell,
  DRAW_CALL_CAP,
  NON_TILE_CALLS,
  chooseBudgetLevel,
  plannedCalls,
  tileCalls,
} from './levels';
import { LodController } from './lod';
import type { TileStreamer } from './loader';
import { type ShardRecord, type TileEntry, parseManifest } from './manifest';

// T-6.5: the draw-call budget of a view (ADR-0040).

const ALL = ['buildings', 'landuse', 'green', 'water', 'road_areas', 'roads', 'markings', 'rail', 'landmark_details', 'trees'];

describe('tileCalls', () => {
  it('counts a base tile as buildings, one merged flat mesh, the layers never merged, and the shadow pass (T-6.5b)', () => {
    const counts = { buildings: 7, green: 3, roads: 167, markings: 20, trees: 8, water: 0 };
    expect(tileCalls(0, counts, ALL, false)).toBe(4); // buildings, merged (green, roads), markings, trees
    expect(tileCalls(0, counts, ALL, true)).toBe(5);
    expect(tileCalls(0, { roads: 2 }, ALL, true)).toBe(1); // no buildings, no shadow pass
    expect(tileCalls(0, { roads: 2, markings: 1, landmark_details: 4 }, ALL, false)).toBe(3);
    expect(tileCalls(0, { buildings: 1, landmark_details: 4 }, ALL, true)).toBe(3);
  });

  it('counts a coarse tile as its buildings plus one merged mesh, and the shadow pass', () => {
    const counts = { buildings: 37, green: 15, landuse: 6, road_areas: 15, roads: 157 };
    expect(tileCalls(1, counts, ALL, false)).toBe(2);
    expect(tileCalls(2, counts, ALL, true)).toBe(3);
    expect(tileCalls(3, { buildings: 1 }, ALL, false)).toBe(1);
    expect(tileCalls(3, { roads: 4, water: 1 }, ALL, false)).toBe(1);
  });

  it('assumes every layer when the entry has no counts', () => {
    expect(tileCalls(0, undefined, ALL, true)).toBe(1 + 1 + 3 + 1); // buildings, merged, markings + landmark_details + trees, shadow
    expect(tileCalls(2, undefined, ALL, false)).toBe(2);
  });
});

describe('plannedCalls', () => {
  it('adds up the calls of the tiles the plan draws', () => {
    const cells: Cell[] = [
      { id: 'a', level: 2, box: [0, 0, 1, 1] },
      { id: 'b', level: 2, box: [1, 0, 2, 1] },
    ];
    expect(plannedCalls(2, cells, (id) => (id === 'a' ? 3 : 2))).toBe(5);
    expect(plannedCalls(2, [], () => 3)).toBe(0);
  });
});

describe('chooseBudgetLevel', () => {
  const calls = (table: Record<number, number | null>) => (l: number) => (l in table ? (table[l] as number | null) : 0);

  it('keeps the level of the 1-pixel rule when its plan is within the cap', () => {
    expect(chooseBudgetLevel(2, 2, 3, calls({ 2: 280 }))).toBe(2);
    expect(chooseBudgetLevel(0, 0, 3, calls({ 0: 100 }))).toBe(0);
  });

  it('takes the next coarser level while the plan is over the cap, and never goes above level 3', () => {
    expect(chooseBudgetLevel(2, 2, 3, calls({ 2: 281, 3: 100 }))).toBe(3);
    expect(chooseBudgetLevel(1, 1, 3, calls({ 1: 400, 2: 300, 3: 120 }))).toBe(3);
    expect(chooseBudgetLevel(2, 2, 3, calls({ 2: 900, 3: 900 }))).toBe(3); // level 3 is the end
    expect(chooseBudgetLevel(3, 3, 3, calls({ 3: 900 }))).toBe(3);
    expect(BUDGET_MAX_LEVEL).toBe(3);
  });

  it('has a default cap of 280, and a custom one', () => {
    expect(DRAW_CALL_CAP).toBe(280);
    expect(chooseBudgetLevel(2, 2, 3, calls({ 2: 250, 3: 1 }), 200)).toBe(3);
  });

  it('hysteresis: a level left for the budget comes back only at 90 % of the cap', () => {
    const cap = 280;
    const back = cap * BUDGET_HYSTERESIS; // 252
    // in use: 3 (budget); level 2 would now cost 270: over 252, stay on 3
    expect(chooseBudgetLevel(2, 3, 3, calls({ 2: 270, 3: 100 }), cap)).toBe(3);
    // exactly at the return threshold: back to 2
    expect(chooseBudgetLevel(2, 3, 3, calls({ 2: back, 3: 100 }), cap)).toBe(2);
    // and a view that sits between 252 and 280 does not flicker: from 2 it stays 2, from 3 it stays 3
    for (const n of [253, 265, 280]) {
      expect(chooseBudgetLevel(2, 2, 3, calls({ 2: n, 3: 100 }), cap)).toBe(2);
      expect(chooseBudgetLevel(2, 3, 3, calls({ 2: n, 3: 100 }), cap)).toBe(3);
    }
  });

  it('while a plan is unknown: keep the coarser level in use, else take the level and ask again', () => {
    const unknown: number[] = [];
    // in use 3, base level 2 not known yet: stay on 3 and ask for level 2
    expect(chooseBudgetLevel(2, 3, 3, calls({ 2: null }), 280, unknown)).toBe(3);
    expect(unknown).toEqual([2]);
    // nothing coarser in use: take the base level (its tiles get requested)
    expect(chooseBudgetLevel(2, 0, 3, calls({ 2: null }), 280, [])).toBe(2);
    expect(chooseBudgetLevel(1, 1, 3, calls({ 1: null }), 280, [])).toBe(1);
    // T-6.5b: the level in use is over the cap and the coarser one is not known yet: the level in use stays, and the coarser one is asked for
    const ask: number[] = [];
    expect(chooseBudgetLevel(0, 0, 3, calls({ 0: 400, 1: null }), 280, ask)).toBe(0);
    expect(ask).toEqual([1]);
    expect(chooseBudgetLevel(0, 1, 3, calls({ 0: 400, 1: null }), 280, [])).toBe(1);
  });
});

// --- the controller ----------------------------------------------------------------------------------

const SHA = 'd'.repeat(64);
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
    counts: { buildings: 5, roads: 4, green: 2 },
  };
}
// level 1: four 500 m tiles over [0,1000] x [-1000,0]; level 2: one 1000 m tile; level 3: one 2000 m tile
const L1 = [
  entry('L1_0_0', 1, 0, -500, 500, 0),
  entry('L1_1_0', 1, 500, -500, 1000, 0),
  entry('L1_0_1', 1, 0, -1000, 500, -500),
  entry('L1_1_1', 1, 500, -1000, 1000, -500),
];
const L2 = [entry('L2_0_0', 2, 0, -1000, 1000, 0)];
const L3 = [entry('L3_0_0', 3, -500, -1500, 1500, 500)];
const L0 = [entry('0_0', 0, 0, -250, 250, 0)];
const SHARD_TILES = new Map<string, TileEntry[]>([
  ['S0_0_0', L0],
  ['S1_0_0', L1],
  ['S2_0_0', L2],
  ['S3_0_0', L3],
]);

function shardRecord(level: number, id: string, tiles: TileEntry[]): ShardRecord {
  const x0 = Math.min(...tiles.map((t) => t.content_bbox_local.min[0]));
  const z0 = Math.min(...tiles.map((t) => t.content_bbox_local.min[2]));
  const x1 = Math.max(...tiles.map((t) => t.content_bbox_local.max[0]));
  const z1 = Math.max(...tiles.map((t) => t.content_bbox_local.max[2]));
  return {
    level,
    id,
    file: `shards/${id}.json`,
    bytes: 100,
    sha256: SHA,
    tiles: tiles.length,
    content_bbox_local: { min: [x0, 0, z0], max: [x1, 20, z1] },
  };
}

function manifest() {
  return parseManifest({
    format_version: 2,
    axis: 'x=E-E0, y=up, z=-(N-N0)',
    quantization: { unit_m: 0.02, anchor: 'tile_center' },
    tile_size_m: 250,
    layers: ['buildings', 'green', 'roads'],
    attribution: [{ source: 'OpenStreetMap', licence: 'ODbL 1.0', text: '(c) OpenStreetMap contributors' }],
    bounds_local: [-500, -1500, 1500, 500],
    shards: [...SHARD_TILES].map(([id, tiles]) => shardRecord(tiles[0].level ?? 0, id, tiles)),
    levels: [
      { level: 0, tolerance_m: 0.2, block_m: 250 },
      { level: 1, tolerance_m: 1, block_m: 500 },
      { level: 2, tolerance_m: 2, block_m: 1000 },
      { level: 3, tolerance_m: 3, block_m: 2000 },
    ],
  });
}

function streamer() {
  const loaded = new Map<string, { visible: boolean }>();
  const s = {
    update: () => undefined,
    addTiles: () => undefined,
    loadedIds: () => [...loaded.keys()],
    isLoaded: (id: string) => loaded.has(id),
    isFailed: () => false,
    get: (id: string) => loaded.get(id),
  };
  return { loaded, streamer: s as unknown as TileStreamer<THREE.Object3D> };
}

function frustum(width: number, tx = 500, tz = -500): THREE.Frustum {
  const cam = createCamera(16 / 9, 30);
  const rig = new CameraRig(cam, 30);
  rig.setBounds({ minX: -1e5, maxX: 1e5, minZ: -1e5, maxZ: 1e5 });
  rig.target = [tx, tz];
  rig.visibleWidth = width;
  rig.apply();
  return frustumOf(cam);
}

const flush = async (): Promise<void> => {
  for (let k = 0; k < 8; k++) await Promise.resolve();
};

function controller(opts: { cap: number; hold?: Set<string>; nonTile?: number }) {
  const requested: string[] = [];
  const s = streamer();
  const lod = new LodController(manifest(), s.streamer, {
    cap: opts.cap,
    nonTileCalls: opts.nonTile ?? 0,
    castersBelowLevel: 3,
    fetchShard: (rec) => {
      requested.push(rec.id);
      if (opts.hold?.has(rec.id)) return new Promise<TileEntry[]>(() => undefined);
      return Promise.resolve((SHARD_TILES.get(rec.id) ?? []).map((t) => ({ ...t, level: rec.level })));
    },
  });
  return { lod, requested, ...s };
}

describe('LodController, draw-call budget', () => {
  it('adds the calls that are not tiles (ground plane, margin) to every plan', async () => {
    const { lod } = controller({ cap: 100, nonTile: NON_TILE_CALLS });
    lod.update(frustum(1400), 1.5, 500, -500);
    await flush();
    lod.update(frustum(1400), 1.5, 500, -500);
    expect(lod.state().estimatedCalls).toBe(12 + NON_TILE_CALLS);
    expect(NON_TILE_CALLS).toBe(3);
  });

  // mpp 1.5 asks for level 1 (tolerance 1 m, below level 2's 2 m); every coarse tile with buildings, roads
  // and green costs 3 calls at levels 1 and 2 (buildings, merged flat mesh, shadow pass)
  const MPP = 1.5;

  it('draws the level of the 1-pixel rule when its plan is within the cap', async () => {
    const { lod } = controller({ cap: 12 });
    lod.update(frustum(1400), MPP, 500, -500);
    await flush();
    lod.update(frustum(1400), MPP, 500, -500);
    expect(lod.state()).toMatchObject({ level: 1, baseLevel: 1, budgetSwitched: false, estimatedCalls: 12 });
  });

  it('draws the next coarser level when the plan is over the cap, and says so', async () => {
    const { lod, requested } = controller({ cap: 11 });
    lod.update(frustum(1400), MPP, 500, -500); // level 1 shards requested
    await flush();
    lod.update(frustum(1400), MPP, 500, -500); // level 1 costs 4 x 3 = 12 > 11: level 2 is asked for
    expect(requested).toEqual(['S1_0_0', 'S2_0_0']);
    // T-6.5b: level 2 is not known yet, so level 1 (its tiles are loaded) stays: no empty view while level 2 arrives
    expect(lod.state()).toMatchObject({ level: 1, baseLevel: 1, budgetSwitched: false });
    await flush();
    lod.update(frustum(1400), MPP, 500, -500);
    expect(lod.state()).toMatchObject({ level: 2, baseLevel: 1, budgetSwitched: true, estimatedCalls: 3 });
  });

  it('goes on to level 3 when level 2 is over the cap as well, and no further', async () => {
    const { lod } = controller({ cap: 2 });
    for (let k = 0; k < 4; k++) {
      lod.update(frustum(1400), MPP, 500, -500);
      await flush();
    }
    // level 1: 12, level 2: 3, both over 2; level 3 (no shadows, buildings + merged mesh = 2) is the last
    expect(lod.state()).toMatchObject({ level: 3, baseLevel: 1, budgetSwitched: true, estimatedCalls: 2 });
  });

  it('stays on the coarser level while the finer one is not known yet, then returns by the hysteresis rule', async () => {
    const { lod, requested } = controller({ cap: 11 });
    for (let k = 0; k < 3; k++) {
      lod.update(frustum(1400), MPP, 500, -500);
      await flush();
    }
    expect(lod.state()).toMatchObject({ level: 2, baseLevel: 1, budgetSwitched: true });
    // zoom in: the base level is 0 now, but its shard is not known yet: level 2 stays and level 0 is asked for
    lod.update(frustum(700, 125, -125), 0.5, 125, -125);
    expect(lod.state()).toMatchObject({ level: 2, baseLevel: 0, budgetSwitched: true });
    expect(requested).toContain('S0_0_0');
    await flush();
    // its plan is 1 tile x 3 calls (buildings, merged flat mesh, shadow pass), within 0.9 x 11: back to level 0
    lod.update(frustum(700, 125, -125), 0.5, 125, -125);
    expect(lod.state()).toMatchObject({ level: 0, baseLevel: 0, budgetSwitched: false, estimatedCalls: 3 });
  });
});
