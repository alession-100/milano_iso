import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FeatureTable } from '../style/materials';
import { HEIGHT_SOURCE_LABELS, labelOf } from './labels';
import { cardModel } from './model';
import {
  type IndexEntry,
  IndexLookup,
  isPickable,
  matcherFor,
  osmUrl,
  osmUrlOfBuildingKey,
  refForRow,
  refKey,
  rowForFeature,
} from './rows';

const ROOT = path.resolve(__dirname, '..', '..', '..');

const table: FeatureTable = {
  tile: '0_0',
  layers: {
    buildings: [
      { key: 'osm:w10', name: 'Casa', building_type: 'apartments', height_m: 12.34, height_source: 'osm_height', landmark_id: null },
      { key: 'dbt:EDIFC_1', name: null, building_type: 'yes', height_m: 30, height_source: 'dbt', landmark_id: null },
      { key: 'dbt:EDIFC_2', name: null, building_type: 'church', height_m: 40, height_source: 'dbt', landmark_id: 'duomo' },
    ],
    landmark_details: [{ detail: 'spire', landmark_id: 'duomo', stylised: true }],
    roads: [{ class: 'residential', osm_type: 'w', osm_id: 7, width_m: 6, width_source: 'style' }],
    markings: [{ kind: 'zebra', osm_type: 'w', osm_id: 7, stylised: true }],
    trees: [
      { decorative: false, source: 'osm_tree', height_m: 8, height_source: 'style_default', osm_type: 'n', osm_id: 5, x: 1, z: 2 },
      { decorative: true, source: 'fill', height_m: 7, height_source: 'style_default', osm_type: null, osm_id: null, x: 3, z: 4 },
    ],
    green: [{ kind: 'park', osm_type: 'w', osm_id: 9 }],
  },
};
const rows = (layer: string) => table.layers[layer] as Record<string, unknown>[];
const tables = new Map([['0_0', table]]);
const entries: IndexEntry[] = [
  { name: 'Duomo di Milano', kind: 'landmark', ref: { landmark_id: 'duomo' } },
  { name: 'Via Test', kind: 'street', ref: { osm_ids: { w: [7, 8] } } },
  { name: 'Parco Test', kind: 'green', ref: { osm_type: 'w', osm_id: 9 } },
  { name: 'Casa', kind: 'building', ref: { key: 'osm:w10' } },
];
const index = new IndexLookup(entries);

describe('row lookup from feature id', () => {
  it('returns the row at the id, and null outside the table', () => {
    expect(rowForFeature(table, 'buildings', 1)?.key).toBe('dbt:EDIFC_1');
    expect(rowForFeature(table, 'buildings', 3)).toBeNull();
    expect(rowForFeature(table, 'buildings', -1)).toBeNull();
    expect(rowForFeature(table, 'buildings', 1.5)).toBeNull();
    expect(rowForFeature(table, 'nope', 0)).toBeNull();
    expect(rowForFeature(undefined, 'buildings', 0)).toBeNull();
  });
});

describe('what can be picked', () => {
  it('picks buildings, details, roads, areas and mapped trees', () => {
    for (const l of ['buildings', 'landmark_details', 'roads', 'green', 'trees']) {
      expect(isPickable(l, rowForFeature(table, l, 0))).toBe(true);
    }
  });
  it('never picks fill trees, markings, rail, road areas or unknown layers', () => {
    expect(isPickable('trees', rowForFeature(table, 'trees', 1))).toBe(false);
    expect(isPickable('trees', { height_m: 8 })).toBe(false); // no explicit decorative=false
    for (const l of ['markings', 'rail', 'road_areas', 'whatever']) expect(isPickable(l, { kind: 'x' })).toBe(false);
    expect(isPickable('buildings', null)).toBe(false);
  });
  it('a landmark body or detail gives the landmark ref, never the detail', () => {
    const body = refForRow('buildings', '0_0', rows('buildings')[2]);
    const detail = refForRow('landmark_details', '0_0', rows('landmark_details')[0]);
    expect(body).toEqual({ layer: 'landmark', tile: '0_0', landmarkId: 'duomo' });
    expect(detail).toEqual(body);
    expect(refForRow('buildings', '0_0', rows('buildings')[0])).toEqual({ layer: 'buildings', tile: '0_0', key: 'osm:w10' });
    expect(refForRow('roads', '0_0', rows('roads')[0])).toEqual({ layer: 'roads', tile: '0_0', osmType: 'w', osmId: 7 });
    expect(refForRow('trees', '0_0', rows('trees')[0])).toMatchObject({ layer: 'trees', osmType: 'n', osmId: 5 });
    expect(refKey(null)).toBe('');
  });
});

