// Playwright from this folder's node_modules (npm install), or from a global install when that's missing.
// GPU=1 launches full Chromium in new headless mode with hardware acceleration (D3D11 on Windows) instead
// of the software-rendered headless shell.
import { createRequire } from 'module';
let pw;
try { pw = await import('playwright'); } catch {
  for (const r of [process.env.PLAYWRIGHT_ROOT, '/opt/node-tools/node_modules/'].filter(Boolean)) { try { pw = createRequire(r)('playwright'); break; } catch {} }
  if (!pw) throw new Error('Playwright not found: run `npm install` and `npx playwright install chromium` in promo/');
}
const chromium = pw.chromium || pw.default.chromium;
export const GPU = process.env.GPU === '1';
export function launch() {
  if (!GPU) return chromium.launch();
  const args = ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-zero-copy'];
  if (process.platform === 'win32') args.push('--use-angle=d3d11');
  return chromium.launch({ channel: 'chromium', args });
}
// what the page is actually drawn with: "SwiftShader" means software, otherwise the GPU's name
export const renderer = page => page.evaluate(() => { const g = document.createElement('canvas').getContext('webgl'); const x = g && g.getExtension('WEBGL_debug_renderer_info'); return g ? (x ? g.getParameter(x.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER)) : 'no WebGL'; });
