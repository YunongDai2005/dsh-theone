// Renders DSH's own icon set, whale mark and wordmark to SVG strings (src/generated/dsh-icons.json).
// The artwork is not committed: scripts/prepare.mjs clones deepseek-harness into promo-4k/.dsh and runs this.
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
fs.mkdirSync('src/generated', { recursive: true }); fs.writeFileSync('src/generated/dsh-icons.json', JSON.stringify(out))
console.log(Object.keys(out).length, 'icons')
