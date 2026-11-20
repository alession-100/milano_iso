/* global process, console */
// T-6.3: write a brotli (.br) and a gzip (.gz) copy next to every text and glb asset of a directory,
// when the copy is smaller than the file. Node built-ins only (zlib), no dependency.
//
//   node scripts/precompress.mjs [dir ...]      (default: dist, next to this script's package)
//
// Deterministic for one Node build: fixed quality and window, no timestamps. The gzip header written by
// zlib has MTIME = 0 and an OS byte that depends on the platform, so the OS byte is set to 255
// ("unknown"), the same on Windows and Linux. Brotli has no header fields. The compressed bytes of
// the same input are the same on every run with the same Node/zlib build and CPU class (T-6.3 measures
// repeatability, not byte identity across machines: the .br/.gz files are build output, never committed).
import { readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

/** Text assets and glb: what compresses. Images and fonts are already compressed. */
export const COMPRESSIBLE = new Set([
  '.html',
  '.js',
  '.mjs',
  '.css',
  '.json',
  '.svg',
  '.glb',
  '.txt',
  '.xml',
  '.map',
  '.webmanifest',
]);

/** Brotli quality 11 (best), window 2^24: the slowest and smallest setting, fixed. */
export const BROTLI_QUALITY = 11;
export const BROTLI_LGWIN = 24;
/** gzip level 9 (best), memLevel 9. */
export const GZIP_LEVEL = 9;

export function brotli(buf) {
  return zlib.brotliCompressSync(buf, {
    params: {
      [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_GENERIC,
      [zlib.constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
      [zlib.constants.BROTLI_PARAM_LGWIN]: BROTLI_LGWIN,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
    },
  });
}

export function gzip(buf) {
  const out = zlib.gzipSync(buf, { level: GZIP_LEVEL, memLevel: 9 });
  out[4] = out[5] = out[6] = out[7] = 0; // MTIME: none (zlib writes 0 already; stated, not assumed)
  out[9] = 255; // OS: unknown, so the bytes do not depend on the platform
  return out;
}

function* walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

/** True when `file` holds a valid brotli/gzip stream that decodes to `raw` (an up-to-date variant). */
function decodesTo(file, ext, raw) {
  try {
    const packed = readFileSync(file);
    const plain = ext === 'br' ? zlib.brotliDecompressSync(packed) : zlib.gunzipSync(packed);
    return packed.length < raw.length && plain.equals(raw);
  } catch {
    return false;
  }
}

/**
 * Compress every compressible file under `dir`. A variant that is not smaller is not written, and an
 * old one is removed. A variant that already decodes to the file is kept as it is (so the 340 MB of
 * city tiles are compressed once, in `public/tiles/<extent>`, and a later build only compresses the
 * new JS and HTML; delete the .br/.gz to force a rebuild of them). Returns one record per file, in
 * path order, with the sizes.
 */
export function compressTree(dir) {
  const rows = [];
  for (const file of [...walk(dir)]) {
    if (/\.(br|gz)$/.test(file) || !COMPRESSIBLE.has(path.extname(file).toLowerCase())) continue;
    const raw = readFileSync(file);
    const row = { file: path.relative(dir, file).split(path.sep).join('/'), raw: raw.length, br: 0, gz: 0 };
    for (const [ext, fn] of [
      ['br', brotli],
      ['gz', gzip],
    ]) {
      if (decodesTo(`${file}.${ext}`, ext, raw)) {
        row[ext] = statSync(`${file}.${ext}`).size;
        continue;
      }
      const out = fn(raw);
      if (out.length < raw.length) {
        writeFileSync(`${file}.${ext}`, out);
        row[ext] = out.length;
      } else {
        rmSync(`${file}.${ext}`, { force: true });
      }
    }
    rows.push(row);
  }
  return rows;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const dirs = process.argv.length > 2 ? process.argv.slice(2).map((d) => path.resolve(d)) : [path.join(root, 'dist')];
  for (const dir of dirs) {
    const rows = compressTree(dir);
    const raw = rows.reduce((a, r) => a + r.raw, 0);
    const br = rows.reduce((a, r) => a + (r.br || r.raw), 0);
    const gz = rows.reduce((a, r) => a + (r.gz || r.raw), 0);
    console.log(`precompress ${dir}: ${rows.length} files, raw ${raw} B, brotli ${br} B, gzip ${gz} B`);
  }
}
