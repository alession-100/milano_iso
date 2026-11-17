import * as THREE from 'three';

/**
 * TEMPORARY (T-3.2): flat neutral placeholder materials, one shared instance per layer.
 * T-3.3 replaces `materialFor` with the real style; the signature stays.
 */
const COLOURS: Record<string, number> = {
  buildings: 0xd7ccc8,
  landuse: 0xcfd8dc,
  green: 0xaed581,
  water: 0x81d4fa,
  road_areas: 0xbdbdbd,
  roads: 0x9e9e9e,
  rail: 0x757575,
};
const FALLBACK = 0xe0e0e0;

const cache = new Map<string, THREE.MeshLambertMaterial>();

/** Mesh names are layer names, with a `#n` suffix when a layer is split in chunks. */
export function layerOf(meshName: string): string {
  const k = meshName.indexOf('#');
  return k < 0 ? meshName : meshName.slice(0, k);
}

export function materialFor(layer: string): THREE.MeshLambertMaterial {
  let m = cache.get(layer);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color: COLOURS[layer] ?? FALLBACK, flatShading: true });
    m.name = layer;
    cache.set(layer, m);
  }
  return m;
}
