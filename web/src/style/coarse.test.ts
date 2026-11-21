import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { applyLayerVisibility, allVisible, setLayerState } from '../layers';
import { refForRow, refKey, rowForFeature } from '../pick/rows';
import {
  COARSE_MESH,
  type CoarsePart,
  applyCoarseVisibility,
  isCoarseMesh,
  mergeCoarseLayers,
  partOf,
} from './coarse';
import {
  type FeatureTable,
  applyStyle,
  colourIndices,
  createLookupMaterial,
  flatPaletteIndex,
  buildLookupTexture,
  setPaletteMode,
} from './materials';
import { paletteFor } from './palette';

// A synthetic coarse tile: 6 flat layers + buildings, quantised like the real glb files (Int16 positions,
// Uint16 feature ids, Uint16 indices), all nodes with the same translation and scale.

interface LayerSpec {
  name: string;
  rows: Record<string, unknown>[] | undefined; // undefined: a flat layer without feature rows
  /** feature id of each triangle (3 vertices per triangle, each with its own id) */
  triFeatures: number[];
}

function layerMesh(spec: LayerSpec, seed: number): THREE.Mesh {
  const tris = spec.triFeatures.length;
  const pos = new Int16Array(tris * 9);
  const fid = new Uint16Array(tris * 3);
  const idx = new Uint16Array(tris * 3);
  for (let t = 0; t < tris; t++) {
    for (let k = 0; k < 3; k++) {
      const v = t * 3 + k;
      pos[v * 3] = seed * 100 + t * 7 + k;
      pos[v * 3 + 1] = (t * 3 + k) % 40;
      pos[v * 3 + 2] = -seed * 50 - t * 5 - k * 2;
      fid[v] = spec.triFeatures[t];
      idx[v] = v;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('_feature_id', new THREE.BufferAttribute(fid, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
  m.name = spec.name;
  m.position.set(-9500, 0, 500);
  m.scale.setScalar(0.04);
  return m;
}

const SPECS: LayerSpec[] = [
  { name: 'buildings', rows: [{ key: 'dbt:1', building_type: 'yes', landmark_id: null }], triFeatures: [0, 0, 0] },
  {
    name: 'landuse',
    rows: [
      { kind: 'industrial', osm_type: 'w', osm_id: 11 },
      { kind: 'residential', osm_type: 'w', osm_id: 12 },
    ],
    triFeatures: [0, 1, 1],
  },
  { name: 'green', rows: [{ kind: 'park', osm_type: 'r', osm_id: 21 }, { kind: 'forest', osm_type: 'w', osm_id: 22 }], triFeatures: [1, 0] },
  { name: 'water', rows: [{ kind: 'canal', osm_type: 'r', osm_id: 31 }], triFeatures: [0, 0] },
  { name: 'road_areas', rows: [{ class: 'pedestrian', osm_type: 'w', osm_id: 41 }], triFeatures: [0] },
  {
    name: 'roads',
    rows: [
      { class: 'motorway', osm_type: 'w', osm_id: 51, width_m: 12 },
      { class: 'residential', osm_type: 'w', osm_id: 52, width_m: 6 },
      { class: 'pedestrian', osm_type: 'w', osm_id: 53, width_m: 4 },
    ],
    triFeatures: [0, 2, 1, 2],
  },
  { name: 'rail', rows: undefined, triFeatures: [0, 3] },
];

const table: FeatureTable = {
  tile: 'L2_0_0',
  layers: Object.fromEntries(SPECS.filter((s) => s.rows).map((s) => [s.name, s.rows])),
};

function tile(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'L2_0_0';
  g.userData.table = table;
  SPECS.forEach((s, i) => g.add(layerMesh(s, i + 1)));
  return g;
}

describe('mergeCoarseLayers (T-6.5)', () => {
  it('turns six flat layers into one mesh next to the buildings, with the same vertices', () => {
    const g = tile();
    const before = new Map(g.children.map((c) => [c.name, (c as THREE.Mesh).geometry]));
    const merged = mergeCoarseLayers(g, table) as THREE.Mesh;
    expect(merged.name).toBe(COARSE_MESH);
    expect(g.children.map((c) => c.name)).toEqual(['buildings', COARSE_MESH]);
    // vertices: the layers' own Int16 data, concatenated in the fixed layer order
    const order = ['landuse', 'green', 'water', 'road_areas', 'roads', 'rail'];
    const expected: number[] = [];
    for (const l of order) expected.push(...((before.get(l)?.getAttribute('position') as THREE.BufferAttribute).array as Int16Array));
    expect(Array.from(merged.geometry.getAttribute('position').array)).toEqual(expected);
    expect(merged.geometry.getAttribute('position').array).toBeInstanceOf(Int16Array);
    expect(merged.scale.x).toBe(0.04);
    expect(merged.position.x).toBe(-9500);
    // triangles: every merged triangle is the original triangle of its layer (compare the vertex positions)
    const pos = merged.geometry.getAttribute('position') as THREE.BufferAttribute;
    const idx = merged.geometry.index as THREE.BufferAttribute;
    let t = 0;
    for (const l of order) {
      const og = before.get(l) as THREE.BufferGeometry;
      const oi = og.index as THREE.BufferAttribute;
      const op = og.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < oi.count; i++, t++) {
        for (const c of [0, 1, 2]) {
          expect(pos.getComponent(idx.getX(t), c)).toBe(op.getComponent(oi.getX(i), c));
        }
      }
    }
    expect(t).toBe(idx.count);
  });

  it('keeps every feature of every layer identifiable: same layer and same row as before', () => {
    const merged = mergeCoarseLayers(tile(), table) as THREE.Mesh;
    const parts = merged.userData.parts as CoarsePart[];
    const attr = merged.geometry.getAttribute('_feature_id') as THREE.BufferAttribute;
    const idx = merged.geometry.index as THREE.BufferAttribute;
    // walk the merged triangles in the order of the layers and compare with the layers' own triangle list
    let t = 0;
    for (const s of SPECS.filter((s) => s.name !== 'buildings')) {
      for (const f of s.triFeatures) {
        const part = partOf(parts, attr.getX(idx.getX(t * 3)));
        expect(part, `${s.name} tri ${t}`).toEqual({ layer: s.name, row: f });
        // and the feature table gives the same ref as for the separate layer
        if (s.rows) {
          const row = rowForFeature(table, part?.layer ?? '', part?.row ?? -1);
          expect(refKey(refForRow(part?.layer ?? '', 'L2_0_0', row ?? {}))).toBe(
            refKey(refForRow(s.name, 'L2_0_0', s.rows[f])),
          );
        }
        t += 1;
      }
    }
  });

  it('colours every feature as its separate layer would: lookup colours, flat colours, same palette', () => {
    const merged = mergeCoarseLayers(tile(), table) as THREE.Mesh;
    const parts = merged.userData.parts as CoarsePart[];
    const lookup = (merged.material as THREE.Material).userData.lookup as THREE.DataTexture;
    const data = lookup.image.data as Uint8Array;
    for (const s of SPECS.filter((s) => s.name !== 'buildings')) {
      const part = parts.find((p) => p.layer === s.name) as CoarsePart;
      const own = s.rows && s.name !== 'road_areas' && s.name !== 'rail' ? colourIndices(s.name, s.rows) : null;
      for (let row = 0; row < part.count; row++) {
        expect(data[part.offset + row], `${s.name} ${row}`).toBe(own ? own[row] : flatPaletteIndex(s.name));
      }
    }
    // a separate layer drawn the old way: the same lookup bytes for the same feature
    const plain = buildLookupTexture(colourIndices('roads', table.layers.roads as Record<string, unknown>[]));
    const roads = parts.find((p) => p.layer === 'roads') as CoarsePart;
    expect(Array.from((plain.image.data as Uint8Array).slice(0, 3))).toEqual(
      Array.from(data.slice(roads.offset, roads.offset + 3)),
    );
  });

  it('switches day and night with the other lookup materials: one shared palette, updated in place', () => {
    const merged = mergeCoarseLayers(tile(), table) as THREE.Mesh;
    const own = createLookupMaterial('roads', buildLookupTexture(new Uint8Array(3)));
    const shader = () => ({
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: '#include <common>\n#include <begin_vertex>',
      fragmentShader: '#include <common>\n#include <color_fragment>',
    });
    const a = shader();
    const b = shader();
    (merged.material as THREE.Material).onBeforeCompile(a as never, undefined as never);
    own.onBeforeCompile(b as never, undefined as never);
    expect(a.uniforms.paletteColours).toBe(b.uniforms.paletteColours); // the very same object
    const pal = a.uniforms.paletteColours.value as THREE.Color[];
    setPaletteMode('night');
    const night = paletteFor('night');
    expect(pal[0].getHex()).toBe(new THREE.Color(night[Object.keys(night)[0] as keyof typeof night]).getHex());
    setPaletteMode('day');
    // the water sheen is on for the water ids only, in its own program
    expect(a.fragmentShader).toContain('waterRange');
    expect(b.fragmentShader).not.toContain('waterRange');
    const parts = merged.userData.parts as CoarsePart[];
    const water = parts.find((p) => p.layer === 'water') as CoarsePart;
    expect((a.uniforms.waterRange.value as THREE.Vector2).toArray()).toEqual([water.offset, water.offset + water.count]);
    expect((merged.material as THREE.Material).customProgramCacheKey()).not.toBe(own.customProgramCacheKey());
  });

  it('applies the layer toggles by draw range, and a tile without a toggle group stays correct', () => {
    const g = tile();
    const merged = mergeCoarseLayers(g, table) as THREE.Mesh;
    const total = (merged.geometry.index as THREE.BufferAttribute).count;
    const wgCount = (3 + 2 + 2) * 3; // landuse, green, water triangles
    const state = allVisible();
    setLayerState(state);
    applyLayerVisibility(g);
    expect([merged.visible, merged.geometry.drawRange.start, merged.geometry.drawRange.count]).toEqual([true, 0, total]);
    setLayerState({ ...state, roads: false });
    applyLayerVisibility(g);
    expect([merged.visible, merged.geometry.drawRange.start, merged.geometry.drawRange.count]).toEqual([true, 0, wgCount]);
    setLayerState({ ...state, waterGreen: false });
    applyLayerVisibility(g);
    expect([merged.visible, merged.geometry.drawRange.start, merged.geometry.drawRange.count]).toEqual([
      true,
      wgCount,
      total - wgCount,
    ]);
    setLayerState({ ...state, waterGreen: false, roads: false });
    applyLayerVisibility(g);
    expect(merged.visible).toBe(false);
    applyCoarseVisibility(merged, () => true);
    expect(merged.visible).toBe(true);
    setLayerState(allVisible());
  });

  it('leaves buildings alone, as the only caster; the merged mesh receives but never casts', () => {
    const g = tile();
    const merged = mergeCoarseLayers(g, table) as THREE.Mesh;
    const buildings = g.children.find((c) => c.name === 'buildings') as THREE.Mesh;
    applyStyle(buildings, table);
    expect([buildings.castShadow, merged.castShadow, merged.receiveShadow]).toEqual([true, false, true]);
    expect(isCoarseMesh(merged)).toBe(true);
    expect(isCoarseMesh(buildings)).toBe(false);
  });

  it('reads a position stream padded to 8 bytes per vertex (interleaved, as the glTF loader gives it)', () => {
    const g = tile();
    const mesh = g.children[1] as THREE.Mesh; // landuse
    const plain = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const padded = new Int16Array(plain.count * 4);
    for (let i = 0; i < plain.count; i++) padded.set([plain.getX(i), plain.getY(i), plain.getZ(i), 0], i * 4);
    mesh.geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(padded, 4), 3, 0, false));
    const expected = Array.from(plain.array);
    const merged = mergeCoarseLayers(g, table) as THREE.Mesh;
    expect(Array.from(merged.geometry.getAttribute('position').array).slice(0, expected.length)).toEqual(expected);
  });

  it('does not merge what it cannot merge exactly: one layer, other transforms, float positions', () => {
    const one = new THREE.Group();
    one.add(layerMesh(SPECS[1], 1));
    expect(mergeCoarseLayers(one, table)).toBeNull();
    expect(one.children.map((c) => c.name)).toEqual(['landuse']);

    const moved = tile();
    (moved.children[1] as THREE.Mesh).position.x += 1;
    expect(mergeCoarseLayers(moved, table)).toBeNull();
    expect(moved.children).toHaveLength(SPECS.length);

    const floats = tile();
    const m = floats.children[1] as THREE.Mesh;
    m.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(27), 3));
    expect(mergeCoarseLayers(floats, table)).toBeNull();
  });

  it('uses 32-bit indices when the merged vertex count exceeds 65535', () => {
    const g = new THREE.Group();
    const big = (name: string, tris: number) =>
      layerMesh({ name, rows: undefined, triFeatures: Array.from({ length: tris }, () => 0) }, 1);
    g.add(big('landuse', 12000), big('green', 12000)); // 36000 + 36000 vertices
    const merged = mergeCoarseLayers(g, { layers: {} }) as THREE.Mesh;
    expect(merged.geometry.index?.array).toBeInstanceOf(Uint32Array);
    expect(merged.geometry.getAttribute('position').count).toBe(72000);
    const last = (merged.geometry.index as THREE.BufferAttribute).getX(72000 - 1);
    expect(last).toBe(71999);
  });
});
