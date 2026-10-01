import * as THREE from 'three';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { Text } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { continueRender, delayRender, staticFile } from 'remotion';

export const FONT = {
  r: staticFile('fonts/inter-latin-400-normal.woff'), m: staticFile('fonts/inter-latin-500-normal.woff'), sb: staticFile('fonts/inter-latin-600-normal.woff'),
  one: staticFile('fonts/nunito-latin-700-normal.woff'), mono: staticFile('fonts/jetbrains-mono-latin-500-normal.woff'),
};
export const col = (c: string | [number, number, number]) => (typeof c === 'string' ? new THREE.Color(c) : new THREE.Color(...c));
/** HDR colour (linear, may exceed 1) for bloom sources. */
export const hdr = (rgb255: [number, number, number], gain: number) => new THREE.Color(...rgb255.map(v => Math.pow(v / 255, 2.2) * gain) as [number, number, number]);

export function roundedRect(w: number, h: number, r: number, path: THREE.Path | THREE.Shape = new THREE.Shape()) {
  const x = -w / 2, y = -h / 2; r = Math.min(r, w / 2, h / 2);
  path.moveTo(x + r, y); path.lineTo(x + w - r, y); path.quadraticCurveTo(x + w, y, x + w, y + r); path.lineTo(x + w, y + h - r);
  path.quadraticCurveTo(x + w, y + h, x + w - r, y + h); path.lineTo(x + r, y + h); path.quadraticCurveTo(x, y + h, x, y + h - r);
  path.lineTo(x, y + r); path.quadraticCurveTo(x, y, x + r, y);
  return path;
}
const cache = new Map<string, THREE.BufferGeometry>();
const memo = (key: string, make: () => THREE.BufferGeometry) => { let g = cache.get(key); if (!g) { g = make(); cache.set(key, g); } return g; };
export const panelGeo = (w: number, h: number, r: number) => memo(`p${w}|${h}|${r}`, () => new THREE.ShapeGeometry(roundedRect(w, h, r) as THREE.Shape, 12));
/** a rounded-rect outline (ring) of width lw, centred on the rect's edge */
export const ringGeo = (w: number, h: number, r: number, lw: number) => memo(`r${w}|${h}|${r}|${lw}`, () => {
  const s = roundedRect(w + lw, h + lw, r + lw / 2) as THREE.Shape; s.holes.push(roundedRect(w - lw, h - lw, Math.max(0, r - lw / 2), new THREE.Path()));
  return new THREE.ShapeGeometry(s, 12);
});

/** Redraw hooks: troika lays text out asynchronously, and while rendering R3F only draws when the frame changes,
 *  so a finished layout must redraw the canvas itself (through the composer when there is one). */
export const redraw = new Set<() => void>();
/** troika text that holds the frame until its glyphs are laid out and drawn (no frame is captured with missing text).
 *  The hold starts on commit: a font load suspends the tree, and anything created during a suspended render is thrown away. */
export function SText(props: React.ComponentProps<typeof Text>) {
  const handle = useRef<number | null>(null), done = useRef(false);
  const advance = useThree(s => s.advance);
  useLayoutEffect(() => {
    if (!done.current) handle.current = delayRender('text layout');
    return () => { if (handle.current !== null) { continueRender(handle.current); handle.current = null; } };
  }, []);
  return <Text renderOrder={10} {...props} onSync={m => {
    props.onSync?.(m); done.current = true;
    if (handle.current !== null) {
      if (redraw.size) redraw.forEach(f => f()); else advance(performance.now());
      continueRender(handle.current); handle.current = null;
    }
  }} />;
}

/** soft drop shadow under floating panels: a blurred rounded rect baked once into a canvas texture */
const shadowTex = (() => {
  let tex: THREE.CanvasTexture | null = null;
  return () => {
    if (tex) return tex;
    const c = document.createElement('canvas'); c.width = 256; c.height = 256; const g = c.getContext('2d')!;
    g.filter = 'blur(22px)'; g.fillStyle = '#000'; g.beginPath(); g.roundRect(56, 56, 144, 144, 26); g.fill();
    tex = new THREE.CanvasTexture(c); return tex;
  };
})();
export function Shadow({ w, h, o, dy = -18, z = -2 }: { w: number; h: number; o: number; dy?: number; z?: number }) {
  return <mesh position={[0, dy, z]} scale={[w * 256 / 144, h * 256 / 144, 1]} renderOrder={-1}>
    <planeGeometry args={[1, 1]} /><meshBasicMaterial map={shadowTex()} transparent opacity={o} depthWrite={false} />
  </mesh>;
}

export function useOnce<T>(make: () => T) { return useMemo(make, []); } // eslint-disable-line react-hooks/exhaustive-deps
