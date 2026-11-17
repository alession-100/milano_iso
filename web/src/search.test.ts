import { describe, expect, it } from 'vitest';
import { type IndexEntry, fold, hitLabel, parseIndex, refOf, search, unionBbox } from './search';

const e = (
  name: string,
  kind: IndexEntry['kind'],
  ref: IndexEntry['ref'],
  bbox: IndexEntry['bbox'] = [0, 0, 10, 10],
  centre: [number, number] = [5, 5],
): IndexEntry => ({ name, kind, ref, bbox, centre, tiles: ['0_0'] });

const ENTRIES: IndexEntry[] = [
  e('Duomo di Milano', 'landmark', { landmark_id: 'duomo' }),
  e('Piazza del Duomo', 'street', { osm_ids: { w: [11, 12] } }),
  e('Palazzo della Veneranda Fabbrica del Duomo', 'building', { key: 'osm:w1' }),
  e("Ca' Granda", 'building', { key: 'osm:w2' }, [0, 0, 10, 10], [5, 5]),
  e("Ca' Granda", 'building', { key: 'osm:w3' }, [100, 100, 120, 130], [110, 115]),
  e('Via Torino', 'street', { osm_ids: { r: [99], w: [5] } }),
  e('Città Studi', 'green', { osm_id: 7, osm_type: 'w' }),
  e('Naviglio Grande', 'water', { osm_id: 8, osm_type: 'r' }),
];

describe('fold', () => {
  it('folds accents, case and apostrophes', () => {
    expect(fold('Città')).toBe('citta');
    expect(fold("Ca' Granda")).toBe('ca granda');
    expect(fold('  CA’  GRANDA ')).toBe('ca granda');
  });
});

describe('search', () => {
  it('finds names ignoring case and accents', () => {
    expect(search(ENTRIES, 'duomo')[0].name).toBe('Duomo di Milano');
    expect(search(ENTRIES, 'citta').map((h) => h.name)).toEqual(['Città Studi']);
    expect(search(ENTRIES, 'ca granda').map((h) => h.name)).toEqual(["Ca' Granda"]);
  });
  it('ranks prefix matches before substring matches', () => {
    const names = search(ENTRIES, 'duomo').map((h) => h.name);
    expect(names).toEqual(['Duomo di Milano', 'Palazzo della Veneranda Fabbrica del Duomo', 'Piazza del Duomo'].slice(0, 1).concat(
      ['Palazzo della Veneranda Fabbrica del Duomo', 'Piazza del Duomo'],
    ));
    expect(names[0]).toBe('Duomo di Milano'); // the only prefix match
  });
  it('is deterministic for ties (folded name, then kind)', () => {
    const a = search(ENTRIES, 'a').map(hitLabel);
    const b = search([...ENTRIES].reverse(), 'a').map(hitLabel);
    expect(a).toEqual(b);
  });
  it('returns nothing for an empty or punctuation-only query', () => {
    expect(search(ENTRIES, '')).toEqual([]);
    expect(search(ENTRIES, " '' ")).toEqual([]);
  });
  it('limits to 8 hits', () => {
    const many = Array.from({ length: 20 }, (_, i) => e(`Via ${i}`, 'street', { osm_ids: { w: [i] } }));
    expect(search(many, 'via')).toHaveLength(8);
  });
  it('groups entries with the same name and kind and unions their boxes', () => {
    const hits = search(ENTRIES, 'granda');
    expect(hits).toHaveLength(1);
    expect(hits[0].count).toBe(2);
    expect(hitLabel(hits[0])).toBe("Ca' Granda (2)");
    expect(hits[0].bbox).toEqual([0, 0, 120, 130]);
    expect(hits[0].centre).toEqual([60, 65]);
  });
  it('keeps the entry centre for a single member', () => {
    expect(search(ENTRIES, 'torino')[0].centre).toEqual([5, 5]);
  });
  it('does not group the same name of different kinds', () => {
    const two = [e('Duomo', 'street', { osm_ids: { w: [1] } }), e('Duomo', 'building', { key: 'k' })];
    expect(search(two, 'duomo')).toHaveLength(2);
  });
});

describe('refOf', () => {
  const ref = (q: string) => refOf(search(ENTRIES, q)[0]);
  it('maps a landmark', () => expect(ref('duomo di')).toEqual({ layer: 'landmark', landmarkId: 'duomo' }));
  it('maps a building (first member of a group)', () =>
    expect(ref('granda')).toEqual({ layer: 'buildings', key: 'osm:w2' }));
  it('maps a street to its first id', () =>
    expect(ref('torino')).toEqual({ layer: 'roads', streetName: 'Via Torino', osmType: 'r', osmId: 99 }));
  it('maps green and water', () => {
    expect(ref('citta')).toEqual({ layer: 'green', osmType: 'w', osmId: 7 });
    expect(ref('naviglio')).toEqual({ layer: 'water', osmType: 'r', osmId: 8 });
  });
  it('gives null when the reference is empty', () => {
    expect(refOf(search([e('X', 'building', {})], 'x')[0])).toBeNull();
    expect(refOf(search([e('X', 'street', { osm_ids: {} })], 'x')[0])).toBeNull();
  });
});

describe('parseIndex / unionBbox', () => {
  it('drops malformed entries and rejects a missing list', () => {
    expect(parseIndex({ entries: [ENTRIES[0], { name: 1 }, null] })).toHaveLength(1);
    expect(() => parseIndex({})).toThrow();
  });
  it('unions boxes', () => {
    expect(unionBbox([[0, 0, 1, 1], [-2, 3, 0, 4]])).toEqual([-2, 0, 1, 4]);
  });
});
