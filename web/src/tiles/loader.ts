import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { layerOf, materialFor } from '../materials';
import type { TileEntry } from './manifest';

/** Most tiles fetched and decoded at the same time. */
export const MAX_CONCURRENT = 4;
/** Most loaded tiles kept in memory; style/UX constant, not data. */
export const CACHE_LIMIT = 64;

export interface TileStats {
  loaded: number;
  loading: number;
  failed: number;
}

export interface StreamerOptions<T> {
  /** Fetch and decode one tile. */
  load: (tile: TileEntry) => Promise<T>;
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
}

interface Entry<T> {
  obj: T;
  lastVisible: number;
}

/**
 * Loads wanted tiles nearest first with a concurrency limit, keeps at most `cacheLimit` tiles,
 * and evicts the least recently visible first. Tiles that are currently wanted are never evicted.
 * A failed tile is recorded once and not retried.
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

  constructor(
    tiles: TileEntry[],
    private readonly opts: StreamerOptions<T>,
  ) {
    this.tilesById = new Map(tiles.map((t) => [t.id, t]));
    this.maxConcurrent = opts.maxConcurrent ?? MAX_CONCURRENT;
    this.cacheLimit = opts.cacheLimit ?? CACHE_LIMIT;
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
    this.pump();
  }

  get stats(): TileStats {
    return {
      loaded: this.loadedMap.size,
      loading: this.loadingSet.size,
      failed: this.failedSet.size,
    };
  }

  isLoaded(id: string): boolean {
    return this.loadedMap.has(id);
  }

  get(id: string): T | undefined {
    return this.loadedMap.get(id)?.obj;
  }

  private pump(): void {
    for (const id of this.order) {
      if (this.loadingSet.size >= this.maxConcurrent) break;
      if (this.loadedMap.has(id) || this.loadingSet.has(id) || this.failedSet.has(id)) continue;
      const tile = this.tilesById.get(id);
      if (!tile) continue;
      this.start(tile);
    }
  }

  private start(tile: TileEntry): void {
    this.loadingSet.add(tile.id);
    this.opts.onChange?.();
    this.opts
      .load(tile)
      .then((obj) => {
        this.loadingSet.delete(tile.id);
        this.loadedMap.set(tile.id, { obj, lastVisible: this.tick });
        this.opts.onLoaded(tile.id, obj);
        this.evict();
      })
      .catch((err: unknown) => {
        this.loadingSet.delete(tile.id);
        this.failedSet.add(tile.id);
        this.opts.onError(tile.id, err);
      })
      .finally(() => {
        this.opts.onChange?.();
        this.pump();
      });
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

/** Dispose every geometry below `obj`. Materials are shared per layer and are never disposed here. */
export function disposeTile(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose();
  });
}

/**
 * GLTFLoader-based tile loader (`KHR_mesh_quantization` is native). `_FEATURE_ID` stays on each
 * geometry as the attribute `_feature_id` (three lower-cases custom attribute names) for Phase 5.
 * The file's placeholder materials are replaced by the shared `materialFor(layer)` instance.
 */
export function createGltfTileLoader(base: URL): (tile: TileEntry) => Promise<THREE.Group> {
  const loader = new GLTFLoader();
  return async (tile) => {
    const gltf = await loader.loadAsync(new URL(tile.glb.file, base).href);
    const group = gltf.scene;
    group.name = tile.id;
    group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const own = mesh.material;
      for (const m of Array.isArray(own) ? own : [own]) m.dispose();
      mesh.material = materialFor(layerOf(mesh.name));
    });
    return group;
  };
}
