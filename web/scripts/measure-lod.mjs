/* global process, console, window, requestAnimationFrame */
// T-6.2 evidence: draw calls, triangles, tiles drawn per level, bytes fetched and the time until the
// view is complete, on the CITY tileset (web/public/tiles/city, copied by `make web-tiles EXTENT=city`),
// at visible widths 300 .. 4000 m, centred on three points, at 1280x720 and 412x915.
// Usage (a preview server must already run on E2E_PORT, built after the tiles were copied):
//   E2E_PORT=4187 node web/scripts/measure-lod.mjs <out.md> [--only=<substring of a view name>]
// Not part of the test suite. Every number in the table comes from this script's output.
//
// Method: a fresh browser context per view. The tile requests (.glb and feature .json) are held until
// the camera is set, so the bytes and the time are those of this view alone (not of the 600 m start
// view). The time runs from the release of the tile requests to the moment the view is complete
// (every visible tile of the level in use loaded, nothing in flight, draw calls equal on three polls).
// Bytes are counted per response: raw as served by `vite preview` (no compression), and gzip-9 of the
// same bytes ("gzip as served" is what a gzip-enabled host sends; headers and caching are T-6.3).
// Software rendering (SwiftShader) is slow, so the times are an upper bound for a GPU browser.
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { chromium } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 4173);
const out = process.argv[2];
if (!out) {
  console.error('usage: measure-lod.mjs <out.md> [--only=<substring>]');
  process.exit(2);
}
const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7);
const base = `http://localhost:${port}`;
const QUERY = process.env.MEASURE_QUERY ?? '?e2e=1&tiles=tiles/city/';

// Centres in client metres (x = E - E0, z = -(N - N0)). Origin: the Duomo. The other two are mine:
// the centre of the Stadio Meazza footprint (bounds quoted in R-6.1, converted with pyproj) and a
// point 4.5 km east of the origin (both checked to be inside the comune boundary).
const CENTRES = [
  ['origin', 0, 0],
  ['meazza', -5291, -1529],
  ['east4500', 4500, 0],
];
const WIDTHS = [300, 600, 1200, 2400, 4000];
const VIEWPORTS = [
  ['1280x720', 1280, 720],
  ['412x915', 412, 915],
];

const TILE_FILE = /\/(L\d+_)?-?\d+_-?\d+\.(glb|json)$/;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

