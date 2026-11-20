import type * as THREE from 'three';
import { cullTiles, sortNearestFirst } from './culling';
import { type Cell, cellOf, chooseLevel, planDraw } from './levels';
import { ShardCatalog, type CatalogStats } from './catalog';
import type { TileStreamer } from './loader';
import { type Manifest, type ShardRecord, type TileEntry, levelSpecs } from './manifest';

export interface LodState {
  /** Level in use (0 = base tiles). */
  level: number;
  /** Metres per CSS pixel at the last camera change. */
  mpp: number;
  /** Tolerance in metres of every level of the tileset, ascending. */
  tolerances: number[];
  /** Chosen-level tiles in view, and how many of them are not loaded yet. */
  visible: number;
  pending: number;
  /** Shard files (tile entries, T-6.3) of the level in use that are in view and not loaded yet. */
  shardsPending: number;
  /** Shard requests of the whole session. */
  shards: CatalogStats;
  /** Tiles drawn right now, per level. */
  drawnByLevel: Record<number, number>;
  /** Tiles loaded (drawn or not), per level. */
  loadedByLevel: Record<number, number>;
}

/**
 * Level selection and switching on top of the tile streamer (T-6.2). The camera drives `update`
 * (level choice, culling, what to load); `apply` runs every frame and decides which loaded tiles
 * are drawn, so a coarser tile stays until the finer ones replace it, and a parent is never drawn
 * with its children (see `planDraw`).
 */
export interface LodOptions {
  /** Fetch one shard of tile entries (T-6.3); rejects when the signal is aborted. */
  fetchShard: (rec: ShardRecord, signal: AbortSignal) => Promise<TileEntry[]>;
  /** A shard arrived: the view must be culled again (the camera did not change, so the caller forces it). */
  onShardsChanged?: () => void;
  onShardError?: (rec: ShardRecord, err: unknown) => void;
  retryDelayMs?: number;
}

export class LodController<T extends THREE.Object3D> {
  private readonly specs;
  private readonly byLevel = new Map<number, TileEntry[]>();
  private readonly cells = new Map<string, Cell>();
  private readonly catalog: ShardCatalog;
  private level = 0;
  private mpp = 0;
  private visible: string[] = [];
  private neededShards: ShardRecord[] = [];
  private drawn = new Set<string>();

  constructor(
    private readonly manifest: Manifest,
    private readonly streamer: TileStreamer<T>,
    opts: LodOptions,
  ) {
    this.specs = levelSpecs(manifest);
    this.catalog = new ShardCatalog(manifest.shards, {
      fetchShard: opts.fetchShard,
      onShard: (tiles) => this.addTiles(tiles),
      onError: opts.onShardError,
      onChange: opts.onShardsChanged,
      retryDelayMs: opts.retryDelayMs,
    });
  }

  /** A shard arrived: its tiles join the level they belong to. */
  private addTiles(tiles: readonly TileEntry[]): void {
    for (const t of tiles) {
      if (this.cells.has(t.id)) continue;
      const lv = t.level ?? 0;
      const list = this.byLevel.get(lv) ?? [];
      list.push(t);
      this.byLevel.set(lv, list);
      this.cells.set(t.id, cellOf(t));
    }
    this.streamer.addTiles(tiles);
  }

  /** Camera changed: choose the level, cull it, tell the streamer what to load. */
  update(frustum: THREE.Frustum, mpp: number, cx: number, cz: number): void {
    this.mpp = mpp;
    this.level = chooseLevel(this.specs, mpp, this.level);
    // Which shards of this level the view needs (nearest first): request them, cancel the others.
    const margin = this.manifest.tile_size_m;
    this.neededShards = this.catalog
      .inView(this.level, frustum, margin)
      .sort((a, b) => shardDistance(a, cx, cz) - shardDistance(b, cx, cz) || (a.id < b.id ? -1 : 1));
    this.catalog.want(this.neededShards);
    const tiles = this.byLevel.get(this.level) ?? [];
    const { visible, wanted } = cullTiles(tiles, frustum, this.manifest.tile_size_m);
    this.visible = visible;
    // Order (T-6.3): the tiles in view first, nearest to the view centre first, then the prefetch ring,
    // nearest first. The view is complete before a single tile of the ring is fetched.
    const inView = new Set(visible);
    const ring = wanted.filter((id) => !inView.has(id));
    this.streamer.update(
      [...sortNearestFirst(tiles, visible, cx, cz), ...sortNearestFirst(tiles, ring, cx, cz)],
      [...this.plan(), ...visible],
    );
    this.apply();
  }

  private plan(): Set<string> {
    const visibleCells = this.visible.map((id) => this.cells.get(id) as Cell);
    const loaded = this.streamer.loadedIds().map((id) => this.cells.get(id) as Cell);
    return planDraw(this.level, visibleCells, loaded, (id) => this.streamer.isLoaded(id));
  }

  /** Show the planned tiles and hide the rest of the loaded ones. Returns true if anything changed. */
  apply(): boolean {
    this.drawn = this.plan();
    let changed = false;
    for (const id of this.streamer.loadedIds()) {
      const obj = this.streamer.get(id);
      if (!obj) continue;
      const show = this.drawn.has(id);
      if (obj.visible !== show) {
        obj.visible = show;
        changed = true;
      }
    }
    return changed;
  }

  /** Level in use (0 = base tiles). */
  get currentLevel(): number {
    return this.level;
  }

  state(): LodState {
    const drawn: Record<number, number> = {};
    const loaded: Record<number, number> = {};
    for (const id of this.streamer.loadedIds()) {
      const lv = this.cells.get(id)?.level ?? 0;
      loaded[lv] = (loaded[lv] ?? 0) + 1;
      if (this.drawn.has(id)) drawn[lv] = (drawn[lv] ?? 0) + 1;
    }
    return {
      level: this.level,
      mpp: this.mpp,
      tolerances: this.specs.map((s) => s.tolerance_m),
      visible: this.visible.length,
      // tiles not loaded yet, plus one for every shard whose tiles are not even known yet
      pending:
        this.visible.filter((id) => !this.streamer.isLoaded(id) && !this.streamer.isFailed(id)).length +
        this.catalog.missing(this.neededShards),
      shardsPending: this.catalog.missing(this.neededShards),
      shards: this.catalog.stats,
      drawnByLevel: drawn,
      loadedByLevel: loaded,
    };
  }
}

/** Horizontal distance from (cx, cz) to the centre of a shard's content box. */
function shardDistance(s: ShardRecord, cx: number, cz: number): number {
  const { min, max } = s.content_bbox_local;
  return Math.hypot((min[0] + max[0]) / 2 - cx, (min[2] + max[2]) / 2 - cz);
}
