import * as THREE from 'three';

export interface SceneParts {
  scene: THREE.Scene;
  /** Parent of every loaded tile. */
  tileRoot: THREE.Group;
}

const GROUND_SIZE_M = 8000;
const GROUND_Y = -0.1; // below the lowest layer (landuse at 0.02 m)

/** Ground plane, the tile root group, one directional + one ambient light. No assets. */
export function createScene(): SceneParts {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xcfd8dc);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_SIZE_M, GROUND_SIZE_M),
    new THREE.MeshLambertMaterial({ color: 0xe8e4dc, flatShading: true }),
  );
  ground.name = 'ground';
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = GROUND_Y;
  scene.add(ground);

  const tileRoot = new THREE.Group();
  tileRoot.name = 'tiles';
  scene.add(tileRoot);

  const sun = new THREE.DirectionalLight(0xffffff, 2.5);
  sun.position.set(-8, 15, 6);
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  return { scene, tileRoot };
}
