import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { type FeatureTable, applyStyle, disposeLookupMaterial } from '../style/materials';
import { buildTreeMesh } from '../style/trees';
import { type TileEntry, assetUrl } from './manifest';

/** Most tiles fetched and decoded at the same time. */
export const MAX_CONCURRENT = 4;
/** Most loaded tiles kept in memory; style/UX constant, not data. */
export const CACHE_LIMIT = 64;

export interface TileStats {
  loaded: number;
  loading: number;
  failed: number;
  /** Requests started, completed and cancelled since the start (T-6.3). A cancelled tile can start again. */
  started: number;
  completed: number;
  cancelled: number;
}

export interface StreamerOptions<T> {
  /**
   * Fetch and decode one tile. The signal is aborted when the tile is no longer wanted: the request
   * must stop and the promise must reject (its result is dropped either way).
   */
  load: (tile: TileEntry, signal: AbortSignal) => Promise<T>;
  /** A tile finished loading (add it to the scene). */
  onLoaded: (id: string, obj: T) => void;
  /** A tile leaves the cache (remove it from the scene and dispose it). */
  onEvict: (id: string, obj: T) => void;
  /** A tile failed to load; called once per tile. */
  onError: (id: string, err: unknown) => void;
  /** Loaded, loading or failed sets changed. */
  onChange?: () => void;
  maxConcurrent?: number;
  cacheLimit?: number;
  /** Wait before the single retry of a failed tile (ms). */
  retryDelayMs?: number;
}

/** One retry of a failed tile after this delay; style/UX constant. */
export const RETRY_DELAY_MS = 2000;

interface Entry<T> {
  obj: T;
  lastVisible: number;
}

/**
 * Loads wanted tiles nearest first with a concurrency limit, keeps at most `cacheLimit` tiles,
 * and evicts the least recently visible first. Tiles that are currently wanted are never evicted.
 * A tile in flight that is no longer wanted (it left the view, or another level replaced it) is
 * cancelled with its AbortController: its request stops, it never reaches the scene, and it can be
 * requested again later (T-6.3). The tile entries may be added while running (`addTiles`), as the
 * shards that list them arrive.
 * A failed tile is retried once after `retryDelayMs`. While it waits it is counted as loading but
 * holds no loader slot (T-5.4), and it is retried only if it is still wanted when the wait ends;
 * if the retry fails too it is recorded and reported once.
 */
export class TileStreamer<T> {
  private readonly tilesById: Map<string, TileEntry>;
  private readonly loadedMap = new Map<string, Entry<T>>();
  private readonly loadingSet = new Set<string>();
  private readonly failedSet = new Set<string>();
  private order: string[] = [];
  private wanted = new Set<string>();
  private tick = 0;
  private readonly maxConcurrent: number;
  private readonly cacheLimit: number;
  private readonly retryDelayMs: number;
  private readonly retried = new Set<string>();
  /** Failed once, waiting for the retry delay: counted as loading, but not using a slot. */
  private readonly retryWait = new Set<string>();
  private readonly controllers = new Map<string, AbortController>();
  private startedN = 0;
  private completedN = 0;
  private cancelledN = 0;

  constructor(
    tiles: TileEntry[],
    private readonly opts: StreamerOptions<T>,
  ) {
    this.tilesById = new Map(tiles.map((t) => [t.id, t]));
    this.maxConcurrent = opts.maxConcurrent ?? MAX_CONCURRENT;
    this.cacheLimit = opts.cacheLimit ?? CACHE_LIMIT;
    this.retryDelayMs = opts.retryDelayMs ?? RETRY_DELAY_MS;
  }

  /**
   * @param wantedNearestFirst ids to have loaded, nearest to the view centre first
   * @param visible ids currently in view (refreshes their recency)
   */
  update(wantedNearestFirst: string[], visible: Iterable<string>): void {
    this.tick += 1;
    for (const id of visible) {
      const e = this.loadedMap.get(id);
      if (e) e.lastVisible = this.tick;
    }
    this.order = wantedNearestFirst;
    this.wanted = new Set(wantedNearestFirst);
    this.cancelUnwanted();
    this.pump();
  }

