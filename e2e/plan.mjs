// node plan.mjs native <ws> | main: turns plan mode on with /plan, then sends a message; prints whether the model saw plan mode.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs'
import { readFileSync, existsSync } from 'node:fs'
const [,, where, ws] = process.argv
const url = readFileSync('dsh.log', 'utf8').match(/http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/g).at(-1)
const lines = () => existsSync('probe.log') ? readFileSync('probe.log', 'utf8').trim().split('\n').filter(Boolean) : []
const b = await chromium.launch(); const p = await (await b.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 860 } })).newPage()
await p.goto(url); await p.waitForTimeout(4000)
if (where === 'native') { await p.getByText(ws, { exact: true }).first().hover(); await p.locator(`[aria-label="在“${ws}”中新建会话"]`).first().click({ force: true }) }
else await p.locator('.theone-nav').first().click()
await p.waitForTimeout(2500)
const box = p.locator('textarea, [contenteditable="true"]').last()
const send = async text => { await box.click(); await p.keyboard.type(text); await p.waitForTimeout(400); await p.keyboard.press('Enter'); await p.waitForTimeout(400); await p.keyboard.press('Escape').catch(() => {}) }
await send('/plan'); await p.waitForTimeout(2500)
const before = lines().length
await send(where === 'native' ? 'hello plan' : '[topic:发票导出] hello plan'); await p.waitForTimeout(6000)
console.log(JSON.stringify(lines().slice(before).map(l => JSON.parse(l)).map(e => ({ kind: e.kind, plan: e.plan, user: e.user.slice(0, 40) }))))
await p.screenshot({ path: `plan-${where}.png` })
await send('/plan off'); await p.waitForTimeout(2000)
await b.close()
