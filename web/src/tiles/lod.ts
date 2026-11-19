import type * as THREE from 'three';
import { cullTiles, sortNearestFirst } from './culling';
import { type Cell, cellOf, chooseLevel, planDraw } from './levels';
import type { TileStreamer } from './loader';
import { type Manifest, type TileEntry, allTiles, levelSpecs } from './manifest';

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
export class LodController<T extends THREE.Object3D> {
  private readonly specs;
  private readonly byLevel = new Map<number, TileEntry[]>();
  private readonly cells = new Map<string, Cell>();
  private level = 0;
  private mpp = 0;
  private visible: string[] = [];
  private drawn = new Set<string>();

  constructor(
    private readonly manifest: Manifest,
    private readonly streamer: TileStreamer<T>,
  ) {
    this.specs = levelSpecs(manifest);
    for (const t of allTiles(manifest)) {
      const lv = t.level ?? 0;
      const list = this.byLevel.get(lv) ?? [];
      list.push(t);
      this.byLevel.set(lv, list);
      this.cells.set(t.id, cellOf(t));
    }
  }

  /** Camera changed: choose the level, cull it, tell the streamer what to load. */
  update(frustum: THREE.Frustum, mpp: number, cx: number, cz: number): void {
    this.mpp = mpp;
    this.level = chooseLevel(this.specs, mpp, this.level);
    const tiles = this.byLevel.get(this.level) ?? [];
    const { visible, wanted } = cullTiles(tiles, frustum, this.manifest.tile_size_m);
    this.visible = visible;
    this.streamer.update(sortNearestFirst(tiles, wanted, cx, cz), [...this.plan(), ...visible]);
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
      pending: this.visible.filter((id) => !this.streamer.isLoaded(id) && !this.streamer.isFailed(id)).length,
      drawnByLevel: drawn,
      loadedByLevel: loaded,
    };
  }
}
