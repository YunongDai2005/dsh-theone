// Pre-render The One key face as a high-resolution bitmap (face.png) with a transparent outside.
import { createRequire } from 'module'; import path from 'path';
const require = createRequire('/opt/node-tools/node_modules/'); const { chromium } = require('playwright');
const here = path.dirname(new URL(import.meta.url).pathname);
const SCALE = +(process.env.FACE_SCALE || 8);
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 400, height: 140 }, deviceScaleFactor: SCALE });
await p.goto('file://' + path.join(here, 'film.html'));
await p.evaluate(() => window.warm());
await p.evaluate(() => {
  document.head.insertAdjacentHTML('beforeend', '<style>#face .osub{font-weight:500;color:rgb(80,84,90)} #face .othe{font-weight:500}</style>');
  document.body.innerHTML = '<div id="face" class="lf top" style="position:absolute;left:10px;top:10px;transform:none"><div class="zin" style="zoom:1;transform:none">' + ONE_HTML + '</div></div>';
  document.body.style.background = 'transparent'; document.documentElement.style.background = 'transparent';
});
await p.evaluate(() => document.fonts.ready);
await p.locator('#face').screenshot({ path: path.join(here, 'face.png'), omitBackground: true });
await b.close();
console.log('face.png at', SCALE + 'x');
