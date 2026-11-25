/* global Buffer, fetch */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compressTree } from './precompress.mjs';
import { IMMUTABLE, NO_CACHE, acceptedEncodings, cacheControlFor, createStaticServer, pickEncoding, resolveInside } from './serve.mjs';

const TEXT = JSON.stringify({ tiles: Array.from({ length: 200 }, (_, i) => ({ id: `${i}_0` })) });
let dir;
let server;
let base;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'milano-serve-'));
  mkdirSync(path.join(dir, 'tiles', 'city', 'shards'), { recursive: true });
  mkdirSync(path.join(dir, 'assets'));
  writeFileSync(path.join(dir, 'index.html'), '<!doctype html>' + '<p>milano</p>'.repeat(200));
  writeFileSync(path.join(dir, 'assets', 'index-abc123.js'), 'export const a = 1;\n'.repeat(300));
  writeFileSync(path.join(dir, 'assets', 'index-abc123.css'), 'body{margin:0}\n'.repeat(300));
  writeFileSync(path.join(dir, 'tiles', 'city', 'tiles.json'), TEXT);
  writeFileSync(path.join(dir, 'tiles', 'city', 'shards', 'S0_0_0.json'), TEXT);
  writeFileSync(path.join(dir, 'tiles', 'city', '0_0.glb'), Buffer.from('glTF'.repeat(500)));
  writeFileSync(path.join(dir, 'tiles', 'city', 'tiny.glb'), Buffer.from('glTF')); // no variant: not smaller
  compressTree(dir);
  server = createStaticServer(dir);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  rmSync(dir, { recursive: true, force: true });
});

