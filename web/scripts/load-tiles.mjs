/* global process, console */
// Loads every .glb in a tile directory with three's GLTFLoader (no browser) and prints the
// mesh names and vertex/index counts. Usage: node web/scripts/load-tiles.mjs <tile dir> [summary.json]
// With a summary path (default: reports/artifacts/T-2.2/export_summary.json next to the repo
// root) the counts are compared with the exporter's numbers; a mismatch exits non-zero.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node web/scripts/load-tiles.mjs <tile dir> [export_summary.json]');
  process.exit(2);
}
const here = dirname(fileURLToPath(import.meta.url));
const summaryPath = resolve(
  process.argv[3] ?? join(here, '..', '..', 'reports', 'artifacts', 'T-2.2', 'export_summary.json'),
);
const summary = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, 'utf8')) : null;

const loader = new GLTFLoader();
const parse = (buf) => new Promise((ok, fail) => loader.parse(buf, '', ok, fail));

let mismatches = 0;
const files = readdirSync(dir).filter((f) => f.endsWith('.glb')).sort();
for (const f of files) {
  const tile = f.slice(0, -4);
  const b = readFileSync(join(dir, f));
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  const gltf = await parse(ab);
  console.log(`tile ${tile} (${b.byteLength} bytes)`);
  const seen = {};
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    const vertices = g.getAttribute('position').count;
    const indices = g.getIndex().count;
    const hasFid = g.getAttribute('_feature_id') !== undefined;
    seen[o.name] = { vertices, triangles: indices / 3 };
    console.log(
      `  ${o.name}: vertices=${vertices} indices=${indices} triangles=${indices / 3} feature_id=${hasFid}`,
    );
  });
  if (summary) {
    const exp = summary.tiles[tile]?.layers ?? {};
    const names = Object.keys(exp).sort().join(',');
    if (names !== Object.keys(seen).sort().join(',')) {
      console.log(`  MISMATCH mesh names: summary=${names}`);
      mismatches++;
    }
    for (const [n, e] of Object.entries(exp)) {
      const s = seen[n];
      if (!s || s.vertices !== e.vertices || s.triangles !== e.triangles) {
        console.log(`  MISMATCH ${n}: summary vertices=${e.vertices} triangles=${e.triangles}`);
        mismatches++;
      }
    }
  }
}
console.log(`loaded ${files.length} tiles; ` + (summary ? `summary mismatches: ${mismatches}` : 'no summary found'));
process.exit(mismatches ? 1 : 0);
