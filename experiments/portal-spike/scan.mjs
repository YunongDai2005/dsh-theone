#!/usr/bin/env node
// Spike 1: what Claude Code and Codex have on this computer, read-only. Counts sessions active in
// the last N days, their exchanges, and estimates the tokens TheOne would spend organising them
// (8 exchanges per call, each cut to 500 characters of the prompt and two 350-character reply
// excerpts, as the DSH history catalog does). Prints counts only; --titles also prints each
// session's first prompt, cut short, on this screen only. Nothing is written or sent anywhere.
//
//   node scan.mjs [--days 30] [--titles] [--claude ~/.claude/projects] [--codex ~/.codex/sessions]
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

const DAY = 86400000

/** Every file under `dir` whose name passes `keep`. */
function walk(dir, keep, out = []) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    let stat
    try { stat = statSync(path) } catch { continue }
    if (stat.isDirectory()) walk(path, keep, out)
    else if (keep(name)) out.push({ path, mtime: stat.mtimeMs, size: stat.size })
  }
  return out
}

const lines = path => readFileSync(path, 'utf8').split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)] } catch { return [] } })
const textOf = content => typeof content === 'string' ? content
  : Array.isArray(content) ? content.flatMap(block => typeof block?.text === 'string' && !['tool_result', 'tool_use'].includes(block.type) ? [block.text] : []).join('\n') : ''

/** One Claude Code session: the user's own prompts, with the assistant text that followed each. */
export function claudeSession(entries) {
  const exchanges = []
  let cwd, last, title
  for (const entry of entries) {
    if (entry.timestamp) last = entry.timestamp
    if (entry.cwd) cwd ??= entry.cwd
    if (entry.type === 'summary' && typeof entry.summary === 'string') title ??= entry.summary
    const content = entry.message?.content
    if (entry.type === 'user' && !entry.isMeta) {
      // Tool results also arrive as user entries; only words the person typed start an exchange.
      if (Array.isArray(content) && content.some(block => block?.type === 'tool_result')) continue
      const text = textOf(content).trim()
      if (text && !text.startsWith('<')) exchanges.push({ user: text, replies: [] })
    } else if (entry.type === 'assistant' && exchanges.length) {
      const text = textOf(content).trim()
      if (text) exchanges.at(-1).replies.push(text)
    }
  }
  return { cwd, last, title, exchanges }
}

/** One Codex rollout: the same, from its response items; environment notes are not the person's words. */
export function codexSession(entries) {
  const exchanges = []
  let cwd, last
  for (const entry of entries) {
    if (entry.timestamp) last = entry.timestamp
    const item = entry.type === 'response_item' ? entry.payload : entry.type ? undefined : entry
    if (entry.type === 'session_meta') cwd ??= entry.payload?.cwd
    if (item?.type !== 'message') continue
    const text = textOf(item.content).trim()
    if (!text) continue
    if (item.role === 'user' && !text.startsWith('<')) exchanges.push({ user: text, replies: [] })
    else if (item.role === 'assistant' && exchanges.length) exchanges.at(-1).replies.push(text)
  }
  return { cwd, last, title: undefined, exchanges }
}

/** Rough tokens for text: one per CJK character, one per four other characters. */
export const tokens = text => { const cjk = (text.match(/[㐀-鿿぀-ヿ가-힯]/g) ?? []).length; return cjk + Math.ceil((text.length - cjk) / 4) }

/** Tokens the catalog would send for these exchanges: excerpts, plus per-call prompt and topic list. */
export function catalogCost(exchanges) {
  const excerpt = exchanges.map(e => e.user.slice(0, 500) + e.replies.slice(-2).map(r => r.slice(0, 350)).join('\n'))
  const calls = Math.ceil(exchanges.length / 8)
  return { calls, input: excerpt.reduce((sum, text) => sum + tokens(text), 0) + calls * 2500, output: calls * 800 }
}

function report(name, files, read, days, titles) {
  const cutoff = Date.now() - days * DAY
  const active = files.filter(file => file.mtime >= cutoff)
  let exchanges = 0, input = 0, output = 0, calls = 0, empty = 0
  const projects = new Map()
  for (const file of active) {
    let session
    try { session = read(lines(file.path)) } catch { continue }
    if (!session.exchanges.length) { empty++; continue }
    exchanges += session.exchanges.length
    const cost = catalogCost(session.exchanges)
    input += cost.input; output += cost.output; calls += cost.calls
    projects.set(session.cwd ?? '?', (projects.get(session.cwd ?? '?') ?? 0) + 1)
    if (titles) console.log(`  ${new Date(file.mtime).toISOString().slice(0, 10)}  ${(session.title ?? session.exchanges[0].user).replace(/\s+/g, ' ').slice(0, 60)}`)
  }
  console.log(`${name}: ${files.length} sessions on disk, ${active.length} active in ${days} days (${empty} without prompts)`)
  console.log(`  ${exchanges} exchanges in ${projects.size} project folders`)
  console.log(`  organising them: about ${calls} model calls, ${(input / 1e6).toFixed(2)}M input + ${(output / 1e6).toFixed(2)}M output tokens`)
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const { values } = parseArgs({ options: { days: { type: 'string', default: '30' }, titles: { type: 'boolean', default: false },
    claude: { type: 'string', default: join(homedir(), '.claude', 'projects') }, codex: { type: 'string', default: join(homedir(), '.codex', 'sessions') } } })
  const days = Number(values.days)
  report('Claude Code', walk(values.claude, name => name.endsWith('.jsonl')), claudeSession, days, values.titles)
  report('Codex', walk(values.codex, name => name.startsWith('rollout-') && name.endsWith('.jsonl')), codexSession, days, values.titles)
}
