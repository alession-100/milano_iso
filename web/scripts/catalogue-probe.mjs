/* global process, console, fetch, window */
// T-6.7: the heap cost of the shard catalogue (ADR-0043). The app keeps every shard it has loaded
// (`ShardCatalog`, T-6.3). This script measures how much JS heap the parsed shard documents of the
// whole city take, so that the memory session can subtract the catalogue (shards loaded x SHARD_MB)
// from the heap before it applies its growth rule. What the app keeps is rebuilt here as `parseShard`
// (manifest.ts) and `LodController.addTiles` / `TileStreamer.addTiles` do it: every tile entry is a copy
// `{ ...tile, level }` of the parsed JSON, held in a per-level list and in a map by id; the raw document
// is dropped.
//
//   npm run serve -- --port 4210
//   node scripts/catalogue-probe.mjs --port 4210 --out ../reports/artifacts/T-6.7/catalogue_probe.json
//
// Per shard: heap after a forced garbage collection with the shard held, minus the heap before it
// was fetched. Reports the per-shard list, the sum of all shards, and the largest single shard.
import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const port = Number(arg('port', 4191));
const out = arg('out', '');
const tiles = arg('tiles', 'tiles/city/');
const browser = await chromium.launch({ headless: true, args: ['--js-flags=--expose-gc'] });
const page = await browser.newPage();
const cdp = await page.context().newCDPSession(page);
const base = `http://127.0.0.1:${port}/${tiles}`;
await page.goto(`${base}tiles.json`);
const root = await page.evaluate(async (url) => (await fetch(url)).json(), `${base}tiles.json`);
const shards = [...(root.shards ?? [])].sort((a, b) => (a.id < b.id ? -1 : 1));
const heap = async () => {
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.collectGarbage');
  return (await cdp.send('Runtime.getHeapUsage')).usedSize;
};
await cdp.send('HeapProfiler.enable');
const rows = [];
const h0 = await heap();
let prev = h0;
for (const rec of shards) {
  await page.evaluate(
    async ([url, level]) => {
      const raw = await (await fetch(url)).json();
      const held = (window.__held ??= { byLevel: new Map(), byId: new Map() });
      const list = held.byLevel.get(level) ?? [];
      held.byLevel.set(level, list);
      for (const t of raw.tiles) {
        const e = { ...t, level };
        list.push(e);
        held.byId.set(e.id, e);
      }
    },
    [`${base}${rec.file}`, rec.level],
  );
  const h = await heap();
  rows.push({ id: rec.id, level: rec.level, tiles: null, deltaB: h - prev });
  prev = h;
}
const total = prev - h0;
const deltas = rows.map((r) => r.deltaB);
const result = {
  shards: shards.length,
  totalMB: total / 1048576,
  meanPerShardMB: total / shards.length / 1048576,
  maxPerShardMB: Math.max(...deltas) / 1048576,
  rows,
};
await browser.close();
if (out) writeFileSync(out, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, rows: undefined }, null, 2));
