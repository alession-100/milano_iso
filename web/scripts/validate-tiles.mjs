/* global process, console */
// Runs the Khronos glTF validator (npm: gltf-validator) on every .glb in a tile directory.
// Usage: node web/scripts/validate-tiles.mjs <tile dir>
// Errors fail the run (exit 1); warnings, infos and hints are listed per tile and counted.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import validator from 'gltf-validator';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node web/scripts/validate-tiles.mjs <tile dir>');
  process.exit(2);
}

const files = readdirSync(dir)
  .filter((f) => f.endsWith('.glb'))
  .sort();
if (files.length === 0) {
  console.error(`no .glb files in ${dir}`);
  process.exit(2);
}

console.log(`gltf-validator ${validator.version()}`);
let errors = 0;
let warnings = 0;
let infos = 0;
let hints = 0;
for (const f of files) {
  const bytes = new Uint8Array(readFileSync(join(dir, f)));
  const report = await validator.validateBytes(bytes, { uri: f, maxIssues: 0 });
  const m = report.issues;
  errors += m.numErrors;
  warnings += m.numWarnings;
  infos += m.numInfos;
  hints += m.numHints;
  console.log(
    `${f}: errors=${m.numErrors} warnings=${m.numWarnings} infos=${m.numInfos} hints=${m.numHints}`,
  );
  for (const msg of m.messages) {
    if (msg.severity <= 1) {
      const sev = ['ERROR', 'WARNING'][msg.severity];
      console.log(`  ${sev} ${msg.code} ${msg.pointer ?? ''}: ${msg.message}`);
    }
  }
}
console.log(
  `validated ${files.length} tiles: errors=${errors} warnings=${warnings} infos=${infos} hints=${hints}`,
);
process.exit(errors ? 1 : 0);
