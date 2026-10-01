import * as THREE from 'three';
import { useMemo } from 'react';
import { accent, PAL, type Theme } from '../lib/theme';
import { ONE } from '../lib/story';
import { SText, FONT, col, hdr, panelGeo, ringGeo, roundedRect } from './util';

/** slab body: an extruded rounded rect whose sides run from a deep to a light warm tone (vertex colours) */
function bodyGeo(th: number, theme: Theme, heat: number) {
  const g = new THREE.ExtrudeGeometry(roundedRect(ONE.w - 6, ONE.h - 6, 10) as THREE.Shape,
    { depth: Math.max(.5, th), bevelEnabled: true, bevelThickness: 3, bevelSize: 3, bevelSegments: 3, curveSegments: 10 });
  const pos = g.attributes.position, c = new Float32Array(pos.count * 3), z0 = -3, z1 = th + 3;
  const lo = theme === 'light' ? [196, 112, 52] : [26, 40, 56], hi = theme === 'light' ? [244, 178, 120] : [64, 100, 134];
  for (let i = 0; i < pos.count; i++) {
    const k = (pos.getZ(i) - z0) / (z1 - z0), e = heat * k * k;
    for (let j = 0; j < 3; j++) c[i * 3 + j] = Math.pow((lo[j] + (hi[j] - lo[j]) * k) / 255, 2.2) * (1 + 1.4 * e);
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

/** The One key: the DSH button lifted out of the sidebar, with real thickness and a face drawn as vector text */
export function Key({ theme, th, glow, heat, faceOpacity = 1 }: { theme: Theme; th: number; glow: number; heat: number; faceOpacity?: number }) {
  const P = PAL[theme], A = accent(theme, 255, 150, 60);
  const thq = Math.round(th * 2) / 2, hq = Math.round(heat * 20) / 20;
  const body = useMemo(() => bodyGeo(thq, theme, hq), [thq, theme, hq]);
  const fz = thq + 3.2;
  const x = (dx: number) => dx - ONE.w / 2, y = (dy: number) => ONE.h / 2 - dy;
  return (
    <group>
      <mesh geometry={body}><meshBasicMaterial vertexColors toneMapped={false} /></mesh>
      <group position={[0, 0, fz]}>
        <mesh geometry={panelGeo(ONE.w, ONE.h, 12)}><meshBasicMaterial color={col(P.keyTop)} transparent opacity={faceOpacity} /></mesh>
        <mesh geometry={ringGeo(ONE.w - 2, ONE.h - 2, 12, 2)} position={[0, 0, .1]}><meshBasicMaterial color={col(P.keyEdge)} transparent opacity={faceOpacity} /></mesh>
        {/* lit rim: the bloom source that makes the glow follow the key's real outline */}
        <mesh geometry={ringGeo(ONE.w + 1, ONE.h + 1, 12.5, 2.2)} position={[0, 0, .2]}><meshBasicMaterial color={hdr(A, 1.6 + 3.2 * glow)} toneMapped={false} transparent opacity={Math.min(1, .35 + .65 * glow)} /></mesh>
        <group position={[0, 0, .3]}>
          <mesh position={[x(35), y(45.5), 0]}><ringGeometry args={[12.2, 14, 48]} /><meshBasicMaterial color={col(P.keyInk)} /></mesh>
          <mesh position={[x(35), y(45.5), 0]}><circleGeometry args={[3, 24]} /><meshBasicMaterial color={col(P.keyInk)} /></mesh>
          <SText font={FONT.r} fontSize={16} color={P.keySub} letterSpacing={-.019} anchorX="left" anchorY="bottom-baseline" position={[x(66), y(40), 0]}>The</SText>
          <group position={[x(95.5), y(40), 0]} rotation={[0, 0, 4 * Math.PI / 180]}>
            <SText font={FONT.one} fontSize={26} color={P.keyInk} letterSpacing={-.046} anchorX="left" anchorY="bottom-baseline">One</SText>
            <mesh position={[50.5, 17.5, 0]}><circleGeometry args={[2.5, 16]} /><meshBasicMaterial color={col(P.keyInk)} /></mesh>
          </group>
          <SText font={FONT.r} fontSize={16} color={P.keyInk} anchorX="left" anchorY="bottom-baseline" position={[x(166), y(40), 0]}>Main chat</SText>
          <SText font={FONT.r} fontSize={16} color={P.keySub} anchorX="left" anchorY="bottom-baseline" position={[x(66), y(67), 0]}>Pick up the conversation</SText>
        </group>
      </group>
    </group>
  );
}
