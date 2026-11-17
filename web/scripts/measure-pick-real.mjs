/* global process, console, window, document, performance, requestAnimationFrame */
// T-5.1 evidence: picking on the REAL pilot tiles (web/public/tiles/pilot), screenshots of the info
// card and draw-call / pick-time numbers. Not part of the test suite.
// Usage (a preview server must already run on E2E_PORT, tiles copied by `make web-tiles`):
//   E2E_PORT=4181 node web/scripts/measure-pick-real.mjs <out-dir>
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 4173);
const outDir = process.argv[2];
if (!outDir) {
  console.error('usage: measure-pick-real.mjs <out-dir>');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const results = {};
const DEG = Math.PI / 180;

async function settle(page) {
  await page.waitForFunction(
    () => {
      const s = window.__milanoIso?.tiles;
      return s && s.loading === 0 && s.visible > 0 && s.loaded >= s.visible;
    },
    null,
    { timeout: 120_000 },
  );
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  await page.waitForTimeout(400);
}

const view = (page, x, z, w) => page.evaluate(([a, b, c]) => window.__milanoIsoSetView(a, b, c), [x, z, w]);
const sel = (page) => page.evaluate(() => window.__milanoIso.selection);

/** Ground point under a screen pixel (the app's orthographic mapping, inverted independently). */
function ground(c, px, py, vw, vh) {
  const az = c.azimuthDeg * DEG;
  const sinEl = Math.sin(c.elevationDeg * DEG);
  const mpp = c.visibleWidth / vw;
  const xv = (px - vw / 2) * mpp;
  const yv = ((vh / 2 - py) * mpp) / sinEl;
  return [c.target[0] + Math.cos(az) * xv - Math.sin(az) * yv, c.target[1] - Math.sin(az) * xv - Math.cos(az) * yv];
}

/** Every distinct pickable ref found on a screen grid, with one pixel each. */
function scan(page, step, avoidRight) {
  return page.evaluate(
    ([st, avoid]) => {
      const out = new Map();
      for (let y = 8; y < window.innerHeight - 40; y += st) {
        for (let x = 8; x < window.innerWidth - avoid; x += st) {
          if (!document.elementFromPoint(x, y)?.closest('#app')) continue; // a control is on top
          const h = window.__milanoIsoPickAt(x, y);
          if (!h.ref) continue;
          const k = JSON.stringify(h.ref);
          const prev = out.get(k);
          // Prefer a landmark detail pixel for landmarks.
          if (!prev || (h.layer === 'landmark_details' && prev.layer !== 'landmark_details')) out.set(k, { ref: h.ref, layer: h.layer, x, y });
        }
      }
      return [...out.values()];
    },
    [step, avoidRight],
  );
}

async function clickAndRead(page, p) {
  await page.mouse.click(p.x, p.y);
  await page.waitForFunction(() => window.__milanoIso.selection.card.open);
  await page.waitForTimeout(150);
  return sel(page);
}

for (const [name, w, h] of [
  ['desktop-1280x720', 1280, 720],
  ['mobile-412x915', 412, 915],
]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const problems = [];
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && !/GPU stall due to ReadPixels/.test(m.text())) problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(String(e)));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`http://localhost:${port}/?e2e=1`);
  await page.waitForFunction(() => typeof window.__milanoIsoSetView === 'function');
  await settle(page);

  // Draw calls at the real default view, before and during hover; pick cost.
  const callsBefore = (await page.evaluate(() => window.__milanoIso.render)).calls;
  const hits = await scan(page, 24, 0);
  const b = hits.find((x) => x.ref.layer === 'buildings' && x.y > 150 && x.y < h - 120 && x.x > 20 && x.x < w - 340 + (w < 600 ? 330 : 0)) ?? hits[0];
  await page.mouse.move(Math.max(0, b.x - 40), b.y + 30);
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.waitForFunction(() => window.__milanoIso.selection.hover !== null);
  await page.waitForTimeout(300);
  const callsHover = (await page.evaluate(() => window.__milanoIso.render)).calls;
  const timing = await page.evaluate(
    ([W, H]) => {
      const n = 300;
      const ms = [];
      for (let i = 0; i < n; i++) {
        const t0 = performance.now();
        window.__milanoIsoPickAt(20 + ((i * 37) % (W - 40)), 20 + ((i * 53) % (H - 60)));
        ms.push(performance.now() - t0);
      }
      ms.sort((a, b) => a - b);
      const q = (p) => +ms[Math.min(n - 1, Math.floor(p * n))].toFixed(2);
      return { calls: n, meanMs: +(ms.reduce((a, b) => a + b, 0) / n).toFixed(2), medianMs: q(0.5), p95Ms: q(0.95), maxMs: q(1) };
    },
    [w, h],
  );
  const moves = [];
  for (let i = 0; i < 60; i++) await page.mouse.move(20 + ((i * 97) % (w - 40)), 30 + ((i * 131) % (h - 80)));
  await page.waitForTimeout(500);
  moves.push((await sel(page)).pick);
  results[`${name}/draw-calls-default-view`] = { withoutHover: callsBefore, withHover: callsHover, tiles: await page.evaluate(() => window.__milanoIso.tiles) };
  results[`${name}/pick-time`] = { direct: timing, hoverMoves: moves[0] };
  await page.mouse.move(2, 2);

  // Find the four targets on a few wide views.
  const found = {};
  const centres = [[0, 0], [-250, 0], [250, 0], [0, -250], [0, 250], [-250, -250], [250, 250], [-250, 250], [250, -250]];
  for (const [cx, cz] of centres) {
    if (found.duomo && found.dbt && found.osmDefault && found.street) break;
    await view(page, cx, cz, 500);
    await settle(page);
    const cam = await page.evaluate(() => window.__milanoIso.camera);
    for (const hit of await scan(page, 10, name.startsWith('desktop') ? 340 : 0)) {
      const r = hit.ref;
      const want =
        (!found.duomo && r.landmarkId === 'duomo' && 'duomo') ||
        (!found.dbt && r.layer === 'buildings' && r.key?.startsWith('dbt:') && 'dbt') ||
        (!found.osmDefault && r.layer === 'buildings' && r.key?.startsWith('osm:') && 'osmDefault') ||
        (!found.street && r.layer === 'roads' && 'street');
      if (!want) continue;
      const s = await clickAndRead(page, hit);
      const ok =
        (want === 'duomo' && s.current?.landmarkId === 'duomo') ||
        (want === 'dbt' && s.card.heightSource === 'rilievo DBT 2020' && s.card.named === false) ||
        (want === 'osmDefault' && s.card.heightSource === 'default stimato') ||
        (want === 'street' && s.card.named && s.card.type !== 'Percorso pedonale');
      await page.keyboard.press('Escape');
      if (!ok) continue;
      found[want] = { hit, ground: ground(cam, hit.x, hit.y, w, h), card: s.card, ref: s.current, layer: hit.layer };
    }
  }
  results[`${name}/targets`] = Object.fromEntries(Object.entries(found).map(([k, v]) => [k, { ref: v.ref, layer: v.layer, card: v.card }]));

  for (const [key, f] of Object.entries(found)) {
    const [gx, gz] = f.ground;
    await view(page, gx, gz, 150);
    await settle(page);
    // Re-find the same feature near the centre of the new view.
    const near = await page.evaluate(
      ([ref, W, H]) => {
        const k = JSON.stringify(ref);
        let best = null;
        for (let y = 8; y < H - 40; y += 6) {
          for (let x = 8; x < W - (W > 600 ? 340 : 0); x += 6) {
            if (!document.elementFromPoint(x, y)?.closest('#app')) continue;
            const hh = window.__milanoIsoPickAt(x, y);
            if (!hh.ref || JSON.stringify(hh.ref) !== k) continue;
            const d = Math.hypot(x - W / 2, y - H / 2);
            if (!best || d < best.d) best = { x, y, d };
          }
        }
        return best;
      },
      [f.ref, w, h],
    );
    if (!near) {
      results[`${name}/${key}/screenshot`] = 'feature not found in the 150 m view';
      continue;
    }
    await page.mouse.click(near.x, near.y);
    await page.waitForFunction(() => window.__milanoIso.selection.card.open);
    await page.mouse.move(2, 2);
    await page.waitForTimeout(400);
    const file = path.join(outDir, `${key}-${name}.png`);
    await page.screenshot({ path: file });
    results[`${name}/${key}/screenshot`] = { file, card: (await sel(page)).card };
    await page.keyboard.press('Escape');
  }
  results[`${name}/console-problems`] = problems;
  await page.close();
}
await browser.close();
console.log(JSON.stringify(results, null, 2));
