// /plan in main chat, the topic submits a plan, the user approves it; then a message checks plan mode is off.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs'
import { readFileSync, existsSync } from 'node:fs'
const url = readFileSync('dsh.log', 'utf8').match(/http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/g).at(-1)
const lines = () => existsSync('probe.log') ? readFileSync('probe.log', 'utf8').trim().split('\n').filter(Boolean) : []
const b = await chromium.launch(); const p = await (await b.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 860 } })).newPage()
await p.goto(url); await p.waitForTimeout(4000); await p.locator('.theone-nav').first().click(); await p.waitForTimeout(2500)
const box = p.locator('textarea, [contenteditable="true"]').last()
const send = async text => { await box.click(); await p.keyboard.type(text); await p.waitForTimeout(400); await p.keyboard.press('Enter'); await p.waitForTimeout(400); await p.keyboard.press('Escape').catch(() => {}) }
await send('/plan'); await p.waitForTimeout(2500)
await send('[topic:发票导出] [call:exit_plan_mode] {"plan":"# 导出方案\\n先加按钮，再写导出"}'); await p.waitForTimeout(5000)
await p.screenshot({ path: 'plan-review.png' })
await p.getByRole('button', { name: '同意执行' }).last().click()
await p.waitForTimeout(500)
for (const label of ['提交', '确定']) { const btn = p.getByRole('button', { name: label, exact: true }); if (await btn.count()) { await btn.last().click(); break } }
await p.waitForTimeout(5000)
const before = lines().length
await send('[topic:发票导出] next step'); await p.waitForTimeout(6000)
console.log(JSON.stringify(lines().slice(before).map(l => JSON.parse(l)).map(e => ({ kind: e.kind, plan: e.plan, user: e.user.slice(0, 40) }))))
await p.screenshot({ path: 'plan-after.png' })
await b.close()
