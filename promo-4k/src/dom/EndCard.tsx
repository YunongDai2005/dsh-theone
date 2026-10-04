import { E, r, lerp, pulse, seg } from '../lib/timeline';
import { accent, css, type Theme } from '../lib/theme';
import { GITHUB } from './icons';

export const END_IN = r(28.85), LOGO = r(29);
export function EndCard({ t, theme }: { t: number; theme: Theme }) {
  const A = (a: number, g: number, c: number) => accent(theme, a, g, c);
  const k = seg(t, LOGO, LOGO + .6);
  // the logo's light swells on each bar's strongest hit (plus its own entrance)
  const P = Math.max(pulse(t), Math.exp(-Math.max(0, t - LOGO) * 3) * (t >= LOGO ? 1 : 0));
  const sc = lerp(1.12, 1, E.oe(k)) * (1 + .02 * P), hv = seg(t, LOGO, LOGO + .4);
  const up = (a: number): React.CSSProperties => { const p = seg(t, a, a + .4); return { opacity: p, transform: `translateY(${(1 - E.o(p)) * 24}px)` }; };
  const word = (cls: string, style: React.CSSProperties, oStyle?: React.CSSProperties, dStyle?: React.CSSProperties) =>
    <div className={cls} style={style}><span className="t">The</span><span className="o" style={oStyle}>One<span className="d" style={dStyle} /></span></div>;
  return (
    <div className="end" style={{ opacity: seg(t, END_IN, END_IN + .2) }}>
      <div className="erays" style={{ opacity: hv * (.10 + .26 * P), transform: `translate(-50%,-50%) rotate(${(t - LOGO) * 4}deg) scale(${1 + .06 * P})` }} />
      {word('ewm ewg', { opacity: hv * (.35 + .5 * P), transform: `scale(${sc})`, filter: `blur(${18 + 16 * P}px)` })}
      {word('ewm', { opacity: seg(t, LOGO, LOGO + .15), transform: `scale(${sc})` },
        { textShadow: `0 0 ${36 + 40 * P}px ${css(A(255, 140, 50), .3 + .35 * P)},0 0 ${110 + 90 * P}px ${css(A(255, 120, 30), .12 + .26 * P)}` },
        { boxShadow: `0 0 ${20 + 30 * P}px ${css(A(255, 140, 50), .55 + .4 * P)}` })}
      <div className="etag" style={up(r(30.25))}>One chat. Every context.</div>
      <div className="eurl" style={up(r(31))}>{GITHUB}<span>YunongDai2005/dsh-theone</span></div>
      <div className="edisc" style={up(r(31.5))}>Community plugin for DSH · unofficial</div>
    </div>
  );
}
