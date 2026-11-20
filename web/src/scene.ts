import * as THREE from 'three';
import { type Lights, createLights } from './style/lights';
import { type StyleMode, paletteFor } from './style/palette';

export interface SceneParts {
  scene: THREE.Scene;
  /** Parent of every loaded tile. */
  tileRoot: THREE.Group;
  /** The fixed sun (T-3.3); its shadow frustum is refitted by main.ts on camera change. */
  sun: THREE.DirectionalLight;
  lights: Lights;
  /** Switches page background and ground colour to the day or night palette (T-4.3). */
  setGroundMode: (mode: StyleMode) => void;
}

const GROUND_SIZE_M = 8000;
const GROUND_Y = -0.1; // below the lowest layer (landuse at 0.02 m)

/** Ground plane, the tile root group, one directional + one ambient light. No assets. */
export function createScene(shadows = true): SceneParts {
  const scene = new THREE.Scene();
  const background = new THREE.Color(paletteFor('day').ground);
  scene.background = background;

  const groundMaterial = new THREE.MeshLambertMaterial({
    color: paletteFor('day').ground,
    flatShading: true,
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(GROUND_SIZE_M, GROUND_SIZE_M), groundMaterial);
  ground.name = 'ground';
  ground.receiveShadow = true;
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = GROUND_Y;
  scene.add(ground);

  const tileRoot = new THREE.Group();
  tileRoot.name = 'tiles';
  scene.add(tileRoot);
  // The scene and the tile root stay at the identity and the loaded tiles are frozen (loader.ts
  // freezeMatrices): with matrixAutoUpdate on, three.js marks the root's world matrix as changed on
  // every render and then recomputes the world matrix of every mesh of every tile (T-6.4).
  scene.matrixAutoUpdate = false;
  tileRoot.matrixAutoUpdate = false;

  const lights = createLights(shadows);
  const { sun, fill } = lights;
  scene.add(sun, sun.target, fill);

  const setGroundMode = (mode: StyleMode): void => {
    const c = paletteFor(mode).ground;
    background.set(c);
    groundMaterial.color.set(c);
  };
  return { scene, tileRoot, sun, lights, setGroundMode };
}
