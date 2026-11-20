/* global process, console, window, document, getComputedStyle, Image, requestAnimationFrame */
// T-5.4 evidence: text and component contrast of the UI over the REAL rendered map (WCAG 2.x ratios).
//
// Usage (a preview server must already run on E2E_PORT, real tiles copied by `make web-tiles`):
//   E2E_PORT=4181 node web/scripts/measure-contrast.mjs <out-dir>
//
// Method (the one the G4 reviewer used, made repeatable): for every viewport (1280x720, 412x915), mode
// (day, night) and camera view, load the real pilot tiles, open the UI states, hide the UI and take a
// screenshot of the bare map. Then, for each control, read its rectangle and its computed colours and
// combine them with the REAL map pixels behind it:
//   text      the text colour against the control's fill (its translucent background composited over every
//             sampled pixel behind it); the worst pixel counts. Needs >= 4.5.
//   border    the control's border colour against the map pixels just outside it. Needs >= 3.
//   focus     the focus ring colour against the halo inside it and against the map pixels just outside
//             it. Needs >= 3.
// Not part of the test suite. It writes contrast.json and contrast.md to <out-dir>.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 4173);
const outDir = process.argv[2];
if (!outDir) {
  console.error('usage: measure-contrast.mjs <out-dir>');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });
const base = `http://localhost:${port}`;

const VIEWPORTS = [
  ['desktop-1280x720', 1280, 720],
  ['mobile-412x915', 412, 915],
];
const MODES = ['day', 'night'];
// [ground x (m), ground z (m), visible width (m)]: close, medium and whole-area views at the centre and
// at four offsets, so the controls are seen over streets, parks, water, dense blocks and empty ground.
const QUICK = process.env.QUICK === '1';
const ALL_VIEWS = [
  [0, 0, 300],
  [0, 0, 1000],
  [0, 0, 4000],
  [-600, -600, 1000],
  [600, 600, 1000],
  [-600, 600, 1000],
  [600, -600, 1000],
];
const VIEWS = QUICK ? [ALL_VIEWS[2]] : ALL_VIEWS;

const TEXT = [
  '#mode-toggle', '#rotate-left', '#rotate-right', '#lang-toggle', '#layers-button', '#help-button',
  '#minimap-button', '#search-input', '#search-list li .name', '#search-list li .kind',
  '#search-list li.active .name', '#search-status.visible', '#layers-panel label span:not(.box)',
  '#help-panel h2', '#help-panel li', '#tiles-notice span', '#tiles-notice button', '#info-card h2',
  '#info-card dt', '#info-card dd', '#info-card a', '#info-card p', '#info-card .close',
  '#attribution', '#attribution a',
];
const BORDER = [
  '#mode-toggle', '#rotate-left', '#rotate-right', '#lang-toggle', '#layers-button', '#help-button',
  '#minimap-button', '#search-input', '#search-list', '#layers-panel', '#help-panel', '#tiles-notice',
  '#info-card', '#minimap', '#info-card .close', '#layers-panel .box',
];
const FOCUS = [
  '#mode-toggle', '#rotate-left', '#rotate-right', '#lang-toggle', '#layers-button', '#help-button',
  '#minimap-button', '#search-input', '#tiles-notice button', '#info-card .close', '#attribution a', '#app',
];

