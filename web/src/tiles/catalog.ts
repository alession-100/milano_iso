import * as THREE from 'three';
import type { ShardRecord, TileEntry } from './manifest';

export interface CatalogOptions {
  /** Fetch and parse one shard; must reject with the signal's reason when it is aborted. */
  fetchShard: (rec: ShardRecord, signal: AbortSignal) => Promise<TileEntry[]>;
  /** A shard arrived: its tile entries are now known. */
  onShard: (tiles: TileEntry[], rec: ShardRecord) => void;
  /** A shard could not be fetched or parsed (not an abort); called once per failure. */
  onError?: (rec: ShardRecord, err: unknown) => void;
  /** The caller should run `want` again: a shard arrived, a retry wait ended, or a shard failed for good. */
  onChange?: () => void;
  /** Wait before the single retry of a failed shard (ms). */
  retryDelayMs?: number;
}

/** One retry of a failed shard after this delay, like a failed tile; style/UX constant. */
export const SHARD_RETRY_DELAY_MS = 2000;

export interface CatalogStats {
  /** Shards known to the root manifest, loaded, in flight now. */
  total: number;
  loaded: number;
  loading: number;
  failed: number;
  /** Requests started, completed and cancelled since the start (T-6.3 measurement). */
  started: number;
  completed: number;
  cancelled: number;
}

/**
 * The tile entries of the tileset, fetched shard by shard as the view needs them (T-6.3).
 * `want` is called with the shards the current view needs: a shard that is not loaded is requested,
 * and a request in flight for a shard that is no longer needed is aborted (it can be requested again).
 * Loaded shards stay in memory: a shard is a few KB, and the whole city is about 2.4 MB of JSON.
 */
export class ShardCatalog {
  private readonly byLevel = new Map<number, ShardRecord[]>();
  private readonly loadedIds = new Set<string>();
  private readonly failedIds = new Set<string>();
  private readonly inFlight = new Map<string, AbortController>();
  private readonly retried = new Set<string>();
  private readonly retryWait = new Set<string>();
  private startedN = 0;
  private completedN = 0;
  private cancelledN = 0;

  constructor(
    private readonly shards: ShardRecord[],
    private readonly opts: CatalogOptions,
  ) {
    for (const s of shards) {
      const list = this.byLevel.get(s.level) ?? [];
      list.push(s);
      this.byLevel.set(s.level, list);
    }
  }

  /** The shards of `level` whose content box meets the frustum grown by `margin` metres (not yet loaded or not). */
  inView(level: number, frustum: THREE.Frustum, margin: number): ShardRecord[] {
    const out: ShardRecord[] = [];
    for (const s of this.byLevel.get(level) ?? []) {
      const { min, max } = s.content_bbox_local;
      const box = new THREE.Box3(
        new THREE.Vector3(min[0] - margin, min[1], min[2] - margin),
        new THREE.Vector3(max[0] + margin, max[1], max[2] + margin),
      );
      if (frustum.intersectsBox(box)) out.push(s);
    }
    return out;
  }

  /** Make `needed` (nearest first) the set of shards to have: request the missing, abort the unneeded. */
  want(needed: readonly ShardRecord[]): void {
    const ids = new Set(needed.map((s) => s.id));
    for (const [id, ctl] of this.inFlight) {
      if (!ids.has(id)) {
        this.inFlight.delete(id);
        this.cancelledN += 1;
        ctl.abort();
      }
    }
    for (const rec of needed) {
      if (
        this.loadedIds.has(rec.id) ||
        this.failedIds.has(rec.id) ||
        this.inFlight.has(rec.id) ||
        this.retryWait.has(rec.id)
      ) {
        continue;
      }
      this.start(rec);
    }
  }

  private start(rec: ShardRecord): void {
    const ctl = new AbortController();
    this.inFlight.set(rec.id, ctl);
    this.startedN += 1;
    this.opts.fetchShard(rec, ctl.signal).then(
      (tiles) => {
        if (ctl.signal.aborted) return; // cancelled while the answer was on its way: not used
        this.inFlight.delete(rec.id);
        this.loadedIds.add(rec.id);
        this.completedN += 1;
        this.opts.onShard(tiles, rec);
        this.opts.onChange?.();
      },
      (err: unknown) => {
        if (ctl.signal.aborted) return; // counted as cancelled by `want`
        this.inFlight.delete(rec.id);
        if (!this.retried.has(rec.id)) {
          // first failure: wait, then the next `want` (the onChange below asks for one) tries again
          this.retried.add(rec.id);
          this.retryWait.add(rec.id);
          setTimeout(() => {
            this.retryWait.delete(rec.id);
            this.opts.onChange?.();
          }, this.opts.retryDelayMs ?? SHARD_RETRY_DELAY_MS);
        } else {
          this.failedIds.add(rec.id);
          this.opts.onError?.(rec, err);
        }
        this.opts.onChange?.();
      },
    );
  }

  isLoaded(id: string): boolean {
    return this.loadedIds.has(id);
  }

  /** Shards of `level` in `needed` that are neither loaded nor failed: the view is not complete yet. */
  missing(needed: readonly ShardRecord[]): number {
    return needed.filter((s) => !this.loadedIds.has(s.id) && !this.failedIds.has(s.id)).length;
  }

  get stats(): CatalogStats {
    return {
      total: this.shards.length,
      loaded: this.loadedIds.size,
      loading: this.inFlight.size + this.retryWait.size,
      failed: this.failedIds.size,
      started: this.startedN,
      completed: this.completedN,
      cancelled: this.cancelledN,
    };
  }
}
