import { E, b, clamp, seg, track } from '../lib/timeline';
import { CLICK_DSH, WIN_OPEN } from '../lib/story';
import { ARROW, svg } from './icons';

const DOCK_X = [724, 824, 924, 1024, 1124];
export const ICON = { x: DOCK_X[3] + 36, y: 1016 };
function cursorPath(t: number): [number, number] {
  const u = E.io(seg(t, .25, CLICK_DSH - .08)), m = 1 - u;
  const P = [[1520, 300], [1560, 760], [1240, 930], [ICON.x + 6, ICON.y + 4]];
  return [0, 1].map(k => m * m * m * P[0][k] + 3 * m * m * u * P[1][k] + 3 * m * u * u * P[2][k] + u * u * u * P[3][k]) as [number, number];
}
/** desktop camera: centre and zoom, shared with the window-open animation */
export function deskCam(t: number) {
  const z = track(t, [[0, 1.14], [CLICK_DSH, 1.24], [WIN_OPEN, 1.04, 'o']]);
  const c = cursorPath(Math.max(0, t - .14));
  const cx = clamp((c[0] + ICON.x) / 2, 960 / z, 1920 - 960 / z), cy = clamp((c[1] + ICON.y) / 2 - 60, 540 / z, 1080 - 540 / z);
  return { z, cx, cy };
}
export const toScreen = (t: number, x: number, y: number): [number, number] => { const c = deskCam(t); return [(x - c.cx) * c.z + 960, (y - c.cy) * c.z + 540]; };

export function Desktop({ t }: { t: number }) {
  const { z, cx, cy } = deskCam(t), cur = cursorPath(t), [sx, sy] = toScreen(t, cur[0], cur[1]);
  const press = Math.abs(t - CLICK_DSH) < .07, bounce = t > CLICK_DSH ? 1 - .1 * Math.sin(seg(t, CLICK_DSH, CLICK_DSH + .35) * Math.PI) : 1;
  const icons = [
    <svg viewBox="0 0 100 100"><path d="M24 34a6 6 0 0 1 6-6h14l6 6h20a6 6 0 0 1 6 6v26a6 6 0 0 1-6 6H30a6 6 0 0 1-6-6z" fill="#fff" opacity=".92" /></svg>,
    <svg viewBox="0 0 100 100"><g stroke="#b88a1a" strokeWidth="3" opacity=".6"><path d="M26 40h48M26 52h48M26 64h34" /></g></svg>,
    <svg viewBox="0 0 100 100"><path d="M44 30v32a8 8 0 1 1-5-7.4V36l22-5v24a8 8 0 1 1-5-7.4V31" stroke="#fff" strokeWidth="5" fill="none" strokeLinecap="round" /></svg>,
    null,
    <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="24" stroke="#fff" strokeWidth="4" fill="none" /><path d="M58 42l-6 14-14 6 6-14z" fill="#fff" /></svg>,
  ];
  const bg = ['linear-gradient(180deg,#6cc6ff,#1f7ae0)', 'linear-gradient(180deg,#fff6cf,#ffd45c)', 'linear-gradient(180deg,#ff7a8a,#e2334f)', '', 'linear-gradient(180deg,#8fe0b0,#18a058)'];
  return (
    <div className="desk">
      <div className="deskWorld" style={{ transform: `translate(960px,540px) scale(${z}) translate(${-cx}px,${-cy}px)`,
        filter: `blur(${4 * seg(t, CLICK_DSH + .1, b(3.9))}px) brightness(${1 - .15 * seg(t, CLICK_DSH, b(3.9))})` }}>
        <div className="wall" />
        <div className="menubar"><span style={{ fontSize: 16 }}></span><b>Finder</b><span>File</span><span>Edit</span><span>View</span><span>Go</span><span>Window</span><span className="sp" /><span>Tue 9:41</span></div>
        <div className="dock" />
        {DOCK_X.map((x, i) => i === 3
          ? <div key={i} className="dicon dsh" style={{ left: x, transform: `scale(${press ? .92 : 1}) translateY(${(1 - bounce) * 140}px)` }} dangerouslySetInnerHTML={{ __html: svg('Fish') }} />
          : <div key={i} className="dicon" style={{ left: x, background: bg[i] }}>{icons[i]}</div>)}
        <div className="ddot" style={{ left: DOCK_X[0] + 34 }} />
        <div className="ddot" style={{ left: DOCK_X[3] + 34, opacity: seg(t, CLICK_DSH + .1, CLICK_DSH + .2) }} />
      </div>
      <div className="dcur" style={{ transform: `translate(${sx - 3 * z}px,${sy - 3 * z}px) scale(${z * (press ? .86 : 1)})`,
        opacity: seg(t, .1, .35) * (1 - seg(t, CLICK_DSH + .15, CLICK_DSH + .3)) }}>{ARROW}</div>
    </div>
  );
}