  /** Make tile entries known (a shard arrived); entries already known are kept as they are. */
  addTiles(tiles: readonly TileEntry[]): void {
    for (const t of tiles) if (!this.tilesById.has(t.id)) this.tilesById.set(t.id, t);
  }

  /** Abort every request in flight whose tile is no longer wanted; the tile is forgotten, not failed. */
  private cancelUnwanted(): void {
    for (const [id, ctl] of this.controllers) {
      if (this.wanted.has(id)) continue;
      this.controllers.delete(id);
      this.loadingSet.delete(id);
      this.cancelledN += 1;
      ctl.abort();
      this.opts.onChange?.();
    }
  }

  /** Tiles the last update asked for (in view and the prefetch ring); a wanted tile is never evicted. */
  get wantedCount(): number {
    return this.wanted.size;
  }

  get stats(): TileStats {
    return {
      loaded: this.loadedMap.size,
      loading: this.loadingSet.size + this.retryWait.size,
      failed: this.failedSet.size,
      started: this.startedN,
      completed: this.completedN,
      cancelled: this.cancelledN,
    };
  }

  isLoaded(id: string): boolean {
    return this.loadedMap.has(id);
  }

  /** A tile that failed for good (after its one retry). */
  isFailed(id: string): boolean {
    return this.failedSet.has(id);
  }

  /** Requests in flight whose tile is not wanted: always 0 after `update` (the invariant of T-6.3). */
  unwantedInFlight(): number {
    let n = 0;
    for (const id of this.loadingSet) if (!this.wanted.has(id)) n += 1;
    return n;
  }

  /** Ids of every loaded tile (any level), in load order. */
  loadedIds(): string[] {
    return [...this.loadedMap.keys()];
  }

  get(id: string): T | undefined {
    return this.loadedMap.get(id)?.obj;
  }

  private pump(): void {
    for (const id of this.order) {
      if (this.loadingSet.size >= this.maxConcurrent) break;
      if (this.loadedMap.has(id) || this.loadingSet.has(id) || this.retryWait.has(id) || this.failedSet.has(id)) continue;
      const tile = this.tilesById.get(id);
      if (!tile) continue;
      this.start(tile);
    }
  }

  private start(tile: TileEntry): void {
    const ctl = new AbortController();
    this.controllers.set(tile.id, ctl);
    this.loadingSet.add(tile.id);
    this.startedN += 1;
    this.opts.onChange?.();
    this.opts
      .load(tile, ctl.signal)
      .then((obj) => {
        // cancelled while the answer was on its way: the tile is not used (and `load` must have
        // released what it built; the loader checks the signal before it returns)
        if (ctl.signal.aborted) return;
        this.controllers.delete(tile.id);
        this.loadingSet.delete(tile.id);
        this.completedN += 1;
        this.loadedMap.set(tile.id, { obj, lastVisible: this.tick });
        this.opts.onLoaded(tile.id, obj);
        this.evict();
      })
      .catch((err: unknown) => {
        if (ctl.signal.aborted) return; // an abort is not a failure
        this.controllers.delete(tile.id);
        if (!this.retried.has(tile.id)) {
          // First failure: free the slot, count as loading, and try once more after the delay.
          this.retried.add(tile.id);
          this.loadingSet.delete(tile.id);
          this.retryWait.add(tile.id);
          setTimeout(() => this.retry(tile.id), this.retryDelayMs);
          return;
        }
        this.loadingSet.delete(tile.id);
        this.failedSet.add(tile.id);
        this.opts.onError(tile.id, err);
      })
      .finally(() => {
        this.opts.onChange?.();
        this.pump();
      });
  }

