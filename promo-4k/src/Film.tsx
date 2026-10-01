import { AbsoluteFill, Audio, staticFile, useCurrentFrame, continueRender, delayRender } from 'remotion';
import { useEffect, useState } from 'react';
import '@fontsource/inter/300.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/nunito/700.css';
import '@fontsource/jetbrains-mono/500.css';
import './dom/film.css';
import { D, E, FPS, TOTAL, r, seg } from './lib/timeline';
import { WIN_OPEN, CLICK_DSH } from './lib/story';
import { shotAt } from './lib/shots';
import type { Theme } from './lib/theme';
import { Desktop } from './dom/Desktop';
import { WindowLayer } from './dom/WindowLayer';
import { EndCard, END_IN } from './dom/EndCard';
import { Motes } from './dom/Motes';
import { Scene3D } from './three/Scene3D';

export type FilmProps = { theme: Theme; audio?: boolean };
export const Film: React.FC<FilmProps> = ({ theme, audio = true }) => {
  const frame = useCurrentFrame(), t = frame / FPS;
  const [fonts] = useState(() => delayRender('fonts'));
  useEffect(() => { document.fonts.ready.then(() => continueRender(fonts)); }, [fonts]);
  const shot = shotAt(t);
  const flash = Math.max(t >= D ? 1 - E.o(seg(t, D, D + .55)) : 0,
    t >= r(28.4) ? (t < r(29) ? .95 * E.ie(seg(t, r(28.4), r(29))) : .95 * (1 - E.o(seg(t, r(29), r(29) + .7)))) : 0);
  return (
    <AbsoluteFill className="film" data-theme={theme}>
      {audio && <Audio src={staticFile('mix.wav')} />}
      <div className="backdrop" />
      {/* one window layer, always above the desktop; heavy layers mount early (still transparent) so that no
          scene change waits on a first render: a late mount shows as a flash at the cut */}
      {t < WIN_OPEN + .1 && <Desktop t={t} />}
      {t >= CLICK_DSH - .5 && t < r(12.5) && <WindowLayer t={t} shot={shot} theme={theme} />}
      {t >= D - 3 && t < END_IN + .5 && <Scene3D t={t} shot={shot} theme={theme} />}
      <Motes t={t} theme={theme} />
      {t >= END_IN - .5 && <EndCard t={t} theme={theme} />}
      <div className="flash" style={{ opacity: flash }} />
      <div className="vig" />
      <div className="fade" style={{ opacity: seg(t, TOTAL - .45, TOTAL) }} />
    </AbsoluteFill>
  );
};
