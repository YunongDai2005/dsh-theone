import * as THREE from 'three';

/** One camera drives both the DOM layer (as CSS 3D) and the Three.js scene, so they line up to the pixel. */
export interface Shot { pos: [number, number, number]; target: [number, number, number]; roll: number; fov: number }
export const VW = 1920, VH = 1080;

export function makeCamera(s: Shot): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(s.fov, VW / VH, 10, 40000);
  cam.position.set(...s.pos);
  cam.up.set(Math.sin(s.roll), Math.cos(s.roll), 0);
  cam.lookAt(new THREE.Vector3(...s.target));
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}

const n = (v: number) => (Math.abs(v) < 1e-10 ? 0 : v);
/** CSS equivalents of the camera (same math as three's CSS3DRenderer). */
export function cssCamera(cam: THREE.PerspectiveCamera) {
  const fovPx = cam.projectionMatrix.elements[5] * VH / 2;
  const e = cam.matrixWorldInverse.elements;
  const m = [e[0], -e[1], e[2], e[3], e[4], -e[5], e[6], e[7], e[8], -e[9], e[10], e[11], e[12], -e[13], e[14], e[15]].map(n);
  return { perspective: fovPx, transform: `translateZ(${fovPx}px) matrix3d(${m.join(',')}) translate(${VW / 2}px,${VH / 2}px)` };
}
export function cssObject(world: THREE.Matrix4) {
  const e = world.elements;
  const m = [e[0], e[1], e[2], e[3], -e[4], -e[5], -e[6], -e[7], e[8], e[9], e[10], e[11], e[12], e[13], e[14], e[15]].map(n);
  return `translate(-50%,-50%) matrix3d(${m.join(',')})`;
}
/** World point → screen px (top-left origin). */
export function project(cam: THREE.PerspectiveCamera, p: [number, number, number]): [number, number, number] {
  const v = new THREE.Vector3(...p).project(cam);
  return [(v.x + 1) / 2 * VW, (1 - v.y) / 2 * VH, v.z];
}
