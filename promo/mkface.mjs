// Pre-render The One key face as a high-resolution bitmap (face.png) with a transparent outside.
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { launch } from './pw.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const SCALE = +(process.env.FACE_SCALE || 8);
const b = await launch(); const p = await b.newPage({ viewport: { width: 400, height: 140 }, deviceScaleFactor: SCALE });
const THEME = process.env.THEME || 'light';
await p.goto(pathToFileURL(path.join(here, 'film.html')).href + (THEME === 'dark' ? '?theme=dark' : ''));
await p.evaluate(() => window.warm());
await p.evaluate(() => {
  document.head.insertAdjacentHTML('beforeend', document.documentElement.dataset.theme === 'dark' ? '<style>#face .osub{font-weight:500;color:rgb(190,195,202)} #face .othe{font-weight:500;color:rgb(190,195,202)} #face .zin{color:#93c8f3}</style>' : '<style>#face .osub{font-weight:500;color:rgb(80,84,90)} #face .othe{font-weight:500}</style>');
  document.body.innerHTML = '<div id="face" class="lf top" style="position:absolute;left:10px;top:10px;transform:none"><div class="zin" style="zoom:1;transform:none">' + ONE_HTML + '</div></div>';
  document.body.style.background = 'transparent'; document.documentElement.style.background = 'transparent';
});
await p.evaluate(() => document.fonts.ready);
await p.locator('#face').screenshot({ path: path.join(here, THEME === 'dark' ? 'face_dark.png' : 'face.png'), omitBackground: true });
await b.close();
console.log(THEME, 'face at', SCALE + 'x');