describe('highlight matching', () => {
  it('a landmark covers its buildings and details; a building only itself', () => {
    const m = matcherFor({ layer: 'landmark', landmarkId: 'duomo' }, index);
    expect(m('buildings', rows('buildings')[2])).toBe(true);
    expect(m('landmark_details', rows('landmark_details')[0])).toBe(true);
    expect(m('buildings', rows('buildings')[0])).toBe(false);
    const b = matcherFor({ layer: 'buildings', key: 'dbt:EDIFC_1' }, index);
    expect(b('buildings', rows('buildings')[1])).toBe(true);
    expect(b('buildings', rows('buildings')[0])).toBe(false);
  });
  it('a street found by name covers the ways of the index entry', () => {
    const m = matcherFor({ layer: 'roads', streetName: 'Via Test' }, index);
    expect(m('roads', rows('roads')[0])).toBe(true);
    expect(m('roads', { osm_type: 'w', osm_id: 99 })).toBe(false);
  });
});

describe('info card model', () => {
  it('shows name, type group, height and the label of the height source', () => {
    const m = cardModel({ layer: 'buildings', tile: '0_0', key: 'osm:w10' }, tables, index, 'it');
    expect(m).toMatchObject({ title: 'Casa', named: true, typeLabel: 'Edificio residenziale', pending: false });
    expect(m.height).toEqual({ text: '12,3 m', source: 'OSM (altezza indicata)' });
    expect(m.osmUrl).toBe('https://www.openstreetmap.org/way/10');
    const en = cardModel({ layer: 'buildings', tile: '0_0', key: 'dbt:EDIFC_1' }, tables, index, 'en');
    expect(en).toMatchObject({ title: 'Unnamed', named: false, typeLabel: 'Building', osmUrl: null });
    expect(en.height).toEqual({ text: '30 m', source: 'DBT 2020 survey' });
  });
  it('a landmark shows the index name, the stylisation notice and the height of its body', () => {
    const m = cardModel({ layer: 'landmark', landmarkId: 'duomo', tile: '0_0' }, tables, index, 'it');
    expect(m).toMatchObject({ title: 'Duomo di Milano', typeLabel: 'Punto di riferimento', osmUrl: null });
    expect(m.height?.text).toBe('40 m');
    expect(m.height?.source).toBe(labelOf(HEIGHT_SOURCE_LABELS, 'dbt', 'it'));
    expect(m.note).toContain('stilizzati');
  });
  it('a landmark body with an OSM key gives the OSM link', () => {
    const t2: FeatureTable = { tile: '1_0', layers: { buildings: [{ key: 'osm:w77', name: 'Torre', height_m: 55.5, height_source: 'osm_height', landmark_id: 'torre' }] } };
    const m = cardModel({ layer: 'landmark', landmarkId: 'torre' }, new Map([['1_0', t2]]), index, 'en');
    expect(m.height).toEqual({ text: '55.5 m', source: labelOf(HEIGHT_SOURCE_LABELS, 'osm_height', 'en') });
    expect(m.osmUrl).toBe('https://www.openstreetmap.org/way/77');
  });
  it('a landmark whose body rows disagree on the height, or is not fully loaded, shows no height and no invented number', () => {
    const rowsOf = (hs: number[]): FeatureTable => ({
      tile: '2_0',
      layers: { buildings: hs.map((h, i) => ({ key: `dbt:E${i}`, name: 'Palazzo', height_m: h, height_source: 'dbt', landmark_id: 'palazzo' })) },
    });
    const two = cardModel({ layer: 'landmark', landmarkId: 'palazzo' }, new Map([['2_0', rowsOf([20, 25])]]), index, 'it');
    expect(two).toMatchObject({ height: null, osmUrl: null });
    const same = cardModel({ layer: 'landmark', landmarkId: 'palazzo' }, new Map([['2_0', rowsOf([20, 20])]]), index, 'it');
    expect(same.height?.text).toBe('20 m');
    const idx = new IndexLookup([{ name: 'Palazzo', kind: 'landmark', tiles: ['2_0', '3_0'], ref: { landmark_id: 'palazzo' } }]);
    const partial = cardModel({ layer: 'landmark', landmarkId: 'palazzo' }, new Map([['2_0', rowsOf([20])]]), idx, 'it');
    expect(partial.height).toBeNull();
    const none = cardModel({ layer: 'landmark', landmarkId: 'palazzo' }, new Map<string, FeatureTable>(), index, 'it');
    expect(none.height).toBeNull();
  });
  it('a street is named from the index; green from the index with its kind label', () => {
    const r = cardModel({ layer: 'roads', tile: '0_0', osmType: 'w', osmId: 7 }, tables, index, 'it');
    expect(r).toMatchObject({ title: 'Via Test', typeLabel: 'Strada residenziale' });
    const g = cardModel({ layer: 'green', tile: '0_0', osmType: 'w', osmId: 9 }, tables, index, 'en');
    expect(g).toMatchObject({ title: 'Parco Test', typeLabel: 'Park' });
  });
  it('a mapped tree shows its height and source; an unknown value is shown as in the data', () => {
    const t = cardModel({ layer: 'trees', tile: '0_0', osmType: 'n', osmId: 5 }, tables, index, 'it');
    expect(t).toMatchObject({ typeLabel: 'Albero mappato in OSM', height: { text: '8 m', source: 'default stimato' } });
    expect(labelOf(HEIGHT_SOURCE_LABELS, 'something_new', 'it')).toBe('something_new');
  });
  it('a search hit whose tile is not loaded gives the index data and pending, and does not throw', () => {
    const none = new Map<string, FeatureTable>();
    const m = cardModel({ layer: 'buildings', key: 'osm:w10' }, none, index, 'it');
    expect(m).toMatchObject({ title: 'Casa', pending: true, height: null });
    expect(cardModel({ layer: 'buildings', key: 'dbt:zzz' }, none, index, 'it')).toMatchObject({ named: false, pending: true });
    expect(cardModel({ layer: 'roads', streetName: 'Via Test' }, none, index, 'it')).toMatchObject({ title: 'Via Test', pending: false });
    expect(cardModel({ layer: 'green', osmType: 'w', osmId: 1 }, none, index, 'it').pending).toBe(true);
    expect(cardModel({ layer: 'trees', osmType: 'n', osmId: 1 }, none, index, 'it').pending).toBe(true);
    expect(cardModel({ layer: 'weird' }, none, index, 'it').pending).toBe(true);
  });
  it('builds OSM links only from a type and a positive id', () => {
    expect(osmUrl('r', 12)).toBe('https://www.openstreetmap.org/relation/12');
    expect(osmUrl('x', 12)).toBeNull();
    expect(osmUrl('w', null)).toBeNull();
    expect(osmUrlOfBuildingKey('osm:n3')).toBe('https://www.openstreetmap.org/node/3');
    expect(osmUrlOfBuildingKey('dbt:EDIFC_1')).toBeNull();
    expect(osmUrlOfBuildingKey('fix:B1')).toBeNull();
  });
});

