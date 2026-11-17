import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { type StyleMode, paletteFor } from './palette';

/**
 * Trees (T-4.1). STYLE, not data: the shape and colours are ours. What is data is the position
 * of a mapped tree and its OSM height tag; fill trees are decorative and flagged as such in the
 * feature table (`decorative`, `source`).
 *
 * One tile draws all its trees with ONE InstancedMesh (one draw call): the trunk and the crown
 * are merged into a single unit-height geometry with baked vertex colours, shared by every tile.
 */

/** Height of the unit tree geometry (metres); instances are scaled by `height_m / this`. */
export const TREE_UNIT_HEIGHT = 1;
/** Ground level a tree stands on (top of the roads layer, T-2.2 LAYER_HEIGHT_M), metres. */
export const TREE_BASE_Y = 0.12;

// Proportions of the unit tree (style constants).
const TRUNK_RADIUS = 0.035;
const TRUNK_HEIGHT = 0.3;
const CROWN_RADIUS = 0.22;
const CROWN_BASE = 0.2;
const CROWN_SEGMENTS = 7;
const TRUNK_SEGMENTS = 5;

let treeMode: StyleMode = 'day';

/** Vertex colours of one part, from the palette of the current mode (day or night, T-4.3). */
function paint(g: THREE.BufferGeometry, name: 'treeCrown' | 'treeTrunk'): THREE.BufferGeometry {
  const c = new THREE.Color(paletteFor(treeMode)[name]); // sRGB hex converted to linear by three
  const n = g.getAttribute('position').count;
  const colours = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    colours[3 * i] = c.r;
    colours[3 * i + 1] = c.g;
    colours[3 * i + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  return g;
}

/** Low-poly tree of height 1 standing at the origin: a short trunk and a cone crown. */
export function createTreeGeometry(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(TRUNK_RADIUS, TRUNK_RADIUS * 1.3, TRUNK_HEIGHT, TRUNK_SEGMENTS);
  trunk.translate(0, TRUNK_HEIGHT / 2, 0);
  const crownHeight = TREE_UNIT_HEIGHT - CROWN_BASE;
  const crown = new THREE.ConeGeometry(CROWN_RADIUS, crownHeight, CROWN_SEGMENTS);
  crown.translate(0, CROWN_BASE + crownHeight / 2, 0);
  const merged = mergeGeometries([paint(trunk, 'treeTrunk'), paint(crown, 'treeCrown')]);
  trunk.dispose();
  crown.dispose();
  return merged;
}

let sharedGeometry: THREE.BufferGeometry | null = null;
let sharedMaterial: THREE.MeshLambertMaterial | null = null;

/** The geometry and material shared by every tile's trees; never disposed with a tile. */
export function treeAssets(): { geometry: THREE.BufferGeometry; material: THREE.MeshLambertMaterial } {
  sharedGeometry ??= createTreeGeometry();
  if (!sharedMaterial) {
    sharedMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    sharedMaterial.name = 'trees';
  }
  return { geometry: sharedGeometry, material: sharedMaterial };
}

/** Re-colours the shared tree geometry for the day or night palette; the caller requests a render. */
export function setTreeMode(mode: StyleMode): void {
  treeMode = mode;
  if (!sharedGeometry) return; // built lazily with the right mode
  sharedGeometry.dispose();
  sharedGeometry.copy(createTreeGeometry());
}

/** The fields of a `trees` feature table row the client reads. */
export interface TreeRow {
  x: number;
  z: number;
  height_m: number;
}

function isTreeRow(r: Record<string, unknown>): r is Record<string, unknown> & TreeRow {
  return (
    typeof r.x === 'number' &&
    typeof r.z === 'number' &&
    typeof r.height_m === 'number' &&
    Number.isFinite(r.x) &&
    Number.isFinite(r.z) &&
    r.height_m > 0
  );
}

/** Instance matrices (column-major, 16 floats each) of the rows: position (x, base, z), uniform scale. */
export function treeMatrices(rows: readonly Record<string, unknown>[]): Float32Array {
  const valid = rows.filter(isTreeRow);
  const out = new Float32Array(valid.length * 16);
  const m = new THREE.Matrix4();
  valid.forEach((r, i) => {
    const s = r.height_m / TREE_UNIT_HEIGHT;
    m.makeScale(s, s, s).setPosition(r.x, TREE_BASE_Y, r.z);
    m.toArray(out, i * 16);
  });
  return out;
}

/** One InstancedMesh with all the trees of a tile, or null when there are none. */
export function buildTreeMesh(rows: readonly Record<string, unknown>[]): THREE.InstancedMesh | null {
  const matrices = treeMatrices(rows);
  const count = matrices.length / 16;
  if (count === 0) return null;
  const { geometry, material } = treeAssets();
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.array.set(matrices);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.name = 'trees';
  mesh.castShadow = false; // STYLE choice: only buildings cast shadows (materials.ts)
  mesh.receiveShadow = true;
  return mesh;
}
