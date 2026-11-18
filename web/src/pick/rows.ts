import type { FeatureRef } from '../selection';
import type { FeatureTable } from '../style/materials';

/** One feature-table row. */
export type Row = Record<string, unknown>;

/** Loaded feature tables by tile id. */
export type Tables = ReadonlyMap<string, FeatureTable>;

/** Layers a ray may hit (T-5.1). Markings and rail are never pickable; road_areas are not listed in the card. */
export const PICKABLE_LAYERS: ReadonlySet<string> = new Set([
  'buildings',
  'landmark_details',
  'roads',
  'green',
  'water',
  'landuse',
  'trees',
]);

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The row of feature `fid` in `layer` of a tile table, or null. */
export function rowForFeature(table: FeatureTable | undefined, layer: string, fid: number): Row | null {
  const rows = table?.layers[layer];
  if (!rows || !Number.isInteger(fid) || fid < 0 || fid >= rows.length) return null;
  return rows[fid];
}

/**
 * Whether a hit on `row` of `layer` can be picked. Fill trees (`decorative` is not exactly false)
 * and every layer outside PICKABLE_LAYERS (markings, rail, road areas) are not: the ray goes on.
 */
export function isPickable(layer: string, row: Row | null): boolean {
  if (!PICKABLE_LAYERS.has(layer) || !row) return false;
  if (layer === 'trees') return row.decorative === false;
  return true;
}

/**
 * The selection ref of a picked row. A landmark building or landmark detail gives the landmark
 * (never the detail, ADR-0028). Returns null when the row lacks what identifies it.
 */
export function refForRow(layer: string, tile: string, row: Row): FeatureRef | null {
  if (layer === 'landmark_details' || (layer === 'buildings' && str(row.landmark_id) !== null)) {
    const landmarkId = str(row.landmark_id);
    return landmarkId === null ? null : { layer: 'landmark', tile, landmarkId };
  }
  if (layer === 'buildings') {
    const key = str(row.key);
    return key === null ? null : { layer, tile, key };
  }
  const osmType = str(row.osm_type);
  const osmId = num(row.osm_id);
  if (osmType === null || osmId === null) return null;
  return { layer, tile, osmType, osmId };
}

/** Stable string identity of a ref, to compare selections and hovers. */
export function refKey(ref: FeatureRef | null): string {
  if (!ref) return '';
  return [ref.layer, ref.key ?? '', ref.osmType ?? '', ref.osmId ?? '', ref.landmarkId ?? '', ref.streetName ?? ''].join('|');
}

/** Search-index entry (ADR-0031), only the fields read here. */
export interface IndexEntry {
  name: string;
  kind: string;
  /** Tiles that hold the entry's geometry (landmarks: every tile of the body). */
  tiles?: string[];
  ref: { key?: string; landmark_id?: string; osm_id?: number; osm_type?: string; osm_ids?: Record<string, number[]> };
}

/** Names and kinds from `index.json`, by the keys the card needs. */
export class IndexLookup {
  private readonly landmarks = new Map<string, IndexEntry>();
  private readonly streetsById = new Map<string, IndexEntry>();
  private readonly streetsByName = new Map<string, IndexEntry>();
  private readonly areas = new Map<string, IndexEntry>();
  private readonly buildings = new Map<string, IndexEntry>();

  constructor(entries: readonly IndexEntry[] = []) {
    for (const e of entries) {
      const r = e.ref;
      if (e.kind === 'landmark' && r.landmark_id) this.landmarks.set(r.landmark_id, e);
      else if (e.kind === 'building' && r.key) this.buildings.set(r.key, e);
      else if (e.kind === 'street') {
        this.streetsByName.set(e.name, e);
        for (const [t, ids] of Object.entries(r.osm_ids ?? {})) {
          for (const id of ids) this.streetsById.set(`${t}${id}`, e);
        }
      } else if (r.osm_type && typeof r.osm_id === 'number') {
        this.areas.set(`${r.osm_type}${r.osm_id}`, e);
      }
    }
  }

