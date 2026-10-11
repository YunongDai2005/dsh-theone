// node e2e.mjs native <workspace> <message> [preset] [access]  |  node e2e.mjs main <message> [preset] [access]
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'node:fs'
const [,, where, ...rest] = process.argv
const ws = where === 'native' ? rest.shift() : undefined
const [message, preset, access] = rest
const url = readFileSync('dsh.log', 'utf8').match(/http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/g).at(-1)
const lines = () => existsSync('probe.log') ? readFileSync('probe.log', 'utf8').trim().split('\n').filter(Boolean) : []
const before = lines().length
const b = await chromium.launch(); const p = await (await b.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 860 } })).newPage()
await p.goto(url); await p.waitForTimeout(4000)
if (where === 'native') { await p.getByText(ws, { exact: true }).first().hover(); await p.locator(`[aria-label="在“${ws}”中新建会话"]`).first().click({ force: true }) }
else await p.locator('.theone-nav').first().click()
await p.waitForTimeout(2500)
if (preset) { await p.getByRole('button', { name: /模式$/ }).first().click(); await p.waitForTimeout(800); await p.getByText(preset, { exact: false }).first().click(); await p.waitForTimeout(1200) }
if (access) { await p.getByRole('button', { name: /访问模式/ }).click(); await p.waitForTimeout(800); await p.getByText(access, { exact: true }).last().click(); await p.waitForTimeout(1200) }
const box = p.locator('textarea, [contenteditable="true"]').last()
await box.click(); await p.keyboard.type(message); await p.keyboard.press('Enter')
const approvals = []
for (let i = 0; i < 60 && lines().length === before; i++) {
  await p.waitForTimeout(500)
  for (const label of ['允许本次', '允许一次', '允许', '批准', '同意']) {
    const btn = p.getByRole('button', { name: label, exact: true })
    if (await btn.count().catch(() => 0)) { approvals.push(label); await btn.first().click().catch(() => {}); break }
  }
}
await p.waitForTimeout(1500)
const shown = (await p.locator('main').innerText().catch(() => '')).split('\n').filter(l => /PROBE|拒绝|denied|错误|失败|error/i.test(l)).slice(-3)
console.log(JSON.stringify({ where, ws, message, approvals, shown, logged: lines().slice(before).map(l => JSON.parse(l)).map(e => ({ kind: e.kind, n: e.tools.length, theone: e.tools.filter(t => t.startsWith('theone_')).length, result: (e.result ?? '').replace(/\\n/g, ' ').slice(0, 260) })) }))
await p.screenshot({ path: `last-${where}.png` })
await b.close()
