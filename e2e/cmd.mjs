// node cmd.mjs "<line>" — type a line in main chat, show what the page says afterwards
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const url = readFileSync('dsh.log', 'utf8').match(/http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/g).at(-1)
const b = await chromium.launch(); const p = await (await b.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 900 } })).newPage()
await p.goto(url); await p.waitForTimeout(4000)
await p.locator('.theone-nav').first().click(); await p.waitForTimeout(2500)
await p.locator('textarea, [contenteditable="true"]').last().click()
await p.keyboard.type(process.argv[2]); await p.waitForTimeout(800)
await p.screenshot({ path: 'cmd-typed.png' })
await p.keyboard.press("Enter"); await p.waitForTimeout(Number(process.env.WAIT ?? 8000))
await p.screenshot({ path: 'cmd-after.png' })
console.log((await p.locator('body').innerText()).split('\n').slice(-14).join(' | '))
await b.close()
