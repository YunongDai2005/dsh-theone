import * as THREE from 'three';
import { useEffect, useMemo } from 'react';
import { D, E, r, lerp, seg, pulse, land, lastHit, rng, clamp } from '../lib/timeline';
import { KEY, KEY_Z, S_KEY, ONE, ONE_W, ROUTER, CARDS, CARD, NEWC, HIST, CL, SLOT, CHIP_T, CHIP_CL } from '../lib/story';
import { accent, PAL, type Theme } from '../lib/theme';
import { Key } from './Key';
import { SText, FONT, col, hdr, panelGeo, ringGeo, roundedRect, Shadow } from './util';

type V3 = [number, number, number];
const L3 = (a: V3 | readonly number[], c: V3 | readonly number[], k: number): V3 => [lerp(a[0], c[0], k), lerp(a[1], c[1], k), lerp(a[2], c[2], k)];

function Panel({ w, h, rad, theme, o, edge, children, shadow = .14 }: { w: number; h: number; rad: number; theme: Theme; o: number; edge?: THREE.Color; children?: React.ReactNode; shadow?: number }) {
  const P = PAL[theme];
  if (o <= .002) return null;
  return <group>
    <Shadow w={w} h={h} o={o * (theme === 'dark' ? .55 : shadow)} />
    <mesh geometry={panelGeo(w, h, rad)}><meshBasicMaterial color={col(P.glass)} transparent opacity={o * .96} depthWrite={false} /></mesh>
    <mesh geometry={ringGeo(w, h, rad, 1.5)} position={[0, 0, .2]}><meshBasicMaterial color={edge ?? col(theme === 'dark' ? '#3a3d45' : '#dfe3ea')} transparent opacity={o} depthWrite={false} /></mesh>
    <group position={[0, 0, .5]}>{children}</group>
  </group>;
}
/** a straight beam between two points (thin cylinder) */
function Beam({ a, b, color, o, rad = 1.4 }: { a: V3; b: V3; color: THREE.Color; o: number; rad?: number }) {
  const { pos, quat, len } = useMemo(() => {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b), d = vb.clone().sub(va);
    return { pos: va.clone().add(vb).multiplyScalar(.5), quat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()), len: d.length() };
  }, [a[0], a[1], a[2], b[0], b[1], b[2]]); // eslint-disable-line react-hooks/exhaustive-deps
  if (o <= .002) return null;
  return <mesh position={pos} quaternion={quat}><cylinderGeometry args={[rad, rad, len, 8, 1, true]} /><meshBasicMaterial color={color} toneMapped={false} transparent opacity={o} depthWrite={false} /></mesh>;
}
/** a rounded-rect wavefront whose size changes every frame */
function Wave({ p, w, h, color, o }: { p: V3; w: number; h: number; color: THREE.Color; o: number }) {
  const wq = Math.round(w / 2) * 2, hq = Math.round(h / 2) * 2;
  const geo = useMemo(() => { const s = roundedRect(wq + 3, hq + 3, 16) as THREE.Shape; s.holes.push(roundedRect(wq - 3, hq - 3, 13, new THREE.Path())); return new THREE.ShapeGeometry(s, 8); }, [wq, hq]);
  useEffect(() => () => geo.dispose(), [geo]);
  if (o <= .002) return null;
  return <mesh geometry={geo} position={p}><meshBasicMaterial color={color} toneMapped={false} transparent opacity={o} depthWrite={false} /></mesh>;
}

const CHIPS = CHIP_T.map((title, i) => { const r0 = rng(100 + i); return { title, i, cl: CHIP_CL[i], k: i % 3, ph: r0() * 6, w: Math.round(title.length * 13.2 + 34) }; });

