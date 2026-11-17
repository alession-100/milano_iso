import { describe, expect, it } from 'vitest';
import { layerOf } from '../style/materials';
import { TileStreamer } from './loader';
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
  const load = (t: TileEntry) =>
    new Promise<string>((ok, ko) => {
      started.push(t.id);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
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
  return { load, pending, started, max: () => maxInFlight };
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
    expect(s.stats).toEqual({ loaded: 0, loading: 4, failed: 0 });
    m.pending.get('t0')?.ok('a');
    await tick();
    expect(m.started).toEqual(['t0', 't1', 't2', 't3', 't4']);
    for (const id of ['t1', 't2', 't3', 't4', 't5', 't6']) {
      await tick();
      m.pending.get(id)?.ok(id);
    }
    await tick();
    expect(s.stats).toEqual({ loaded: 7, loading: 0, failed: 0 });
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
    expect(s.stats).toEqual({ loaded: 1, loading: 1, failed: 0 });
    await new Promise((r) => setTimeout(r, 40));
    expect(m.started).toEqual(['t0', 't1', 't0']);
    m.pending.get('t0')?.ko(new Error('boom again'));
    await tick();
    s.update(['t0', 't1'], ['t0', 't1']);
    s.update(['t0', 't1'], ['t0', 't1']);
    expect(errors).toEqual(['t0']);
    expect(s.stats).toEqual({ loaded: 1, loading: 0, failed: 1 });
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
    expect(s.stats).toEqual({ loaded: 1, loading: 0, failed: 0 });
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

describe('layerOf', () => {
  it('strips the chunk suffix', () => {
    expect(layerOf('buildings#3')).toBe('buildings');
    expect(layerOf('roads')).toBe('roads');
  });
});
