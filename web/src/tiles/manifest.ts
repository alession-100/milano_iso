/**
 * tiles.json: fetch and validate the minimal shape the client relies on (ADR-0021, ADR-0022, ADR-0025).
 * The full schema lives in pipeline/milano_iso/tiles/tiles.schema.json; here only what is read.
 *
 * Format 2 (T-6.3, ADR-0038): tiles.json is a small root (header, attribution, levels, the list of
 * shards). The tile entries are in `shards/S<level>_<a>_<b>.json`, fetched when the view needs them.
 */

export type Vec3 = [number, number, number];

export interface FileRef {
  file: string;
  /** Content hash; the client appends its first 12 hex digits as `?v=`, so a cached file is never stale (T-6.3). */
  sha256?: string;
}

export interface TileEntry {
  id: string;
  i: number;
  j: number;
  /** Extent of the decoded vertices in the client frame (metres); may exceed the grid cell. */
  content_bbox_local: { min: Vec3; max: Vec3 };
  glb: FileRef;
  features: FileRef;
  /** Level of detail (T-6.2): 0 for the base tiles (and when absent), 1..n for the coarse blocks. */
  level?: number;
  /** Features per layer in the tile (T-6.5 reads it to count the draw calls of a plan); absent in old tilesets. */
  counts?: Record<string, number>;
  /** Grid cell [xmin, zmin, xmax, zmax] in client metres; the cells of the levels nest. */
  bbox_local?: [number, number, number, number];
}

/** One level of detail as listed in tiles.json `levels` (T-6.2). Its tiles are in the shards. */
export interface LevelRecord {
  level: number;
  /** Simplification error in metres: the level may be shown where metres per pixel >= this. */
  tolerance_m: number;
  block_m: number;
}