async function measure(vp, centre, width) {
  const ctx = await browser.newContext({ viewport: { width: vp[1], height: vp[2] }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  let release = () => undefined;
  const gate = new Promise((r) => {
    release = r;
  });
  const bytes = { tilesJson: 0, minimap: 0, tileGlb: 0, tileJson: 0, other: 0 };
  const gz = { tilesJson: 0, minimap: 0, tileGlb: 0, tileJson: 0, other: 0 };
  let nGlb = 0;
  let maxGlbGz = 0;
  const glbFiles = [];
  let gzMap = new Map(); // glb file -> gzip-9 bytes recorded by the pipeline (tiles.json)
  const problems = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text());
  });
  await page.route('**/tiles/city/**', async (route) => {
    if (TILE_FILE.test(new URL(route.request().url()).pathname)) await gate;
    await route.fallback();
  });
  page.on('response', async (res) => {
    const u = new URL(res.url());
    if (!u.pathname.includes('/tiles/city/')) return;
    let buf;
    try {
      buf = await res.body();
    } catch {
      return;
    }
    const kind = u.pathname.endsWith('tiles.json')
      ? 'tilesJson'
      : u.pathname.endsWith('minimap.svg')
        ? 'minimap'
        : TILE_FILE.test(u.pathname)
          ? u.pathname.endsWith('.glb')
            ? 'tileGlb'
            : 'tileJson'
          : 'other';
    if (kind === 'tilesJson') {
      const m = JSON.parse(buf.toString('utf8'));
      const all = [...m.tiles, ...(m.levels ?? []).flatMap((l) => l.tiles ?? [])];
      gzMap = new Map(all.map((t) => [t.glb.file, t.glb.gzip9_bytes]));
    }
    bytes[kind] += buf.length;
    const g = gzipSync(buf, { level: 9 }).length;
    gz[kind] += g;
    if (kind === 'tileGlb') {
      nGlb += 1;
      glbFiles.push(u.pathname.split('/').pop());
      maxGlbGz = Math.max(maxGlbGz, g);
    }
  });
  const tLoad = Date.now();
  await page.goto(`${base}/${QUERY}`);
  await page.waitForFunction(
    () => typeof window.__milanoIsoSetView === 'function' && (window.__milanoIso?.camera?.bounds?.maxX ?? 500) !== 500,
    null,
    { timeout: 120_000 },
  );
  const msToApp = Date.now() - tLoad;
  await page.evaluate(([x, z, w]) => window.__milanoIsoSetView(x, z, w), [centre[1], centre[2], width]);
  // let the camera change reach the tile logic (a frame), then let the tile requests go
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  const t0 = Date.now();
  release();
  await page.waitForFunction(
    () => {
      const s = window.__milanoIso.tiles;
      return s.visible > 0 && s.loading === 0 && s.pending === 0;
    },
    null,
    { timeout: 600_000, polling: 100 },
  );
  let prev = -1;
  let same = 0;
  for (let i = 0; i < 200 && same < 3; i++) {
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    const c = await page.evaluate(() => window.__milanoIso.render.calls);
    same = c === prev ? same + 1 : 0;
    prev = c;
  }
  const tDone = Date.now() - t0;
  const st = await page.evaluate(() => ({
    render: { ...window.__milanoIso.render },
    tiles: JSON.parse(JSON.stringify(window.__milanoIso.tiles)),
  }));
  await ctx.close();
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  // The pipeline's gzip-9 (Python zlib, the figure of the 250 KB budget) is what tiles.json records for
  // each .glb; Node's zlib gives about 20% more for the same bytes, so both are reported.
  const pipeGlb = glbFiles.map((f) => gzMap.get(f) ?? 0);
  return {
    calls: st.render.calls,
    triangles: st.render.triangles,
    level: st.tiles.level,
    mpp: st.tiles.mpp,
    visible: st.tiles.visible,
    drawn: st.tiles.drawnByLevel,
    failed: st.tiles.failed,
    nGlb,
    bytes: sum(bytes),
    gzip: sum(gz),
    viewBytes: bytes.tileGlb + bytes.tileJson,
    viewGzip: gz.tileGlb + gz.tileJson,
    viewGzipPipe: pipeGlb.reduce((a, b) => a + b, 0) + gz.tileJson,
    maxGlbGz,
    maxGlbGzPipe: Math.max(0, ...pipeGlb),
    gz,
    msToApp,
    ms: tDone,
    problems,
  };
}

const rows = [];
for (const vp of VIEWPORTS) {
  for (const centre of CENTRES) {
    for (const width of WIDTHS) {
      const name = `${vp[0]} ${centre[0]} ${width}m`;
      if (only && !name.includes(only)) continue;
      const r = await measure(vp, centre, width);
      rows.push({ name, vp: vp[0], centre: centre[0], width, ...r });
      console.log(JSON.stringify({ name, ...r }));
    }
  }
}
await browser.close();

const kb = (n) => (n / 1024).toFixed(0);
const lines = [
  '| viewport | centre | width m | mpp | level | draw calls | triangles | tiles drawn per level | tiles fetched | tile bytes raw KB | tile bytes gzip-9 KB (pipeline zlib for .glb, Node zlib for .json) | largest .glb gzip-9 KB (pipeline) | tile bytes gzip-9 KB (Node zlib for all) | all bytes since load gzip-9 KB (Node zlib; adds tiles.json and minimap.svg) | time to complete s |',
  '|---|---|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|',
];
for (const r of rows) {
  lines.push(
    `| ${r.vp} | ${r.centre} | ${r.width} | ${r.mpp.toFixed(2)} | ${r.level} | ${r.calls} | ${r.triangles} | ${JSON.stringify(r.drawn).replace(/"/g, '')} | ${r.nGlb} | ${kb(r.viewBytes)} | ${kb(r.viewGzipPipe)} | ${kb(r.maxGlbGzPipe)} | ${kb(r.viewGzip)} | ${kb(r.gzip)} | ${(r.ms / 1000).toFixed(1)} |`,
  );
}
writeFileSync(out, lines.join('\n') + '\n');
writeFileSync(out.replace(/\.md$/, '.json'), JSON.stringify(rows, null, 1) + '\n');
console.log(`wrote ${out}`);
