#!/usr/bin/env node
// Spike 2: route with the agents the user is already signed in to, no API key. Sends TheOne's own
// routing prompt (from the DSH plugin's dist/) for a few made-up messages through `claude -p` and
// `codex exec`, and reports, per agent: how long each call takes, whether the answer is valid,
// whether it picked the right topic, and whether any session file was left behind (it must not:
// routing calls are not the user's conversations). The topics and messages are invented, not yours.
//
//   node route.mjs [--only claude|codex] [--claude-model haiku] [--codex-model <id>]
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { ROUTING_PROMPT, routingPayload, validateRoutingDecision } from '../../dist/llm-router.js'

const topic = (id, title, summary) => ({ id, title, summary, entities: [], keywords: [], lastState: '' })
const contexts = [
  topic('gpu', 'Qwen3 on RX 9070 XT', 'Getting FP8 inference of Qwen3-32B stable on an AMD RX 9070 XT with ROCm'),
  topic('kyoto', 'Kyoto trip in October', 'Booking a ryokan near Arashiyama for Oct 18-20 under $250 a night'),
  topic('thesis', 'Thesis: video attention', 'Chapter 3 ablations of temporal attention for long video'),
]
const cases = [
  { text: 'Did the TunableOp warm-up help?', current: 'kyoto', want: 'gpu' },
  { text: '那家旅馆有温泉吗？', current: 'gpu', want: 'kyoto' },
  { text: 'Can you redo the ablation table with the memory-token column?', current: 'gpu', want: 'thesis' },
  { text: '帮我写一个用 Rust 解析发票 PDF 的命令行工具', current: 'thesis', want: 'CREATE' },
  { text: 'ok, go on', current: 'kyoto', want: 'kyoto' },
]

const run = (command, args, input) => new Promise(resolve => {
  const started = performance.now()
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] })
  let out = '', err = ''
  child.stdout.on('data', chunk => { out += chunk })
  child.stderr.on('data', chunk => { err += chunk })
  child.on('error', error => resolve({ ok: false, out, err: String(error), ms: performance.now() - started }))
  child.on('close', code => resolve({ ok: code === 0, out, err, ms: performance.now() - started }))
  child.stdin.end(input)
})

const countFiles = dir => { if (!existsSync(dir)) return 0; let n = 0; for (const name of readdirSync(dir)) { const p = join(dir, name); n += statSync(p).isDirectory() ? countFiles(p) : 1 } return n }
const firstJson = text => { const start = text.indexOf('{'), end = text.lastIndexOf('}'); return start >= 0 && end > start ? JSON.parse(text.slice(start, end + 1)) : undefined }

const agents = {
  claude: {
    sessions: join(homedir(), '.claude', 'projects'),
    async help() { return (await run('claude', ['--help'], '')).out },
    args: (model, help) => ['-p', '--output-format', 'json', '--model', model, '--max-turns', '1', '--system-prompt', ROUTING_PROMPT,
      ...(help.includes('--no-session-persistence') ? ['--no-session-persistence'] : [])],
    answer(out) { const value = JSON.parse(out); return { text: value.result ?? '', cost: value.total_cost_usd, usage: value.usage } },
  },
  codex: {
    sessions: join(homedir(), '.codex', 'sessions'),
    async help() { return (await run('codex', ['exec', '--help'], '')).out },
    args: (model, help) => ['exec', '--json', '--skip-git-repo-check', '--sandbox', 'read-only', '-c', 'model_reasoning_effort="low"',
      ...(model ? ['--model', model] : []), ...(help.includes('--ephemeral') ? ['--ephemeral'] : []), '-'],
    answer(out) {
      let text = '', usage
      for (const line of out.split('\n')) {
        try {
          const event = JSON.parse(line)
          if (event.type === 'item.completed' && event.item?.type === 'agent_message') text = event.item.text ?? text
          if (event.type === 'turn.completed') usage = event.usage
        } catch { /* Not an event line. */ }
      }
      return { text, usage }
    },
  },
}

const { values } = parseArgs({ options: { only: { type: 'string' }, 'claude-model': { type: 'string', default: 'haiku' }, 'codex-model': { type: 'string' } } })
for (const [name, agent] of Object.entries(agents)) {
  if (values.only && values.only !== name) continue
  const help = await agent.help()
  if (!help) { console.log(`${name}: not installed or not on PATH, skipped`); continue }
  const model = name === 'claude' ? values['claude-model'] : values['codex-model']
  const args = agent.args(model, help)
  console.log(`\n${name}: ${args.filter(a => a.startsWith('--')).join(' ')}`)
  if (name === 'claude' && !args.includes('--no-session-persistence')) console.log('  ! this claude has no --no-session-persistence: routing calls may be saved as sessions')
  if (name === 'codex' && !args.includes('--ephemeral')) console.log('  ! this codex has no --ephemeral: routing calls may be saved as sessions')
  const before = countFiles(agent.sessions)
  let right = 0, valid = 0, total = 0
  for (const item of cases) {
    const input = { text: item.text, contexts, currentId: item.current, recent: [] }
    // Claude takes the routing prompt as its system prompt; Codex gets it at the top of the message.
    const message = (name === 'codex' ? ROUTING_PROMPT + '\n\n' : '') + JSON.stringify(routingPayload(input))
    const result = await run(name, args, message)
    total += result.ms
    let verdict = 'invalid'
    try {
      const { text } = agent.answer(result.out)
      const decision = validateRoutingDecision(firstJson(text), input)
      valid++
      const got = decision.action === 'CREATE' ? 'CREATE' : decision.contextId
      if (got === item.want) right++
      verdict = `${got}${got === item.want ? '' : ` (wanted ${item.want})`}`
    } catch (error) { if (!result.ok) verdict = `failed: ${(result.err || result.out).trim().split('\n').at(-1)?.slice(0, 120)}` }
    console.log(`  ${(result.ms / 1000).toFixed(1)} s  ${item.text.slice(0, 40).padEnd(40)}  → ${verdict}`)
  }
  const after = countFiles(agent.sessions)
  console.log(`  ${right}/${cases.length} right, ${valid}/${cases.length} valid, ${(total / cases.length / 1000).toFixed(1)} s per call on average`)
  console.log(`  session files left behind: ${after - before}`)
}
