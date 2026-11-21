import * as THREE from 'three';
import type { TileEntry } from './manifest';

export interface CullResult {
  /** Tile ids whose content box intersects the view volume. */
  visible: string[];
  /** Visible plus one tile ring of margin (prefetch). */
  wanted: string[];
}

/** View frustum of a camera (world space). */
export function frustumOf(camera: THREE.Camera): THREE.Frustum {
  camera.updateMatrixWorld();
  const m = new THREE.Matrix4().multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse,
  );
  return new THREE.Frustum().setFromProjectionMatrix(m);
}

// One scratch box for every test: the culling runs on every camera change over every tile of the level,
// and a new Box3 and two Vector3 per tile per frame is garbage for nothing (T-6.4).
const SCRATCH = new THREE.Box3();

function boxOf(tile: TileEntry, margin: number): THREE.Box3 {
  const { min, max } = tile.content_bbox_local;
  SCRATCH.min.set(min[0] - margin, min[1], min[2] - margin);
  SCRATCH.max.set(max[0] + margin, max[1], max[2] + margin);
  return SCRATCH;
}

/** True if the tile's 3D content box (grown horizontally by `margin` metres) meets the frustum. */
export function tileIntersects(tile: TileEntry, frustum: THREE.Frustum, margin = 0): boolean {
  return frustum.intersectsBox(boxOf(tile, margin));
}

const SPHERE = new THREE.Sphere();

/**
 * True if the bounding sphere of the tile's content (the box's own centre, half its diagonal) meets the
 * frustum: the test three.js applies to each mesh before it draws it, so it admits a little more than the
 * box test above. The draw calls of a view are counted with this one (T-6.5).
 */
export function tileSphereIntersects(tile: TileEntry, frustum: THREE.Frustum): boolean {
  const { min, max } = tile.content_bbox_local;
  SPHERE.center.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
  SPHERE.radius = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2;
  return frustum.intersectsSphere(SPHERE);
}

/**
 * Tiles in view and tiles to load. The margin is one tile ring: the content box grown by one
 * tile size on x and z. Output ids keep the manifest order.
 */
export function cullTiles(
  tiles: TileEntry[],
  frustum: THREE.Frustum,
  tileSize: number,
): CullResult {
  const visible: string[] = [];
  const wanted: string[] = [];
  for (const t of tiles) {
    if (tileIntersects(t, frustum, 0)) {
      visible.push(t.id);
      wanted.push(t.id);
    } else if (tileIntersects(t, frustum, tileSize)) {
      wanted.push(t.id);
    }
  }
  return { visible, wanted };
}

/** Ground point (x, z) the camera looks at: the view axis meets the plane y = 0. */
export function viewCentre(camera: THREE.Camera): [number, number] {
  camera.updateMatrixWorld();
  const dir = camera.getWorldDirection(new THREE.Vector3());
  const p = camera.position;
  if (Math.abs(dir.y) < 1e-9) return [p.x, p.z];
  const s = -p.y / dir.y;
  return [p.x + dir.x * s, p.z + dir.z * s];
}

/** Tile ids sorted by horizontal distance of the content box centre to (cx, cz); ties by id. */
export function sortNearestFirst(
  tiles: TileEntry[],
  ids: Iterable<string>,
  cx: number,
  cz: number,
): string[] {
  const byId = new Map(tiles.map((t) => [t.id, t]));
  const dist = (id: string): number => {
    const t = byId.get(id);
    if (!t) return Infinity;
    const { min, max } = t.content_bbox_local;
    return Math.hypot((min[0] + max[0]) / 2 - cx, (min[2] + max[2]) / 2 - cz);
  };
  return [...ids].sort((a, b) => dist(a) - dist(b) || (a < b ? -1 : a > b ? 1 : 0));
}
