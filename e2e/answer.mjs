// node answer.mjs "<option label>" | "custom:<text>"  — answers the question open in main chat
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'node:fs'
const [,, pick] = process.argv
const url = readFileSync('dsh.log', 'utf8').match(/http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/g).at(-1)
const lines = () => existsSync('probe.log') ? readFileSync('probe.log', 'utf8').trim().split('\n').filter(Boolean) : []
const before = lines().length
const b = await chromium.launch(); const p = await (await b.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 900 } })).newPage()
await p.goto(url); await p.waitForTimeout(4000)
await p.locator('.theone-nav').first().click(); await p.waitForTimeout(3000)
if (pick.startsWith('custom:')) { await p.locator('textarea[placeholder="输入你的答案"]').first().click({ force: true }); await p.keyboard.type(pick.slice(7)) }
else await p.getByText(pick, { exact: true }).filter({ visible: true }).first().click()
await p.waitForTimeout(500)
await p.getByRole('button', { name: '提交' }).filter({ visible: true }).last().click()
for (let i = 0; i < 30 && lines().length === before; i++) await p.waitForTimeout(500)
console.log(JSON.stringify(lines().slice(before).map(l => JSON.parse(l)).map(e => ({ kind: e.kind, result: e.result }))))
await b.close()
