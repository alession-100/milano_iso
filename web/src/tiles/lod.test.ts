import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CameraRig, createCamera } from '../camera';
import { frustumOf } from './culling';
import { LodController } from './lod';
import type { TileStreamer } from './loader';
import { type Manifest, type TileEntry, parseManifest } from './manifest';

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

function manifest(): Manifest {
  return parseManifest({
    format_version: 1,
    axis: 'x=E-E0, y=up, z=-(N-N0)',
    quantization: { unit_m: 0.02, anchor: 'tile_center' },
    tile_size_m: 250,
    layers: ['buildings'],
    attribution: [{ source: 'OpenStreetMap', licence: 'ODbL 1.0', text: '(c) OpenStreetMap contributors' }],
    tiles: BASE,
    levels: [
      { level: 0, tolerance_m: 0.2, block_m: 250 },
      { level: 1, tolerance_m: 1, block_m: 500, tiles: [BLOCK] },
    ],
  });
}

/** A streamer stand-in: tiles are "loaded" when the test says so; update() records what was asked. */
function fakeStreamer() {
  const loaded = new Map<string, { visible: boolean }>();
  const asked: { wanted: string[]; visible: string[] }[] = [];
  const streamer = {
    update: (wanted: string[], visible: Iterable<string>) => asked.push({ wanted, visible: [...visible] }),
    loadedIds: () => [...loaded.keys()],
    isLoaded: (id: string) => loaded.has(id),
    isFailed: () => false,
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
  it('uses the base level at a fine view and asks for base tiles only', () => {
    const { streamer, asked } = fakeStreamer();
    const lod = new LodController(manifest(), streamer);
    lod.update(view(400), 0.3, 250, -125);
    expect(lod.state().level).toBe(0);
    expect(asked[0].wanted.every((id) => !id.startsWith('L1'))).toBe(true);
    expect(lod.state().tolerances).toEqual([0.2, 1]);
  });

  it('uses the coarse level where the metres per pixel reach its tolerance', () => {
    const { streamer, asked } = fakeStreamer();
    const lod = new LodController(manifest(), streamer);
    lod.update(view(1400), 1.1, 250, -125);
    expect(lod.state().level).toBe(1);
    expect(asked[0].wanted).toContain('L1_0_0');
  });

  it('keeps the base tiles drawn until the block has loaded, then hides them', () => {
    const { streamer, loaded } = fakeStreamer();
    const lod = new LodController(manifest(), streamer);
    for (const t of BASE) loaded.set(t.id, { visible: true });
    lod.update(view(1400), 1.1, 250, -125); // level 1 chosen, block missing
    expect(loaded.get('0_0')?.visible).toBe(true);
    expect(loaded.get('1_0')?.visible).toBe(true);
    expect(lod.state()).toMatchObject({ level: 1, pending: 1, drawnByLevel: { 0: 2 } });
    loaded.set('L1_0_0', { visible: true }); // the block arrives
    expect(lod.apply()).toBe(true);
    expect(loaded.get('L1_0_0')?.visible).toBe(true);
    expect(loaded.get('0_0')?.visible).toBe(false);
    expect(loaded.get('1_0')?.visible).toBe(false);
    expect(lod.state()).toMatchObject({ pending: 0, drawnByLevel: { 1: 1 }, loadedByLevel: { 0: 2, 1: 1 } });
  });

  it('a manifest without levels behaves as before: base tiles only, all drawn', () => {
    const raw = { ...manifest(), levels: undefined };
    const { streamer, loaded } = fakeStreamer();
    const lod = new LodController(raw, streamer);
    for (const t of BASE) loaded.set(t.id, { visible: false });
    lod.update(view(4000), 9, 250, -125);
    expect(lod.state().level).toBe(0);
    expect(loaded.get('0_0')?.visible).toBe(true);
  });
});
