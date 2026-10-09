// node mid.mjs "<first message>" "<interjection, or empty>" "<queued, or empty>" [seconds]
// Sends the first message in main chat, then (while it runs) an interjection (Ctrl/Cmd+Enter) and a
// queued message (Enter); prints main chat's text and what each session received, with times.
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'node:fs'
const [,, first, interjection, queued, seconds = '25'] = process.argv
const url = readFileSync('dsh.log', 'utf8').match(/http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/g).at(-1)
const lines = () => existsSync('probe.log') ? readFileSync('probe.log', 'utf8').trim().split('\n').filter(Boolean) : []
const before = lines().length
const b = await chromium.launch(); const p = await (await b.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 860 } })).newPage()
await p.goto(url); await p.waitForTimeout(4000)
await p.locator('.theone-nav').first().click()
await p.waitForTimeout(2500)
const box = p.locator('textarea, [contenteditable="true"]').last()
const sent = []
const send = async (text, keys) => { await box.click(); await p.keyboard.type(text); await p.keyboard.press(keys); sent.push({ at: new Date().toISOString(), text, keys }) }
await send(first, 'Enter')
await p.waitForTimeout(2500)
if (interjection) await send(interjection, 'Control+Enter')
if (queued) { await p.waitForTimeout(300); await send(queued, 'Enter') }
const approvals = [], clicked = []
// CLICK=<label>: choose that option when a question window opens, noting when it was shown.
for (let i = 0; i < Number(seconds) * 2; i++) {
  await p.waitForTimeout(500)
  if (process.env.CLICK && !clicked.length) {
    const option = p.getByText(process.env.CLICK, { exact: false })
    if (await option.count().catch(() => 0)) {
      await p.screenshot({ path: 'mid-question.png' })
      await option.first().click().catch(() => {})
      for (const label of ['提交', '确定', 'Submit']) {
        const btn = p.getByRole('button', { name: label, exact: true })
        if (await btn.count().catch(() => 0)) { await btn.first().click().catch(() => {}); break }
      }
      clicked.push(new Date().toISOString())
    }
  }
  for (const label of ['允许本次', '允许一次', '允许']) {
    const btn = p.getByRole('button', { name: label, exact: true })
    if (await btn.count().catch(() => 0)) { approvals.push(label); await btn.first().click().catch(() => {}); break }
  }
}
const main = (await p.locator('main').innerText().catch(() => '')).split('\n').filter(l => /PROBE|\[topic:|→|＋|·/.test(l))
console.log(JSON.stringify({ sent, approvals, clicked, main, logged: lines().slice(before).map(l => JSON.parse(l)).map(e => ({ at: e.at, kind: e.kind, user: e.user, result: (e.result ?? '').slice(0, 120) })) }, null, 1))
await p.screenshot({ path: 'last-mid.png', fullPage: true })
await b.close()
