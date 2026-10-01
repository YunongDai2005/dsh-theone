import { Composition } from 'remotion';
import { Film, type FilmProps } from './Film';
import { FPS, FRAMES } from './lib/timeline';

// 1920×1080 design, rendered with --scale=2 for 3840×2160 (DOM text and WebGL both rasterize at 4K)
export const Root = () => <>
  <Composition id="TheOne-Light" component={Film} durationInFrames={FRAMES} fps={FPS} width={1920} height={1080} defaultProps={{ theme: 'light' } as FilmProps} />
  <Composition id="TheOne-Dark" component={Film} durationInFrames={FRAMES} fps={FPS} width={1920} height={1080} defaultProps={{ theme: 'dark' } as FilmProps} />
</>;
