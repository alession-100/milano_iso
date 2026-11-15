import * as THREE from 'three';
import { createCamera, parseElevation, resizeCamera } from './camera';
import { DEFAULT_LANG, t } from './i18n';
import { createScene } from './scene';

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
