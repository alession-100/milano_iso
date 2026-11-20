/* global process, console, URL */
// T-6.3: a local static server for the built site (web/dist), Node built-ins only, bound to 127.0.0.1.
//
//   node scripts/serve.mjs [--dir dist] [--port 4174] [--host 127.0.0.1] [--encodings br,gzip]      (npm run serve)
//
// Bound to 127.0.0.1 unless `--host` says otherwise: `--host 0.0.0.0` makes it reachable from the local
// network (a phone on the same Wi-Fi, T-6.4); it then serves to anyone on that network, so stop it after.
//
// It serves the precompressed files that scripts/precompress.mjs wrote: for `x` it looks for `x.br`
// and `x.gz` and picks one by the request's Accept-Encoding (br first, then gzip, else the plain
// file). It sets Content-Type, Content-Encoding, Vary: Accept-Encoding and the cache headers of
// `cacheControlFor`. The same rules, as far as a path-only file can say them, are in public/_headers.
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const IMMUTABLE = 'public, max-age=31536000, immutable';
export const NO_CACHE = 'no-cache';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

/** Cache-Control of a response by URL path and whether the request carries a content-hash `?v=`. */
export function cacheControlFor(pathname, hasVersion) {
  if (pathname === '/' || pathname.endsWith('.html')) return NO_CACHE; // the page: always revalidated
  if (/^\/tiles\/[^/]+\/tiles\.json$/.test(pathname)) return NO_CACHE; // the root manifest names the hashes
  if (pathname.startsWith('/assets/')) return IMMUTABLE; // Vite names these by content hash
  // Tile, shard, index and minimap files are requested as `...?v=<sha256 prefix>` (the manifest has the
  // hash): the URL changes with the content, so a copy stays valid for ever. Without `v` nothing says so.
  if (pathname.startsWith('/tiles/')) return hasVersion ? IMMUTABLE : NO_CACHE;
  return NO_CACHE;
}

/** The encodings an Accept-Encoding header accepts (q > 0), as a Set of lower-case tokens. */
export function acceptedEncodings(header) {
  const out = new Set();
  for (const part of String(header ?? '').split(',')) {
    const [token, ...params] = part.trim().split(';');
    if (!token) continue;
    const q = params.map((p) => p.trim()).find((p) => /^q=/i.test(p));
    const weight = q === undefined ? 1 : Number(q.slice(2));
    if (weight > 0) out.add(token.trim().toLowerCase());
  }
  return out;
}

/** br if accepted and present, else gzip if accepted and present, else identity. */
export function pickEncoding(header, has) {
  const ok = acceptedEncodings(header);
  if ((ok.has('br') || ok.has('*')) && has.br) return 'br';
  if ((ok.has('gzip') || ok.has('*')) && has.gz) return 'gzip';
  return 'identity';
}

/** Resolve a request path inside `root`; undefined if it leaves the directory or is malformed. */
export function resolveInside(root, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  if (decoded.includes('\0')) return undefined;
  const target = path.resolve(root, '.' + path.posix.normalize('/' + decoded));
  const rel = path.relative(root, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return undefined;
  return target;
}

function fileOf(target) {
  try {
    const st = statSync(target);
    return st.isFile() ? st : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Create (not start) the server for `dir`. `encodings` limits what it will send, in order of
 * preference: the default is both; `['gzip']` makes it behave for a client without brotli (the T-6.3
 * measurement of the same bytes with gzip), `[]` sends the plain files.
 */
export function createStaticServer(dir, { encodings = ['br', 'gzip'] } = {}) {
  const root = path.resolve(dir);
  const etags = new Map();
  const etagOf = (file, st) => {
    const key = `${file}:${st.size}:${st.mtimeMs}`;
    let tag = etags.get(key);
    if (!tag) {
      tag = `"${createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 20)}"`;
      etags.set(key, tag);
    }
    return tag;
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const send = (code, body, extra = {}) => {
      res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': NO_CACHE, ...extra });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'method not allowed', { Allow: 'GET, HEAD' });
    let pathname = url.pathname;
    if (pathname.endsWith('/')) pathname += 'index.html';
    const target = resolveInside(root, pathname);
    if (!target) return send(400, 'bad request');
    const st = fileOf(target);
    if (!st) return send(404, 'not found');
    const ext = path.extname(target).toLowerCase();
    const variants = {
      br: encodings.includes('br') ? fileOf(`${target}.br`) : undefined,
      gz: encodings.includes('gzip') ? fileOf(`${target}.gz`) : undefined,
    };
    const hasVariants = Boolean(variants.br || variants.gz);
    const enc = pickEncoding(req.headers['accept-encoding'], variants);
    const served = enc === 'br' ? `${target}.br` : enc === 'gzip' ? `${target}.gz` : target;
    const sst = enc === 'br' ? variants.br : enc === 'gzip' ? variants.gz : st;
    const headers = {
      'Content-Type': TYPES[ext] ?? 'application/octet-stream',
      'Cache-Control': cacheControlFor(url.pathname.endsWith('/') ? '/' : url.pathname, url.searchParams.has('v')),
      'X-Content-Type-Options': 'nosniff',
      // the body depends on Accept-Encoding whenever a compressed copy exists (also when it is not used)
      ...(hasVariants ? { Vary: 'Accept-Encoding' } : {}),
      ...(enc !== 'identity' ? { 'Content-Encoding': enc } : {}),
      ETag: etagOf(served, sst),
    };
    if (req.headers['if-none-match'] === headers.ETag) {
      res.writeHead(304, headers);
      return res.end();
    }
    res.writeHead(200, { ...headers, 'Content-Length': sst.size });
    if (req.method === 'HEAD') return res.end();
    createReadStream(served).pipe(res);
  });
  return server;
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dir = path.resolve(arg('dir', path.join(here, '..', 'dist')));
  const port = Number(arg('port', process.env.PORT ?? 4174));
  if (!existsSync(path.join(dir, 'index.html'))) {
    console.error(`no built site in ${dir}: run npm run build first`);
    process.exit(1);
  }
  const encodings = arg('encodings', 'br,gzip').split(',').filter(Boolean);
  const server = createStaticServer(dir, { encodings });
  const host = arg('host', '127.0.0.1');
  server.listen(port, host, () => console.log(`serving ${dir} on http://${host === '0.0.0.0' ? 'this-machine-LAN-address' : host}:${port}/`));
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
