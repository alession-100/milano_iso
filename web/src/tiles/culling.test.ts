import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { cullTiles, frustumOf, sortNearestFirst, tileIntersects, viewCentre } from './culling';
import { CameraRig, createCamera } from '../camera';
import type { TileEntry } from './manifest';

function tile(id: string, i: number, j: number, height = 20): TileEntry {
  // Grid cell i, j of 250 m in the client frame: x = 250 i, z = -250 (j + 1) .. -250 j.
  return {
    id,
    i,
    j,
    content_bbox_local: {
      min: [250 * i, 0, -250 * (j + 1)],
      max: [250 * (i + 1), height, -250 * j],
    },
    glb: { file: `${id}.glb` },
    features: { file: `${id}.json` },
  };
}

function camera(x: number, z: number, width: number): THREE.OrthographicCamera {
  const cam = createCamera(16 / 9, 30);
  const rig = new CameraRig(cam, 30);
  rig.setBounds({ minX: -1e5, maxX: 1e5, minZ: -1e5, maxZ: 1e5 });
  rig.target = [x, z];
  rig.visibleWidth = width;
  rig.apply();
  cam.updateMatrixWorld();
  return cam;
}

describe('cullTiles', () => {
  const tiles = [tile('0_0', 0, 0), tile('3_0', 3, 0), tile('20_20', 20, 20)];

  it('a tight view at the origin sees only the tile there; far tiles are not wanted', () => {
    const cam = camera(100, -100, 100);
    const r = cullTiles(tiles, frustumOf(cam), 250);
    expect(r.visible).toEqual(['0_0']);
    expect(r.wanted).not.toContain('20_20');
  });

  it('a tile one ring away is wanted (prefetch) but not visible', () => {
    const cam = camera(100, -100, 100);
    const near = [tile('0_0', 0, 0), tile('2_0', 2, 0)];
    const r = cullTiles(near, frustumOf(cam), 250);
    expect(r.visible).toEqual(['0_0']);
    expect(r.wanted).toEqual(['0_0', '2_0']);
  });

  it('a wide view sees all the tiles in range', () => {
    const cam = camera(400, -100, 3000);
    const r = cullTiles(tiles.slice(0, 2), frustumOf(cam), 250);
    expect(r.visible).toEqual(['0_0', '3_0']);
  });

  it('uses the 3D box: a tall tile is visible although its footprint is just off screen', () => {
    // Same footprint, but a 300 m tall tile pokes into the view from behind the camera's ground
    // window; a flat one does not.
    const cam = camera(100, -100, 40);
    const flat = tile('0_0', 0, 0, 0.1);
    flat.content_bbox_local = { min: [400, 0, -400], max: [450, 0.1, -350] };
    const tall = tile('t', 0, 0, 300);
    tall.content_bbox_local = { min: [400, 0, -400], max: [450, 300, -350] };
    const fr = frustumOf(cam);
    expect(tileIntersects(flat, fr)).toBe(false);
    expect(tileIntersects(tall, fr)).toBe(false); // too far on the ground even when tall
    const near = tile('n', 0, 0, 300);
    near.content_bbox_local = { min: [150, 0, -100], max: [200, 300, -50] };
    expect(tileIntersects(near, fr)).toBe(true);
  });
});

describe('viewCentre', () => {
  it('returns the ground point the camera looks at', () => {
    for (const [x, z] of [[0, 0], [120, -340]]) {
      const [cx, cz] = viewCentre(camera(x, z, 500));
      expect(cx).toBeCloseTo(x, 6);
      expect(cz).toBeCloseTo(z, 6);
    }
  });
});

describe('sortNearestFirst', () => {
  it('orders by distance of the content centre, ties by id', () => {
    const ts = [tile('0_0', 0, 0), tile('1_0', 1, 0), tile('2_0', 2, 0)];
    expect(sortNearestFirst(ts, ['2_0', '1_0', '0_0'], 400, -100)).toEqual(['1_0', '2_0', '0_0']);
    expect(sortNearestFirst(ts, ['1_0', '0_0'], 250, -125)).toEqual(['0_0', '1_0']);
  });
});
