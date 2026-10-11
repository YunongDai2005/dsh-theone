#!/usr/bin/env node
// How you actually send messages to TheOne: how often several come in quick succession, how often
// such a burst changes subject, and how often messages typed during a reply (kept with the current
// topic without routing) were later moved by you. Counts only: no message text, ids or titles are
// read into the output, and nothing leaves this computer.
//
//   node scripts/route-stats.mjs                 (reads ~/.dsh/theone/contexts.db and ~/.dsh/sessions)
//   node scripts/route-stats.mjs --json
//   node scripts/route-stats.mjs --db <path> --sessions <dir>
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { DatabaseSync } from 'node:sqlite'
import zlib from 'node:zlib'

const GAPS = [3, 10, 30, 60]
/** Reasons TheOne records when it keeps a message with the current topic without asking the model. */
const RULE_KEEPS = new Set(['steering', 'short-continuation', 'attachment-only'])

/** Routes recorded by TheOne, oldest first, without their text. */
export function readRoutes(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    return db.prepare(`SELECT r.message_id, r.gateway_id, r.decision, r.status, r.created_at, d.corrected_to
      FROM routing_events r LEFT JOIN route_details d ON d.message_id = r.message_id ORDER BY r.rowid`).all().map(row => {
      const decision = JSON.parse(String(row.decision))
      // Where the message really belonged: where you moved it, else where it was routed.
      const contextId = row.corrected_to == null ? decision.contextId ?? null : String(row.corrected_to)
      return { messageId: String(row.message_id), gatewayId: String(row.gateway_id), action: decision.action, contextId,
        reason: RULE_KEEPS.has(decision.reason) || decision.reason === 'correction' ? decision.reason : 'model', corrected: row.corrected_to != null,
        at: Date.parse(String(row.created_at).replace(' ', 'T') + 'Z') }
    })
  } finally { db.close() }
}

/** The user's messages in one session log: id and time only. */
function userMessages(file) {
  let raw = readFileSync(file)
  if (file.endsWith('.zstd')) {
    if (!zlib.zstdDecompressSync) throw new Error('This Node.js cannot read .zstd session logs; use Node.js 22.15 or later')
    raw = zlib.zstdDecompressSync(raw)
  }
  const out = []
  for (const line of raw.toString('utf8').split('\n')) {
    if (!line.includes('"user/message"')) continue
    try {
      const event = JSON.parse(line)
      if (event.type === 'user/message' && event.data?.source?.kind === 'user') out.push({ id: String(event.data.id), time: Number(event.time) })
    } catch { /* A torn last line. */ }
  }
  return out
}

/** Session log directories by session id: <root>/<project>/<session id>/session*.jsonl[.zstd]. */
function sessionLogs(root, ids) {
  const found = new Map()
  if (!existsSync(root)) return found
  for (const project of readdirSync(root)) {
    const projectDir = join(root, project)
    if (!statSync(projectDir).isDirectory()) continue
    for (const id of readdirSync(projectDir)) {
      if (!ids.has(id)) continue
      // The session's own log, newest format first; numbered files belong to child sessions.
      const files = readdirSync(join(projectDir, id)).filter(name => /^session(\.v\d+)?\.jsonl(\.zstd)?$/.test(name))
        .sort((a, b) => (Number(b.match(/\.v(\d+)/)?.[1] ?? 0)) - (Number(a.match(/\.v(\d+)/)?.[1] ?? 0)))
      if (files[0]) found.set(id, join(projectDir, id, files[0]))
    }
  }
  return found
}

const share = (part, whole) => whole ? Math.round(part / whole * 1000) / 1000 : null

