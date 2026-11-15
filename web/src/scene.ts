import * as THREE from 'three';

interface BoxSpec {
  size: [number, number, number];
  pos: [number, number];
  color: number;
}

const BOXES: BoxSpec[] = [
  { size: [2, 3, 2], pos: [-2.5, -2], color: 0xef5350 },
  { size: [3, 1.5, 1.5], pos: [2, 1.5], color: 0x42a5f5 },
  { size: [1, 5, 1], pos: [-1, 2.5], color: 0xffca28 },
];

/** Flat 10 x 10 m ground grid, three boxes, one directional + one ambient light. No assets. */
export function createScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xcfd8dc);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 10),
    new THREE.MeshLambertMaterial({ color: 0x9ccc65, flatShading: true }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const grid = new THREE.GridHelper(10, 10, 0x33691e, 0x558b2f);
  grid.position.y = 0.01;
  scene.add(grid);

  for (const b of BOXES) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(...b.size),
      new THREE.MeshLambertMaterial({ color: b.color, flatShading: true }),
    );
    mesh.position.set(b.pos[0], b.size[1] / 2, b.pos[1]);
    scene.add(mesh);
  }

  const sun = new THREE.DirectionalLight(0xffffff, 2.5);
  sun.position.set(-8, 15, 6);
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  return scene;
}
