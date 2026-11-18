import type { FeatureRef } from './selection';

/** Bbox `[minX, minZ, maxX, maxZ]` in client metres (ADR-0031). */
export type Bbox4 = [number, number, number, number];

export type IndexKind = 'building' | 'street' | 'green' | 'water' | 'landmark' | 'stop';

/** One entry of `index.json` (ADR-0031); only the fields the client reads. */
export interface IndexEntry {
  bbox: Bbox4;
  centre: [number, number];
  kind: IndexKind;
  name: string;
  ref: {
    key?: string;
    osm_id?: number;
    osm_type?: string;
    osm_ids?: Record<string, number[]>;
    landmark_id?: string;
  };
  tiles: string[];
}

export const MAX_RESULTS = 8;
const KINDS: readonly string[] = ['building', 'street', 'green', 'water', 'landmark', 'stop'];

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Validates the parsed `index.json`; entries of an unexpected shape are dropped, not guessed. */
export function parseIndex(raw: unknown): IndexEntry[] {
  const entries = (raw as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(entries)) throw new Error('index.json: entries missing');
  const out: IndexEntry[] = [];
  for (const e of entries as Record<string, unknown>[]) {
    const ok =
      typeof e === 'object' &&
      e !== null &&
      typeof e.name === 'string' &&
      typeof e.kind === 'string' &&
      KINDS.includes(e.kind) &&
      Array.isArray(e.bbox) &&
      e.bbox.length === 4 &&
      e.bbox.every(isNum) &&
      Array.isArray(e.centre) &&
      e.centre.length === 2 &&
      e.centre.every(isNum) &&
      typeof e.ref === 'object' &&
      e.ref !== null;
    if (ok) out.push(e as unknown as IndexEntry);
  }
  return out;
}

/**
 * Accent- and case-folded form used for matching only (names are shown verbatim, ADR-0006):
 * NFD, combining marks removed, lower case, anything that is not a letter or digit becomes one
 * space ("Ca' Granda" and "ca granda" fold to the same string).
 */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export interface Hit {
  /** Verbatim name of the first member. */
  name: string;
  kind: IndexKind;
  /** Number of index entries sharing this name and kind. */
  count: number;
  members: IndexEntry[];
  /** Union bbox of the members. */
  bbox: Bbox4;
  /** Entry centre for a single member, else the union bbox centre. */
  centre: [number, number];
}

export function unionBbox(boxes: readonly Bbox4[]): Bbox4 {
  return [
    Math.min(...boxes.map((b) => b[0])),
    Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])),
    Math.max(...boxes.map((b) => b[3])),
  ];
}

function makeHit(members: IndexEntry[]): Hit {
  const bbox = unionBbox(members.map((m) => m.bbox));
  const first = members[0];
  return {
    name: first.name,
    kind: first.kind,
    count: members.length,
    members,
    bbox,
    centre:
      members.length === 1
        ? [first.centre[0], first.centre[1]]
        : [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2],
  };
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Kind order for equal names: alphabetical, but a stop after a street of the same name. */
function tieKind(kind: IndexKind): string {
  return kind === 'stop' ? '￿' : kind;
}

/** How many hits `search` would find without the limit (same grouping: one per kind and name). */
export function countHits(entries: readonly IndexEntry[], query: string): number {
  const q = fold(query);
  if (q === '') return 0;
  const keys = new Set<string>();
  for (const e of entries) if (fold(e.name).includes(q)) keys.add(`${e.kind}\u0000${e.name}`);
  return keys.size;
}

/**
 * Matches `query` against the entries. Order: an exact folded-name match first, then prefix
 * matches, then substring matches; within the prefix and substring groups landmarks come before
 * the other kinds; then folded name, then kind (stop last), then verbatim name (deterministic). Entries with
 * the same name and kind are grouped into one hit. At most `limit` hits.
 */
export function search(entries: readonly IndexEntry[], query: string, limit = MAX_RESULTS): Hit[] {
  const q = fold(query);
  if (q === '') return [];
  const groups = new Map<string, { folded: string; rank: number; members: IndexEntry[] }>();
  for (const e of entries) {
    const folded = fold(e.name);
    const at = folded.indexOf(q);
    if (at < 0) continue;
    const key = `${e.kind}\u0000${e.name}`;
    const g = groups.get(key);
    if (g) g.members.push(e);
    else groups.set(key, { folded, rank: folded === q ? 0 : at === 0 ? 1 : 2, members: [e] });
  }
  const sorted = [...groups.values()].sort(
    (a, b) =>
      a.rank - b.rank ||
      Number(b.members[0].kind === 'landmark') - Number(a.members[0].kind === 'landmark') ||
      cmp(a.folded, b.folded) ||
      cmp(tieKind(a.members[0].kind), tieKind(b.members[0].kind)) ||
      cmp(a.members[0].name, b.members[0].name),
  );
  return sorted.slice(0, limit).map((g) => makeHit(g.members));
}

/** "Name" or "Name (n)" for a grouped hit. */
export function hitLabel(hit: Hit): string {
  return hit.count > 1 ? `${hit.name} (${hit.count})` : hit.name;
}

/** FeatureRef (selection.ts contract) for a hit: the first member stands for a group. */
export function refOf(hit: Hit): FeatureRef | null {
  const e = hit.members[0];
  switch (e.kind) {
    case 'landmark':
      return e.ref.landmark_id === undefined ? null : { layer: 'landmark', landmarkId: e.ref.landmark_id };
    case 'building':
      return e.ref.key === undefined ? null : { layer: 'buildings', key: e.ref.key };
    case 'stop':
    case 'street': {
      const ids = e.ref.osm_ids ?? {};
      for (const type of Object.keys(ids)) {
        const first = ids[type]?.[0];
        if (first !== undefined) return { layer: 'roads', streetName: e.name, osmType: type, osmId: first };
      }
      return null;
    }
    case 'green':
    case 'water':
      return e.ref.osm_id === undefined
        ? null
        : { layer: e.kind, osmType: e.ref.osm_type, osmId: e.ref.osm_id };
  }
}