/** All the numbers, from routes and (where found) the main chat's session logs. */
export function routeStats(routes, logs = new Map()) {
  const byId = new Map(routes.map(route => [route.messageId, route]))
  const reasons = {}
  for (const route of routes) {
    const entry = reasons[route.reason] ??= { routes: 0, corrected: 0 }
    entry.routes++
    entry.corrected += route.corrected
  }
  for (const entry of Object.values(reasons)) entry.correctedShare = share(entry.corrected, entry.routes)

  // Consecutive user messages in the main chat, with the gap between them.
  let messages = 0, unrouted = 0
  const pairs = []
  for (const [gatewayId, file] of logs) {
    const list = userMessages(file)
    messages += list.length
    unrouted += list.filter(message => !byId.has(message.id)).length
    for (let i = 1; i < list.length; i++) {
      const gap = (list[i].time - list[i - 1].time) / 1000
      if (!Number.isFinite(gap) || gap < 0) continue
      pairs.push({ gap, before: byId.get(list[i - 1].id), after: byId.get(list[i].id), gatewayId })
    }
  }
  const gaps = Object.fromEntries(GAPS.map(seconds => {
    const within = pairs.filter(pair => pair.gap <= seconds)
    // Both have a topic (after your corrections): does the second belong somewhere else?
    const routed = within.filter(pair => pair.before?.contextId && pair.after?.contextId)
    return [`<=${seconds}s`, { pairs: within.length, share: share(within.length, pairs.length),
      bothRouted: routed.length, topicChanged: share(routed.filter(pair => pair.before.contextId !== pair.after.contextId).length, routed.length),
      secondNotRouted: share(within.filter(pair => !pair.after).length, within.length) }]
  }))
  const routedPairs = pairs.filter(pair => pair.before?.contextId && pair.after?.contextId)
  return {
    routes: routes.length,
    actions: routes.reduce((counts, route) => ({ ...counts, [route.action]: (counts[route.action] ?? 0) + 1 }), {}),
    reasons,
    corrected: share(routes.filter(route => route.corrected).length, routes.length),
    mainChat: { sessionsFound: logs.size, sessionsKnown: new Set(routes.map(route => route.gatewayId)).size, userMessages: messages,
      // Typed while a reply ran and handed straight to it: never routed, so never correctable either.
      notRouted: unrouted, notRoutedShare: share(unrouted, messages) },
    consecutive: { pairs: pairs.length, topicChanged: share(routedPairs.filter(pair => pair.before.contextId !== pair.after.contextId).length, routedPairs.length), byGap: gaps },
  }
}

function report(stats) {
  const pct = value => value == null ? '–' : `${(value * 100).toFixed(1)}%`
  const lines = [`路由记录 ${stats.routes} 条；被你手动改过话题的 ${pct(stats.corrected)}`, '', '| 路由方式 | 条数 | 被改过的比例 |', '|---|---|---|']
  const names = { model: '模型判断', steering: '回复中补充（不问模型）', 'short-continuation': '"继续"类短句（不问模型）', 'attachment-only': '只有附件', correction: '按你的更正' }
  for (const [reason, entry] of Object.entries(stats.reasons)) lines.push(`| ${names[reason] ?? reason} | ${entry.routes} | ${pct(entry.correctedShare)} |`)
  const m = stats.mainChat
  lines.push('', `主聊天会话日志：找到 ${m.sessionsFound} / ${m.sessionsKnown} 个；你发出的消息 ${m.userMessages} 条，其中 ${m.notRouted}（${pct(m.notRoutedShare)}）在回复进行中直接交给了正在回复的话题，没有经过路由。`)
  const c = stats.consecutive
  lines.push('', `相邻两条消息 ${c.pairs} 对；两条都经过路由时，第二条换了话题的比例 ${pct(c.topicChanged)}`, '', '| 间隔 | 对数 | 占全部 | 其中换了话题 | 第二条没经过路由 |', '|---|---|---|---|---|')
  for (const [gap, entry] of Object.entries(c.byGap)) lines.push(`| ${gap} | ${entry.pairs} | ${pct(entry.share)} | ${pct(entry.topicChanged)}（${entry.bothRouted} 对可判断） | ${pct(entry.secondNotRouted)} |`)
  return lines.join('\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const { values } = parseArgs({ options: { db: { type: 'string', default: join(home, 'theone', 'contexts.db') },
    sessions: { type: 'string', default: join(home, 'sessions') }, json: { type: 'boolean', default: false } } })
  if (!existsSync(values.db)) throw new Error(`No TheOne database at ${values.db}; pass --db <path>`)
  const routes = readRoutes(values.db)
  const stats = routeStats(routes, sessionLogs(values.sessions, new Set(routes.map(route => route.gatewayId))))
  console.log(values.json ? JSON.stringify(stats, null, 2) : report(stats))
}
