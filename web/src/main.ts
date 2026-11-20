import * as THREE from 'three';
import { CameraRig, azimuthOfStep, createCamera, parseElevation, parseRotation, resizeCamera } from './camera';
import { Controls } from './controls';
import { getLang, initialLang, onLangChange, setLang, t } from './i18n';
import { RotationAnimator, createRotationButtons } from './rotation';
import { createScene } from './scene';
import { createModeToggle } from './modeToggle';
import { NO_SHADOW_FROM_LEVEL, applyLightMode, configureShadowRenderer, fitSunShadow, parseShadows } from './style/lights';
import { setPaletteMode, setShadowCasters } from './style/materials';
import { initialMode, storeMode } from './style/mode';
import { type StyleMode, paletteFor } from './style/palette';
import { e2eEnabled, registerSetView, registerTestState } from './testhook';
import { renderAttribution } from './tiles/attribution';
import { frustumOf, viewCentre } from './tiles/culling';
import { LodController } from './tiles/lod';
import { Picker } from './pick/picker';
import type { IndexEntry as PickIndexEntry } from './pick/rows';
import { CACHE_LIMIT, TileStreamer, createGltfTileLoader, disposeTile } from './tiles/loader';
import { FlyAnimator, fitWidth } from './fly';
import { applyLayerVisibility, initialLayers, layerState, setLayerState, storeLayers } from './layers';
import { parseMinimapSvg, viewFootprint } from './minimap';
import { type IndexEntry, parseIndex, refOf } from './search';
import { currentSelection, onSelect, select } from './selection';
import { initLayout } from './layout';
import { createToolbar } from './toolbar';
import {
  type Manifest,
  assetUrl,
  contentBounds,
  fetchManifest,
  fetchShard,
  indexUrl,
  minimapUrl,
  resolveTilesBase,
} from './tiles/manifest';

const host = document.getElementById('app') as HTMLElement;
// T-5.4 language (ADR-0006): ?lang= wins, then the remembered choice, then Italian. Every module
// re-labels itself through onLangChange; the ones living in this file do so right here.
setLang(initialLang(window.location.search));
document.title = t('title');
onLangChange(() => {
  document.title = t('title');
  host.setAttribute('aria-label', t('mapLabel'));
  picker.setLang(getLang()); // the info card
  relabelNotices();
  renderAttributionNow();
});

// e2e (software GL) runs without MSAA: Chromium's SwiftShader MSAA resolve intermittently raises a
// GL_INVALID_OPERATION blit feedback loop under continuous rendering (see R-3.4). Production keeps AA.
const renderer = new THREE.WebGLRenderer({ antialias: !e2eEnabled() });
renderer.setPixelRatio(1);
host.appendChild(renderer.domElement);

// --- T-3.3 style ---
const shadowsOn = parseShadows(window.location.search);
configureShadowRenderer(renderer, shadowsOn);
// --- end T-3.3 style ---
const { scene, tileRoot, sun, lights, setGroundMode } = createScene(shadowsOn);
const elevation = parseElevation(window.location.search);
const initialStep = parseRotation(window.location.search); // T-5.2
const camera = createCamera(
  window.innerWidth / window.innerHeight,
  elevation,
  azimuthOfStep(initialStep),
);
const rig = new CameraRig(camera, elevation, initialStep);

let lastRender = { calls: 0, triangles: 0 };
registerTestState('render', () => lastRender);
registerTestState('camera', () => rig.snapshot());

// --- T-4.3 day/night (style only, never data) ---
let styleMode: StyleMode = initialMode(window.location.search);
registerTestState('style', () => ({ mode: styleMode }));
const modeToggle = createModeToggle(styleMode, () => setMode(styleMode === 'night' ? 'day' : 'night', true));

function setMode(mode: StyleMode, remember: boolean): void {
  styleMode = mode;
  setPaletteMode(mode);
  applyLightMode(lights, mode);
  setGroundMode(mode);
  document.documentElement.style.background = '#' + paletteFor(mode).ground.toString(16).padStart(6, '0');
  modeToggle.sync(mode);
  picker.setMode(mode); // T-5.1
  toolbar.setMode(mode); // T-5.3b
  if (remember) storeMode(mode);
  requestRender(); // one frame on demand, no loop
}
// --- end T-4.3 day/night ---

