import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { layerOf } from '../style/materials';
import { TileStreamer, freezeMatrices } from './loader';
import type { TileEntry } from './manifest';

function entries(n: number): TileEntry[] {
  return Array.from({ length: n }, (_, k) => ({
    id: `t${k}`,
    i: k,
    j: 0,
    content_bbox_local: { min: [0, 0, 0], max: [1, 1, 1] },
    glb: { file: `t${k}.glb` },
    features: { file: `t${k}.json` },
  }));
}

/** A load function whose promises the test resolves or rejects by hand. */
function manual() {
  const pending = new Map<string, { ok: (v: string) => void; ko: (e: Error) => void }>();
  const started: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const signals = new Map<string, AbortSignal>();
  const load = (t: TileEntry, signal: AbortSignal) =>
    new Promise<string>((ok, ko) => {
      started.push(t.id);
      signals.set(t.id, signal);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      // like fetch: an abort rejects the promise (and the request stops, so it no longer counts)
      signal.addEventListener('abort', () => {
        inFlight -= 1;
        ko(new DOMException('aborted', 'AbortError'));
      });
      pending.set(t.id, {
        ok: (v) => {
          inFlight -= 1;
          ok(v);
        },
        ko: (e) => {
          inFlight -= 1;
          ko(e);
        },
      });
    });
  return { load, pending, started, signals, max: () => maxInFlight };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('TileStreamer', () => {
  it('loads at most 4 at a time, nearest first, and continues the queue', async () => {
    const m = manual();
    const ts = entries(7);
    const s = new TileStreamer<string>(ts, {
      load: m.load,
      onLoaded: () => {},
      onEvict: () => {},
      onError: () => {},
    });
    const order = ts.map((t) => t.id);
    s.update(order, order);
    expect(m.started).toEqual(['t0', 't1', 't2', 't3']);
    expect(s.stats).toMatchObject({ loaded: 0, loading: 4, failed: 0 });
    m.pending.get('t0')?.ok('a');
    await tick();
    expect(m.started).toEqual(['t0', 't1', 't2', 't3', 't4']);
    for (const id of ['t1', 't2', 't3', 't4', 't5', 't6']) {
      await tick();
      m.pending.get(id)?.ok(id);
    }
    await tick();
    expect(s.stats).toMatchObject({ loaded: 7, loading: 0, failed: 0 });
    expect(m.max()).toBe(4);
  });

  it('a tile that fails twice is retried once, then reported once, counted, and not retried again', async () => {
    const m = manual();
    const errors: string[] = [];
    const s = new TileStreamer<string>(entries(2), {
      load: m.load,
      onLoaded: () => {},
      onEvict: () => {},
      onError: (id) => errors.push(id),
      retryDelayMs: 20,
    });
    s.update(['t0', 't1'], ['t0', 't1']);
    m.pending.get('t0')?.ko(new Error('boom'));
    m.pending.get('t1')?.ok('b');
    await tick();
    // Waiting for the retry: not reported, still counted as loading.
    expect(errors).toEqual([]);
    expect(s.stats).toMatchObject({ loaded: 1, loading: 1, failed: 0 });
    await new Promise((r) => setTimeout(r, 40));
    expect(m.started).toEqual(['t0', 't1', 't0']);
    m.pending.get('t0')?.ko(new Error('boom again'));
    await tick();
    s.update(['t0', 't1'], ['t0', 't1']);
    s.update(['t0', 't1'], ['t0', 't1']);
    expect(errors).toEqual(['t0']);
    expect(s.stats).toMatchObject({ loaded: 1, loading: 0, failed: 1 });
    expect(m.started).toEqual(['t0', 't1', 't0']);
    // T-6.2: the level logic asks which tiles are loaded and which failed for good
    expect(s.loadedIds()).toEqual(['t1']);
    expect(s.isFailed('t0')).toBe(true);
    expect(s.isFailed('t1')).toBe(false);
  });

  it('a tile waiting for its retry holds no loader slot (T-5.4)', async () => {
    const m = manual();
    const s = new TileStreamer<string>(entries(3), {
      load: m.load,
      onLoaded: () => {},
      onEvict: () => {},
      onError: () => {},
      maxConcurrent: 1,
      retryDelayMs: 60,
    });
    s.update(['t0', 't1', 't2'], ['t0', 't1', 't2']);
    expect(m.started).toEqual(['t0']);
    m.pending.get('t0')?.ko(new Error('boom'));
    await tick();
    // t0 waits for its retry (counted as loading) but the single slot is free: t1 starts now.
    expect(m.started).toEqual(['t0', 't1']);
    expect(s.stats.loading).toBe(2);
    m.pending.get('t1')?.ok('1');
    await tick();
    expect(m.started).toEqual(['t0', 't1', 't2']);
    m.pending.get('t2')?.ok('2');
    await new Promise((r) => setTimeout(r, 90));
    expect(m.started).toEqual(['t0', 't1', 't2', 't0']); // the retry runs after the wait
    expect(m.max()).toBe(1);
  });

  it('a tile that is no longer wanted when its retry is due is not retried (T-5.4)', async () => {
    const m = manual();
    const errors: string[] = [];
    const s = new TileStreamer<string>(entries(2), {
      load: m.load,
      onLoaded: () => {},
      onEvict: () => {},
      onError: (id) => errors.push(id),
      retryDelayMs: 20,
    });
    s.update(['t0'], ['t0']);
    m.pending.get('t0')?.ko(new Error('boom'));
    await tick();
    s.update(['t1'], ['t1']); // the view moved on: t0 is not wanted any more
    await new Promise((r) => setTimeout(r, 40));
    expect(m.started).toEqual(['t0', 't1']); // no retry of t0
    expect(errors).toEqual([]);
    expect(s.stats.loading).toBe(1); // only t1
    // Wanted again later: it loads afresh and gets its own retry.
    s.update(['t0', 't1'], ['t0', 't1']);
    expect(m.started).toEqual(['t0', 't1', 't0']);
  });

  it('a tile that fails once and then loads is loaded with no error', async () => {
    const m = manual();
    const errors: string[] = [];
    const s = new TileStreamer<string>(entries(1), {
      load: m.load,
      onLoaded: () => {},
      onEvict: () => {},
      onError: (id) => errors.push(id),
      retryDelayMs: 20,
    });
    s.update(['t0'], ['t0']);
    m.pending.get('t0')?.ko(new Error('boom'));
    await new Promise((r) => setTimeout(r, 40));
    m.pending.get('t0')?.ok('a');
    await tick();
    expect(errors).toEqual([]);
    expect(s.stats).toMatchObject({ loaded: 1, loading: 0, failed: 0 });
  });

  it('evicts the least recently visible tile that is not wanted, and disposes it', async () => {
    const m = manual();
    const evicted: string[] = [];
    const ts = entries(4);
    const s = new TileStreamer<string>(ts, {
      load: m.load,
      onLoaded: () => {},
      onEvict: (id) => evicted.push(id),
      onError: () => {},
      cacheLimit: 2,
      maxConcurrent: 1,
    });
    // t0 visible, loaded; then t1 visible, loaded (t0 no longer visible).
    s.update(['t0'], ['t0']);
    m.pending.get('t0')?.ok('0');
    await tick();
    s.update(['t1'], ['t1']);
    m.pending.get('t1')?.ok('1');
    await tick();
    expect(evicted).toEqual([]);
    // Moving to t2: t0 (older) goes first when t2 arrives.
    s.update(['t2'], ['t2']);
    m.pending.get('t2')?.ok('2');
    await tick();
    expect(evicted).toEqual(['t0']);
    expect(s.isLoaded('t0')).toBe(false);
    expect(s.stats.loaded).toBe(2);
    // Wanted tiles are never evicted even over the limit.
    s.update(['t1', 't2', 't3'], ['t1', 't2', 't3']);
    m.pending.get('t3')?.ok('3');
    await tick();
    expect(evicted).toEqual(['t0']);
    expect(s.stats.loaded).toBe(3);
    // T-6.4: the largest wanted set is remembered (the cache holds at most the larger of it and the limit)
    expect(s.peakWanted).toBe(3);
    expect(s.wantedCount).toBe(3);
    s.update(['t3'], ['t3']);
    expect(s.wantedCount).toBe(1);
    expect(s.peakWanted).toBe(3);
  });

  it('drops queued tiles that are no longer wanted', async () => {
    const m = manual();
    const s = new TileStreamer<string>(entries(3), {
      load: m.load,
      onLoaded: () => {},
      onEvict: () => {},
      onError: () => {},
      maxConcurrent: 1,
    });
    s.update(['t0', 't1'], []);
    s.update(['t2'], []);
    m.pending.get('t0')?.ok('0');
    await tick();
    expect(m.started).toEqual(['t0', 't2']);
  });
});

describe('TileStreamer cancellation (T-6.3)', () => {
  function streamer(n: number, loaded: string[] = [], errors: string[] = []) {
    const m = manual();
    const s = new TileStreamer<string>(entries(n), {
      load: m.load,
      onLoaded: (id) => loaded.push(id),
      onEvict: () => {},
      onError: (id) => errors.push(id),
    });
    return { m, s };
  }

  it('aborts a request in flight when its tile is no longer wanted, and never adds the tile', async () => {
    const loaded: string[] = [];
    const errors: string[] = [];
    const { m, s } = streamer(6, loaded, errors);
    s.update(['t0', 't1', 't2', 't3'], []);
    expect(m.started).toEqual(['t0', 't1', 't2', 't3']);
    s.update(['t2', 't3', 't4', 't5'], []); // t0 and t1 left the view
    expect(m.signals.get('t0')?.aborted).toBe(true);
    expect(m.signals.get('t1')?.aborted).toBe(true);
    expect(m.signals.get('t2')?.aborted).toBe(false);
    expect(s.stats).toMatchObject({ started: 6, cancelled: 2, loading: 4, completed: 0 });
    expect(m.started).toEqual(['t0', 't1', 't2', 't3', 't4', 't5']); // freed slots go to the next wanted
    // a late answer for a cancelled tile (the network was faster than the abort) is ignored
    m.pending.get('t0')?.ok('late');
    await tick();
    expect(loaded).toEqual([]);
    expect(errors).toEqual([]); // an abort is not a failure
    expect(s.isLoaded('t0')).toBe(false);
    expect(s.isFailed('t0')).toBe(false);
  });

  it('never has more than the limit in flight across a change of level, nearest first', () => {
    const { m, s } = streamer(10);
    s.update(['t0', 't1', 't2', 't3', 't4'], []); // the old level
    s.update(['t9', 't8', 't7', 't6', 't5'], []); // another level replaces it, nearest first
    expect(m.started).toEqual(['t0', 't1', 't2', 't3', 't9', 't8', 't7', 't6']);
    expect(s.stats).toMatchObject({ loading: 4, cancelled: 4 });
    expect(m.max()).toBe(4); // aborted requests are gone before the new ones start
  });

  it('a cancelled tile can load again later', async () => {
    const loaded: string[] = [];
    const { m, s } = streamer(2, loaded);
    s.update(['t0'], []);
    s.update(['t1'], []);
    expect(s.stats).toMatchObject({ cancelled: 1 });
    s.update(['t0', 't1'], []); // t0 is wanted again
    expect(m.started).toEqual(['t0', 't1', 't0']);
    expect(m.signals.get('t0')?.aborted).toBe(false); // the new request has a fresh signal
    m.pending.get('t0')?.ok('again');
    await tick();
    expect(loaded).toEqual(['t0']);
    expect(s.isLoaded('t0')).toBe(true);
    expect(s.stats).toMatchObject({ started: 3, completed: 1, cancelled: 1, failed: 0 });
  });

  it('keeps a tile that stays wanted: nothing is aborted by an update that still wants it', () => {
    const { m, s } = streamer(3);
    s.update(['t0', 't1'], []);
    s.update(['t1', 't0', 't2'], []);
    expect(m.signals.get('t0')?.aborted).toBe(false);
    expect(m.signals.get('t1')?.aborted).toBe(false);
    expect(s.stats.cancelled).toBe(0);
  });

  it('addTiles makes entries known later; an unknown id is skipped until then', () => {
    const m = manual();
    const s = new TileStreamer<string>([], {
      load: m.load,
      onLoaded: () => {},
      onEvict: () => {},
      onError: () => {},
    });
    s.update(['t0'], []);
    expect(m.started).toEqual([]);
    s.addTiles(entries(1));
    s.update(['t0'], []);
    expect(m.started).toEqual(['t0']);
  });
});

describe('layerOf', () => {
  it('strips the chunk suffix', () => {
    expect(layerOf('buildings#3')).toBe('buildings');
    expect(layerOf('roads')).toBe('roads');
  });
});

describe('freezeMatrices (T-6.4)', () => {
  it('computes the local matrices once and stops the per-frame recomputation', () => {
    const root = new THREE.Group();
    const mesh = new THREE.Mesh();
    mesh.position.set(1, 2, 3);
    mesh.scale.set(0.02, 0.02, 0.02);
    root.add(mesh);
    freezeMatrices(root);
    expect(root.matrixAutoUpdate).toBe(false);
    expect(mesh.matrixAutoUpdate).toBe(false);
    expect(mesh.matrix.elements[12]).toBe(1);
    expect(mesh.matrix.elements[0]).toBeCloseTo(0.02, 12);
    const scene = new THREE.Scene();
    scene.matrixAutoUpdate = false;
    scene.add(root);
    scene.updateMatrixWorld();
    expect(mesh.matrixWorld.elements[13]).toBe(2); // the world matrix is still computed once
  });
});
