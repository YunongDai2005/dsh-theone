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
// EXTRA_ARGS passes more Chromium switches, space-separated. With the GPU, the tile budget is raised: when Chrome
// runs out of tile memory it skips layers silently ("tile memory limits exceeded, some content may not draw").
const EXTRA = (process.env.EXTRA_ARGS || '').split(' ').filter(Boolean);
export function launch() {
  if (!GPU) return chromium.launch({ args: EXTRA });
  const args = ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-zero-copy',
    `--force-gpu-mem-available-mb=${process.env.GPU_MEM_MB || 8192}`, ...EXTRA];
  if (process.platform === 'win32') args.push('--use-angle=d3d11');
  return chromium.launch({ channel: 'chromium', args });
}
// WebGL adapter probe: "SwiftShader" means this context uses software. CSS/SVG can take other paths.
export const renderer = page => page.evaluate(() => { const g = document.createElement('canvas').getContext('webgl'); const x = g && g.getExtension('WEBGL_debug_renderer_info'); return g ? (x ? g.getParameter(x.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER)) : 'no WebGL'; });
