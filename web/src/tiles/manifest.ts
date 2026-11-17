/**
 * tiles.json: fetch and validate the minimal shape the client relies on (ADR-0021, ADR-0022, ADR-0025).
 * The full schema lives in pipeline/milano_iso/tiles/tiles.schema.json; here only what is read.
 */

export type Vec3 = [number, number, number];

export interface TileEntry {
  id: string;
  i: number;
  j: number;
  /** Extent of the decoded vertices in the client frame (metres); may exceed the grid cell. */
  content_bbox_local: { min: Vec3; max: Vec3 };
  glb: { file: string };
  features: { file: string };
}

export interface AttributionEntry {
  source: string;
  licence: string;
  text: string;
  url?: string;
}

/** A standalone file next to the tiles (index.json, minimap.svg), T-5.3a. */
export interface ExtraFile {
  file: string;
  bytes: number;
  gzip9_bytes: number;
  sha256: string;
}

export interface Manifest {
  format_version: 1;
  axis: string;
  tile_size_m: number;
  layers: string[];
  attribution: AttributionEntry[];
  tiles: TileEntry[];
  /** Search index of named features; absent in tilesets built before T-5.3a. */
  index?: ExtraFile;
  /** Minimap drawing of the whole tileset extent; absent in tilesets built before T-5.3a. */
  minimap?: ExtraFile;
}

export const EXPECTED_FORMAT_VERSION = 1;
export const EXPECTED_UNIT_M = 0.02;
export const EXPECTED_AXIS = 'x=E-E0, y=up, z=-(N-N0)';
export const DEFAULT_TILES_BASE = 'tiles/pilot/';

export class ManifestError extends Error {}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isVec3(v: unknown): v is Vec3 {
  return (
    Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

function fail(msg: string): never {
  throw new ManifestError(`tiles.json: ${msg}`);
}

function checkExtraFile(raw: Record<string, unknown>, key: 'index' | 'minimap'): void {
  const v = raw[key];
  if (v === undefined) return;
  if (
    !isRecord(v) ||
    typeof v.file !== 'string' ||
    v.file === '' ||
    typeof v.bytes !== 'number' ||
    typeof v.gzip9_bytes !== 'number' ||
    typeof v.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(v.sha256)
  ) {
    fail(`${key} entry invalid`);
  }
}

/** Validate an already-parsed JSON value; throws ManifestError on anything unexpected. */
export function parseManifest(raw: unknown): Manifest {
  if (!isRecord(raw)) fail('not an object');
  if (raw.format_version !== EXPECTED_FORMAT_VERSION) {
    fail(`format_version ${String(raw.format_version)}, expected ${EXPECTED_FORMAT_VERSION}`);
  }
  const q = raw.quantization;
  if (!isRecord(q) || q.unit_m !== EXPECTED_UNIT_M) {
    fail(`quantization.unit_m must be ${EXPECTED_UNIT_M}`);
  }
  if (raw.axis !== EXPECTED_AXIS) fail(`axis must be "${EXPECTED_AXIS}"`);
  if (typeof raw.tile_size_m !== 'number' || !(raw.tile_size_m > 0)) fail('tile_size_m invalid');
  if (!Array.isArray(raw.layers) || !raw.layers.every((l) => typeof l === 'string')) {
    fail('layers invalid');
  }
  if (!Array.isArray(raw.attribution) || raw.attribution.length === 0) fail('attribution missing');
  for (const a of raw.attribution) {
    if (!isRecord(a) || typeof a.source !== 'string' || typeof a.text !== 'string') {
      fail('attribution entry invalid');
    }
  }
  if (!Array.isArray(raw.tiles) || raw.tiles.length === 0) fail('tiles missing');
  for (const tile of raw.tiles) {
    if (!isRecord(tile) || typeof tile.id !== 'string') fail('tile entry invalid');
    const cb = tile.content_bbox_local;
    if (!isRecord(cb) || !isVec3(cb.min) || !isVec3(cb.max)) {
      fail(`tile ${tile.id}: content_bbox_local invalid`);
    }
    if (!isRecord(tile.glb) || typeof tile.glb.file !== 'string') {
      fail(`tile ${tile.id}: glb.file missing`);
    }
  }
  checkExtraFile(raw, 'index');
  checkExtraFile(raw, 'minimap');
  return raw as unknown as Manifest;
}

/** URL of the search index file, or undefined if the tileset has none. */
export function indexUrl(manifest: Manifest, base: URL): URL | undefined {
  return manifest.index === undefined ? undefined : new URL(manifest.index.file, base);
}

/** URL of the minimap drawing, or undefined if the tileset has none. */
export function minimapUrl(manifest: Manifest, base: URL): URL | undefined {
  return manifest.minimap === undefined ? undefined : new URL(manifest.minimap.file, base);
}

/** Base URL of the tile directory: `?tiles=<base>` if given, else `tiles/pilot/` (ADR-0025). */
export function resolveTilesBase(search: string, pageUrl: string): URL {
  const q = new URLSearchParams(search).get('tiles');
  const base = q !== null && q.trim() !== '' ? q.trim() : DEFAULT_TILES_BASE;
  return new URL(base.endsWith('/') ? base : `${base}/`, pageUrl);
}

export async function fetchManifest(base: URL): Promise<Manifest> {
  const url = new URL('tiles.json', base);
  const res = await fetch(url);
  if (!res.ok) fail(`HTTP ${res.status} for ${url.pathname}`);
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    fail('not valid JSON');
  }
  return parseManifest(json);
}

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Ground rectangle covered by all tile content, for the camera's `setBounds` (T-3.1). */
export function contentBounds(manifest: Manifest): Bounds {
  const b: Bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const t of manifest.tiles) {
    const { min, max } = t.content_bbox_local;
    b.minX = Math.min(b.minX, min[0]);
    b.maxX = Math.max(b.maxX, max[0]);
    b.minZ = Math.min(b.minZ, min[2]);
    b.maxZ = Math.max(b.maxZ, max[2]);
  }
  return b;
}

// Public pages of the licences / copyright notices named in the manifest. Link targets, not data.
const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright';
const CC_BY_4_URL = 'https://creativecommons.org/licenses/by/4.0/';

/** URL for an attribution entry: its own `url` if http(s), else a known page, else undefined. */
export function attributionUrl(a: AttributionEntry): string | undefined {
  if (a.url !== undefined && /^https?:\/\//.test(a.url)) return a.url;
  if (a.source === 'OpenStreetMap') return OSM_COPYRIGHT_URL;
  if (a.licence === 'CC BY 4.0') return CC_BY_4_URL;
  return undefined;
}
