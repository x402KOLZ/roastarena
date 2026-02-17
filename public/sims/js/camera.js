import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function setupCamera(renderer) {
  const aspect = window.innerWidth / window.innerHeight;
  const frustumSize = 120;

  const camera = new THREE.OrthographicCamera(
    -frustumSize * aspect / 2,
    frustumSize * aspect / 2,
    frustumSize / 2,
    -frustumSize / 2,
    0.1,
    1000
  );

  // Isometric-style position
  camera.position.set(80, 80, 80);
  camera.lookAt(0, 0, 0);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = true;
  controls.enableRotate = true;
  controls.minZoom = 0.3;
  controls.maxZoom = 8;
  controls.maxPolarAngle = Math.PI / 2.2;
  controls.minPolarAngle = Math.PI / 10;
  controls.target.set(0, 0, 0);

  return { camera, controls };
}

export function flyTo(controls, x, z, duration = 800) {
  const startX = controls.target.x;
  const startZ = controls.target.z;
  const startTime = performance.now();

  function animate() {
    const t = Math.min((performance.now() - startTime) / duration, 1);
    const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // easeInOutQuad
    controls.target.x = startX + (x - startX) * ease;
    controls.target.z = startZ + (z - startZ) * ease;
    if (t < 1) requestAnimationFrame(animate);
  }
  animate();
}
