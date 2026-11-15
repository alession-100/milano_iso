/* global process, console */
// Loads every .glb in a tile directory with three's GLTFLoader (no browser) and prints the
// mesh names and vertex/index counts. Usage: node web/scripts/load-tiles.mjs <tile dir> [summary.json]
// With a summary path (default: reports/artifacts/T-2.2/export_summary.json next to the repo
// root) the counts are compared with the exporter's numbers; a mismatch exits non-zero.
// Meshes split into `<layer>#<n>` chunks (ADR-0022) are summed per layer.
// Quantised positions (KHR_mesh_quantization, int16 cm with a node translation and scale) are
// dequantised through the node transform and compared with the exporter's float64 sample
// (`position_sample` per tile in the summary) within 0.01 m.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const POSITION_TOLERANCE_M = 0.01;
const MIN_SAMPLE = 100;

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
let sampleChecked = 0;
let worstError = 0;
const files = readdirSync(dir).filter((f) => f.endsWith('.glb')).sort();
for (const f of files) {
  const tile = f.slice(0, -4);
  const b = readFileSync(join(dir, f));
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  const json = JSON.parse(
    Buffer.from(ab, 20, new DataView(ab).getUint32(12, true)).toString('utf8'),
  );
  const quantised =
    (json.extensionsUsed ?? []).includes('KHR_mesh_quantization') &&
    (json.extensionsRequired ?? []).includes('KHR_mesh_quantization');
  if (!quantised) {
    console.log(`  MISMATCH ${tile}: KHR_mesh_quantization missing from extensionsUsed/Required`);
    mismatches++;
  }
  const gltf = await parse(ab);
  console.log(`tile ${tile} (${b.byteLength} bytes)`);
  const seen = {};
  const byMesh = {};
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    const pos = g.getAttribute('position');
    const vertices = pos.count;
    const indices = g.getIndex().count;
    const hasFid = g.getAttribute('_feature_id') !== undefined;
    const layer = o.name.split('#')[0];
    seen[layer] ??= { vertices: 0, triangles: 0, chunks: 0 };
    seen[layer].vertices += vertices;
    seen[layer].triangles += indices / 3;
    seen[layer].chunks += 1;
    o.updateMatrix();
    byMesh[o.name] = { pos, matrix: o.matrix };
    console.log(
      `  ${o.name}: vertices=${vertices} indices=${indices} triangles=${indices / 3} ` +
        `feature_id=${hasFid} position_type=${pos.array?.constructor?.name ?? 'interleaved'}`,
    );
  });
  if (summary) {
    const t = summary.tiles[tile];
    const exp = t?.layers ?? {};
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
    const sample = t?.position_sample ?? [];
    if (sample.length < MIN_SAMPLE) {
      console.log(`  MISMATCH position sample too small: ${sample.length} < ${MIN_SAMPLE}`);
      mismatches++;
    }
    let tileWorst = 0;
    for (const s of sample) {
      const m = byMesh[s.mesh];
      if (!m) {
        console.log(`  MISMATCH sample mesh ${s.mesh} not loaded`);
        mismatches++;
        continue;
      }
      const v = new Vector3(m.pos.getX(s.vertex), m.pos.getY(s.vertex), m.pos.getZ(s.vertex));
      v.applyMatrix4(m.matrix);
      const err = Math.max(
        Math.abs(v.x - s.xyz[0]),
        Math.abs(v.y - s.xyz[1]),
        Math.abs(v.z - s.xyz[2]),
      );
      tileWorst = Math.max(tileWorst, err);
      sampleChecked++;
      if (!(err <= POSITION_TOLERANCE_M)) {
        console.log(`  MISMATCH position ${s.mesh}[${s.vertex}]: error ${err} m`);
        mismatches++;
      }
    }
    worstError = Math.max(worstError, tileWorst);
    console.log(`  position check: ${sample.length} vertices, max error ${tileWorst.toFixed(6)} m`);
  }
}
console.log(
  `loaded ${files.length} tiles; ` +
    (summary
      ? `quantisation extension required in all tiles unless flagged; ` +
        `positions checked: ${sampleChecked}, max error ${worstError.toFixed(6)} m; ` +
        `summary mismatches: ${mismatches}`
      : 'no summary found'),
);
process.exit(mismatches ? 1 : 0);
