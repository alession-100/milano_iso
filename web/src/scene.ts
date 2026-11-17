import * as THREE from 'three';
import { createLights } from './style/lights';
import { PALETTE } from './style/palette';

export interface SceneParts {
  scene: THREE.Scene;
  /** Parent of every loaded tile. */
  tileRoot: THREE.Group;
  /** The fixed sun (T-3.3); its shadow frustum is refitted by main.ts on camera change. */
  sun: THREE.DirectionalLight;
}

const GROUND_SIZE_M = 8000;
const GROUND_Y = -0.1; // below the lowest layer (landuse at 0.02 m)

/** Ground plane, the tile root group, one directional + one ambient light. No assets. */
export function createScene(shadows = true): SceneParts {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.ground);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_SIZE_M, GROUND_SIZE_M),
    new THREE.MeshLambertMaterial({ color: PALETTE.ground, flatShading: true }),
  );
  ground.name = 'ground';
  ground.receiveShadow = true;
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = GROUND_Y;
  scene.add(ground);

  const tileRoot = new THREE.Group();
  tileRoot.name = 'tiles';
  scene.add(tileRoot);

  const { sun, fill } = createLights(shadows);
  scene.add(sun, sun.target, fill);
  return { scene, tileRoot, sun };
}