/** Runs in the page. Returns one record per (kind, selector) with the worst ratio over the samples. */
function measureInPage({ TEXT, BORDER, FOCUS }) {
  const bg = window.__bg; // ImageData of the bare map
  const W = bg.width;
  const H = bg.height;
  const px = (x, y) => {
    const xi = Math.min(W - 1, Math.max(0, Math.round(x)));
    const yi = Math.min(H - 1, Math.max(0, Math.round(y)));
    const i = (yi * W + xi) * 4;
    return [bg.data[i], bg.data[i + 1], bg.data[i + 2]];
  };
  const lin = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const ratio = (a, b) => {
    const la = lum(a);
    const lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };
  const parse = (s) => {
    s = s.trim();
    if (s.startsWith('#')) {
      const h = s.length === 4 ? [...s.slice(1)].map((c) => c + c).join('') : s.slice(1); // #fff or #ffffff
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
    }
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (!m) throw new Error('colour not understood: ' + s);
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  };
  const over = (top, under) => {
    const a = top[3];
    return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a)];
  };
  // The fill layers of an element, outermost first, up to (not including) the page and the map host.
  const layers = (el) => {
    const out = [];
    for (let e = el; e && e !== document.body && e !== document.documentElement && e.id !== 'app'; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c[3] > 0) out.unshift(c);
      if (c[3] >= 1) break;
    }
    return out;
  };
  const fillAt = (ls, p) => ls.reduce((acc, l) => over(l, acc), p);
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('[hidden]');
  };
  const grid = (r, step) => {
    const pts = [];
    for (let y = r.top + 1; y < r.bottom; y += step) for (let x = r.left + 1; x < r.right; x += step) pts.push([x, y]);
    return pts;
  };
  const ring = (r, d, step) => {
    const pts = [];
    for (let x = r.left - d; x <= r.right + d; x += step) pts.push([x, r.top - d], [x, r.bottom + d]);
    for (let y = r.top - d; y <= r.bottom + d; y += step) pts.push([r.left - d, y], [r.right + d, y]);
    return pts.filter(([x, y]) => x >= 0 && y >= 0 && x < W && y < H);
  };
  const root = getComputedStyle(document.documentElement);
  const varColour = (n) => parse(root.getPropertyValue(n));
  const results = [];
  const record = (kind, sel, el, value, at, detail) => results.push({ kind, sel, ratio: value, at, detail });
  const worst = (kind, sel, el, samples) => {
    // samples: [{ ratio, at, detail }]
    if (samples.length === 0) return;
    const w = samples.reduce((a, b) => (b.ratio < a.ratio ? b : a));
    record(kind, sel, el, w.ratio, w.at, w.detail);
  };

  for (const sel of TEXT) {
    for (const el of document.querySelectorAll(sel)) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const ls = layers(el);
      const colours = [['text', parse(cs.color)]];
      if (el.matches('input')) {
        const ph = parse(getComputedStyle(el, '::placeholder').color);
        colours.push(['placeholder', ph]);
      }
      for (const [what, c] of colours) {
        const samples = [];
        for (const [x, y] of grid(r, 4)) {
          const f = fillAt(ls, px(x, y));
          const t = c[3] < 1 ? over(c, f) : c;
          samples.push({ ratio: ratio(t, f), at: [Math.round(x), Math.round(y)], detail: `${what} rgb(${t.map(Math.round)}) on rgb(${f.map(Math.round)})` });
        }
        worst('text', what === 'text' ? sel : `${sel} (${what})`, el, samples);
      }
    }
  }

  for (const sel of BORDER) {
    for (const el of document.querySelectorAll(sel)) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (parseFloat(cs.borderTopWidth) === 0 || cs.borderTopStyle === 'none') continue;
      const bc = parse(cs.borderTopColor);
      const samples = [];
      if (el.matches('.box')) {
        // Inner boundary: the box border against the row fill behind it.
        const ls = layers(el.parentElement);
        const c = [(r.left + r.right) / 2, (r.top + r.bottom) / 2];
        const f = fillAt(ls, px(c[0], c[1]));
        samples.push({ ratio: ratio(bc, f), at: c.map(Math.round), detail: `border rgb(${bc.slice(0, 3)}) on rgb(${f.map(Math.round)})` });
      } else {
        // Outer boundary: the border, or the control's own fill, against the map pixels (or the parent
        // block) just outside it. WCAG 1.4.11 asks for 3:1 for whichever of them identifies the control.
        const parentLayers = el.parentElement ? layers(el.parentElement) : [];
        const own = layers(el);
        const alone = [];
        for (const [x, y] of ring(r, 2, 4)) {
          const out = fillAt(parentLayers, px(x, y));
          const ix = x < r.left ? r.left + 3 : x > r.right ? r.right - 3 : x;
          const iy = y < r.top ? r.top + 3 : y > r.bottom ? r.bottom - 3 : y;
          const fill = fillAt(own, px(ix, iy));
          const rb = ratio(bc, out);
          const rf = ratio(fill, out);
          const at = [Math.round(x), Math.round(y)];
          alone.push({ ratio: rb, at, detail: `border rgb(${bc.slice(0, 3)}) on rgb(${out.map(Math.round)})` });
          samples.push({
            ratio: Math.max(rb, rf),
            at,
            detail: `border ${rb.toFixed(2)} / fill ${rf.toFixed(2)}: border rgb(${bc.slice(0, 3)}), fill rgb(${fill.map(Math.round)}), outside rgb(${out.map(Math.round)})`,
          });
        }
        worst('border alone (info)', sel, el, alone);
      }
      worst('boundary (border or fill)', sel, el, samples);
    }
  }

  const ringC = varColour('--tb-focus');
  const haloC = varColour('--tb-halo');
  for (const sel of FOCUS) {
    const el = document.querySelector(sel);
    if (!el || !visible(el)) continue;
    const r = el.getBoundingClientRect();
    record('focus ring vs halo', sel, el, ratio(ringC, haloC), [0, 0], `ring rgb(${ringC.slice(0, 3)}) halo rgb(${haloC.slice(0, 3)})`);
    // Outside the indicator (ring 2..5 px, halo to 7 px): the map pixels 8 px from the element. The ring or
    // its halo must stand out from them by 3:1 (wherever the map is close to one in lightness it is not
    // close to the other). For the map itself the indicator is inset: the pixels 8 px inside the edge.
    const pts = sel === '#app' ? ring({ left: 8, right: W - 8, top: 8, bottom: H - 8 }, 0, 8) : ring(r, 8, 4);
    const samples = pts.map(([x, y]) => {
      const f = px(x, y);
      const rr = ratio(ringC, f);
      const rh = ratio(haloC, f);
      return { ratio: Math.max(rr, rh), at: [Math.round(x), Math.round(y)], detail: `ring ${rr.toFixed(2)} / halo ${rh.toFixed(2)} on map rgb(${f})` };
    });
    worst('focus indicator vs map (ring or halo)', sel, el, samples);
  }
  // The layer rows draw their ring inside the row, on the panel's own fill (the whole row is the target).
  const row = document.querySelector('#layers-panel label');
  if (row && visible(row)) {
    const r = row.getBoundingClientRect();
    const samples = ring({ left: r.left + 4, right: r.right - 4, top: r.top + 4, bottom: r.bottom - 4 }, 0, 4).map(([x, y]) => {
      const f = fillAt(layers(row.parentElement), px(x, y));
      return { ratio: ratio(ringC, f), at: [Math.round(x), Math.round(y)], detail: `ring rgb(${ringC.slice(0, 3)}) on panel rgb(${f.map(Math.round)})` };
    });
    worst('focus indicator vs map (ring or halo)', '#layers-panel label (ring on the panel fill)', row, samples);
  }
  return results;
}

