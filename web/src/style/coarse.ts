import * as THREE from 'three';
import {
  LOOKUP_WIDTH,
  type FeatureTable,
  colourIndices,
  createLookupMaterial,
  flatPaletteIndex,
  layerOf,
  packLookup,
} from './materials';

/**
 * One mesh for the flat layers of a coarse tile (T-6.5, ADR-0040).
 *
 * A coarse tile (level 1 to 3) has up to six flat layers besides its buildings; drawn one by one they
 * cost a draw call each. Here they are concatenated into ONE mesh named `coarse`, in a fixed layer
 * order, with a single lookup material:
 *  - every layer keeps its own colours: the lookup texture holds, per feature, the palette index the
 *    separate layer would have used (flat layers: their single palette colour), so the day/night
 *    switch (the shared palette uniform) and the highlight mask work as before;
 *  - the feature id of the merged mesh is `layer offset + the feature's own id`. `parts` says which
 *    layer owns which id range, so picking returns the same feature (layer, row) as before;
 *  - the water layer keeps its sheen (by its id range, see `createLookupMaterial`);
 *  - the triangles of the two layer groups of the layer toggles (water/green/land use, and roads) are
 *    contiguous in the index, so a toggle only changes the draw range, with no rebuild.
 * Buildings stay a separate mesh: they are the only shadow casters. The geometry is the file's own
 * quantised data, concatenated; nothing is re-quantised, so every vertex is exactly where it was.
 * Level 0 is never merged.
 */
export const COARSE_MESH = 'coarse';

/** Flat layers that are merged, in the order of their triangles; the two toggle groups are contiguous. */
export const MERGED_LAYERS = ['landuse', 'green', 'water', 'road_areas', 'roads', 'rail'] as const;
/** Layers of the toggle `waterGreen` come first in the index, those of `roads` after them. */
const FIRST_GROUP: ReadonlySet<string> = new Set(['landuse', 'green', 'water']);

/** One layer inside the merged mesh: its feature ids are `offset .. offset + count - 1`. */
export interface CoarsePart {
  layer: string;
  offset: number;
  count: number;
}

/** Index ranges (in indices) of the two toggle groups: [start, count] each. */
export interface CoarseRanges {
  waterGreen: [number, number];
  roads: [number, number];
}

export function isCoarseMesh(o: THREE.Object3D): boolean {
  return (o.userData as Record<string, unknown> | undefined)?.parts !== undefined;
}

/** The layer and the feature's own row index of a merged-mesh feature id; null if the id is in no part. */
export function partOf(parts: readonly CoarsePart[], id: number): { layer: string; row: number } | null {
  for (const p of parts) if (id >= p.offset && id < p.offset + p.count) return { layer: p.layer, row: id - p.offset };
  return null;
}

/**
 * Replaces the flat layer meshes of `group` by one merged mesh and returns it, or returns null and
 * leaves the group untouched when the layers cannot be merged (fewer than two, different transforms,
 * no index, or more feature ids than a 16-bit attribute holds): the tile is then drawn layer by layer.
 */
