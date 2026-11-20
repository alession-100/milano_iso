import { describe, expect, it } from 'vitest';
import { ShardCatalog } from './catalog';
import type { ShardRecord, TileEntry } from './manifest';

function rec(id: string, level = 0): ShardRecord {
  return {
    level,
    id,
    file: `shards/${id}.json`,
    bytes: 10,
    sha256: 'd'.repeat(64),
    tiles: 1,
    content_bbox_local: { min: [0, 0, 0], max: [10, 5, 10] },
  };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function setup(retryDelayMs = 0) {
  const pending = new Map<string, { ok: (t: TileEntry[]) => void; ko: (e: Error) => void }>();
  const signals = new Map<string, AbortSignal[]>();
  const arrived: string[] = [];
  const errors: string[] = [];
  let changes = 0;
  const catalog = new ShardCatalog([rec('S0_0_0'), rec('S0_1_0'), rec('S1_0_0', 1)], {
    fetchShard: (r, signal) =>
      new Promise<TileEntry[]>((ok, ko) => {
        signals.set(r.id, [...(signals.get(r.id) ?? []), signal]);
        pending.set(r.id, { ok, ko });
        signal.addEventListener('abort', () => ko(new DOMException('aborted', 'AbortError')));
      }),
    onShard: (_t, r) => arrived.push(r.id),
    onError: (r) => errors.push(r.id),
    onChange: () => {
      changes += 1;
    },
    retryDelayMs,
  });
  return { catalog, pending, signals, arrived, errors, changes: () => changes };
}

describe('ShardCatalog (T-6.3)', () => {
  it('requests each needed shard once, however often it is asked', () => {
    const { catalog, signals } = setup();
    catalog.want([rec('S0_0_0'), rec('S0_1_0')]);
    catalog.want([rec('S0_0_0'), rec('S0_1_0')]);
    expect([...signals.keys()]).toEqual(['S0_0_0', 'S0_1_0']);
    expect(catalog.stats).toMatchObject({ started: 2, loading: 2, cancelled: 0 });
  });

  it('aborts the requests that are no longer needed and requests them again when needed again', () => {
    const { catalog, signals } = setup();
    catalog.want([rec('S0_0_0'), rec('S0_1_0')]);
    catalog.want([rec('S0_1_0')]);
    expect(signals.get('S0_0_0')?.[0].aborted).toBe(true);
    expect(signals.get('S0_1_0')?.[0].aborted).toBe(false);
    expect(catalog.stats).toMatchObject({ cancelled: 1, loading: 1 });
    catalog.want([rec('S0_0_0'), rec('S0_1_0')]);
    expect(signals.get('S0_0_0')?.length).toBe(2);
    expect(signals.get('S0_0_0')?.[1].aborted).toBe(false);
    expect(catalog.stats).toMatchObject({ started: 3, cancelled: 1 });
  });

  it('a shard that arrives is kept and not requested again; an aborted one is never reported', async () => {
    const { catalog, pending, arrived, errors, signals } = setup();
    catalog.want([rec('S0_0_0'), rec('S0_1_0')]);
    pending.get('S0_0_0')?.ok([]);
    await tick();
    expect(arrived).toEqual(['S0_0_0']);
    expect(catalog.isLoaded('S0_0_0')).toBe(true);
    catalog.want([rec('S0_0_0')]); // S0_1_0 is dropped
    expect(signals.get('S0_1_0')?.[0].aborted).toBe(true);
    pending.get('S0_1_0')?.ok([]); // a late answer
    await tick();
    expect(arrived).toEqual(['S0_0_0']);
    expect(errors).toEqual([]);
    expect(catalog.stats).toMatchObject({ loaded: 1, completed: 1, cancelled: 1, failed: 0 });
  });

  it('retries a failed shard once, then reports it once', async () => {
    const { catalog, pending, errors, signals, changes } = setup(0);
    catalog.want([rec('S0_0_0')]);
    pending.get('S0_0_0')?.ko(new Error('boom'));
    await tick();
    await tick();
    expect(catalog.stats).toMatchObject({ loading: 0, failed: 0 }); // the wait is over: due again
    expect(changes()).toBeGreaterThan(0); // the caller is asked to call `want` again
    catalog.want([rec('S0_0_0')]);
    expect(signals.get('S0_0_0')?.length).toBe(2);
    pending.get('S0_0_0')?.ko(new Error('boom again'));
    await tick();
    expect(errors).toEqual(['S0_0_0']);
    expect(catalog.stats).toMatchObject({ failed: 1 });
    expect(catalog.missing([rec('S0_0_0')])).toBe(0); // failed for good: not waited for
  });

  it('counts the needed shards that are not loaded', async () => {
    const { catalog, pending } = setup();
    const needed = [rec('S0_0_0'), rec('S0_1_0')];
    catalog.want(needed);
    expect(catalog.missing(needed)).toBe(2);
    pending.get('S0_0_0')?.ok([]);
    await tick();
    expect(catalog.missing(needed)).toBe(1);
  });
});