let manifest: Manifest | null = null;
let streamer: TileStreamer<THREE.Group> | null = null;
let lod: LodController<THREE.Group> | null = null;
/** Tile state for the e2e hook and the debug overlay; `visible` counts the tiles of the level in use. */
function tilesState() {
  return {
    ...(streamer?.stats ?? { loaded: 0, loading: 0, failed: 0, started: 0, completed: 0, cancelled: 0 }),
    ...(lod?.state() ?? { visible: 0, pending: 0, level: 0 }),
    // T-6.3 checks: tile groups in the scene (equals `loaded`: a cancelled tile is never added), and requests in flight that are not wanted (0)
    inScene: tileRoot.children.length,
    wanted: streamer?.wantedCount ?? 0, // T-6.4: the cache may hold more than its limit only while this is larger
    unwantedInFlight: streamer?.unwantedInFlight() ?? 0,
  };
}
registerTestState('tiles', tilesState);
// T-6.4 memory session: what the renderer holds, against what the tiles in the scene account for.
registerTestState('gpu', () => {
  const geoms = new Set<THREE.BufferGeometry>();
  const texs = new Set<THREE.Texture>();
  tileRoot.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    geoms.add(mesh.geometry);
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      for (const v of Object.values(m)) if ((v as THREE.Texture | null)?.isTexture) texs.add(v as THREE.Texture);
      // the per-tile lookup materials keep their colour-index and mask textures in userData (materials.ts)
      for (const k of ['lookup', 'mask'] as const) {
        const v = m.userData[k] as THREE.Texture | undefined;
        if (v?.isTexture) texs.add(v);
      }
      for (const u of Object.values((m as THREE.ShaderMaterial).uniforms ?? {})) {
        if ((u.value as THREE.Texture | null)?.isTexture) texs.add(u.value as THREE.Texture);
      }
    }
  });
  let maxGeomsPerTile = 0;
  for (const tile of tileRoot.children) {
    const g = new Set<THREE.BufferGeometry>();
    tile.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) g.add((o as THREE.Mesh).geometry);
    });
    maxGeomsPerTile = Math.max(maxGeomsPerTile, g.size);
  }
  return {
    maxGeomsPerTile,
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
    programs: renderer.info.programs?.length ?? 0,
    tileGeometries: geoms.size,
    tileTextures: texs.size,
    tilesInScene: tileRoot.children.length,
    cacheLimit: CACHE_LIMIT,
    domNodes: document.getElementsByTagName('*').length,
  };
});

// Render on demand: any number of requests coalesce into one animation frame; there is no
// permanent loop. Everything that can change the picture (controls, inertia, resize, tile
// load or evict, manifest load) calls requestRender().
const frameHooks: (() => void)[] = [];
let renderQueued = false;
let forceCull = true; // cull on the next frame although the camera did not move

function requestRender(): void {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(render);
}

// The camera as it was at the last cull: compared number by number, no string built per frame (T-6.4).
const lastProjection: number[] = new Array<number>(16).fill(NaN);
const lastWorld: number[] = new Array<number>(16).fill(NaN);
/** True (and remembers the camera) if the projection or the world matrix differs from the last call. */
function cameraMoved(): boolean {
  const p = camera.projectionMatrix.elements;
  const w = camera.matrixWorld.elements;
  let moved = false;
  for (let i = 0; i < 16; i++) {
    if (p[i] !== lastProjection[i]) {
      lastProjection[i] = p[i] as number;
      moved = true;
    }
    if (w[i] !== lastWorld[i]) {
      lastWorld[i] = w[i] as number;
      moved = true;
    }
  }
  return moved;
}

let errorEl: HTMLElement | null = null;
let errorMessage = '';
function showError(message: string): void {
  errorMessage = message;
  errorEl = document.createElement('div');
  errorEl.id = 'error';
  errorEl.setAttribute('role', 'alert');
  errorEl.textContent = `${t('tilesError')}: ${message}`;
  document.body.appendChild(errorEl);
}

/**
 * Small dismissible notice, top left (the attribution is bottom right, so it is never covered). It
 * stacks in the toolbar zone (T-5.3b), inside a persistent live region so it is announced (T-5.4).
 */
let notice: { el: HTMLElement; text: HTMLElement; close: HTMLButtonElement } | null = null;
let noticeDismissed = false;
function relabelNotices(): void {
  if (errorEl) errorEl.textContent = `${t('tilesError')}: ${errorMessage}`;
  if (notice) {
    notice.text.textContent = t('tilesPartial');
    notice.close.setAttribute('aria-label', t('close'));
  }
}
function showTilesNotice(): void {
  if (notice || noticeDismissed) return;
  const el = document.createElement('div');
  el.id = 'tiles-notice';
  const text = document.createElement('span');
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'tb-btn';
  close.textContent = '×';
  close.addEventListener('click', () => {
    noticeDismissed = true;
    el.remove();
    notice = null;
  });
  el.append(text, close);
  notice = { el, text, close };
  relabelNotices();
  toolbar.notices.appendChild(el);
}

