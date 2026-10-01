import { D, rng, seg } from '../lib/timeline';
import { T_UP1 } from '../lib/story';
import { accent, css, type Theme } from '../lib/theme';
const M = (() => { const r0 = rng(21); return Array.from({ length: 60 }, () => ({ x: r0() * 1920, y: r0() * 1080, sp: 20 + r0() * 70, ph: r0() * 6, s: .4 + r0() * 1.1 })); })();
/** dust in the light before the click (screen space) */
export function Motes({ t, theme }: { t: number; theme: Theme }) {
  const mv = t > T_UP1 && t < D + .3 ? seg(t, T_UP1, T_UP1 + 1) * (1 - seg(t, D, D + .3)) : 0;
  if (!mv) return null;
  const c = accent(theme, 255, 176, 102), g = accent(theme, 255, 150, 60);
  return <div className="motes">{M.map((m, i) => {
    const y = ((m.y - (t - T_UP1) * m.sp) % 1080 + 1080) % 1080;
    return <div key={i} className="mote" style={{ background: css(c), boxShadow: `0 0 12px 3px ${css(g, .55)}`, opacity: mv * (.35 + .65 * Math.abs(Math.sin(t * 1.7 + m.ph))),
      transform: `translate(${m.x + 14 * Math.sin(t + m.ph)}px,${y}px) scale(${m.s})` }} />;
  })}</div>;
}
