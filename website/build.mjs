import { mkdir, copyFile, cp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const root = dirname(fileURLToPath(import.meta.url));
const output = resolve(root, 'out');
if (dirname(output) !== root) throw new Error('Build output must stay inside website/');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of ['index.html','style.css','product-polish.css','fonts.css','typography.css','story-motion.css','alignment.css','conversation-timeline.js','conversation-motion.js','app.js','favicon.svg','dsh-logo.svg','HARNESS-LICENSE.txt','robots.txt','sitemap.xml','_headers']) {
  await copyFile(new URL(file, import.meta.url), new URL(`out/${file}`, import.meta.url));
}
console.log('Built website/out (static, no dependencies).');

await cp(new URL('./fonts/', import.meta.url), new URL('./out/fonts/', import.meta.url), { recursive: true });
