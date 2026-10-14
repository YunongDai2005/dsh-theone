// Renders DSH's own icon set, whale mark and wordmark to plain SVG strings (dsh-icons.js).
// The artwork is not committed; regenerate it from a local clone:
//   git clone --depth 1 https://github.com/deepseek-ai/deepseek-harness.git ../.dsh
//   npx esbuild extract-icons.tsx --bundle --platform=node --format=esm --jsx=automatic \
//     --external:react --external:react-dom --external:react/jsx-runtime --outfile=.extract.mjs && node .extract.mjs
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as I from '../.dsh/packages/client/ui-primitives/src/icons/index.tsx'
import { FishLogo } from '../.dsh/packages/client/ui-primitives/src/FishLogo.tsx'
import { BrandWordmark } from '../.dsh/packages/client/ui-primitives/src/BrandWordmark.tsx'
import fs from 'fs'

const out: Record<string, string> = {}
for (const [k, v] of Object.entries(I))
  if (typeof v === 'function' && k.startsWith('Icon') && k.endsWith('Regular'))
    out[k.replace(/^Icon|OutlineRegular$|Regular$/g, '')] = renderToStaticMarkup(createElement(v as any, { size: 16 }))
out.Fish = renderToStaticMarkup(createElement(FishLogo, { size: 24 }))
out.Wordmark = renderToStaticMarkup(createElement(BrandWordmark, { size: 24 }))
fs.writeFileSync('dsh-icons.js', 'window.DSH_ICONS=' + JSON.stringify(out) + ';')
console.log(Object.keys(out).length, 'icons')
