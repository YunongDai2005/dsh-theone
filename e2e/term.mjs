import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const url = readFileSync('dsh.log', 'utf8').match(/http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/g).at(-1)
const b = await chromium.launch(); const p = await (await b.newContext({ locale: 'zh-CN', viewport: { width: 1400, height: 900 } })).newPage()
await p.goto(url); await p.waitForTimeout(4000); await p.locator('.theone-nav').first().click(); await p.waitForTimeout(3000)
await p.getByRole('button', { name: '打开右侧边栏' }).click().catch(() => {}); await p.waitForTimeout(1500)
await p.locator('[aria-label^="新建终端"]').first().click(); await p.waitForTimeout(4000)
await p.locator('.xterm, [class*="terminal"]').last().click().catch(() => {})
await p.keyboard.type('pwd > term-pwd.txt'); await p.keyboard.press('Enter'); await p.waitForTimeout(2500)
await p.screenshot({ path: 'term.png' }); await b.close()