const acc = new Map(); // key -> worst record
function keep(vp, mode, view, phase, rec) {
  const key = `${rec.kind}|${rec.sel}|${mode}|${vp}`;
  const cur = acc.get(key);
  if (!cur || rec.ratio < cur.ratio) {
    acc.set(key, { ...rec, vp, mode, view: view.join(','), phase });
  }
}

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

for (const [vpName, w, h] of VIEWPORTS) {
  for (const mode of MODES) {
    for (const view of VIEWS) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      const root = await (await page.request.get(`${base}/tiles/pilot/tiles.json`)).json();
      // T-6.3: the tile entries are in the shards; the last tile of the last base-level shard
      const lastShard = root.shards.filter((s) => s.level === 0).at(-1);
      const shard = await (await page.request.get(`${base}/tiles/pilot/${lastShard.file}`)).json();
      const failing = shard.tiles[shard.tiles.length - 1];
      // One tile fails for good, so the tiles notice is on screen when that tile is wanted.
      await page.route(`**/tiles/pilot/${failing.glb.file}*`, (route) => route.abort());
      await page.goto(`${base}/?e2e=1&time=${mode}`);
      await page.waitForFunction(() => typeof window.__milanoIsoSetView === 'function' && window.__milanoIso.camera.bounds.maxX !== 500, null, { timeout: 60_000 });
      // The card: search the Duomo and choose it (a real selection, so the real card is measured).
      await page.locator('#search-input').fill('duomo');
      await page.locator('#search-list').waitFor({ state: 'visible', timeout: 30_000 });
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => window.__milanoIso.selection.card.open, null, { timeout: 30_000 });
      await page.evaluate(([x, z, wd]) => window.__milanoIsoSetView(x, z, wd), view);
      await page.waitForFunction(
        () => {
          const s = window.__milanoIso.tiles;
          return s.visible > 0 && s.loading === 0 && s.loaded + s.failed >= s.visible;
        },
        null,
        { timeout: 120_000 },
      );
      // The same draw-call count on three consecutive polls, after two frames each.
      {
        let prev = -1;
        let same = 0;
        for (let i = 0; i < 60 && same < 3; i++) {
          await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
          const c = await page.evaluate(() => window.__milanoIso.render.calls);
          same = c === prev ? same + 1 : 0;
          prev = c;
        }
      }
      // The notice appears after the retry of the failing tile.
      const wantsFailing = await page.evaluate(() => window.__milanoIso.tiles.failed > 0);
      if (wantsFailing) await page.locator('#tiles-notice').waitFor({ state: 'visible', timeout: 20_000 });
      // The bare map: hide the UI, shoot, show it again.
      const hider = await page.addStyleTag({ content: '#toolbar-zone,#mode-toggle,#rotation-controls,#info-card,#attribution,#minimap{visibility:hidden!important}' });
      const png = await page.screenshot();
      await hider.evaluate((e) => e.remove());
      await page.evaluate(async (url) => {
        const img = new Image();
        img.src = url;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        window.__bg = g.getImageData(0, 0, c.width, c.height);
      }, 'data:image/png;base64,' + png.toString('base64'));

      const measure = async (phase) => {
        for (const rec of await page.evaluate(measureInPage, { TEXT, BORDER, FOCUS })) keep(vpName, mode, view, phase, rec);
      };
      // Phase A: search results open (with the card and, when wanted, the notice).
      await page.locator('#search-input').fill('via');
      await page.locator('#search-list').waitFor({ state: 'visible' });
      await page.keyboard.press('ArrowDown');
      await measure('results');
      // Phase B: layers panel.
      await page.locator('#layers-button').click();
      await page.locator('#layers-panel').waitFor({ state: 'visible' });
      await measure('layers');
      // Phase C: help.
      await page.locator('#help-button').click();
      await page.locator('#help-panel').waitFor({ state: 'visible' });
      await measure('help');
      // Phase D (narrow): the minimap behind its button.
      if (w <= 600) {
        await page.locator('#minimap-button').click();
        await page.locator('#minimap').waitFor({ state: 'visible' });
        await measure('minimap');
      }
      await ctx.close();
      console.error(`measured ${vpName} ${mode} view ${view.join(',')}`);
    }
  }
}
await browser.close();

