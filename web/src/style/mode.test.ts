import { afterEach, describe, expect, it, vi } from 'vitest';
import { MODE_STORAGE_KEY, initialMode, parseTime, readStoredMode, storeMode } from './mode';

afterEach(() => vi.unstubAllGlobals());

function stubStorage(store: Record<string, string>): void {
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
    },
  });
}

describe('parseTime', () => {
  it('reads ?time=night and ?time=day, ignores anything else', () => {
    expect(parseTime('?time=night')).toBe('night');
    expect(parseTime('?e2e=1&time=day')).toBe('day');
    expect(parseTime('?time=dusk')).toBeNull();
    expect(parseTime('')).toBeNull();
  });
});

describe('initialMode', () => {
  it('defaults to day', () => {
    stubStorage({});
    expect(initialMode('')).toBe('day');
  });
  it('uses the remembered choice, and the URL wins over it', () => {
    stubStorage({ [MODE_STORAGE_KEY]: 'night' });
    expect(initialMode('')).toBe('night');
    expect(initialMode('?time=day')).toBe('day');
  });
  it('survives blocked storage (access throws)', () => {
    vi.stubGlobal('window', {
      get localStorage(): never {
        throw new Error('blocked');
      },
    });
    expect(readStoredMode()).toBeNull();
    expect(() => storeMode('night')).not.toThrow();
    expect(initialMode('?time=night')).toBe('night');
    expect(initialMode('')).toBe('day');
  });
  it('stores the choice', () => {
    const store: Record<string, string> = {};
    stubStorage(store);
    storeMode('night');
    expect(store[MODE_STORAGE_KEY]).toBe('night');
  });
});
