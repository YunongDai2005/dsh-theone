// node ask.mjs native|main <pick label or "custom:text">
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'node:fs'
const [,, where, pick] = process.argv
const url = readFileSync('dsh.log', 'utf8').match(/http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/g).at(-1)
const lines = () => existsSync('probe.log') ? readFileSync('probe.log', 'utf8').trim().split('\n').filter(Boolean) : []
const before = lines().length
const b = await chromium.launch(); const p = await (await b.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 900 } })).newPage()
await p.goto(url); await p.waitForTimeout(4000)
if (where === 'native') { await p.getByText('proj', { exact: true }).first().hover(); await p.locator('[aria-label="在“proj”中新建会话"]').first().click({ force: true }) }
else await p.locator('.theone-nav').first().click()
await p.waitForTimeout(2500)
await p.locator('textarea, [contenteditable="true"]').last().click()
await p.keyboard.type(where === 'native' ? '[ask] 帮我决定一下' : '[topic:alpha] [ask] 帮我决定一下'); await p.keyboard.press('Enter')
let shown = false
for (let i = 0; i < 40 && !shown; i++) { await p.waitForTimeout(500); shown = await p.getByText('最稳').count() > 0 }
await p.screenshot({ path: `ask-${where}-1.png` })
console.log('question shown:', shown)
if (shown) {
  if (pick.startsWith('custom:')) {
    await p.getByText('输入你的答案', { exact: true }).filter({ visible: true }).first().click(); await p.waitForTimeout(400); await p.keyboard.type(pick.slice(7)); await p.screenshot({ path: 'ask-custom-typed.png' })
  } else await p.getByText(pick, { exact: true }).filter({ visible: true }).first().click()
  await p.waitForTimeout(700)
  await p.screenshot({ path: `ask-${where}-2.png` })
  const submit = p.getByRole('button', { name: /提交|确认|发送|Submit/ })
  await submit.filter({ visible: true }).last().click()
}
for (let i = 0; i < 30 && lines().length === before; i++) await p.waitForTimeout(500)
console.log(JSON.stringify(lines().slice(before).map(l => JSON.parse(l)).map(e => ({ kind: e.kind, result: e.result }))))
await b.close()
