import * as THREE from 'three';
import { createCamera, parseElevation } from './camera';
import { DEFAULT_LANG, t } from './i18n';
import { createScene } from './scene';
import { registerTestState } from './testhook';
// --- T-3.2 tiles ---
import { renderAttribution } from './tiles/attribution';
import { cullTiles, frustumOf, sortNearestFirst, viewCentre } from './tiles/culling';
import { TileStreamer, createGltfTileLoader, disposeTile } from './tiles/loader';
import { type Manifest, fetchManifest, resolveTilesBase } from './tiles/manifest';
import { applyView, parseView } from './tiles/tempview';
// --- end T-3.2 ---

const host = document.getElementById('app') as HTMLElement;
document.title = t('title', DEFAULT_LANG);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
host.appendChild(renderer.domElement);

const { scene, tileRoot } = createScene();
const elevation = parseElevation(window.location.search);
const camera = createCamera(window.innerWidth / window.innerHeight, elevation);

let dirty = true;
function requestRender(): void {
  dirty = true;
}

let lastRender = { calls: 0, triangles: 0 };
registerTestState('render', () => lastRender);

// --- T-3.2 tiles ---
// Temporary camera placement (?view=x,z,width) until T-3.1's controls own the camera.
const view = parseView(window.location.search);
function fitCamera(): void {
  applyView(camera, window.innerWidth / window.innerHeight, view, elevation);
}

let manifest: Manifest | null = null;
let streamer: TileStreamer<THREE.Group> | null = null;
let visibleCount = 0;
registerTestState('tiles', () => ({
  ...(streamer?.stats ?? { loaded: 0, loading: 0, failed: 0 }),
  visible: visibleCount,
}));

function showError(message: string): void {
  const el = document.createElement('div');
  el.id = 'error';
  el.setAttribute('role', 'alert');
  el.textContent = `${t('tilesError', DEFAULT_LANG)}: ${message}`;
  document.body.appendChild(el);
}

function updateTiles(): void {
  if (!manifest || !streamer) return;
  const { visible, wanted } = cullTiles(
    manifest.tiles,
    frustumOf(camera),
    manifest.tile_size_m,
  );
  visibleCount = visible.length;
  const [cx, cz] = viewCentre(camera);
  streamer.update(sortNearestFirst(manifest.tiles, wanted, cx, cz), visible);
}

async function startTiles(): Promise<void> {
  const base = resolveTilesBase(window.location.search, window.location.href);
  try {
    manifest = await fetchManifest(base);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    showError(message);
    return;
  }
  renderAttribution(
    document.getElementById('attribution') as HTMLElement,
    manifest.attribution,
    t('dataLabel', DEFAULT_LANG),
  );
  streamer = new TileStreamer<THREE.Group>(manifest.tiles, {
    load: createGltfTileLoader(base),
    onLoaded: (_id, obj) => {
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
    },
    onChange: requestRender,
  });
  lastKey = ''; // force a first cull
}
// --- end T-3.2 ---

let lastKey = '';
function cameraKey(): string {
  return `${camera.projectionMatrix.elements.join()}|${camera.matrixWorld.elements.join()}`;
}

function resize(): void {
  renderer.setSize(window.innerWidth, window.innerHeight);
  fitCamera();
  requestRender();
}

// Render on demand: the frame callback only draws when the camera or the tile set changed.
function frame(): void {
  requestAnimationFrame(frame);
  const key = cameraKey();
  if (key !== lastKey) {
    lastKey = key;
    updateTiles();
    dirty = true;
  }
  if (!dirty) return;
  dirty = false;
  renderer.render(scene, camera);
  lastRender = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
}

window.addEventListener('resize', resize);
resize();
void startTiles();
requestAnimationFrame(frame);