/** One shard file of tile entries (T-6.3): one level, one square of ground. */
export interface ShardRecord {
  level: number;
  id: string;
  /** Relative to the tiles directory: `shards/S<level>_<a>_<b>.json`. */
  file: string;
  bytes: number;
  sha256: string;
  tiles: number;
  /** Union of the content boxes of its tiles, to decide whether the shard is in view. */
  content_bbox_local: { min: Vec3; max: Vec3 };
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

/** The root manifest, tiles.json. */
export interface Manifest {
  format_version: 2;
  axis: string;
  tile_size_m: number;
  layers: string[];
  attribution: AttributionEntry[];
  /** Ground extent [xmin, zmin, xmax, zmax] of the content of the base tiles, for the camera bounds. */
  bounds_local: [number, number, number, number];
  shards: ShardRecord[];
  /** Search index of named features; absent in tilesets built before T-5.3a. */
  index?: ExtraFile;
  /** Minimap drawing of the whole tileset extent; absent in tilesets built before T-5.3a. */
  minimap?: ExtraFile;
  /** Levels of detail (T-6.2); absent when the tileset has the base level only. */
  levels?: LevelRecord[];
}

export const EXPECTED_FORMAT_VERSION = 2;
export const EXPECTED_UNIT_M = 0.02;
export const EXPECTED_AXIS = 'x=E-E0, y=up, z=-(N-N0)';
export const DEFAULT_TILES_BASE = 'tiles/city/';

export class ManifestError extends Error {}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isVec3(v: unknown): v is Vec3 {
  return (
    Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

function isBox(v: unknown): boolean {
  return isRecord(v) && isVec3(v.min) && isVec3(v.max);
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

function checkShardRecord(sh: unknown): void {
  if (
    !isRecord(sh) ||
    typeof sh.id !== 'string' ||
    typeof sh.file !== 'string' ||
    !/^shards\/[^/\\]+\.json$/.test(sh.file) ||
    typeof sh.level !== 'number' ||
    !Number.isInteger(sh.level) ||
    sh.level < 0 ||
    typeof sh.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(sh.sha256) ||
    typeof sh.bytes !== 'number' ||
    typeof sh.tiles !== 'number' ||
    !isBox(sh.content_bbox_local)
  ) {
    fail('shard record invalid');
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
  const bl = raw.bounds_local;
  if (!Array.isArray(bl) || bl.length !== 4 || !bl.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    fail('bounds_local invalid');
  }
  if (!Array.isArray(raw.shards) || raw.shards.length === 0) fail('shards missing');
  for (const sh of raw.shards) checkShardRecord(sh);
  checkExtraFile(raw, 'index');
  checkExtraFile(raw, 'minimap');
  checkLevels(raw);
  return raw as unknown as Manifest;
}

/** `levels` (T-6.2): ascending levels from 0, growing tolerance. */
function checkLevels(raw: Record<string, unknown>): void {
  const lv = raw.levels;
  if (lv === undefined) return;
  if (!Array.isArray(lv) || lv.length === 0) fail('levels invalid');
  lv.forEach((l: unknown, k: number) => {
    if (
      !isRecord(l) ||
      l.level !== k ||
      typeof l.tolerance_m !== 'number' ||
      !(l.tolerance_m > 0) ||
      typeof l.block_m !== 'number' ||
      !(l.block_m > 0)
    ) {
      fail(`levels[${k}] invalid`);
    }
    if (k > 0 && (l.tolerance_m as number) <= (lv[k - 1] as LevelRecord).tolerance_m) {
      fail('levels: tolerance_m must grow with the level');
    }
  });
}

/** A shard document, checked against its record in the root; every tile entry gets the shard's level. */
export function parseShard(raw: unknown, rec: ShardRecord): TileEntry[] {
  const bad = (msg: string): never => {
    throw new ManifestError(`${rec.file}: ${msg}`);
  };
  if (!isRecord(raw) || raw.format_version !== EXPECTED_FORMAT_VERSION) return bad('format_version');
  if (raw.id !== rec.id || raw.level !== rec.level) return bad('id or level differs from the root');
  if (!Array.isArray(raw.tiles) || raw.tiles.length === 0) return bad('tiles missing');
  const out: TileEntry[] = [];
  for (const t of raw.tiles as unknown[]) {
    if (!isRecord(t) || typeof t.id !== 'string') return bad('tile entry invalid');
    if (!isBox(t.content_bbox_local)) return bad(`tile ${t.id}: content_bbox_local invalid`);
    if (!isRecord(t.glb) || typeof t.glb.file !== 'string') return bad(`tile ${t.id}: glb.file missing`);
    if (!isRecord(t.features) || typeof t.features.file !== 'string') {
      return bad(`tile ${t.id}: features.file missing`);
    }
    out.push({ ...(t as unknown as TileEntry), level: rec.level });
  }
  return out;
}

/** Level numbers with their tolerance, ascending; a manifest without `levels` has only level 0. */
export function levelSpecs(manifest: Manifest): { level: number; tolerance_m: number }[] {
  const l = manifest.levels;
  if (!l || l.length === 0) return [{ level: 0, tolerance_m: 0 }];
  return l.map((x) => ({ level: x.level, tolerance_m: x.tolerance_m }));
}

/** Digits of the content hash used as the `?v=` of a file (T-6.3). */
export const VERSION_LENGTH = 12;

/**
 * URL of a file of the tileset: `file` next to the tiles, with `?v=<first 12 hex digits of its sha256>`.
 * The hash comes from the manifest: a file that changes gets a new URL, so a cached copy is never stale,
 * and a file that does not change keeps its URL, so its cached copy stays valid (ADR-0038).
 */
export function assetUrl(base: URL, file: string, sha256?: string): URL {
  const u = new URL(file, base);
  if (sha256 !== undefined && /^[0-9a-f]{64}$/.test(sha256)) u.search = `v=${sha256.slice(0, VERSION_LENGTH)}`;
  return u;
}

/** URL of the search index file, or undefined if the tileset has none. */
export function indexUrl(manifest: Manifest, base: URL): URL | undefined {
  return manifest.index === undefined ? undefined : assetUrl(base, manifest.index.file, manifest.index.sha256);
}

/** URL of the minimap drawing, or undefined if the tileset has none. */
export function minimapUrl(manifest: Manifest, base: URL): URL | undefined {
  return manifest.minimap === undefined ? undefined : assetUrl(base, manifest.minimap.file, manifest.minimap.sha256);
}

/** Base URL of the tile directory: `?tiles=<base>` if given, else `tiles/pilot/` (ADR-0025). */
export function resolveTilesBase(search: string, pageUrl: string): URL {
  const q = new URLSearchParams(search).get('tiles');
  const base = q !== null && q.trim() !== '' ? q.trim() : DEFAULT_TILES_BASE;
  return new URL(base.endsWith('/') ? base : `${base}/`, pageUrl);
}

async function fetchJson(url: URL, what: string, init: RequestInit = {}): Promise<unknown> {
  const { signal } = init;
  const res = await fetch(url, init);
  if (!res.ok) fail(`HTTP ${res.status} for ${url.pathname}`);
  try {
    return await res.json();
  } catch (err) {
    if (signal?.aborted) throw err;
    return fail(`${what}: not valid JSON`);
  }
}

/** The root manifest, tiles.json. */
export async function fetchManifest(base: URL): Promise<Manifest> {
  // The one file that is not content-addressed: always revalidated (ETag/304 where the host has them),
  // so a new build is seen at once whatever Cache-Control the host sends (ADR-0038).
  return parseManifest(await fetchJson(new URL('tiles.json', base), 'tiles.json', { cache: 'no-cache' }));
}

/** The tile entries of one shard; the signal cancels the request (T-6.3). */
export async function fetchShard(base: URL, rec: ShardRecord, signal?: AbortSignal): Promise<TileEntry[]> {
  return parseShard(await fetchJson(assetUrl(base, rec.file, rec.sha256), rec.file, { signal }), rec);
}

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Ground rectangle covered by the content of the base tiles, for the camera's `setBounds` (T-3.1). */
export function contentBounds(manifest: Manifest): Bounds {
  const [minX, minZ, maxX, maxZ] = manifest.bounds_local;
  return { minX, maxX, minZ, maxZ };
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
