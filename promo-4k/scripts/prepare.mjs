// Prepares everything the film reads from public/ and src/generated/ (none of it is committed):
// DSH's artwork, the fonts as files for Three.js text, and the soundtrack (BGM cut + synthesized SFX).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
process.chdir(here);
const win = process.platform === 'win32';
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: win && /^(npm|npx)$/.test(cmd), ...opts });
  if (r.status !== 0) { console.error(`\n✗ ${cmd} ${args.join(' ')} failed`); process.exit(1); }
};
const has = (cmd, args) => spawnSync(cmd, args, { stdio: 'ignore' }).status === 0;
const force = process.argv.includes('--force');

// 1. DSH artwork
if (!fs.existsSync('.dsh')) run('git', ['clone', '--depth', '1', 'https://github.com/deepseek-ai/deepseek-harness.git', '.dsh']);
if (force || !fs.existsSync('src/generated/dsh-icons.json')) {
  run('npx', ['esbuild', 'scripts/extract-icons.tsx', '--bundle', '--platform=node', '--format=esm', '--jsx=automatic',
    '--external:react', '--external:react-dom', '--external:react/jsx-runtime', '--outfile=.extract.mjs']);
  run('node', ['.extract.mjs']);
}

// 2. fonts as files (Three.js text needs a font URL, and nothing may load from the network while rendering)
fs.mkdirSync('public/fonts', { recursive: true });
for (const [pkg, file] of [['inter', 'inter-latin-400-normal'], ['inter', 'inter-latin-500-normal'], ['inter', 'inter-latin-600-normal'],
  ['nunito', 'nunito-latin-700-normal'], ['jetbrains-mono', 'jetbrains-mono-latin-500-normal']])
  fs.copyFileSync(`node_modules/@fontsource/${pkg}/files/${file}.woff`, `public/fonts/${file}.woff`);

// 3. soundtrack: the BGM from bar -7, so its drop lands on the click, plus the SFX for the same cue list
const bgm = ['bgm.m4a', '../promo/bgm.m4a'].find(f => fs.existsSync(f));
if (!bgm) { console.error('Save the BGM as promo-4k/bgm.m4a (or promo/bgm.m4a) first'); process.exit(1); }
const PY = ['python3', 'python', 'py'].find(p => has(p, ['-c', 'import numpy, scipy']));
if (!PY) { console.error('missing: Python 3 with numpy and scipy (pip install numpy scipy)'); process.exit(1); }
run('npx', ['tsx', 'scripts/cues.ts']);
const meta = JSON.parse(fs.readFileSync('out/meta.json', 'utf8'));
run(PY, ['scripts/sfx.py', 'out/cues.json', 'out/meta.json', 'out/sfx.wav']);
run('ffmpeg', ['-v', 'error', '-y', '-i', bgm, '-i', 'out/sfx.wav', '-filter_complex',
  `[0:a]aresample=48000,atrim=start=${meta.bgmStart}:duration=${meta.total},asetpts=PTS-STARTPTS,afade=t=in:d=0.4,afade=t=out:st=${(meta.total - 1.2).toFixed(3)}:d=1.2[m];` +
  `[1:a]aresample=48000[s];[m][s]amix=inputs=2:normalize=0,alimiter=limit=0.95:level=false[a]`, '-map', '[a]', '-c:a', 'pcm_s16le', 'public/mix.wav']);
console.log('✓ assets ready');
