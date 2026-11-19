import * as THREE from './three.module.js';

export const W = 975, H = 984, focal = 915, horizon = 451;
export const pitch = Math.atan((H / 2 - horizon) / focal);
export const verticalFov = THREE.MathUtils.radToDeg(2 * Math.atan(H / (2 * focal)));
export const startEye = new THREE.Vector3(0, 2.05, 0);
export const wind = new THREE.Vector2(2 / Math.sqrt(5), -1 / Math.sqrt(5));
// World direction from a surface toward the sun. The chimney-face shadow and
// the veranda eave constrain the same light, 29 degrees above the horizon.
const sunElevation=THREE.MathUtils.degToRad(29),sunBearing=THREE.MathUtils.degToRad(-41);
export const sunDirection=new THREE.Vector3(Math.cos(sunElevation)*Math.cos(sunBearing),
  Math.sin(sunElevation),Math.cos(sunElevation)*Math.sin(sunBearing));
export const sunVectorGLSL=`vec3(${sunDirection.toArray().map(n=>n.toFixed(9)).join(',')})`;

function ray(u, v) {
  const up = (H / 2 - v) / focal;
  return new THREE.Vector3((u - W / 2) / focal,
    up * Math.cos(pitch) - Math.sin(pitch),
    -Math.cos(pitch) - up * Math.sin(pitch));
}
export function atY(u, v, y) {
  const r = ray(u, v);
  return r.multiplyScalar((y - startEye.y) / r.y).add(startEye);
}
export function atD(u, v, d) {
  const r = ray(u, v);
  return r.multiplyScalar(-d / r.z).add(startEye);
}
export function pix(p) {
  const d = p.clone().sub(startEye);
  const c = Math.cos(pitch), s = Math.sin(pitch);
  const depth = -c * d.z - s * d.y;
  return {x: W / 2 + focal * d.x / depth, y: H / 2 - focal * (c * d.y - s * d.z) / depth};
}
export const clamp = (x, lo=0, hi=1) => Math.max(lo, Math.min(hi, x));
export function smooth(a, b, x) {
  const u = clamp((x-a)/(b-a)); return u*u*(3-2*u);
}
export function smoother(a, b, x) {
  const u = clamp((x-a)/(b-a)); return u*u*u*(u*(6*u-15)+10);
}