export function World({ t, theme, camQ }: { t: number; theme: Theme; camQ: THREE.Quaternion }) {
  const P = PAL[theme], dark = theme === 'dark';
  const A = (a: number, g: number, c: number) => accent(theme, a, g, c);
  const post = t >= D;
  // ---- the key lifts out of the sidebar and grows
  const liftZ = lerp(0, KEY_Z, E.oe(seg(t, D, r(1.2)))), liftS = lerp(1, S_KEY, E.oe(seg(t, D, r(1.4))));
  const TH = 28 * E.oe(seg(t, D, r(1)));
  const flare = Math.max(t > r(19) - .3 ? Math.exp(-Math.max(0, t - r(19)) * 4) * (t > r(19) ? 1 : seg(t, r(19) - .3, r(19))) : 0, E.ie(seg(t, r(28.2), r(29))));
  const gI = Math.min(1.6, .55 + .5 * pulse(t) + flare);
  // ---- the structure behind it
  const dimC = (1 - .82 * E.io(seg(t, r(11.6), r(12.3)))) * (1 - .9 * E.io(seg(t, r(18.25), r(19.2))));
  const app = (t0: number) => E.oe(seg(t, t0 - .08, t0 + .4));
  const ra = app(r(1)), routerP = L3(KEY, ROUTER.p, ra);
  const hot0 = t > r(6.25) && t < r(8), hot1 = t > r(10.25) && t < r(12);
  const nk = seg(t, r(10.25) - .1, r(10.25) + .35);
  const ha = app(r(3)), histP = L3(CARDS[4].p, HIST.p, ha);
  // ---- the routing light, level by level, accelerating into each landing
  const KR = { p: [KEY[0], KEY[1], liftZ] as V3, w: ONE.w * liftS, h: ONE.h * liftS };
  const RR = { p: ROUTER.p, w: ROUTER.w, h: ROUTER.h };
  const C0 = { p: CARDS[0].p, w: CARD.w, h: CARD.h }, CN = { p: NEWC.p, w: CARD.w, h: CARD.h };
  const LEGS: [number, number, typeof KR, typeof KR, boolean][] = [[r(4.4), r(5), KR, RR, true], [r(5.15), r(6.25), RR, C0, true], [r(6.4), r(7), C0, KR, false], [r(8.4), r(9), KR, RR, true], [r(9.15), r(10.25), RR, CN, true]];
  const waves: { p: V3; w: number; h: number; o: number }[] = []; let orb: V3 | null = null;
  for (const [a0, a1, Sx, Tx, wave] of LEGS) {
    if (t >= a0 && t <= a1 + .05) { const k = E.iq(seg(t, a0, a1)); orb = L3(Sx.p, Tx.p, k); }
    if (wave && t >= a0 - .05 && t <= a1 + .35) {
      const sw = seg(t, a0 - .05, a0 + .1) * (1 - seg(t, a1 + .05, a1 + .35)), uu = lerp(.05, 1, E.iq(seg(t, a0, a1)));
      for (let i = 0; i < 3; i++) { const u = uu - i * .075; if (u < 0) continue; waves.push({ p: L3(Sx.p, Tx.p, u), w: lerp(Sx.w, Tx.w, u), h: lerp(Sx.h, Tx.h, u), o: sw * (.75 - i * .25) }); }
    }
  }
  const hotR = Math.max(land(t, r(5)) * (1 - seg(t, r(5.6), r(6))), land(t, r(9)) * (1 - seg(t, r(9.6), r(10))));
  const hC0 = land(t, r(6.25), .55) * (1 - seg(t, r(7.8), r(8.2))), hC1 = land(t, r(10.25), .55) * (1 - seg(t, r(11.6), r(12)));
  const bo = post ? seg(t, r(3.2), r(4)) * (1 - seg(t, r(11.6), r(12.2))) : 0;
  const warm = A(255, 150, 60), beamC = col(P.beam), hotBeam = hdr(warm, 1.3);
  // ---- history: titles tumble, snap into four topic slots, square up into a deck, dock under the key
  const deckOf = (i: number) => {
    const g = E.io(seg(t, r(17) - .05 + i * .04, r(17) + .32 + i * .04)), sq = E.io(seg(t, r(17.5) - .05, r(17.5) + .35)), kl = E.ie(seg(t, r(18.25), r(19)));
    const form: V3 = [lerp(CL[i].p[0], HIST.p[0] + (i - 1.5) * 4 * (1 - sq), g), lerp(CL[i].p[1], HIST.p[1] + (i - 1.5) * 3 * (1 - sq), g), lerp(CL[i].p[2], HIST.p[2] + 10 + i * 7, g)];
    const dock: V3 = [KEY[0], KEY[1], KEY_Z - 9 - (3 - i) * 8];
    return { g, sq, kl, p: L3(form, dock, kl), rot: g * (1 - sq) * (i - 1.5) * 2.5 * (1 - kl), sx: lerp(1, ONE.w * S_KEY / SLOT.w, sq), sy: lerp(1, ONE.h * S_KEY / SLOT.h, sq) };
  };
  const slotO = seg(t, r(11.7), r(12.2));
  const bub = ([[r(4), r(5.2), 'Kyoto, day 3?', 0], [r(7), r(8), 'Arashiyama at 9 am.', 1], [r(8), r(9.2), 'New topic: a cat feeder', 0]] as [number, number, string, number][]);
  const bubP: V3 = [KEY[0], KEY[1] + ONE.h * liftS / 2 + 58, liftZ + 20];
  const tagO = (t0: number, t1: number) => seg(t, t0, t0 + .1) * (1 - seg(t, t1, t1 + .1)) * (1 - seg(t, r(11.5), r(12)));
  const hit0 = lastHit(t), su = (t - hit0) / .6;

  return (
    <group visible={post}>
      {/* the key */}
      <group position={[ONE_W[0], ONE_W[1], liftZ]} scale={[liftS, liftS, liftS]}>
        <Key theme={theme} th={TH} glow={gI} heat={Math.min(1, pulse(t) + flare) * .6} />
      </group>
      {/* router */}
      {ra > 0 && <group position={routerP}><Panel w={ROUTER.w} h={ROUTER.h} rad={22} theme={theme} o={ra * dimC}>
        <SText font={FONT.mono} fontSize={15} letterSpacing={.2} color={P.sub} anchorX="left" anchorY="top" position={[-ROUTER.w / 2 + 26, ROUTER.h / 2 - 20, 0]} fillOpacity={ra * dimC}>ROUTER</SText>
        <mesh><ringGeometry args={[81, 82.5, 96]} /><meshBasicMaterial color={col(dark ? '#5d6472' : '#c5cbd8')} transparent opacity={ra * dimC} /></mesh>
        <mesh><ringGeometry args={[55, 56.5, 96]} /><meshBasicMaterial color={col(dark ? '#6d7686' : '#aab3c4')} transparent opacity={ra * dimC * .8} /></mesh>
        <mesh position={[0, 0, .3]}><circleGeometry args={[9, 32]} /><meshBasicMaterial color={hdr(warm, 1 + 2 * hotR)} toneMapped={false} transparent opacity={ra * dimC} /></mesh>
        <SText font={FONT.mono} fontSize={34} letterSpacing={.18} color={`rgb(${A(224, 112, 31).join(',')})`} anchorX="center" anchorY="bottom" position={[0, -ROUTER.h / 2 + 26, .4]} fillOpacity={tagO(r(5), r(9) - .1) * dimC}>SWAP</SText>
        <SText font={FONT.mono} fontSize={34} letterSpacing={.18} color={`rgb(${A(224, 112, 31).join(',')})`} anchorX="center" anchorY="bottom" position={[0, -ROUTER.h / 2 + 26, .4]} fillOpacity={tagO(r(9), r(99)) * dimC}>CREATE</SText>
        <mesh geometry={ringGeo(ROUTER.w + 2, ROUTER.h + 2, 23, 2.4)} position={[0, 0, .3]}><meshBasicMaterial color={hdr(warm, 3.2)} toneMapped={false} transparent opacity={hotR * ra * dimC} /></mesh>
      </Panel></group>}
      {/* sessions */}
      {CARDS.map((c, i) => {
        const ca = app(r(2.25) + (i % 3) * .03 + Math.floor(i / 3) * .03), o = ca * dimC, hot = i === 0 ? hC0 : 0;
        if (o <= .002) return null;
        return <group key={i} position={L3(ROUTER.p, c.p, ca)}><Panel w={CARD.w} h={CARD.h} rad={16} theme={theme} o={o} edge={i === 0 && hot0 ? col(`rgb(${A(255, 176, 112).join(',')})`) : undefined}>
          <SText font={FONT.sb} fontSize={22} color={P.ink} anchorX="left" anchorY="top" position={[-CARD.w / 2 + 20, CARD.h / 2 - 18, 0]} fillOpacity={o}>{c.title}</SText>
          <mesh position={[-CARD.w / 2 + 20 + (70 + (i * 37) % 25) * 1.9 / 2, 6, 0]}><planeGeometry args={[(70 + (i * 37) % 25) * 1.9, 8]} /><meshBasicMaterial color={col(dark ? '#33363d' : '#e8ebf0')} transparent opacity={o} /></mesh>
          <mesh position={[-CARD.w / 2 + 20 + (45 + (i * 53) % 35) * 1.9 / 2, -15, 0]}><planeGeometry args={[(45 + (i * 53) % 35) * 1.9, 8]} /><meshBasicMaterial color={col(dark ? '#33363d' : '#e8ebf0')} transparent opacity={o} /></mesh>
          <SText font={FONT.mono} fontSize={13} color={P.sub} anchorX="left" anchorY="bottom" position={[-CARD.w / 2 + 20, -CARD.h / 2 + 16, 0]} fillOpacity={o}>{`session ${String(i + 1).padStart(2, '0')}`}</SText>
          <mesh geometry={ringGeo(CARD.w + 2, CARD.h + 2, 17, 2.2)} position={[0, 0, .3]}><meshBasicMaterial color={hdr(warm, 3 * (1 + .4 * pulse(t)))} toneMapped={false} transparent opacity={hot * o} /></mesh>
        </Panel></group>;
      })}
      {nk > 0 && <group position={NEWC.p} scale={lerp(.6, 1, E.ob(nk))}><Panel w={CARD.w} h={CARD.h} rad={16} theme={theme} o={Math.min(1, nk * 3) * dimC} edge={hot1 ? col(`rgb(${A(255, 176, 112).join(',')})`) : undefined}>
        <SText font={FONT.sb} fontSize={22} color={P.ink} anchorX="left" anchorY="top" position={[-CARD.w / 2 + 20, CARD.h / 2 - 18, 0]} fillOpacity={Math.min(1, nk * 3) * dimC}>{NEWC.title}</SText>
        <mesh position={[-CARD.w / 2 + 20 + 57, 6, 0]}><planeGeometry args={[114, 8]} /><meshBasicMaterial color={col(dark ? '#33363d' : '#e8ebf0')} transparent opacity={Math.min(1, nk * 3) * dimC} /></mesh>
        <SText font={FONT.mono} fontSize={13} color={P.sub} anchorX="left" anchorY="bottom" position={[-CARD.w / 2 + 20, -CARD.h / 2 + 16, 0]} fillOpacity={Math.min(1, nk * 3) * dimC}>new session</SText>
        <mesh geometry={ringGeo(CARD.w + 2, CARD.h + 2, 17, 2.2)} position={[0, 0, .3]}><meshBasicMaterial color={hdr(warm, 3 * (1 + .4 * pulse(t)))} toneMapped={false} transparent opacity={hC1 * dimC} /></mesh>
      </Panel></group>}
      {/* beams */}
      <Beam a={[KEY[0], KEY[1], liftZ - 4]} b={ROUTER.p} color={hotBeam} o={bo} rad={1.8} />
      {CARDS.map((c, i) => <Beam key={i} a={ROUTER.p} b={c.p} color={i === 0 && hot0 ? hotBeam : beamC} o={bo * (i === 0 && hot0 ? 1 : .35) * dimC} />)}
      <Beam a={ROUTER.p} b={NEWC.p} color={hot1 ? hotBeam : beamC} o={post ? bo * Math.min(1, nk * 2) * (hot1 ? 1 : .35) * dimC : 0} />
      {waves.map((w, i) => <Wave key={i} p={w.p} w={w.w} h={w.h} color={hdr(A(255, 170, 95), 2.2)} o={w.o * .55} />)}
      {orb && <group position={orb}>
        <mesh><sphereGeometry args={[9, 24, 16]} /><meshBasicMaterial color={hdr([255, 250, 240], 6)} toneMapped={false} /></mesh>
        <mesh><sphereGeometry args={[14, 24, 16]} /><meshBasicMaterial color={hdr(A(255, 138, 42), 3)} toneMapped={false} transparent opacity={.5} depthWrite={false} /></mesh>
      </group>}
      {/* chat bubbles over the key, always facing the camera */}
      {bub.map(([t0, t1, text, reply], i) => {
        const o = seg(t, t0, t0 + .08) * (1 - seg(t, t1 - .12, t1)); if (o <= .002) return null;
        const k = E.ob(seg(t, t0, t0 + .25)), w = text.length * 16 + 52;
        return <group key={i} position={bubP} quaternion={camQ} scale={lerp(.7, 1, k)}>
          <Shadow w={w} h={62} o={o * (dark ? .5 : .16)} dy={-8} />
          <mesh geometry={panelGeo(w, 62, 24)}><meshBasicMaterial color={col(reply ? (dark ? '#1d2a37' : '#edf2fc') : (dark ? '#2c2c2e' : '#ffffff'))} transparent opacity={o} depthTest={false} /></mesh>
          <SText font={FONT.m} fontSize={31} color={dark ? '#f0f2f5' : '#111111'} anchorX="center" anchorY="middle" position={[0, 0, .5]} fillOpacity={o} material-depthTest={false}>{text}</SText>
        </group>;
      })}
      {/* history sheet */}
      {ha > 0 && <group position={histP}><Panel w={HIST.w} h={HIST.h} rad={10} theme={theme} o={ha * (1 - seg(t, r(17), r(17.4))) * (1 - .45 * seg(t, r(4), r(5)) * (1 - seg(t, r(11), r(11.8))))} shadow={.1}>
        <SText font={FONT.mono} fontSize={15} letterSpacing={.2} color={P.sub} anchorX="left" anchorY="top" position={[-HIST.w / 2 + 26, HIST.h / 2 - 20, 0]}>HISTORY</SText>
      </Panel></group>}
      {/* topic slots → deck */}
      {slotO > 0 && t < r(26) && CL.map((c, i) => {
        const d = deckOf(i), o = slotO;
        const warmK = d.sq, base = dark ? [32, 34, 40] : [255, 255, 255], warmC = dark ? [40 + i * 6, 62 + i * 9, 86 + i * 12] : [214 + i * 6, 132 + i * 8, 70 + i * 8];
        const fill = base.map((v, j) => Math.round(lerp(v, warmC[j], warmK))) as [number, number, number];
        return <group key={i} position={d.p} rotation={[0, 0, d.rot * Math.PI / 180]} scale={[d.sx, d.sy, 1]}>
          {d.g < .5 && <Shadow w={SLOT.w} h={SLOT.h} o={o * (dark ? .45 : .1) * (1 - d.g * 2)} />}
          <mesh geometry={panelGeo(SLOT.w, SLOT.h, 18)}><meshBasicMaterial color={col(fill)} transparent opacity={o * lerp(.9, 1, d.sq)} /></mesh>
          <mesh geometry={ringGeo(SLOT.w, SLOT.h, 18, 2)} position={[0, 0, .2]}><meshBasicMaterial color={col(dark ? '#4e7194' : '#e9b083')} transparent opacity={o * lerp(.5, .8, d.sq)} /></mesh>
          <SText font={FONT.mono} fontSize={28} letterSpacing={.1} color={`rgb(${A(216, 104, 26).join(',')})`} anchorX="center" anchorY="top" position={[0, SLOT.h / 2 - 16, .4]}
            fillOpacity={o * (.35 + .65 * seg(t, c.t, c.t + .15)) * (1 - seg(t, r(17.5), r(17.5) + .2))}>{c.name}</SText>
          {d.kl > .9 && <mesh geometry={ringGeo(SLOT.w + 2, SLOT.h + 2, 18, 3)} position={[0, 0, .3]}><meshBasicMaterial color={hdr(warm, 2 + 2 * gI)} toneMapped={false} transparent opacity={(d.kl - .9) * 10 * .5} /></mesh>}
        </group>;
      })}
      {CHIPS.map(c => {
        if (t <= r(11.6) || t >= r(18.4)) return null;
        const Cc = CL[c.cl], k = E.oe(seg(t, Cc.t - .1, Cc.t + .3)), tin = E.o(seg(t, r(11.6) + c.i * .03, r(12.3) + c.i * .03));
        const th = c.ph + (t - r(11.6)) * (1.1 + (c.i % 4) * .35) * (c.i % 2 ? 1 : -1), rad = lerp(1400, 260 + (c.i % 5) * 70, tin) + 40 * Math.sin(t * 3 + c.ph);
        const free: V3 = [HIST.p[0] + Math.cos(th) * rad, HIST.p[1] + 40 + Math.sin(th) * rad * .55, HIST.p[2] + 160 + 90 * Math.sin(t * 1.7 + c.ph * 2)];
        const slotP: V3 = [Cc.p[0], Cc.p[1] + 50 - c.k * 56, Cc.p[2] + 6];
        let p = L3(free, slotP, k), sc = 1;
        const q = 1 - k, rz = q * (28 * Math.sin(t * 2.3 + c.ph * 3) + (c.i % 2 ? 14 : -14)), rx = q * 70 * Math.sin(t * 1.9 + c.ph), ry = q * 55 * Math.cos(t * 1.3 + c.ph * 2);
        if (t >= r(17) - .05) { const d = deckOf(c.cl); p = [d.p[0] + (slotP[0] - Cc.p[0]) * d.sx, d.p[1] + (slotP[1] - Cc.p[1]) * d.sy, d.p[2] + 2]; sc = d.sx; }
        const o = seg(t, r(11.6), r(11.9)) * (1 - seg(t, r(17.5), r(17.5) + .25));
        return <group key={c.i} position={p} rotation={[rx * Math.PI / 180, ry * Math.PI / 180, rz * Math.PI / 180]} scale={[sc, sc, 1]}>
          <Shadow w={c.w} h={46} o={o * (dark ? .4 : .1)} dy={-6} />
          <mesh geometry={panelGeo(c.w, 46, 12)}><meshBasicMaterial color={col(P.chip)} transparent opacity={o} side={THREE.DoubleSide} /></mesh>
          <mesh geometry={ringGeo(c.w, 46, 12, 1.2)} position={[0, 0, .2]}><meshBasicMaterial color={col(dark ? '#3a3d45' : '#dde1e8')} transparent opacity={o} side={THREE.DoubleSide} /></mesh>
          <SText font={FONT.r} fontSize={25} color={P.ink} anchorX="center" anchorY="middle" position={[0, 0, .4]} fillOpacity={o}>{c.title}</SText>
        </group>;
      })}
      {/* a light sweep across the key face on each strong hit */}
      <group position={[ONE_W[0], ONE_W[1], liftZ + (TH + 3.6) * liftS]} scale={[liftS, liftS, 1]}>
        {su >= 0 && su <= 1 && post && <mesh position={[lerp(ONE.w * .65, -ONE.w * .65, E.io(clamp(su))), 0, 0]} rotation={[0, 0, -.35]}>
          <planeGeometry args={[34, ONE.h * 1.6]} /><meshBasicMaterial color={dark ? '#cfe6ff' : '#ffffff'} transparent opacity={Math.sin(Math.PI * su) * .55} depthWrite={false} />
        </mesh>}
      </group>
    </group>
  );
}
