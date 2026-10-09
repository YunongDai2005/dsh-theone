// node jobs.mjs: a topic starts a long background job; main chat's header lists it, and stopping it there (press twice) kills it.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs'
import { readFileSync } from 'node:fs'
const url = readFileSync('dsh.log', 'utf8').match(/http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/g).at(-1)
const b = await chromium.launch(); const p = await (await b.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 860 } })).newPage()
await p.goto(url); await p.waitForTimeout(4000); await p.locator('.theone-nav').first().click(); await p.waitForTimeout(2500)
const box = p.locator('textarea, [contenteditable="true"]').last()
await box.click(); await p.keyboard.type('[topic:发票导出] [call:bash] {"command":"for i in 1 2 3 4 5 6 7 8; do echo tick $i; sleep 5; done","description":"probe","run_in_background":true}'); await p.keyboard.press('Enter')
await p.waitForTimeout(12000)
await p.getByRole('button', { name: /后台任务/ }).first().click(); await p.waitForTimeout(1500)
const labels = await p.locator('button[aria-label]').evaluateAll(els => els.map(e => e.getAttribute('aria-label')).filter(l => /任务|输出|展开|停止|job/i.test(l)))
console.log('buttons:', JSON.stringify(labels))
const stop = p.locator('button[data-kill-state]').first(); await stop.click(); await p.waitForTimeout(600); await stop.click(); await p.waitForTimeout(4000)
console.log('header after stop:', await p.getByText(/个后台任务/).first().innerText().catch(() => 'none'))
await b.close()
