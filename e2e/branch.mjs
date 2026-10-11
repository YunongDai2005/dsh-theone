import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const url = readFileSync('dsh.log', 'utf8').match(/http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/g).at(-1)
const b = await chromium.launch(); const p = await (await b.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 900 } })).newPage()
await p.goto(url); await p.waitForTimeout(4000)
await p.locator('.theone-nav').first().click(); await p.waitForTimeout(3000)
const btn = p.getByRole('button', { name: '在新对话中分支' }).last()
await btn.scrollIntoViewIfNeeded(); await btn.click({ force: true }); await p.waitForTimeout(6000)
await p.screenshot({ path: 'branch-after.png' })
console.log('title:', (await p.locator('header, [class*="title"]').first().innerText().catch(() => '')).slice(0, 60))
console.log((await p.locator('body').innerText()).split('\n').filter(Boolean).slice(-8).join(' | '))
await b.close()
