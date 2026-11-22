import type * as THREE from 'three';
import { type MeshBound, countBounds, cullTiles, meshBounds, sortNearestFirst, tileSphereIntersects } from './culling';
import {
  BUDGET_MAX_LEVEL,
  type Cell,
  DRAW_CALL_CAP,
  NON_TILE_CALLS,
  PROBE_MAX_TILES,
  PROBE_RATIO,
  cellOf,
  chooseBudgetLevel,
  chooseLevel,
  planDraw,
  tileCalls,
} from './levels';
import { ShardCatalog, type CatalogStats } from './catalog';
import type { TileStreamer } from './loader';
import { type Manifest, type ShardRecord, type TileEntry, levelSpecs } from './manifest';

export interface LodState {
  /** Level in use (0 = base tiles). */
  level: number;
  /** Level of the 1-pixel rule (ADR-0037); `level` is coarser than this when the draw-call budget switched (T-6.5). */
  baseLevel: number;
  budgetSwitched: boolean;
  /**
   * Draw calls of the level in use with all layers shown (T-6.6): the meshes of its loaded tiles that meet the view, plus the
   * casters that meet the sun's frustum, plus the ground; a tile not loaded yet counts as its manifest says. Null while the
   * tiles of the level in view are not known yet.
   */
  estimatedCalls: number | null;
  /** True when every tile of that count is loaded: the count is then the frame's own, not a bound. */
  estimatedExact: boolean | null;
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
  /** Draw-call cap of a view (T-6.5); default DRAW_CALL_CAP. */
  cap?: number;
  /** Draw calls of a view that are not tiles, added to every plan (default NON_TILE_CALLS; tests set 0). */
  nonTileCalls?: number;
  /** Buildings cast shadows (one more draw call per tile) at the levels below this one; 0 when shadows are off. */
  castersBelowLevel?: number;
}

export class LodController<T extends THREE.Object3D> {
  private readonly specs;
  private readonly byLevel = new Map<number, TileEntry[]>();
  private readonly cells = new Map<string, Cell>();
  private readonly catalog: ShardCatalog;
  private level = 0;
  private baseLevel = 0;
  private estimated: number | null = null;
  private estimatedIsExact: boolean | null = null;
  /** The last decision waited for tiles (a count that is a bound, or a level being counted): ask again when tiles arrive. */
  private waiting = false;
  private seenTiles = 0;
  private readonly bounds = new WeakMap<object, MeshBound[] | null>();
  private readonly cap: number;
  private readonly nonTile: number;
  private readonly castersBelow: number;
  /** Per tile: draw calls of its meshes, and of its shadow pass. */
  private readonly calls = new Map<string, number>();
  private readonly shadowCalls = new Map<string, number>();
  private mpp = 0;
  private visible: string[] = [];
  private neededShards: ShardRecord[] = [];
  private drawn = new Set<string>();