export function mergeCoarseLayers(group: THREE.Object3D, table: FeatureTable | undefined): THREE.Mesh | null {
  const found = new Map<string, THREE.Mesh>();
  for (const child of group.children) {
    const mesh = child as THREE.Mesh;
    const layer = layerOf(mesh.name);
    if (!mesh.isMesh || mesh.name !== layer || !(MERGED_LAYERS as readonly string[]).includes(layer)) continue;
    found.set(layer, mesh);
  }
  if (found.size < 2) return null;
  const ordered = MERGED_LAYERS.filter((l) => found.has(l)).map((l) => ({ layer: l as string, mesh: found.get(l) as THREE.Mesh }));
  const first = ordered[0].mesh;
  let vertices = 0;
  let indices = 0;
  for (const { mesh } of ordered) {
    const g = mesh.geometry;
    const pos = g.getAttribute('position') as THREE.BufferAttribute | undefined;
    const fid = g.getAttribute('_feature_id') as THREE.BufferAttribute | undefined;
    if (
      !g.index ||
      !pos ||
      !fid ||
      !(pos.array instanceof Int16Array) ||
      pos.itemSize !== 3 ||
      pos.normalized ||
      !(fid.array instanceof Uint16Array) ||
      !mesh.position.equals(first.position) ||
      !mesh.scale.equals(first.scale) ||
      !mesh.quaternion.equals(first.quaternion)
    ) {
      return null;
    }
    vertices += pos.count;
    indices += g.index.count;
  }

  // feature id ranges: each layer gets as many ids as it has rows, or as its highest id needs
  const parts: CoarsePart[] = [];
  let ids = 0;
  for (const { layer, mesh } of ordered) {
    const fid = mesh.geometry.getAttribute('_feature_id') as THREE.BufferAttribute;
    let top = -1;
    for (let i = 0; i < fid.count; i++) top = Math.max(top, fid.getX(i));
    const count = Math.max(table?.layers[layer]?.length ?? 0, top + 1);
    parts.push({ layer, offset: ids, count });
    ids += count;
  }
  if (ids > 65535) return null;

  const position = new Int16Array(vertices * 3);
  const featureId = new Uint16Array(vertices);
  const index = vertices > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
  let v = 0;
  let k = 0;
  const lookup = new Uint8Array(ids);
  const ranges: CoarseRanges = { waterGreen: [0, 0], roads: [0, 0] };
  ordered.forEach(({ layer, mesh }, n) => {
    const g = mesh.geometry;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const fid = g.getAttribute('_feature_id') as THREE.BufferAttribute;
    const idx = g.index as THREE.BufferAttribute;
    const part = parts[n];
    position.set(pos.array as Int16Array, v * 3);
    for (let i = 0; i < fid.count; i++) featureId[v + i] = fid.getX(i) + part.offset;
    const start = k;
    for (let i = 0; i < idx.count; i++) index[k + i] = idx.getX(i) + v;
    k += idx.count;
    v += pos.count;
    const range = FIRST_GROUP.has(layer) ? ranges.waterGreen : ranges.roads;
    if (range[1] === 0) range[0] = start;
    range[1] += idx.count;
    // colours: what the separate layer would have shown, feature by feature
    const rows = table?.layers[layer];
    if (rows && layer !== 'road_areas' && layer !== 'rail') lookup.set(colourIndices(layer, rows), part.offset);
    else lookup.fill(flatPaletteIndex(layer), part.offset, part.offset + part.count);
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('_feature_id', new THREE.BufferAttribute(featureId, 1));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  const water = parts.find((p) => p.layer === 'water');
  const { data, width, height } = packLookup(lookup, LOOKUP_WIDTH);
  const tex = new THREE.DataTexture(data, width, height, THREE.RedFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  const mesh = new THREE.Mesh(
    geometry,
    createLookupMaterial(COARSE_MESH, tex, water ? [water.offset, water.offset + water.count] : [0, 0]),
  );
  mesh.name = COARSE_MESH;
  mesh.position.copy(first.position);
  mesh.quaternion.copy(first.quaternion);
  mesh.scale.copy(first.scale);
  mesh.userData.parts = parts;
  mesh.userData.ranges = ranges;
  mesh.userData.casts = false;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  for (const { mesh: old } of ordered) {
    group.remove(old);
    old.geometry.dispose();
  }
  group.add(mesh);
  return mesh;
}

/**
 * Applies the layer toggles to a merged mesh by its draw range: the water/green/land-use triangles and
 * the road triangles are two contiguous runs of the index. `show` says whether a tile layer is shown.
 */
export function applyCoarseVisibility(mesh: THREE.Mesh, show: (layer: string) => boolean): void {
  const r = mesh.userData.ranges as CoarseRanges;
  const wg = show('water');
  const rd = show('roads');
  const [wgStart, wgCount] = r.waterGreen;
  const [rdStart, rdCount] = r.roads;
  const total = mesh.geometry.index?.count ?? 0;
  mesh.visible = (wg && wgCount > 0) || (rd && rdCount > 0);
  if (wg && rd) mesh.geometry.setDrawRange(0, total);
  else if (wg) mesh.geometry.setDrawRange(wgStart, wgCount);
  else if (rd) mesh.geometry.setDrawRange(rdStart, rdCount);
}
