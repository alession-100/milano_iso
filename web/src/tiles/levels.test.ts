import { describe, expect, it } from 'vitest';
import { type Cell, HYSTERESIS, cellOf, chooseLevel, overlaps, planDraw } from './levels';

const SPECS = [
  { level: 0, tolerance_m: 0.2 },
  { level: 1, tolerance_m: 1 },
  { level: 2, tolerance_m: 2 },
  { level: 3, tolerance_m: 5 },
];

describe('chooseLevel: the coarsest level whose tolerance is at most the metres per pixel', () => {
  it('uses the base level below the first tolerance, whatever the base tolerance', () => {
    expect(chooseLevel(SPECS, 0.05, 0)).toBe(0);
    expect(chooseLevel(SPECS, 0.9, 0)).toBe(0);
    expect(chooseLevel([{ level: 0, tolerance_m: 0 }], 9, 0)).toBe(0);
  });
  it('switches to a coarse level exactly where mpp reaches its tolerance', () => {
    expect(chooseLevel(SPECS, 1, 0)).toBe(1);
    expect(chooseLevel(SPECS, 1.99, 0)).toBe(1);
    expect(chooseLevel(SPECS, 2, 0)).toBe(2);
    expect(chooseLevel(SPECS, 4.99, 0)).toBe(2);
    expect(chooseLevel(SPECS, 5, 0)).toBe(3);
    expect(chooseLevel(SPECS, 9.7, 0)).toBe(3);
  });
  it('a coarse level is never used where its error would exceed one pixel', () => {
    for (let mpp = 0.05; mpp < 12; mpp += 0.05) {
      const lv = chooseLevel(SPECS, mpp, 0);
      const tol = SPECS.find((s) => s.level === lv)?.tolerance_m ?? 0;
      if (lv > 0) expect(tol).toBeLessThanOrEqual(mpp);
    }
  });
  it('hysteresis: going finer waits until mpp is below tolerance * HYSTERESIS', () => {
    expect(chooseLevel(SPECS, 1, 0)).toBe(1);
    // at 0.95 the base would do, but level 1 is kept while 0.95 >= 1 * 0.85
    expect(chooseLevel(SPECS, 0.95, 1)).toBe(1);
    expect(chooseLevel(SPECS, 1 * HYSTERESIS, 1)).toBe(1);
    expect(chooseLevel(SPECS, 1 * HYSTERESIS - 0.01, 1)).toBe(0);
    expect(chooseLevel(SPECS, 1.9, 2)).toBe(2);
    expect(chooseLevel(SPECS, 1.6, 2)).toBe(1);
  });
  it('a camera that hovers around a threshold does not flip every step', () => {
    let level = 0;
    const seen: number[] = [];
    for (const mpp of [0.98, 1.02, 0.98, 1.02, 0.97, 1.01, 0.9]) {
      level = chooseLevel(SPECS, mpp, level);
      seen.push(level);
    }
    expect(seen).toEqual([0, 1, 1, 1, 1, 1, 1]);
  });
  it('jumps over several levels in one step', () => {
    expect(chooseLevel(SPECS, 6, 0)).toBe(3);
    expect(chooseLevel(SPECS, 0.3, 3)).toBe(0);
  });
});

const cell = (id: string, level: number, x0: number, z0: number, x1: number, z1: number): Cell => ({
  id,
  level,
  box: [x0, z0, x1, z1],
});

describe('overlaps', () => {
  it('counts interiors, not shared edges', () => {
    expect(overlaps(cell('a', 0, 0, 0, 250, 250), cell('b', 0, 250, 0, 500, 250))).toBe(false);
    expect(overlaps(cell('a', 0, 0, 0, 250, 250), cell('b', 1, 0, 0, 500, 500))).toBe(true);
  });
});