describe('height source labels', () => {
  it('cover every height_source value of the e2e fixture', () => {
    const dir = path.join(ROOT, 'web', 'e2e', 'fixtures', 'tiles');
    const found = new Set<string>();
    for (const f of readdirSync(dir).filter((n) => /^-?\d+_-?\d+\.json$/.test(n))) {
      const t = JSON.parse(readFileSync(path.join(dir, f), 'utf-8')) as FeatureTable;
      for (const layerRows of Object.values(t.layers)) {
        for (const r of layerRows ?? []) if (typeof r.height_source === 'string') found.add(r.height_source);
      }
    }
    expect(found.size).toBeGreaterThan(0);
    for (const v of found) expect(Object.keys(HEIGHT_SOURCE_LABELS), v).toContain(v);
  });
  it('cover every height_source value written by the pipeline', () => {
    const heights = readFileSync(path.join(ROOT, 'pipeline', 'milano_iso', 'heights.py'), 'utf-8');
    const decor = readFileSync(path.join(ROOT, 'pipeline', 'milano_iso', 'decor.py'), 'utf-8');
    const tuple = /^HEIGHT_SOURCES = \(([^)]*)\)/m.exec(heights);
    expect(tuple).not.toBeNull();
    const values = new Set([...(tuple as RegExpExecArray)[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));
    // decor.py: tree heights come back as (height, "<source>") pairs; fill trees carry a literal one.
    for (const m of decor.matchAll(/return (?:h|style\.\w+), "([a-z_]+)"|True, h, "([a-z_]+)", p\)/g)) {
      values.add(m[1] ?? m[2]);
    }
    expect(values).toContain('dbt');
    expect(values).toContain('style_default');
    expect(values).toContain('osm_height');
    for (const v of values) expect(Object.keys(HEIGHT_SOURCE_LABELS), v).toContain(v);
  });
  it('have Italian and English text for each value', () => {
    for (const l of Object.values(HEIGHT_SOURCE_LABELS)) {
      expect(l.it.length).toBeGreaterThan(0);
      expect(l.en.length).toBeGreaterThan(0);
    }
  });
});
