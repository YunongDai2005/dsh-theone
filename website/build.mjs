import { mkdir, copyFile, cp } from 'node:fs/promises';
await mkdir(new URL('./out/', import.meta.url), { recursive: true });
for (const file of ['index.html', 'styles.css', 'theme.css', 'app.js', 'favicon.svg', 'robots.txt', 'sitemap.xml', '_headers']) {
  await copyFile(new URL(file, import.meta.url), new URL(`out/${file}`, import.meta.url));
}
console.log('Built website/out (static, no dependencies).');

await cp(new URL('./assets/', import.meta.url), new URL('./out/assets/', import.meta.url), { recursive: true });