/** Writes the attribution (label in the language in use; the entries are data and stay as they are). */
function renderAttributionNow(): void {
  if (!manifest) return;
  renderAttribution(document.getElementById('attribution') as HTMLElement, manifest.attribution, t('dataLabel'));
}

/** Whether buildings cast shadows now: not at the coarsest level (T-6.4, ADR-0039). */
let castersOn = true;

function updateTiles(): void {
  if (!manifest || !streamer || !lod) return;
  const [cx, cz] = viewCentre(camera);
  lod.update(frustumOf(camera), rig.metresPerPixel(window.innerWidth), cx, cz); // T-6.2
  const casters = lod.currentLevel < NO_SHADOW_FROM_LEVEL;
  if (casters !== castersOn) {
    castersOn = casters;
    setShadowCasters(tileRoot, casters);
  }
}

let lastRenderMs = 0; // T-6.4: CPU time of the last render(), for the benchmark
function render(): void {
  const t0 = performance.now();
  renderQueued = false;
  camera.updateMatrixWorld();
  const moved = cameraMoved() || forceCull;
  if (moved) {
    forceCull = false;
    updateTiles();
  } else {
    lod?.apply(); // a tile arrived or left: which of the loaded tiles are drawn may have changed (T-6.2)
  }
  if (shadowsOn && moved) fitSunShadow(sun, camera, rig.bounds); // T-3.3 style; the fit depends on the camera and the bounds only (T-6.4)
  renderer.render(scene, camera);
  lastRender = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
  lastRenderMs = performance.now() - t0;
  for (const hook of frameHooks) hook(); // T-3.4: empty unless ?debug
}

function resize(): void {
  renderer.setSize(window.innerWidth, window.innerHeight);
  resizeCamera(camera, window.innerWidth / window.innerHeight);
  requestRender();
}

async function startTiles(): Promise<void> {
  const base = resolveTilesBase(window.location.search, window.location.href);
  try {
    manifest = await fetchManifest(base);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    showError(message);
    manifestFailed(err);
    return;
  }
  renderAttributionNow();
  tilesBase = base; // T-5.1: the card fetches index.json on the first selection
  manifestReady(manifest); // T-5.3b
  void loadMinimap(manifest, base);
  rig.setBounds(contentBounds(manifest));
  rig.apply();
  streamer = new TileStreamer<THREE.Group>([], {
    load: createGltfTileLoader(base),
    onLoaded: (_id, obj) => {
      applyLayerVisibility(obj); // T-5.3b: tiles loaded later honour the layer toggles
      if (!castersOn) setShadowCasters(obj, false); // T-6.4
      tileRoot.add(obj);
      picker.tilesChanged(); // T-5.1
      requestRender();
    },
    onEvict: (_id, obj) => {
      tileRoot.remove(obj);
      disposeTile(obj);
      picker.tilesChanged(); // T-5.1
      requestRender();
    },
    onError: (id, err) => {
      console.error(`tile ${id} failed to load: ${err instanceof Error ? err.message : String(err)}`);
      showTilesNotice();
    },
    onChange: requestRender,
  });
  lod = new LodController<THREE.Group>(manifest, streamer, {
    fetchShard: (rec, signal) => fetchShard(base, rec, signal),
    onShardsChanged: () => {
      forceCull = true; // a shard arrived (or a retry is due): cull again although the camera did not move
      requestRender();
    },
    onShardError: (rec, err) => {
      console.error(`shard ${rec.id} failed to load: ${err instanceof Error ? err.message : String(err)}`);
      showTilesNotice();
    },
  });
  forceCull = true; // force a cull on the next frame
  requestRender();
}

// --- T-5.2 rotation ---
const rotation = new RotationAnimator(rig, { requestRender });
createRotationButtons((dir) => rotation.rotate(dir));
// --- end T-5.2 rotation ---

new Controls(host, rig, {
  requestRender,
  ariaLabel: t('mapLabel'),
  onRotate: (dir) => rotation.rotate(dir),
});

