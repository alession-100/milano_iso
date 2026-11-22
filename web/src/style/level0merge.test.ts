import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { allVisible, applyLayerVisibility, setLayerState } from '../layers';
import { refForRow, refKey, rowForFeature } from '../pick/rows';
import { disposeTile } from '../tiles/loader';
import { tileCalls } from '../tiles/levels';
import { COARSE_MESH, type CoarsePart, isCoarseMesh, mergeCoarseLayers, partOf } from './coarse';
import {
  type FeatureTable,
  applyStyle,
  colourIndices,
  flatPaletteIndex,
  layerOf,
  materialFor,
  setPaletteMode,
} from './materials';
import { paletteFor } from './palette';
import { buildTreeMesh } from './trees';

// T-6.5b (ADR-0041): a LEVEL-0 tile merges its flat layers like a coarse tile. Its buildings, painted markings,
// landmark details and instanced trees stay meshes of their own. The merge itself is the one of coarse.test.ts;
// here the tile has the layers and the loader steps of a base tile.

interface Spec {
  name: string;
  rows: Record<string, unknown>[] | undefined;
  tris: number[]; // feature id per triangle
}

function layerMesh(spec: Spec, seed: number): THREE.Mesh {
  const n = spec.tris.length;
  const pos = new Int16Array(n * 9);
  const fid = new Uint16Array(n * 3);
  const idx = new Uint16Array(n * 3);
  for (let t = 0; t < n; t++) {
    for (let k = 0; k < 3; k++) {
      const v = t * 3 + k;
      pos[v * 3] = seed * 100 + t * 7 + k;
      pos[v * 3 + 1] = (t * 3 + k) % 40;
      pos[v * 3 + 2] = -seed * 50 - t * 5 - k * 2;
      fid[v] = spec.tris[t];
      idx[v] = v;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('_feature_id', new THREE.BufferAttribute(fid, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
  m.name = spec.name;
  m.position.set(125, 0, -125);
  m.scale.setScalar(0.02);
  return m;
}

const SPECS: Spec[] = [
  { name: 'buildings', rows: [{ key: 'dbt:1', building_type: 'yes', landmark_id: null }], tris: [0, 0] },
  { name: 'landuse', rows: [{ kind: 'residential', osm_type: 'w', osm_id: 12 }], tris: [0] },
  { name: 'green', rows: [{ kind: 'park', osm_type: 'r', osm_id: 21 }, { kind: 'forest', osm_type: 'w', osm_id: 22 }], tris: [1, 0] },
  { name: 'water', rows: [{ kind: 'canal', osm_type: 'r', osm_id: 31 }], tris: [0, 0] },
  { name: 'road_areas', rows: [{ class: 'pedestrian', osm_type: 'w', osm_id: 41 }], tris: [0] },
  {
    name: 'roads',
    rows: [
      { class: 'motorway', osm_type: 'w', osm_id: 51, width_m: 12 },
      { class: 'residential', osm_type: 'w', osm_id: 52, width_m: 6 },
    ],
    tris: [0, 1, 1],
  },
  { name: 'markings', rows: [{ kind: 'zebra' }], tris: [0] },
  { name: 'rail', rows: undefined, tris: [0, 0] },
  { name: 'landmark_details', rows: [{ detail: 'spire', landmark_id: 'duomo' }], tris: [0] },
];

const TREES = [{ x: 1, z: 2, height_m: 8 }];
const table: FeatureTable = {
  tile: '0_0',
  layers: { ...Object.fromEntries(SPECS.filter((s) => s.rows).map((s) => [s.name, s.rows])), trees: TREES },
};

/** What the tile loader does to a level-0 glb, minus the GLTF parse. */
function loadedTile(): THREE.Group {
  const g = new THREE.Group();
  g.name = '0_0';
  g.userData.table = table;
  SPECS.forEach((s, i) => g.add(layerMesh(s, i + 1)));
  mergeCoarseLayers(g, table);
  g.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || isCoarseMesh(mesh)) return;
    const own = mesh.material;
    for (const m of Array.isArray(own) ? own : [own]) m.dispose();
    applyStyle(mesh, table);
  });
  const trees = buildTreeMesh(table.layers.trees ?? []);
  if (trees) g.add(trees);
  return g;
}

describe('level-0 tile: flat layers merged (T-6.5b)', () => {
  it('has buildings, one merged mesh, markings, landmark details and trees, as many meshes as the plan counts', () => {
    const g = loadedTile();
    expect(g.children.map((c) => c.name)).toEqual(['buildings', 'markings', 'landmark_details', COARSE_MESH, 'trees']);
    const counts = Object.fromEntries(Object.entries(table.layers).map(([k, v]) => [k, v?.length ?? 0]));
    counts.rail = 2; // a layer without feature rows still has triangles
    const all = ['buildings', 'landuse', 'green', 'water', 'road_areas', 'roads', 'markings', 'rail', 'landmark_details', 'trees'];
    expect(tileCalls(0, counts, all, false)).toBe(g.children.length);
    expect(tileCalls(0, counts, all, true)).toBe(g.children.length + 1);
  });

  it('keeps the buildings the only caster, and the markings (own polygon offset) and details apart', () => {
    const g = loadedTile();
    const by = (n: string) => g.children.find((c) => c.name === n) as THREE.Mesh;
    expect([by('buildings').castShadow, by(COARSE_MESH).castShadow, by('markings').castShadow]).toEqual([true, false, false]);
    expect(by('markings').material).toBe(materialFor('markings'));
    expect((by('markings').material as THREE.Material).polygonOffset).toBe(true);
    expect(by('trees')).toBeInstanceOf(THREE.InstancedMesh);
  });

  it('colours every merged feature as its separate layer did', () => {
    const merged = loadedTile().children.find((c) => c.name === COARSE_MESH) as THREE.Mesh;
    const parts = merged.userData.parts as CoarsePart[];
    expect(parts.map((p) => p.layer)).toEqual(['landuse', 'green', 'water', 'road_areas', 'roads', 'rail']);
    const data = ((merged.material as THREE.Material).userData.lookup as THREE.DataTexture).image.data as Uint8Array;
    for (const s of SPECS.filter((s) => parts.some((p) => p.layer === s.name))) {
      const part = parts.find((p) => p.layer === s.name) as CoarsePart;
      const own = s.rows && s.name !== 'road_areas' && s.name !== 'rail' ? colourIndices(s.name, s.rows) : null;
      for (let row = 0; row < part.count; row++) expect(data[part.offset + row], `${s.name} ${row}`).toBe(own ? own[row] : flatPaletteIndex(s.name));
    }
  });

  it('picks the same feature (layer, row, key) as the separate layers', () => {
    const merged = loadedTile().children.find((c) => c.name === COARSE_MESH) as THREE.Mesh;
    const parts = merged.userData.parts as CoarsePart[];
    const attr = merged.geometry.getAttribute('_feature_id') as THREE.BufferAttribute;
    const idx = merged.geometry.index as THREE.BufferAttribute;
    let t = 0;
    for (const s of SPECS.filter((s) => parts.some((p) => p.layer === s.name))) {
      for (const f of s.tris) {
        const part = partOf(parts, attr.getX(idx.getX(t * 3)));
        expect(part, `${s.name} tri ${t}`).toEqual({ layer: s.name, row: f });
        if (s.rows) {
          const row = rowForFeature(table, part?.layer ?? '', part?.row ?? -1);
          expect(refKey(refForRow(part?.layer ?? '', '0_0', row ?? {}))).toBe(refKey(refForRow(s.name, '0_0', s.rows[f])));
        }
        t += 1;
      }
    }
  });

  it('applies the layer toggles: the merged mesh by draw range, the layers apart by visibility', () => {
    const g = loadedTile();
    const by = (n: string) => g.children.find((c) => c.name === n) as THREE.Mesh;
    const merged = by(COARSE_MESH);
    const total = (merged.geometry.index as THREE.BufferAttribute).count;
    const wg = (1 + 2 + 2) * 3; // landuse, green, water
    const s = allVisible();
    setLayerState({ ...s, roads: false, markings: false, trees: false, landmarkDetails: false });
    applyLayerVisibility(g);
    expect([merged.visible, merged.geometry.drawRange.start, merged.geometry.drawRange.count]).toEqual([true, 0, wg]);
    expect([by('markings').visible, by('trees').visible, by('landmark_details').visible, by('buildings').visible]).toEqual([false, false, false, true]);
    setLayerState({ ...s, waterGreen: false });
    applyLayerVisibility(g);
    expect([merged.visible, merged.geometry.drawRange.start, merged.geometry.drawRange.count]).toEqual([true, wg, total - wg]);
    expect([by('markings').visible, by('trees').visible]).toEqual([true, true]);
    setLayerState(s);
    applyLayerVisibility(g);
    expect(merged.geometry.drawRange.count).toBe(total);
  });

  it('switches day and night for the flat layers kept apart (the merged mesh shares the palette uniform)', () => {
    const g = loadedTile();
    const markings = g.children.find((c) => c.name === 'markings') as THREE.Mesh;
    setPaletteMode('night');
    expect((markings.material as THREE.MeshLambertMaterial).color.getHexString()).toBe(
      new THREE.Color(paletteFor('night').markingWhite).getHexString(),
    );
    setPaletteMode('day');
    expect((markings.material as THREE.MeshLambertMaterial).color.getHexString()).toBe(
      new THREE.Color(paletteFor('day').markingWhite).getHexString(),
    );
  });

  it('disposes the merged geometry and its textures with the tile, and leaves the shared materials alone', () => {
    const g = loadedTile();
    const merged = g.children.find((c) => c.name === COARSE_MESH) as THREE.Mesh;
    const markings = g.children.find((c) => c.name === 'markings') as THREE.Mesh;
    const log: string[] = [];
    merged.geometry.addEventListener('dispose', () => log.push('geometry'));
    const mat = merged.material as THREE.Material;
    (mat.userData.lookup as THREE.Texture).addEventListener('dispose', () => log.push('lookup'));
    (mat.userData.mask as THREE.Texture).addEventListener('dispose', () => log.push('mask'));
    (markings.material as THREE.Material).addEventListener('dispose', () => log.push('shared'));
    disposeTile(g);
    expect(log.sort()).toEqual(['geometry', 'lookup', 'mask']);
    expect(g.children.map((c) => layerOf(c.name))).toContain(COARSE_MESH);
  });
});
