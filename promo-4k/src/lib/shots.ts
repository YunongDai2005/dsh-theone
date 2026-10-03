import { D, b, r, E, clamp, lerp, seg, type Ease } from './timeline';
import { ONE_W, KEY, ROUTER, CARDS, NEWC, HIST, CL, T_STOP, T_SLAM, T_UP0, T_UP1, WIN_OPEN, S_KEY } from './story';
import type { Shot } from './camera';
import { VH } from './camera';

/** Camera as an orbit around a target: zoom 1 = one world unit per screen px at the target. */
export interface P { tg: [number, number, number]; zoom: number; el: number; az: number; roll: number }
const FOV = 30, DIST1 = (VH / 2) / Math.tan(FOV / 2 * Math.PI / 180);
export function toShot(p: P): Shot {
  const d = DIST1 / p.zoom, el = p.el * Math.PI / 180, az = p.az * Math.PI / 180;
  return { pos: [p.tg[0] + d * Math.cos(el) * Math.sin(az), p.tg[1] + d * Math.sin(el), p.tg[2] + d * Math.cos(el) * Math.cos(az)], target: p.tg, roll: p.roll * Math.PI / 180, fov: FOV };
}
const mix = (a: P, c: P, f: number): P => ({ tg: a.tg.map((v, i) => lerp(v, c.tg[i], f)) as P['tg'], zoom: Math.exp(lerp(Math.log(a.zoom), Math.log(c.zoom), f)),
  el: lerp(a.el, c.el, f), az: lerp(a.az, c.az, f), roll: lerp(a.roll, c.roll, f) });
type Key = [number, P, (Ease | 'cut')?];
/** keyframed camera; a key marked 'cut' jumps to its shot at its time (a hard cut on the beat) */
function path(t: number, keys: Key[]): P {
  if (t < keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, p1, e] = keys[i];
    if (e === 'cut') { if (t < t1) return keys[i - 1][1]; continue; }
    if (t < t1) { const [t0, p0] = keys[i - 1]; return mix(p0, p1, E[e ?? 'io'](clamp((t - t0) / (t1 - t0)))); }
  }
  return keys[keys.length - 1][1];
}

const WIDE: P = { tg: [0, -10, 0], zoom: .9, el: 0, az: 0, roll: 0 };
const SEARCH: P = { tg: [-170, -5, 0], zoom: 1.0, el: 4, az: -9, roll: 0 };
const SEARCH2: P = { ...SEARCH, zoom: 1.05, tg: [-185, -12, 0] };
const TOP: P = { tg: [ONE_W[0], ONE_W[1] - 8, 0], zoom: 2.75, el: -13, az: 0, roll: 0 };
const TOP2: P = { ...TOP, zoom: 3.05, el: -10 };
const kx = KEY[0], ky = KEY[1];
const RX = ROUTER.p, CC = CARDS[4].p, C0 = CARDS[0].p, Z0 = KEY[2];
const at = (tg: readonly number[], zoom: number, el: number, az: number, roll = 0): P => ({ tg: [tg[0], tg[1], tg[2]], zoom, el, az, roll });
// wide establishing shots of the whole pipeline
const REVEAL = at([kx + 700, ky - 25, 0], .8, 12, -6, -1.5);
const ROUTE1 = at([kx + 700, ky - 20, 0], .82, 11, -4, -1);
// cut-ins on the hits: close on the key as a message arrives, over the router as the light lands, beside the cards
const KCLOSE_A = at([kx + 40, ky + 50, Z0], 1.9, 6, -20, -2), KCLOSE_A2 = at([kx + 60, ky + 40, Z0], 2.05, 5, -16, -2);
const RTOP_A = at(RX, 1.45, 36, -10, -1);
const CSIDE = at([(RX[0] + C0[0]) / 2, (RX[1] + C0[1]) / 2, -100], 1.2, 18, 30, 2), CSIDE2 = { ...CSIDE, zoom: 1.32 };
const WIDE_B = at([kx + 720, ky - 20, 0], .84, 10, 6, 1), WIDE_B2 = { ...WIDE_B, zoom: .88, az: 3 };
const KCLOSE_B = at([kx - 20, ky + 50, Z0], 1.85, 4, 22, 2), KCLOSE_B2 = { ...KCLOSE_B, zoom: 2.0 };
const RTOP_B = at(RX, 1.4, 40, 8, 1);
const GRIDTOP = at([CC[0], CC[1] - 20, CC[2]], 1.2, 58, -4, 0), GRIDTOP2 = { ...GRIDTOP, zoom: 1.32 };
const BURST = at([kx + 760, ky - 20, 0], .72, 14, -2, -1);
// history: wide, then cut close on each pair of slots as titles land in them
const HISTV = at([HIST.p[0], HIST.p[1] + 10, HIST.p[2]], .98, 9, -6);
const HIST_L = at([(CL[0].p[0] + CL[1].p[0]) / 2, CL[0].p[1] + 10, CL[0].p[2]], 1.6, 10, -12, -1), HIST_L2 = { ...HIST_L, zoom: 1.72 };
const HIST_R = at([(CL[2].p[0] + CL[3].p[0]) / 2, CL[2].p[1] + 10, CL[2].p[2]], 1.6, 10, 12, 1);
const HISTW = { ...HISTV, zoom: .9, el: 14 };
const KEYV = at([kx, ky - 30, Z0 - 40], 1.75, 20, -24, -2);
// hero: the finished key, a low close angle, then a high one from the other side
const HERO_A = at([kx, ky - 20, Z0 - 30], 2.2, -6, -32, -3), HERO_A2 = at([kx, ky - 20, Z0 - 30], 2.0, 8, -4, 0);
const HERO_B = at([kx, ky - 30, Z0 - 40], 1.85, 30, 36, 3), HERO_B2 = at([kx, ky - 30, Z0 - 40], 1.95, 18, 16, 1);
const FACE = at([kx, ky, Z0 + 30], 2.55, 0, 0);
const INTO = at([kx - 72 * S_KEY, ky + 12 * S_KEY, Z0 + 30], 11, 0, 0);
void CARDS; void NEWC;