  landmark(id: string): IndexEntry | undefined {
    return this.landmarks.get(id);
  }
  building(key: string): IndexEntry | undefined {
    return this.buildings.get(key);
  }
  street(name: string): IndexEntry | undefined {
    return this.streetsByName.get(name);
  }
  /** Named entry of a road way/relation or of a green/water area. */
  byOsm(layer: string, osmType: string, osmId: number): IndexEntry | undefined {
    return layer === 'roads' ? this.streetsById.get(`${osmType}${osmId}`) : this.areas.get(`${osmType}${osmId}`);
  }
  /** OSM way/relation ids of a street name, as `w123` keys. */
  streetOsmKeys(name: string): Set<string> {
    const out = new Set<string>();
    for (const [t, ids] of Object.entries(this.streetsByName.get(name)?.ref.osm_ids ?? {})) {
      for (const id of ids) out.add(`${t}${id}`);
    }
    return out;
  }
}

/** First table (the ref's tile first) holding a row for which `test` is true. */
function findIn(tables: Tables, tile: string | undefined, layer: string, test: (r: Row) => boolean): { tile: string; row: Row } | null {
  const order = tile && tables.has(tile) ? [tile, ...[...tables.keys()].filter((k) => k !== tile)] : [...tables.keys()];
  for (const id of order) {
    const rows = tables.get(id)?.layers[layer];
    const row = rows?.find(test);
    if (row) return { tile: id, row };
  }
  return null;
}

/** The feature-table row a ref points at, if its tile is loaded. */
export function findRow(ref: FeatureRef, tables: Tables): Row | null {
  switch (ref.layer) {
    case 'buildings':
      return findIn(tables, ref.tile, 'buildings', (r) => r.key === ref.key)?.row ?? null;
    case 'roads':
    case 'green':
    case 'water':
    case 'landuse':
    case 'trees':
      if (ref.osmType === undefined || ref.osmId === undefined) return null;
      return findIn(tables, ref.tile, ref.layer, (r) => r.osm_type === ref.osmType && r.osm_id === ref.osmId)?.row ?? null;
    default:
      return null;
  }
}

/** All building rows of a landmark that are loaded. */
export function landmarkBuildingRows(landmarkId: string, tables: Tables): Row[] {
  const out: Row[] = [];
  for (const t of tables.values()) {
    for (const r of t.layers.buildings ?? []) if (r.landmark_id === landmarkId) out.push(r);
  }
  return out;
}

/**
 * Whether row `row` of `layer` belongs to the feature `ref` (used to highlight it). A landmark
 * covers its buildings and its details; a tree ref covers every tree with that OSM id (a mapped
 * tree row shares one id); a street found by name covers the ways listed in the index.
 */
export function matcherFor(ref: FeatureRef, index: IndexLookup): (layer: string, row: Row) => boolean {
  switch (ref.layer) {
    case 'landmark':
      return (layer, row) => (layer === 'buildings' || layer === 'landmark_details') && row.landmark_id === ref.landmarkId;
    case 'buildings':
      return (layer, row) => layer === 'buildings' && row.key === ref.key && ref.key !== undefined;
    case 'roads': {
      if (ref.streetName !== undefined) {
        const keys = index.streetOsmKeys(ref.streetName);
        return (layer, row) => layer === 'roads' && keys.has(`${String(row.osm_type)}${String(row.osm_id)}`);
      }
      return (layer, row) => layer === 'roads' && row.osm_type === ref.osmType && row.osm_id === ref.osmId;
    }
    case 'green':
    case 'water':
    case 'landuse':
    case 'trees':
      return (layer, row) => layer === ref.layer && ref.osmId !== undefined && row.osm_type === ref.osmType && row.osm_id === ref.osmId;
    default:
      return () => false;
  }
}

/** OSM URL of `<type letter n|w|r>` and id; null for anything else. */
export function osmUrl(osmType: string | null | undefined, osmId: number | null | undefined): string | null {
  if (osmId == null || !Number.isInteger(osmId) || osmId <= 0) return null;
  const name = osmType === 'n' ? 'node' : osmType === 'w' ? 'way' : osmType === 'r' ? 'relation' : null;
  return name === null ? null : `https://www.openstreetmap.org/${name}/${osmId}`;
}

/** OSM URL of a building key `osm:<w|n|r><id>` (T-1.x heights); DBT-only keys have none. */
export function osmUrlOfBuildingKey(key: string | null): string | null {
  const m = key === null ? null : /^osm:([nwr])(\d+)$/.exec(key);
  return m ? osmUrl(m[1], Number(m[2])) : null;
}
