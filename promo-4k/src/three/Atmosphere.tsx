import * as THREE from 'three';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { D, r, pulse, rng, seg } from '../lib/timeline';
import { KEY } from '../lib/story';
import { accent, type Theme } from '../lib/theme';

const once = new Map<string, THREE.Texture>();
function canvasTex(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  let tex = once.get(key);
  if (!tex) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d')!); tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; once.set(key, tex); }
  return tex;
}
/** a miniature session card: the cloud of every other conversation */
const cardTex = (dark: boolean) => canvasTex('card' + dark, 256, 152, g => {
  g.fillStyle = dark ? '#26282e' : '#ffffff'; g.strokeStyle = dark ? '#3a3d45' : '#dfe3ea'; g.lineWidth = 3;
  g.beginPath(); g.roundRect(4, 4, 248, 144, 18); g.fill(); g.stroke();
  g.fillStyle = dark ? '#5a5f6a' : '#c3c8d2'; g.beginPath(); g.roundRect(24, 28, 132, 16, 8); g.fill();
  g.fillStyle = dark ? '#3a3e47' : '#e6e9ee'; g.beginPath(); g.roundRect(24, 66, 196, 10, 5); g.fill(); g.beginPath(); g.roundRect(24, 88, 140, 10, 5); g.fill();
});
/** floor: a dot grid fading out from the middle */
const floorTex = (dark: boolean) => canvasTex('floor' + dark, 2048, 2048, g => {
  for (let x = 16; x < 2048; x += 32) for (let y = 16; y < 2048; y += 32) {
    const d = Math.hypot(x - 1024, y - 1024) / 1024, a = Math.max(0, 1 - d) ** 1.6;
    g.fillStyle = dark ? `rgba(170,190,230,${.5 * a})` : `rgba(70,90,140,${.38 * a})`; g.beginPath(); g.arc(x, y, 2.6, 0, Math.PI * 2); g.fill();
  }
});
/** a soft light shaft: bright core, fading down and to the sides */
const shaftTex = () => canvasTex('shaft', 128, 512, g => {
  for (let x = 0; x < 128; x++) {
    const u = Math.exp(-(((x - 64) / 30) ** 2));
    const lg = g.createLinearGradient(0, 0, 0, 512); lg.addColorStop(0, `rgba(255,255,255,${u})`); lg.addColorStop(.55, `rgba(255,255,255,${.45 * u})`); lg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = lg; g.fillRect(x, 0, 1, 512);
  }
});

const N = 380;
const CLOUD = (() => {
  const r0 = rng(77), kx = KEY[0], ky = KEY[1];
  return Array.from({ length: N }, () => {
    const z = -2700 + r0() * 2150;   // always behind the structure
    return { x: kx - 1900 + r0() * 7200, y: ky - 1500 + r0() * 2900, z, s: .75 + r0() * .55, rz: (r0() - .5) * .5, ry: (r0() - .5) * .6, ph: r0() * 6.28, sp: .15 + r0() * .25, depth: (z + 2700) / 2150 };
  });
})();

export function Atmosphere({ t, theme, camQ }: { t: number; theme: Theme; camQ: THREE.Quaternion }) {
  const dark = theme === 'dark';
  const ref = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => new THREE.PlaneGeometry(230, 136), []);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ map: cardTex(dark), transparent: true, depthWrite: false }), [dark]);
  const bg = new THREE.Color(dark ? '#111215' : '#e3e8f0'), white = new THREE.Color('#ffffff');
  const show = seg(t, D + .1, r(2.2)) * (1 - seg(t, r(28.3), r(28.9)));
  mat.opacity = show * (dark ? .8 : .9);
  useLayoutEffect(() => {
    const m = ref.current; if (!m) return;
    const o = new THREE.Object3D(), c = new THREE.Color();
    CLOUD.forEach((p, i) => {
      o.position.set(p.x + 30 * Math.sin((t - D) * p.sp + p.ph), p.y + 40 * Math.sin((t - D) * p.sp * .8 + p.ph * 2), p.z);
      o.rotation.set(0, p.ry, p.rz + .05 * Math.sin((t - D) * p.sp + p.ph)); o.scale.setScalar(p.s); o.updateMatrix(); m.setMatrixAt(i, o.matrix);
      // far cards sink into the backdrop (instanced colour stands in for per-card opacity)
      c.copy(white).lerp(bg, dark ? .25 + .6 * (1 - p.depth) : .3 + .62 * (1 - p.depth)); m.setColorAt(i, c);
    });
    m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });
  const A = accent(theme, 255, 196, 140), pz = pulse(t);
  const floorO = show * (dark ? .9 : .8);
  return (
    <group>
      <instancedMesh ref={ref} args={[geo, mat, N]} frustumCulled={false} renderOrder={-5} />
      {/* floor under the structure */}
      <mesh position={[KEY[0] + 1700, KEY[1] - 760, -700]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={-4}>
        <planeGeometry args={[9000, 9000]} /><meshBasicMaterial map={floorTex(dark)} transparent opacity={floorO} depthWrite={false} />
      </mesh>
      {/* light shafts from above, swelling on the bar's strongest hit */}
      {[-.9, -.3, .25, .8, 1.4].map((k, i) => (
        <mesh key={i} position={[KEY[0] + 700 + k * 900, KEY[1] + 900, -900 - i * 120]} quaternion={camQ} renderOrder={-3}>
          <planeGeometry args={[340 + 120 * (i % 2), 3200]} />
          <meshBasicMaterial map={shaftTex()} color={new THREE.Color(`rgb(${A.join(',')})`)} transparent depthWrite={false}
            opacity={show * (dark ? .12 : .2) * (1 + .7 * pz) * (.8 + .2 * Math.sin((t - D) * .7 + i))} blending={dark ? THREE.AdditiveBlending : THREE.NormalBlending} />
        </mesh>
      ))}
    </group>
  );
}