// --- T-5.3b toolbar ---
// Search (index fetched lazily), layer toggles, minimap. Selection goes through selection.ts.
setLayerState(initialLayers(window.location.search));
const fly = new FlyAnimator(rig, { requestRender });
let manifestReady: (m: Manifest) => void = () => undefined;
let manifestFailed: (e: unknown) => void = () => undefined;
const manifestPromise = new Promise<Manifest>((resolve, reject) => {
  manifestReady = resolve;
  manifestFailed = reject;
});
manifestPromise.catch(() => undefined); // the failure itself is reported by startTiles

const toolbar = createToolbar({
  loadIndex: async (): Promise<IndexEntry[]> => {
    const m = await manifestPromise;
    const url = indexUrl(m, resolveTilesBase(window.location.search, window.location.href));
    if (!url) throw new Error('this tileset has no search index');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`index.json: HTTP ${res.status}`);
    return parseIndex(await res.json());
  },
  onChoose: (hit) => {
    rotation.finish();
    const aspect = window.innerWidth / window.innerHeight;
    fly.flyTo(hit.centre, fitWidth(hit.bbox, azimuthOfStep(rig.azimuthStep), rig.elevationDeg, aspect));
    const ref = refOf(hit);
    if (ref) select({ ref, source: 'search' });
  },
  layers: layerState(),
  onToggle: (id, visible) => {
    setLayerState({ ...layerState(), [id]: visible });
    storeLayers(layerState());
    applyLayerVisibility(tileRoot);
    requestRender();
  },
  onMinimapPick: (x, z) => fly.flyTo([x, z], rig.visibleWidth),
});
registerTestState('toolbar', () => ({
  ...toolbar.state(),
  minimapView: viewFootprint(rig, window.innerWidth, window.innerHeight), // live, not the last drawn
  layers: layerState(),
  selection: currentSelection(),
}));
frameHooks.push(() => toolbar.setView(viewFootprint(rig, window.innerWidth, window.innerHeight)));

async function loadMinimap(m: Manifest, base: URL): Promise<void> {
  const url = minimapUrl(m, base);
  if (!url) return;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`minimap.svg: HTTP ${res.status}`);
    const svg = parseMinimapSvg(await res.text());
    if (!svg) throw new Error('minimap.svg: not a valid SVG');
    toolbar.setMinimap(svg);
    requestRender(); // refresh the view polygon
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
  }
}
// --- end T-5.3b toolbar ---

// --- T-5.1 picking ---
const picker = new Picker({ host, camera, tileRoot, requestRender });
// index.json holds the names of streets, areas and landmarks. It is fetched on the first selection,
// not at start (T-5.3b keeps it lazy until the search box is used).
let tilesBase: URL | null = null;
let indexRequested = false;
onSelect((sel) => {
  if (!sel || indexRequested || !manifest || !tilesBase) return;
  indexRequested = true;
  void loadSearchIndex(tilesBase, manifest);
});

async function loadSearchIndex(base: URL, m: Manifest): Promise<void> {
  if (!m.index) return; // tilesets before T-5.3a have no index: the card then shows tile data only
  try {
    const res = await fetch(assetUrl(base, m.index.file, m.index.sha256).href);
    if (!res.ok) throw new Error(`index ${m.index.file}: HTTP ${res.status}`);
    const body = (await res.json()) as { entries: PickIndexEntry[] };
    picker.setIndex(body.entries);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
  }
}
// --- end T-5.1 picking ---

// e2e only (`e2e=1`): look at ground point (x, z) with `width` metres across the viewport.
registerSetView((x, z, width, step) => {
  if (step !== undefined) {
    rotation.finish();
    rig.setStep(step);
  }
  rig.target = [x, z];
  rig.visibleWidth = width;
  rig.clampTarget();
  rig.apply();
  requestRender();
});

window.addEventListener('resize', resize);
setMode(styleMode, false);
resize();
rig.apply();
void startTiles();
initLayout(); // T-5.7: the attribution band; the toolbar zone and the card are laid out above it

// --- T-3.4 debug ---
{
  const debugParam = new URLSearchParams(window.location.search).get('debug');
  if (debugParam !== null) {
    void import('./debug').then((m) =>
      m.initDebug(
        {
          renderInfo: () => lastRender,
          tiles: tilesState,
          lastRenderMs: () => lastRenderMs,
          camera: () => rig.snapshot(),
          canvas: renderer.domElement,
          pixelRatio: () => renderer.getPixelRatio(),
          setView: (x, z, width) => {
            rig.target = [x, z];
            rig.visibleWidth = width;
            rig.clampTarget();
            rig.apply();
          },
          requestRender,
          addFrameHook: (hook) => frameHooks.push(hook),
        },
        debugParam === 'bench',
      ),
    );
  }
}
// --- end T-3.4 debug ---
