import * as THREE from 'three';
import { CameraRig, azimuthOfStep, createCamera, parseElevation, parseRotation, resizeCamera } from './camera';
import { Controls } from './controls';
import { DEFAULT_LANG, t } from './i18n';
import { RotationAnimator, createRotationButtons } from './rotation';
import { createScene } from './scene';
import { createModeToggle } from './modeToggle';
import { applyLightMode, configureShadowRenderer, fitSunShadow, parseShadows } from './style/lights';
import { setPaletteMode } from './style/materials';
import { initialMode, storeMode } from './style/mode';
import { type StyleMode, paletteFor } from './style/palette';
import { e2eEnabled, registerSetView, registerTestState } from './testhook';
import { renderAttribution } from './tiles/attribution';
import { cullTiles, frustumOf, sortNearestFirst, viewCentre } from './tiles/culling';
import { TileStreamer, createGltfTileLoader, disposeTile } from './tiles/loader';
import { FlyAnimator, fitWidth } from './fly';
import { applyLayerVisibility, initialLayers, layerState, setLayerState, storeLayers } from './layers';
import { parseMinimapSvg, viewFootprint } from './minimap';
import { type IndexEntry, parseIndex, refOf } from './search';
import { currentSelection, select } from './selection';
import { createToolbar } from './toolbar';
import { type Manifest, contentBounds, fetchManifest, indexUrl, minimapUrl, resolveTilesBase } from './tiles/manifest';

const host = document.getElementById('app') as HTMLElement;
document.title = t('title', DEFAULT_LANG);

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
  toolbar.setMode(mode); // T-5.3b
  if (remember) storeMode(mode);
  requestRender(); // one frame on demand, no loop
}
// --- end T-4.3 day/night ---

let manifest: Manifest | null = null;
let streamer: TileStreamer<THREE.Group> | null = null;
let visibleCount = 0;
registerTestState('tiles', () => ({
  ...(streamer?.stats ?? { loaded: 0, loading: 0, failed: 0 }),
  visible: visibleCount,
}));

// Render on demand: any number of requests coalesce into one animation frame; there is no
// permanent loop. Everything that can change the picture (controls, inertia, resize, tile
// load or evict, manifest load) calls requestRender().
const frameHooks: (() => void)[] = [];
let renderQueued = false;
let lastKey = '';

function requestRender(): void {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(render);
}

function cameraKey(): string {
  return `${camera.projectionMatrix.elements.join()}|${camera.matrixWorld.elements.join()}`;
}

function showError(message: string): void {
  const el = document.createElement('div');
  el.id = 'error';
  el.setAttribute('role', 'alert');
  el.textContent = `${t('tilesError', DEFAULT_LANG)}: ${message}`;
  document.body.appendChild(el);
}

/** Small dismissible notice, top left (the attribution is bottom right, so it is never covered). */
let notice: HTMLElement | null = null;
let noticeDismissed = false;
function showTilesNotice(): void {
  if (notice || noticeDismissed) return;
  const el = document.createElement('div');
  el.id = 'tiles-notice';
  el.setAttribute('role', 'status');
  // T-5.3b: the notice stacks in the toolbar zone (top left, below the toolbar), never over it.
  el.style.cssText =
    'max-width:100%;box-sizing:border-box;font:12px sans-serif;' +
    'color:#263238;background:rgba(255,255,255,0.9);padding:4px 6px;border:1px solid #90a4ae;' +
    'display:flex;gap:8px;align-items:center;';
  const text = document.createElement('span');
  text.textContent = t('tilesPartial', DEFAULT_LANG);
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', t('close', DEFAULT_LANG));
  close.addEventListener('click', () => {
    noticeDismissed = true;
    el.remove();
    notice = null;
  });
  el.append(text, close);
  toolbar.zone.appendChild(el);
  notice = el;
}

function updateTiles(): void {
  if (!manifest || !streamer) return;
  const { visible, wanted } = cullTiles(manifest.tiles, frustumOf(camera), manifest.tile_size_m);
  visibleCount = visible.length;
  const [cx, cz] = viewCentre(camera);
  streamer.update(sortNearestFirst(manifest.tiles, wanted, cx, cz), visible);
}

function render(): void {
  renderQueued = false;
  camera.updateMatrixWorld();
  const key = cameraKey();
  if (key !== lastKey) {
    lastKey = key;
    updateTiles();
  }
  if (shadowsOn) fitSunShadow(sun, camera, rig.bounds); // T-3.3 style
  renderer.render(scene, camera);
  lastRender = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
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
  renderAttribution(
    document.getElementById('attribution') as HTMLElement,
    manifest.attribution,
    t('dataLabel', DEFAULT_LANG),
  );
  manifestReady(manifest); // T-5.3b
  void loadMinimap(manifest, base);
  rig.setBounds(contentBounds(manifest));
  rig.apply();
  streamer = new TileStreamer<THREE.Group>(manifest.tiles, {
    load: createGltfTileLoader(base),
    onLoaded: (_id, obj) => {
      applyLayerVisibility(obj); // T-5.3b: tiles loaded later honour the layer toggles
      tileRoot.add(obj);
      requestRender();
    },
    onEvict: (_id, obj) => {
      tileRoot.remove(obj);
      disposeTile(obj);
      requestRender();
    },
    onError: (id, err) => {
      console.error(`tile ${id} failed to load: ${err instanceof Error ? err.message : String(err)}`);
      showTilesNotice();
    },
    onChange: requestRender,
  });
  lastKey = ''; // force a cull on the next frame
  requestRender();
}

// --- T-5.2 rotation ---
const rotation = new RotationAnimator(rig, { requestRender });
createRotationButtons((dir) => rotation.rotate(dir));
// --- end T-5.2 rotation ---

new Controls(host, rig, {
  requestRender,
  ariaLabel: t('mapLabel', DEFAULT_LANG),
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

// --- T-3.4 debug ---
{
  const debugParam = new URLSearchParams(window.location.search).get('debug');
  if (debugParam !== null) {
    void import('./debug').then((m) =>
      m.initDebug(
        {
          renderInfo: () => lastRender,
          tiles: () => ({
            ...(streamer?.stats ?? { loaded: 0, loading: 0, failed: 0 }),
            visible: visibleCount,
          }),
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