describe('cellOf', () => {
  it('uses bbox_local, else the horizontal extent of the content', () => {
    const base = { id: 'x', content_bbox_local: { min: [1, 0, 2], max: [3, 9, 4] } };
    expect(cellOf(base).box).toEqual([1, 2, 3, 4]);
    expect(cellOf({ ...base, level: 2, bbox_local: [0, 0, 10, 10] })).toEqual({ id: 'x', level: 2, box: [0, 0, 10, 10] });
  });
});

// One coarse block (level 1) over four base tiles (level 0).
const BLOCK = cell('L1_0_0', 1, 0, 0, 500, 500);
const KIDS = [
  cell('0_0', 0, 0, 0, 250, 250),
  cell('1_0', 0, 250, 0, 500, 250),
  cell('0_1', 0, 0, 250, 250, 500),
  cell('1_1', 0, 250, 250, 500, 500),
];

describe('planDraw: no hole and no double drawing', () => {
  it('zooming out: the base tiles stay until the block has loaded, then only the block is drawn', () => {
    const loadedIds = new Set(KIDS.map((k) => k.id));
    const isLoaded = (id: string): boolean => loadedIds.has(id);
    // chosen level 1, block not loaded yet
    expect([...planDraw(1, [BLOCK], KIDS, isLoaded)].sort()).toEqual(['0_0', '0_1', '1_0', '1_1']);
    loadedIds.add(BLOCK.id);
    expect([...planDraw(1, [BLOCK], [...KIDS, BLOCK], isLoaded)]).toEqual(['L1_0_0']);
  });
  it('zooming in: the block stays until every visible base tile has loaded', () => {
    const loadedIds = new Set([BLOCK.id, '0_0', '1_0', '0_1']);
    const isLoaded = (id: string): boolean => loadedIds.has(id);
    const loaded = [BLOCK, ...KIDS.filter((k) => loadedIds.has(k.id))];
    // 1_1 is missing: the block is drawn alone, the loaded children are hidden
    expect([...planDraw(0, KIDS, loaded, isLoaded)]).toEqual(['L1_0_0']);
    loadedIds.add('1_1');
    const all = [BLOCK, ...KIDS];
    expect([...planDraw(0, KIDS, all, isLoaded)].sort()).toEqual(['0_0', '0_1', '1_0', '1_1']);
  });
  it('a parent and its children are never drawn together (every combination of loaded tiles)', () => {
    const ids = [BLOCK.id, ...KIDS.map((k) => k.id)];
    for (let mask = 0; mask < 1 << ids.length; mask += 1) {
      const loadedIds = new Set(ids.filter((_, k) => mask & (1 << k)));
      const loaded = [BLOCK, ...KIDS].filter((c) => loadedIds.has(c.id));
      const isLoaded = (id: string): boolean => loadedIds.has(id);
      for (const [chosen, visible] of [
        [0, KIDS],
        [1, [BLOCK]],
      ] as const) {
        const drawn = [...planDraw(chosen, visible, loaded, isLoaded)];
        const hasBlock = drawn.includes(BLOCK.id);
        const hasKid = drawn.some((id) => id !== BLOCK.id);
        expect(hasBlock && hasKid).toBe(false);
        for (const id of drawn) expect(loadedIds.has(id)).toBe(true);
        // the ground is covered whenever something that covers it is loaded
        const coveredByChosen = visible.every((c) => loadedIds.has(c.id));
        if (coveredByChosen) expect(drawn.length).toBeGreaterThan(0);
      }
    }
  });
  it('the nearest finer level stands in for a missing tile', () => {
    const l2 = cell('L2_0_0', 2, 0, 0, 1000, 1000);
    const loaded = [...KIDS, BLOCK];
    const drawn = planDraw(2, [l2], loaded, (id) => loaded.some((c) => c.id === id));
    expect([...drawn]).toEqual(['L1_0_0']);
  });
  it('draws nothing but the loaded chosen tiles when no other level is loaded', () => {
    const loaded = [KIDS[0], KIDS[1]];
    const drawn = planDraw(0, KIDS, loaded, (id) => loaded.some((c) => c.id === id));
    expect([...drawn].sort()).toEqual(['0_0', '1_0']);
  });
});