const rows = [...acc.values()].sort((a, b) => a.ratio - b.ratio);
writeFileSync(path.join(outDir, 'contrast.json'), JSON.stringify(rows, null, 2) + '\n');

const need = { text: 4.5, 'boundary (border or fill)': 3, 'border alone (info)': 0, 'focus ring vs halo': 3, 'focus indicator vs map (ring or halo)': 3 };
const md = [];
md.push('# T-5.4 contrast over the real rendered map', '');
md.push(`Viewports: ${VIEWPORTS.map((v) => v[0]).join(', ')}. Modes: ${MODES.join(', ')}. Views (x, z, width m): ${VIEWS.map((v) => v.join('/')).join('; ')}.`);
md.push('Each row is the worst ratio over every view, state and sampled pixel. Text needs 4.5, borders and focus rings 3.', '');
for (const kind of ['text', 'boundary (border or fill)', 'border alone (info)', 'focus ring vs halo', 'focus indicator vs map (ring or halo)']) {
  const of = rows.filter((r) => r.kind === kind);
  const min = of.length ? of[0] : null;
  md.push(`## ${kind}: worst ${min ? min.ratio.toFixed(2) : '-'} (need ${need[kind]}), ${of.filter((r) => r.ratio < need[kind]).length} below`, '');
  md.push('| control | mode | viewport | worst ratio | view (x,z,w) | state | detail |', '|---|---|---|---|---|---|---|');
  for (const r of of.slice(0, 40)) md.push(`| ${r.sel} | ${r.mode} | ${r.vp} | ${r.ratio.toFixed(2)} | ${r.view} | ${r.phase} | ${r.detail} |`);
  md.push('');
}
writeFileSync(path.join(outDir, 'contrast.md'), md.join('\n') + '\n');
const below = rows.filter((r) => r.ratio < (need[r.kind.startsWith('text') ? 'text' : r.kind] ?? 3));
console.log(JSON.stringify({ rows: rows.length, below: below.length, worst: rows.slice(0, 8).map((r) => `${r.kind} ${r.sel} ${r.mode} ${r.vp} ${r.ratio.toFixed(2)}`) }, null, 2));