/** A GET that does not decode the body, so the bytes and headers are exactly what was sent. */
function get(pathAndQuery, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(base + pathAndQuery, { method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('content negotiation (T-6.3)', () => {
  it('Accept-Encoding: br, gzip gets the brotli copy, with the headers a client needs', async () => {
    const r = await get('/tiles/city/tiles.json', { 'Accept-Encoding': 'gzip, deflate, br' });
    expect(r.status).toBe(200);
    expect(r.headers['content-encoding']).toBe('br');
    expect(r.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(r.headers.vary).toBe('Accept-Encoding');
    expect(Number(r.headers['content-length'])).toBe(r.body.length);
    expect(zlib.brotliDecompressSync(r.body).toString()).toBe(TEXT);
  });

  it('gzip only gets the gzip copy; no Accept-Encoding gets the plain file (Vary is still set)', async () => {
    const g = await get('/tiles/city/tiles.json', { 'Accept-Encoding': 'gzip' });
    expect(g.headers['content-encoding']).toBe('gzip');
    expect(zlib.gunzipSync(g.body).toString()).toBe(TEXT);
    const p = await get('/tiles/city/tiles.json', { 'Accept-Encoding': 'identity' });
    expect(p.headers['content-encoding']).toBeUndefined();
    expect(p.headers.vary).toBe('Accept-Encoding');
    expect(p.body.toString()).toBe(TEXT);
    const none = await get('/tiles/city/tiles.json', { 'Accept-Encoding': '' });
    expect(none.body.toString()).toBe(TEXT);
  });

  it('a refused encoding (q=0) is not used; br with a smaller q still counts', async () => {
    const a = await get('/tiles/city/tiles.json', { 'Accept-Encoding': 'br;q=0, gzip' });
    expect(a.headers['content-encoding']).toBe('gzip');
    const b = await get('/tiles/city/tiles.json', { 'Accept-Encoding': 'gzip, br;q=0.5' });
    expect(b.headers['content-encoding']).toBe('br');
  });

  it('a file with no smaller copy is sent as it is, without Vary; a glb has its type', async () => {
    const r = await get('/tiles/city/tiny.glb?v=aaaaaaaaaaaa', { 'Accept-Encoding': 'gzip, br' });
    expect(r.headers['content-encoding']).toBeUndefined();
    expect(r.headers.vary).toBeUndefined();
    expect(r.headers['content-type']).toBe('model/gltf-binary');
    const big = await get('/tiles/city/0_0.glb?v=aaaaaaaaaaaa', { 'Accept-Encoding': 'br' });
    expect(big.headers['content-type']).toBe('model/gltf-binary');
    expect(big.headers['content-encoding']).toBe('br');
  });

  it('HEAD has the headers and no body; other methods are refused', async () => {
    const h = await get('/tiles/city/tiles.json', { 'Accept-Encoding': 'br' }, 'HEAD');
    expect(h.status).toBe(200);
    expect(h.body.length).toBe(0);
    expect(Number(h.headers['content-length'])).toBeGreaterThan(0);
    expect((await get('/', {}, 'POST')).status).toBe(405);
  });

  it('the units of the helper functions', () => {
    expect([...acceptedEncodings('gzip, br;q=0.5, deflate;q=0')]).toEqual(['gzip', 'br']);
    expect(pickEncoding('br, gzip', { br: true, gz: true })).toBe('br');
    expect(pickEncoding('br, gzip', { br: false, gz: true })).toBe('gzip');
    expect(pickEncoding('br', { br: false, gz: true })).toBe('identity');
    expect(pickEncoding('*', { br: false, gz: true })).toBe('gzip');
    expect(pickEncoding(undefined, { br: true, gz: true })).toBe('identity');
  });
});

describe('the encodings option (a client without brotli, the plain files)', () => {
  async function withServer(encodings, fn) {
    const s = createStaticServer(dir, { encodings });
    await new Promise((r) => s.listen(0, '127.0.0.1', r));
    const saved = base;
    base = `http://127.0.0.1:${s.address().port}`;
    try {
      await fn();
    } finally {
      base = saved;
      await new Promise((r) => s.close(r));
    }
  }

  it('gzip only: a client that accepts br still gets gzip', async () => {
    await withServer(['gzip'], async () => {
      const r = await get('/tiles/city/tiles.json', { 'Accept-Encoding': 'br, gzip' });
      expect(r.headers['content-encoding']).toBe('gzip');
      expect(zlib.gunzipSync(r.body).toString()).toBe(TEXT);
    });
  });

  it('none: the plain file, and no Vary (nothing varies)', async () => {
    await withServer([], async () => {
      const r = await get('/tiles/city/tiles.json', { 'Accept-Encoding': 'br, gzip' });
      expect(r.headers['content-encoding']).toBeUndefined();
      expect(r.headers.vary).toBeUndefined();
      expect(r.body.toString()).toBe(TEXT);
    });
  });
});

describe('cache headers (T-6.3)', () => {
  it('the page and the root manifest are revalidated; hashed assets and versioned tile files are immutable', async () => {
    expect((await get('/')).headers['cache-control']).toBe(NO_CACHE);
    expect((await get('/index.html')).headers['cache-control']).toBe(NO_CACHE);
    expect((await get('/tiles/city/tiles.json')).headers['cache-control']).toBe(NO_CACHE);
    expect((await get('/tiles/city/tiles.json?v=abc')).headers['cache-control']).toBe(NO_CACHE);
    expect((await get('/assets/index-abc123.js')).headers['cache-control']).toBe(IMMUTABLE);
    expect((await get('/assets/index-abc123.css')).headers['cache-control']).toBe(IMMUTABLE);
    expect((await get('/tiles/city/shards/S0_0_0.json?v=aaaaaaaaaaaa')).headers['cache-control']).toBe(IMMUTABLE);
    expect((await get('/tiles/city/0_0.glb?v=aaaaaaaaaaaa')).headers['cache-control']).toBe(IMMUTABLE);
  });

  it('a tile file asked for without a version is not marked immutable (nothing says it is addressed by content)', async () => {
    expect((await get('/tiles/city/0_0.glb')).headers['cache-control']).toBe(NO_CACHE);
    expect(cacheControlFor('/something/else.txt', true)).toBe(NO_CACHE);
  });

  it('an ETag per encoding gives a 304 on revalidation', async () => {
    const a = await get('/tiles/city/tiles.json', { 'Accept-Encoding': 'br' });
    const b = await get('/tiles/city/tiles.json', { 'Accept-Encoding': 'gzip' });
    expect(a.headers.etag).toBeTruthy();
    expect(a.headers.etag).not.toBe(b.headers.etag);
    const again = await get('/tiles/city/tiles.json', { 'Accept-Encoding': 'br', 'If-None-Match': a.headers.etag });
    expect(again.status).toBe(304);
    expect(again.body.length).toBe(0);
  });

  it('public/_headers says the same where a path-only file can', () => {
    const file = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', '_headers'), 'utf-8');
    const rules = [];
    let cur = null;
    for (const line of file.split('\n')) {
      if (!line.trim() || line.trim().startsWith('#')) continue;
      if (!/^\s/.test(line)) {
        cur = { pattern: line.trim(), headers: {} };
        rules.push(cur);
      } else {
        const [k, ...v] = line.trim().split(':');
        cur.headers[k.trim().toLowerCase()] = v.join(':').trim();
      }
    }
    const toRegex = (p) =>
      new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/:[a-z]+/g, '[^/]+').replace(/\*/g, '.*') + '$');
    // the last matching rule that sets Cache-Control wins (general first, specific last)
    const forPath = (p) => rules.filter((r) => toRegex(r.pattern).test(p) && r.headers['cache-control']).at(-1)?.headers['cache-control'];
    for (const p of ['/', '/index.html', '/assets/index-abc123.js', '/tiles/city/tiles.json', '/tiles/city/0_0.glb', '/tiles/pilot/shards/S0_0_0.json', '/tiles/city/index.json', '/tiles/city/minimap.svg']) {
      expect(forPath(p), p).toBe(cacheControlFor(p, true));
    }
  });
});

describe('safety', () => {
  it('stays inside the directory and answers 404 for what is not there', async () => {
    expect((await get('/nope.html')).status).toBe(404);
    expect((await get('/%2e%2e/%2e%2e/etc/passwd')).status).toBeGreaterThanOrEqual(400);
    expect((await get('/..%2f..%2fpackage.json')).status).toBeGreaterThanOrEqual(400);
    expect((await get('/%00')).status).toBe(400);
    expect(resolveInside(dir, '/../x')?.startsWith(dir)).toBe(true); // normalised into the root, not out of it
    expect(resolveInside(dir, '/%E0%A4%A')).toBeUndefined();
  });

  it('binds to 127.0.0.1 only', () => {
    expect(server.address().address).toBe('127.0.0.1');
  });

  it('serves the page', async () => {
    const r = await fetch(`${base}/`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('milano');
  });
});
