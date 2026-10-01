// Quick stills without re-bundling per frame: node scripts/stills.mjs <light|dark> <t1,t2,…> [scale]
//   → out/stills/<theme>_<t>.jpg   (REMOTION_BROWSER / REMOTION_GL override the browser and GL backend)
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition, openBrowser } from '@remotion/renderer';
import path from 'node:path';
const [theme = 'light', ts = '0', scale = '1'] = process.argv.slice(2);
const id = theme === 'dark' ? 'TheOne-Dark' : 'TheOne-Light';
const browserExecutable = process.env.REMOTION_BROWSER || null;
const chromiumOptions = { gl: process.env.REMOTION_GL || 'angle' };
const serveUrl = await bundle({ entryPoint: path.resolve('src/index.ts'), publicDir: path.resolve('public') });
const puppeteerInstance = await openBrowser('chrome', { browserExecutable, chromiumOptions });
const composition = await selectComposition({ serveUrl, id, inputProps: { audio: false }, puppeteerInstance });
for (const t of ts.split(',')) {
  const out = `out/stills/${theme}_${(+t).toFixed(2)}.jpg`;
  await renderStill({ composition, serveUrl, output: out, frame: Math.round(+t * 60), scale: +scale, imageFormat: 'jpeg', jpegQuality: 92,
    inputProps: { audio: false }, puppeteerInstance, overwrite: true,
    onBrowserLog: process.env.LOG ? l => console.log('[browser]', l.type, l.text.slice(0, 300)) : undefined });
  console.log(out);
}
await puppeteerInstance.close({ silent: true });
