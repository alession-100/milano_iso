/* global Buffer */
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { brotli, compressTree, gzip } from './precompress.mjs';

const dirs = [];
function tmp() {
  const d = mkdtempSync(path.join(tmpdir(), 'milano-precompress-'));
  dirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const TEXT = Buffer.from(JSON.stringify({ tiles: Array.from({ length: 200 }, (_, i) => ({ id: `${i}_0`, file: `${i}_0.glb` })) }));
const NOISE = Buffer.from(Array.from({ length: 64 }, (_, i) => (i * 97 + 31) % 256)); // too short to shrink

function site() {
  const d = tmp();
  mkdirSync(path.join(d, 'tiles', 'x', 'shards'), { recursive: true });
  mkdirSync(path.join(d, 'assets'));
  writeFileSync(path.join(d, 'index.html'), '<!doctype html>' + '<p>milano</p>'.repeat(200));
  writeFileSync(path.join(d, 'assets', 'index-abc.js'), 'export const a = 1;\n'.repeat(300));
  writeFileSync(path.join(d, 'tiles', 'x', 'tiles.json'), TEXT);
  writeFileSync(path.join(d, 'tiles', 'x', 'shards', 'S0_0_0.json'), TEXT);
  writeFileSync(path.join(d, 'tiles', 'x', 'tiny.glb'), NOISE);
  writeFileSync(path.join(d, 'logo.png'), TEXT); // not a compressible type
  return d;
}

function tree(d) {
  const out = {};
  const walk = (p) => {
    for (const n of readdirSync(p).sort()) {
      const f = path.join(p, n);
      if (statSync(f).isDirectory()) walk(f);
      else out[path.relative(d, f).split(path.sep).join('/')] = createHash('sha256').update(readFileSync(f)).digest('hex');
    }
  };
  walk(d);
  return out;
}

describe('precompress (T-6.3)', () => {
  it('writes .br and .gz that decode to the original, for text and glb only, and only when smaller', () => {
    const d = site();
    const rows = compressTree(d);
    const names = rows.map((r) => r.file);
    expect(names).toEqual([
      'assets/index-abc.js',
      'index.html',
      'tiles/x/shards/S0_0_0.json',
      'tiles/x/tiles.json',
      'tiles/x/tiny.glb',
    ]); // path order; the png is skipped
    for (const f of ['index.html', 'assets/index-abc.js', 'tiles/x/tiles.json', 'tiles/x/shards/S0_0_0.json']) {
      const raw = readFileSync(path.join(d, f));
      expect(zlib.brotliDecompressSync(readFileSync(path.join(d, `${f}.br`)))).toEqual(raw);
      expect(zlib.gunzipSync(readFileSync(path.join(d, `${f}.gz`)))).toEqual(raw);
      expect(statSync(path.join(d, `${f}.br`)).size).toBeLessThan(raw.length);
    }
    // a file that does not get smaller has no copy; a type that is not compressible has none either
    expect(existsSync(path.join(d, 'tiles/x/tiny.glb.br'))).toBe(false);
    expect(existsSync(path.join(d, 'tiles/x/tiny.glb.gz'))).toBe(false);
    expect(existsSync(path.join(d, 'logo.png.br'))).toBe(false);
  });

  it('is deterministic: two runs on two copies give the same bytes, and a second run changes nothing', () => {
    const a = site();
    const b = tmp();
    cpSync(a, b, { recursive: true });
    compressTree(a);
    compressTree(b);
    expect(tree(a)).toEqual(tree(b));
    const before = tree(a);
    compressTree(a); // the .br/.gz of the last run are not compressed again
    expect(tree(a)).toEqual(before);
  });

  it('the gzip header has no timestamp and no platform byte; brotli has no header to vary', () => {
    const g = gzip(TEXT);
    expect([...g.subarray(0, 4)]).toEqual([0x1f, 0x8b, 8, 0]); // magic, deflate, no flags (no name)
    expect([...g.subarray(4, 8)]).toEqual([0, 0, 0, 0]); // MTIME
    expect(g[9]).toBe(255); // OS unknown
    expect(gzip(TEXT)).toEqual(g);
    expect(brotli(TEXT)).toEqual(brotli(TEXT));
    // different input, different output (the check is not vacuous)
    expect(brotli(Buffer.concat([TEXT, Buffer.from('x')]))).not.toEqual(brotli(TEXT));
  });

  it('removes the stale copy of a file that no longer shrinks', () => {
    const d = site();
    compressTree(d);
    const f = path.join(d, 'index.html');
    writeFileSync(f, NOISE);
    compressTree(d);
    expect(existsSync(`${f}.br`)).toBe(false);
    expect(existsSync(`${f}.gz`)).toBe(false);
  });
});
