// node changes.mjs: in main chat, opens the changed-files card under the last reply and prints the change requests' status.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs'
import { readFileSync } from 'node:fs'
const url = readFileSync('dsh.log', 'utf8').match(/http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/g).at(-1)
const b = await chromium.launch(); const p = await (await b.newContext({ locale: 'zh-CN', viewport: { width: 1400, height: 900 } })).newPage()
const failed = []
p.on('response', r => { if (/changes\./.test(r.url())) failed.push(`${r.status()} ${r.url().replace(/token=[^&]+/, '')}`) })
await p.goto(url); await p.waitForTimeout(4000); await p.locator('.theone-nav').first().click(); await p.waitForTimeout(3500)
await p.getByText(/已编辑/).last().click(); await p.waitForTimeout(3000)
await p.screenshot({ path: 'changes-open.png' })
console.log(failed.join('\n'))
await b.close()