  constructor(
    private readonly manifest: Manifest,
    private readonly streamer: TileStreamer<T>,
    opts: LodOptions,
  ) {
    this.cap = opts.cap ?? DRAW_CALL_CAP;
    this.nonTile = opts.nonTileCalls ?? NON_TILE_CALLS;
    this.castersBelow = opts.castersBelowLevel ?? 0;
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
      const meshes = tileCalls(lv, t.counts, this.manifest.layers, false);
      this.calls.set(t.id, meshes);
      this.shadowCalls.set(t.id, tileCalls(lv, t.counts, this.manifest.layers, lv < this.castersBelow) - meshes);
    }
    this.streamer.addTiles(tiles);
  }

  /**
   * What a level needs for this view: its shards in view (nearest first), its tiles in view and in the
   * prefetch ring, and how many of those shards are not loaded yet.
   */
  private viewOf(level: number, frustum: THREE.Frustum, cx: number, cz: number) {
    const margin = this.manifest.tile_size_m;
    const shards = this.catalog
      .inView(level, frustum, margin)
      .sort((a, b) => shardDistance(a, cx, cz) - shardDistance(b, cx, cz) || (a.id < b.id ? -1 : 1));
    const tiles = this.byLevel.get(level) ?? [];
    return { shards, tiles, missing: this.catalog.missing(shards), culled: cullTiles(tiles, frustum, margin) };
  }

  /** Camera changed: choose the level, cull it, tell the streamer what to load. */
  update(frustum: THREE.Frustum, mpp: number, cx: number, cz: number, shadowFrustum?: THREE.Frustum): void {
    this.mpp = mpp;
    const wasSwitched = this.level > this.baseLevel; // the level in use was chosen by the budget, not by the 1-pixel rule
    this.baseLevel = chooseLevel(this.specs, mpp, this.baseLevel);
    // The draw-call budget (T-6.5): the level of the 1-pixel rule, or a coarser one if its plan is over the cap.
    const views = new Map<number, ReturnType<LodController<T>['viewOf']>>();
    const view = (l: number) => {
      let v = views.get(l);
      if (!v) {
        v = this.viewOf(l, frustum, cx, cz);
        views.set(l, v);
      }
      return v;
    };
    // The count of a level (T-6.6): the draw calls it will issue once its tiles in view are loaded. A loaded tile is counted
    // from its meshes: each whose bounding sphere meets the view (three.js's own test), and each caster whose sphere meets
    // the sun's shadow frustum (the shadow pass's own test). A tile not loaded yet is counted as its manifest says: every
    // layer of a tile whose content sphere meets the view, a bound that is never below what the tile will cost.
    const shadowOf = (l: number): THREE.Frustum | undefined => (l < this.castersBelow ? (shadowFrustum ?? frustum) : undefined);
    const count = (l: number) => {
      const v = view(l);
      const sh = shadowOf(l);
      let n = this.nonTile;
      let tilesInPlan = 0;
      const pending: string[] = [];
      for (const t of v.tiles) {
        const obj = this.streamer.get(t.id);
        const mb = obj ? this.boundsOf(obj) : null;
        if (mb) {
          const c = countBounds(mb, frustum, sh);
          n += c.main + c.shadow;
          if (c.main + c.shadow > 0) tilesInPlan += 1;
          continue;
        }
        const inMain = tileSphereIntersects(t, frustum);
        const inShadow = sh !== undefined && (this.shadowCalls.get(t.id) ?? 0) > 0 && tileSphereIntersects(t, sh);
        if (!inMain && !inShadow) continue;
        if (inMain) n += this.calls.get(t.id) ?? 0;
        if (inShadow) n += this.shadowCalls.get(t.id) ?? 0;
        tilesInPlan += 1;
        if (!obj && !this.streamer.isFailed(t.id)) pending.push(t.id);
      }
      return { n, tilesInPlan, pending };
    };
    const needs = new Map<number, string[]>();
    const planCalls = (l: number, limit: number): number | null => {
      if (view(l).missing > 0) return null; // the tiles of this level in view are not all known yet
      const c = count(l);
      if (c.pending.length === 0 || c.n <= limit) return c.n;
      // Over the limit only by the bound on tiles not loaded yet. Whether it fits is told by loading them (the manifest
      // bound can be well above the frame), unless it cannot fit by any measured margin or there are too many to hold.
      if (c.tilesInPlan > PROBE_MAX_TILES || c.n * PROBE_RATIO > this.cap) return c.n;
      needs.set(l, c.pending);
      return null;
    };
    const unknown: number[] = [];
    const maxLevel = Math.min(BUDGET_MAX_LEVEL, this.specs[this.specs.length - 1]?.level ?? 0);
    this.level = chooseBudgetLevel(this.baseLevel, wasSwitched ? this.level : this.baseLevel, maxLevel, planCalls, this.cap, unknown);
    const chosen = view(this.level);
    const own = chosen.missing > 0 ? null : count(this.level);
    this.estimated = own ? own.n : null;
    this.estimatedIsExact = own ? own.pending.length === 0 : null;
    this.waiting = unknown.length > 0 || (own?.pending.length ?? 0) > 0;
    // Which shards of this level the view needs (nearest first): request them, cancel the others. The
    // finer levels whose plan is still unknown are asked for too, to answer the budget question.
    this.neededShards = chosen.shards;
    this.catalog.want([...chosen.shards, ...unknown.flatMap((l) => view(l).shards)]);
    const tiles = chosen.tiles;
    const { visible, wanted } = chosen.culled;
    this.visible = visible;
    // Order (T-6.3): the tiles in view first, nearest to the view centre first, then the prefetch ring,
    // nearest first. The view is complete before a single tile of the ring is fetched.
    const inView = new Set(visible);
    const ring = wanted.filter((id) => !inView.has(id));
    // After them: the tiles of the level in use that its count still waits for, and those of the levels being counted.
    const listed = new Set([...visible, ...ring]);
    const extra = (own?.pending ?? []).filter((id) => !listed.has(id));
    const probes = unknown.flatMap((l) => {
      const ids = (needs.get(l) ?? []).filter((id) => !listed.has(id) && !extra.includes(id));
      return sortNearestFirst(view(l).tiles, ids, cx, cz);
    });
    this.streamer.update(
      [...sortNearestFirst(tiles, visible, cx, cz), ...sortNearestFirst(tiles, ring, cx, cz), ...sortNearestFirst(tiles, extra, cx, cz), ...probes],
      [...this.plan(), ...visible],
    );
    this.seenTiles = this.tilesSignal();
    this.apply();
  }

  /** Mesh bounds of a loaded tile, measured once (a tile never moves); null when it has no mesh (then its manifest count is used). */
  private boundsOf(obj: T): MeshBound[] | null {
    let b = this.bounds.get(obj);
    if (b === undefined) {
      const m = meshBounds(obj);
      b = m.length > 0 ? m : null;
      this.bounds.set(obj, b);
    }
    return b;
  }

  /** Changes whenever a tile finished loading or failed for good. */
  private tilesSignal(): number {
    const st = this.streamer.stats;
    return st.completed + st.failed;
  }

  /**
   * True when the last decision waited for tiles (a count that was a bound, or a finer level being counted) and tiles have
   * arrived since: the camera did not move, but the question is to be asked again (T-6.6).
   */
  needsRecheck(): boolean {
    return this.waiting && this.tilesSignal() !== this.seenTiles;
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
      baseLevel: this.baseLevel,
      budgetSwitched: this.level > this.baseLevel,
      estimatedCalls: this.estimated,
      estimatedExact: this.estimatedIsExact,
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