  /** The retry delay is over: retry only a tile that is still wanted (and there is a free slot). */
  private retry(id: string): void {
    this.retryWait.delete(id);
    if (!this.wanted.has(id)) this.retried.delete(id); // not wanted: forget it, a later want starts fresh
    this.opts.onChange?.();
    this.pump();
  }

  private evict(): void {
    while (this.loadedMap.size > this.cacheLimit) {
      let victim: string | undefined;
      let oldest = Infinity;
      for (const [id, e] of this.loadedMap) {
        if (this.wanted.has(id)) continue;
        if (e.lastVisible < oldest) {
          oldest = e.lastVisible;
          victim = id;
        }
      }
      if (victim === undefined) return; // everything left is wanted: keep it
      const e = this.loadedMap.get(victim) as Entry<T>;
      this.loadedMap.delete(victim);
      this.opts.onEvict(victim, e.obj);
    }
  }
}

/**
 * Dispose every geometry below `obj`, and the per-tile lookup materials (with their textures).
 * The flat per-layer materials are shared and are never disposed here.
 */
export function disposeTile(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if ((mesh as THREE.InstancedMesh).isInstancedMesh) {
      // Tree geometry and material are shared by every tile; only the instance buffer is ours.
      (mesh as THREE.InstancedMesh).dispose();
      return;
    }
    mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material;
    if (mat.userData.lookup) disposeLookupMaterial(mat);
  });
}

async function fetchFeatureTable(url: string, signal: AbortSignal): Promise<FeatureTable> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`feature table ${url}: HTTP ${res.status}`);
  return (await res.json()) as FeatureTable;
}

async function fetchGlb(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`tile ${url}: HTTP ${res.status}`);
  return res.arrayBuffer();
}

/**
 * GLTFLoader-based tile loader (`KHR_mesh_quantization` is native). `_FEATURE_ID` stays on each
 * geometry as the attribute `_feature_id` (three lower-cases custom attribute names) for Phase 5.
 * The file's placeholder materials are replaced by the style (T-3.3): the tile's feature table
 * is fetched next to the glb and drives the per-building colours (see style/materials.ts).
 * Both files are fetched here with the tile's AbortSignal (T-6.3) and the glb is parsed from the
 * bytes; an aborted tile throws before it builds anything, so nothing of it reaches the scene.
 */
export function createGltfTileLoader(
  base: URL,
): (tile: TileEntry, signal: AbortSignal) => Promise<THREE.Group> {
  const loader = new GLTFLoader();
  return async (tile, signal) => {
    const [buf, table] = await Promise.all([
      fetchGlb(assetUrl(base, tile.glb.file, tile.glb.sha256).href, signal),
      fetchFeatureTable(assetUrl(base, tile.features.file, tile.features.sha256).href, signal),
    ]);
    signal.throwIfAborted();
    const gltf = await loader.parseAsync(buf, '');
    signal.throwIfAborted();
    const group = gltf.scene;
    group.name = tile.id;
    group.userData.table = table; // feature table, read by picking and the info card (T-5.1)
    group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const own = mesh.material;
      for (const m of Array.isArray(own) ? own : [own]) m.dispose();
      applyStyle(mesh, table);
    });
    // Trees (T-4.1): instance data lives in the feature table, one InstancedMesh per tile.
    const trees = buildTreeMesh(table.layers.trees ?? []);
    if (trees) group.add(trees);
    freezeMatrices(group);
    return group;
  };
}

/**
 * A loaded tile never moves: compute every local matrix once and stop three.js recomputing them (compose,
 * updateMatrix, multiplyMatrices) for every mesh of every tile on every frame (T-6.4, measured in R-6.4).
 * The world matrices are still computed once by the first updateMatrixWorld after the tile is added.
 */
export function freezeMatrices(root: THREE.Object3D): void {
  root.traverse((o) => {
    o.updateMatrix();
    o.matrixAutoUpdate = false;
  });
}
