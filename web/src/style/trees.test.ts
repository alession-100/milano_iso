import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TREE_BASE_Y, buildTreeMesh, createTreeGeometry, treeMatrices } from './trees';

const FIXTURES = path.resolve(process.cwd(), 'e2e', 'fixtures', 'tiles');

function fixtureTreeRows(): Record<string, unknown>[] {
  return readdirSync(FIXTURES)
    .filter((f) => f.endsWith('.json') && f !== 'tiles.json')
    .flatMap((f) => {
      const t = JSON.parse(readFileSync(path.join(FIXTURES, f), 'utf-8')) as {
        layers: Record<string, Record<string, unknown>[]>;
      };
      return t.layers.trees ?? [];
    });
}

describe('tree geometry', () => {
  it('is one geometry of unit height with a colour per vertex', () => {
    const g = createTreeGeometry();
    g.computeBoundingBox();
    const box = g.boundingBox as THREE.Box3;
    expect(box.min.y).toBeCloseTo(0, 6);
    expect(box.max.y).toBeCloseTo(1, 6);
    expect(g.getAttribute('color').count).toBe(g.getAttribute('position').count);
  });
});

describe('treeMatrices', () => {
  it('places each tree at (x, base, z) and scales it by height_m', () => {
    const arr = treeMatrices([
      { x: 10, z: -5, height_m: 8 },
      { x: -3, z: 4, height_m: 2.5 },
    ]);
    const m = new THREE.Matrix4().fromArray(arr, 16);
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    m.decompose(p, q, s);
    expect([p.x, p.y, p.z]).toEqual([-3, TREE_BASE_Y, 4].map((v) => expect.closeTo(v, 5)));
    expect(s.y).toBeCloseTo(2.5, 6);
    expect(s.x).toBeCloseTo(2.5, 6);
  });

  it('skips rows without finite coordinates or a positive height', () => {
    expect(
      treeMatrices([{ x: 1, z: 1, height_m: 0 }, { x: 'a', z: 1, height_m: 5 }, { x: 1, z: 1 }]).length,
    ).toBe(0);
  });
});

describe('buildTreeMesh', () => {
  it('returns one InstancedMesh holding every tree row, sharing geometry and material', () => {
    const rows = fixtureTreeRows();
    expect(rows.length).toBeGreaterThan(0);
    const a = buildTreeMesh(rows) as THREE.InstancedMesh;
    const b = buildTreeMesh(rows) as THREE.InstancedMesh;
    expect(a.isInstancedMesh).toBe(true);
    expect(a.count).toBe(rows.length);
    expect(a.geometry).toBe(b.geometry);
    expect(a.material).toBe(b.material);
    expect(a.castShadow).toBe(false);
  });

  it('returns null for a tile without trees', () => {
    expect(buildTreeMesh([])).toBeNull();
  });
});

describe('fixture feature tables', () => {
  it('flag every fill tree as decorative and every mapped tree as not', () => {
    const rows = fixtureTreeRows();
    expect(rows.some((r) => r.source === 'fill')).toBe(true);
    expect(rows.some((r) => r.source === 'osm_tree')).toBe(true);
    expect(rows.some((r) => r.source === 'osm_tree_row')).toBe(true);
    for (const r of rows) expect(r.decorative).toBe(r.source === 'fill');
  });
});
