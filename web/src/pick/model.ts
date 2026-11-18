import { type Lang, t } from '../i18n';
import type { FeatureRef } from '../selection';
import { buildingGroup } from '../style/palette';
import {
  BUILDING_GROUP_LABELS,
  GREEN_KIND_LABELS,
  HEIGHT_SOURCE_LABELS,
  KIND_LABELS,
  LANDUSE_KIND_LABELS,
  ROAD_CLASS_LABELS,
  TREE_SOURCE_LABELS,
  WATER_KIND_LABELS,
  labelOf,
} from './labels';
import {
  type IndexLookup,
  type Row,
  type Tables,
  findRow,
  landmarkBuildingRows,
  osmUrl,
  osmUrlOfBuildingKey,
} from './rows';

/** What the info card shows; every string is already localized, every value comes from data files. */
export interface CardModel {
  title: string;
  /** True when the title is the data name, false for the localized "Unnamed". */
  named: boolean;
  typeLabel: string;
  height: { text: string; source: string } | null;
  osmUrl: string | null;
  /** Stylisation notice (landmarks). */
  note: string | null;
  /** True while the tile row is not loaded yet and only index data is shown. */
  pending: boolean;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** Height in metres with at most one decimal, in the number format of `lang`. */
export function formatHeight(h: number, lang: Lang): string {
  return `${h.toLocaleString(lang, { maximumFractionDigits: 1 })} m`;
}

function heightOf(row: Row, lang: Lang): CardModel['height'] {
  const h = row.height_m;
  const src = str(row.height_source);
  if (typeof h !== 'number' || !Number.isFinite(h) || src === null) return null;
  return { text: formatHeight(h, lang), source: labelOf(HEIGHT_SOURCE_LABELS, src, lang) };
}

/**
 * Height, height source and OSM link of a landmark, from the feature-table rows of its body buildings
 * (DBT volumes, never the stylised details). Only what the data states without ambiguity is shown:
 * - the landmark has body rows in the loaded tiles, and every tile the index lists for it is loaded;
 * - all body rows state the same height and the same source (one row, or several that agree);
 * - the OSM link only when every body row has the same OSM building key.
 * Otherwise the field stays empty: no placeholder number (T-5.5).
 */
function landmarkBody(id: string, tables: Tables, index: IndexLookup, lang: Lang): Pick<CardModel, 'height' | 'osmUrl'> {
  const rows = landmarkBuildingRows(id, tables);
  const none = { height: null, osmUrl: null };
  if (rows.length === 0) return none;
  const wanted = index.landmark(id)?.tiles ?? [];
  if (wanted.some((tile) => !tables.has(tile))) return none; // a part of the landmark is not loaded yet
  const keys = new Set(rows.map((r) => str(r.key)));
  const heights = new Set(rows.map((r) => r.height_m));
  const sources = new Set(rows.map((r) => str(r.height_source)));
  const link = keys.size === 1 ? osmUrlOfBuildingKey([...keys][0]) : null;
  if (heights.size !== 1 || sources.size !== 1) return { height: null, osmUrl: link };
  return { height: heightOf(rows[0], lang), osmUrl: link };
}

/**
 * The card content for a selection, from the loaded tile tables and the search index. Returns a
 * model also when the tile is not loaded (search hit): the index name and kind, `pending: true`.
 */
export function cardModel(ref: FeatureRef, tables: Tables, index: IndexLookup, lang: Lang): CardModel {
  const unnamed = t('cardUnnamed', lang);
  const base = (title: string | null, typeLabel: string): CardModel => ({
    title: title ?? unnamed,
    named: title !== null,
    typeLabel,
    height: null,
    osmUrl: null,
    note: null,
    pending: false,
  });

  if (ref.layer === 'landmark') {
    const id = ref.landmarkId ?? '';
    const own = landmarkBuildingRows(id, tables).find((r) => str(r.name) !== null);
    const name = str(index.landmark(id)?.name) ?? str(own?.name);
    const body = landmarkBody(id, tables, index, lang);
    return { ...base(name, KIND_LABELS.landmark[lang]), ...body, note: t('cardLandmarkNote', lang) };
  }

  const row = findRow(ref, tables);

  if (ref.layer === 'buildings') {
    if (!row) {
      const e = ref.key ? index.building(ref.key) : undefined;
      return { ...base(str(e?.name), KIND_LABELS.building[lang]), pending: true, osmUrl: osmUrlOfBuildingKey(ref.key ?? null) };
    }
    const group = buildingGroup(str(row.building_type));
    return {
      ...base(str(row.name), BUILDING_GROUP_LABELS[group][lang]),
      height: heightOf(row, lang),
      osmUrl: osmUrlOfBuildingKey(str(row.key)),
    };
  }

  if (ref.layer === 'roads') {
    const named = ref.osmType && ref.osmId !== undefined ? index.byOsm('roads', ref.osmType, ref.osmId) : undefined;
    const cls = row ? str(row.class) : null;
    return {
      ...base(ref.streetName ?? str(named?.name), cls ? labelOf(ROAD_CLASS_LABELS, cls, lang) : KIND_LABELS.roads[lang]),
      osmUrl: osmUrl(ref.osmType, ref.osmId),
      pending: !row && !named && ref.streetName === undefined,
    };
  }

  if (ref.layer === 'trees') {
    const source = row ? str(row.source) : null;
    return {
      ...base(null, source ? labelOf(TREE_SOURCE_LABELS, source, lang) : KIND_LABELS.trees[lang]),
      height: row ? heightOf(row, lang) : null,
      osmUrl: osmUrl(ref.osmType, ref.osmId),
      pending: !row,
    };
  }

  if (ref.layer === 'green' || ref.layer === 'water' || ref.layer === 'landuse') {
    const named = ref.osmType && ref.osmId !== undefined ? index.byOsm(ref.layer, ref.osmType, ref.osmId) : undefined;
    const kind = row ? str(row.kind) : null;
    const table = ref.layer === 'green' ? GREEN_KIND_LABELS : ref.layer === 'water' ? WATER_KIND_LABELS : LANDUSE_KIND_LABELS;
    return {
      ...base(str(named?.name), kind ? labelOf(table, kind, lang) : KIND_LABELS[ref.layer][lang]),
      osmUrl: osmUrl(ref.osmType, ref.osmId),
      pending: !row,
    };
  }

  // Unknown layer from a search hit: show what the ref says, never invent data.
  return { ...base(ref.streetName ?? null, labelOf(KIND_LABELS, ref.layer, lang)), pending: true };
}
