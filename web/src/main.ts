import * as THREE from 'three';
import { CameraRig, createCamera, parseElevation, resizeCamera } from './camera';
import { Controls } from './controls';
import { DEFAULT_LANG, t } from './i18n';
import { createScene } from './scene';
import { registerTestState } from './testhook';

const host = document.getElementById('app') as HTMLElement;
document.title = t('title', DEFAULT_LANG);
(document.getElementById('attribution') as HTMLElement).textContent = t(
  'attribution',
  DEFAULT_LANG,
);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
host.appendChild(renderer.domElement);

const scene = createScene();
const camera = createCamera(
  window.innerWidth / window.innerHeight,
  parseElevation(window.location.search),
);

function render(): void {
  renderer.setSize(window.innerWidth, window.innerHeight);
  resizeCamera(camera, window.innerWidth / window.innerHeight);
  renderer.render(scene, camera);
}
window.addEventListener('resize', render);
render();

// --- T-3.1 controls ---
let renderQueued = false;
/** Renders on demand: coalesces any number of requests into one frame. No permanent loop. */
export function requestRender(): void {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}
const rig = new CameraRig(camera, parseElevation(window.location.search));
new Controls(host, rig, { requestRender, ariaLabel: t('mapLabel', DEFAULT_LANG) });
registerTestState('camera', () => rig.snapshot());
rig.apply();
requestRender();
// --- end T-3.1 ---
