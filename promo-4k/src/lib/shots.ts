import { D, b, r, E, clamp, lerp, seg, type Ease } from './timeline';
import { ONE_W, KEY, ROUTER, CARDS, HIST, T_STOP, T_SLAM, T_UP0, T_UP1, WIN_OPEN, S_KEY } from './story';
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
function path(t: number, keys: [number, P, Ease?][]): P {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) { const [t1, p1, e] = keys[i]; if (t <= t1) { const [t0, p0] = keys[i - 1]; return mix(p0, p1, E[e ?? 'io'](clamp((t - t0) / (t1 - t0)))); } }
  return keys[keys.length - 1][1];
}

const WIDE: P = { tg: [0, -10, 0], zoom: .9, el: 0, az: 0, roll: 0 };
const SEARCH: P = { tg: [-170, -5, 0], zoom: 1.0, el: 4, az: -9, roll: 0 };
const SEARCH2: P = { ...SEARCH, zoom: 1.05, tg: [-185, -12, 0] };
const TOP: P = { tg: [ONE_W[0], ONE_W[1] - 8, 0], zoom: 2.75, el: -13, az: 0, roll: 0 };
const TOP2: P = { ...TOP, zoom: 3.05, el: -10 };
const kx = KEY[0], ky = KEY[1];
const REVEAL: P = { tg: [kx + 880, ky - 30, 0], zoom: .84, el: 12, az: -12, roll: -1.5 };
const ROUTE1: P = { tg: [kx + 900, ky - 30, 0], zoom: .86, el: 11, az: -10, roll: -1 };
const ROUTE2: P = { tg: [kx + 940, ky - 35, 0], zoom: .87, el: 11, az: -8, roll: -.5 };
const HISTV: P = { tg: [HIST.p[0], HIST.p[1] + 10, HIST.p[2]], zoom: .98, el: 9, az: -6, roll: 0 };
const HISTW: P = { ...HISTV, zoom: .9, el: 14 };
const KEYV: P = { tg: [kx, ky - 30, KEY[2] - 40], zoom: 1.75, el: 20, az: -24, roll: -2 };
const HERO: P = { tg: [kx, ky - 30, KEY[2] - 40], zoom: 1.9, el: 12, az: 26, roll: 2 };
const FACE: P = { tg: [kx, ky, KEY[2] + 30], zoom: 2.55, el: 0, az: 0, roll: 0 };
const INTO: P = { tg: [kx - 72 * S_KEY, ky + 12 * S_KEY, KEY[2] + 30], zoom: 11, el: 0, az: 0, roll: 0 };
void ROUTER; void CARDS;

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
    [D, TOP2], [r(1.6), REVEAL, 'oe'], [r(4), ROUTE1, 'io'], [r(8.6), ROUTE2, 'io'], [r(11.6), ROUTE2, 'l'],
    [r(12.8), HISTV, 'io'], [r(16.6), HISTV, 'l'], [r(17.2), HISTW, 'io'], [r(18.25), HISTW, 'l'], [r(19), KEYV, 'io'],
    [r(23.8), HERO, 'io'], [r(27.2), FACE, 'io'], [r(29), INTO, 'ie'],
  ]);
}
export const shotAt = (t: number) => toShot(camAt(t));