export function camAt(t: number): P {
  if (t < D) {
    let p = path(t, [[WIN_OPEN, WIDE], [b(6), SEARCH, 'io'], [T_STOP, SEARCH2, 'l']]);
    // anger: a hand-held shake that builds, then the slam jolts it
    const sh = t > T_STOP && t < T_SLAM + .6 ? (E.io(seg(t, T_STOP, T_SLAM)) + 2.2 * Math.exp(-Math.max(0, t - T_SLAM) * 9) * (t > T_SLAM ? 1 : 0)) * (1 - seg(t, T_SLAM + .3, T_SLAM + .6)) : 0;
    const n1 = Math.sin(t * 61) * .6 + Math.sin(t * 37 + 1) * .4, n2 = Math.sin(t * 53 + 2) * .6 + Math.sin(t * 29) * .4;
    p = { ...p, tg: [p.tg[0] + sh * 3.2 * n1 / p.zoom * 1.6, p.tg[1] + sh * 3.2 * n2 / p.zoom * 1.6, 0], roll: p.roll + sh * .35 * Math.sin(t * 43) };
    // rise and swing to a slight low angle on The One, then a slow push
    const top = path(t, [[T_UP1, TOP], [D, TOP2, 'io']]);
    return mix(p, top, E.ioe(seg(t, T_UP0, T_UP1)));
  }
  return path(t, [
    [D, TOP2], [r(1.6), REVEAL, 'oe'], [r(4), ROUTE1, 'io'],
    // SWAP: message at the key → light down to the router → beside the cards as it lands → wide for the reply
    [r(4), KCLOSE_A, 'cut'], [r(4.4), KCLOSE_A2, 'l'], [r(5), RTOP_A, 'iq'],
    [r(5), CSIDE, 'cut'], [r(6.25), CSIDE2, 'l'],
    [r(6.25), WIDE_B, 'cut'], [r(8), WIDE_B2, 'l'],
    // CREATE: same rhythm from the other side, landing on a top-down view of the grid filling its empty slot
    [r(8), KCLOSE_B, 'cut'], [r(8.4), KCLOSE_B2, 'l'], [r(9), RTOP_B, 'iq'],
    [r(9), GRIDTOP, 'cut'], [r(10.25), GRIDTOP2, 'l'],
    [r(10.6), BURST, 'oe'], [r(11.6), BURST, 'l'],
    // history
    [r(12.8), HISTV, 'io'], [r(13), HISTV, 'l'], [r(13), HIST_L, 'cut'], [r(14.9), HIST_L2, 'l'],
    [r(15), HIST_R, 'cut'], [r(15.6), HIST_R, 'l'], [r(16.6), HISTV, 'io'], [r(17.2), HISTW, 'io'],
    [r(18.25), HISTW, 'l'], [r(19), KEYV, 'io'],
    // hero
    [r(19), HERO_A, 'cut'], [r(21), HERO_A2, 'io'], [r(21), HERO_B, 'cut'], [r(24), HERO_B2, 'io'],
    [r(27.2), FACE, 'io'], [r(29), INTO, 'ie'],
  ]);
}
export const shotAt = (t: number) => toShot(camAt(t));
