#!/usr/bin/env node
// Deterministic routing-event cases, with optional model paraphrasing of the fixed plan.
// No client (and no credentials) is created for --templates or --dry-run.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { createHash } from 'node:crypto'
import { validateRoutingSet } from './lib/routing-v1.mjs'

export const RENDER_ROUTING = 'Rewrite these bilingual routing test exchanges naturally in the requested language. Keep the meaning, named objects, projects, numeric facts, and exact must_include substrings. Do not change the plan or event metadata. For locked_text entries copy text exactly. Return JSON {"messages":[{"i":0,"text":"...","reply":"..."}]}. Every input i must occur exactly once. No other fields.'

export function buildRoutingSet({ variants = 8 } = {}) {
  if (!Number.isInteger(variants) || variants < 2) throw new Error('variants must be an integer >= 2')
  const sessions = []
  for (let v = 0; v < variants; v++) for (const lang of ['zh', 'en']) {
    const zh = lang === 'zh', split = v < Math.ceil(variants * 0.75) && v < variants - 1 ? 'dev' : 'test'
    const names = zh ? [`青禾${v + 1}报表`, `白桦${v + 1}报表`] : [`Atlas ${v + 1} reports`, `Birch ${v + 1} reports`]
    const short = zh ? ['继续', '好的', '可以', '下一步'][v % 4] : ['continue', 'ok', 'yes', 'next step'][v % 4]
    const topics = names.map((title, i) => ({ id: i ? 'b' : 'a', title, summary: zh ? title + '的数据发布，使用 report.csv' : title + ' data release using report.csv',
      entities: [title, 'report.csv'], keywords: [title], lastState: zh ? '等待确认' : 'waiting' }))
    const makeTurn = (i, text, thread, extra = {}) => ({ i, at: new Date(Date.UTC(2026, 8, v + 1, 9, 0, i)).toISOString(),
      text, reply: zh ? '已记下。' : 'Noted.', gold: { thread, action: i ? 'continue' : 'switch', refs: [], explicit_binding: false, retract: [] },
      style: 'explicit', tags: [], ambiguous: false, ...extra })
    const add = (kind, turns, extra = {}, side = '') => {
      const s = { version: 'interleave-v1', routing_schema: 'routing-v1', benchmark_revision: 'step7', session_id: `rv1-${v}-${lang}-${kind}${side}`,
        split, lang, scenario: kind, template_group: `variant-${v}`, generation: 'deterministic-template',
        threads: topics.map(t => ({ id: t.id, title: t.title, description: t.summary, domain: 'software' })),
        catalog: structuredClone(topics), current_id: 'a',
        turns: turns.map(t => ({ ...t, tags: [...t.tags, kind] })), ...extra }
      sessions.push(s); return s
    }
    for (const kind of ['foreground', 'question', 'approval']) for (const owner of ['a', 'b']) {
      const events = kind === 'foreground'
        ? [{ id: 'visible', type: 'foreground', topic_id: owner, text: zh ? '是否继续？' : 'Continue?' }]
        : [{ id: 'request', type: 'pending', owner_id: owner, kind }]
      add(kind, [makeTurn(0, short, owner, { events_before: events, locked_text: true, style: 'implicit',
        input: kind === 'foreground' ? { reply_to: 'visible' } : { pending_response: 'request' },
        gold: { thread: owner, action: 'continue', refs: [], explicit_binding: true, retract: [] } })],
      { pair: { id: `pair-${v}-${lang}-${kind}`, kind, side: owner, event_id: kind === 'foreground' ? 'visible' : 'request', turn_i: 0 } }, '-' + owner)
      // Keep the former competing-waits cases as a separate, explicitly reference-dependent control.
      if (kind !== 'foreground') add(kind + '_conflict', [makeTurn(0, short, owner, {
        events_before: [{ id: 'visible', type: 'foreground', topic_id: 'a', text: zh ? '是否继续？' : 'Continue?' },
          { id: 'request', type: 'pending', owner_id: owner, kind, message_id: 'visible' },
          { id: 'other-request', type: 'pending', owner_id: 'b', kind, message_id: 'visible' }],
        locked_text: true, style: 'implicit', input: { pending_response: 'request' },
        gold: { thread: owner, action: 'continue', refs: [], explicit_binding: true, requires_user_ref: true, retract: [] },
      })], { pair: { id: `pair-${v}-${lang}-${kind}-conflict`, kind, side: owner, event_id: 'request', turn_i: 0 } }, '-' + owner)
    }
    add('background', [makeTurn(0, names[0] + (zh ? '，继续整理数据。' : ': organize the data.'), 'a'),
      makeTurn(1, short, 'a', { style: 'implicit', events_before: [{ type: 'background', id: 'done', topic_id: 'b',
        text: zh ? '后台任务已完成。' : 'Background job finished.', visible: false }] })])
    add('steering', [makeTurn(0, names[0] + (zh ? '，写一段说明。' : ': write a description.'), 'a'),
      makeTurn(1, zh ? '补充一下，要简短。' : 'Keep it concise, please.', 'a', { input: { steering_of: 0 },
        gold: { thread: 'a', action: 'continue', refs: [], explicit_binding: true, retract: [] } })])
    const marker = `RVPOISON${v}`
    const correctionText = zh ? '这条不是青禾的，是白桦的。' : 'That belongs to Birch, not Atlas.'
    const retract = [{ turn_i: 0, from_topic_id: 'a', markers: [marker] }]
    add('correction', [
      makeTurn(0, zh ? `${marker} 预算定为 800 元，填进 report.csv。` : `${marker} budget is 800, put it in report.csv.`, 'b',
        { ambiguous: true, must_include: [marker, '800', 'report.csv'], worker_actions: [
          { name: 'theone_record', arguments: { items: [{ label: marker, kind: 'fact', value: '800', evidenceQuote: zh ? `${marker} 预算定为 800 元` : `${marker} budget is 800` }] } },
          { name: 'theone_update_state', arguments: { state: marker, constraints: marker } }] }),
      makeTurn(1, short, 'b', { style: 'implicit', events_before: [{ type: 'correction', id: 'move', turn_i: 0, target_topic_id: 'b', text: correctionText }],
        gold: { thread: 'b', action: 'continue', refs: [], explicit_binding: false, retract } }),
      makeTurn(2, short, 'b', { at: new Date(Date.UTC(2026, 8, v + 2, 9)).toISOString(), style: 'implicit',
        events_before: [{ type: 'restart', id: 'restart-after-correction' }],
        gold: { thread: 'b', action: 'continue', refs: [], explicit_binding: false, retract } })])
    const createdMarker = `RVNEW${v}`
    add('correction_new', [makeTurn(0, zh ? `${createdMarker} 预算定为 800 元。` : `${createdMarker} budget is 800.`, 'b',
      { ambiguous: true, must_include: [createdMarker, '800'] }),
      makeTurn(1, short, 'b', { events_before: [{ type: 'correction', id: 'move-created', turn_i: 0, target_topic_id: 'b', text: correctionText }],
        gold: { thread: 'b', action: 'continue', refs: [], explicit_binding: false,
          retract: [{ turn_i: 0, from_topic_id: '$routed', markers: [createdMarker] }] } })], { current_id: null })
    add('restart', [makeTurn(0, names[1] + (zh ? '，保存这份计划。' : ': save this plan.'), 'b'),
      makeTurn(1, zh ? '昨天的计划继续。' : "Continue yesterday's plan.", 'b',
        { at: new Date(Date.UTC(2026, 8, v + 2, 9)).toISOString(), events_before: [{ type: 'restart', id: 'next-day' }] })])
    const big = Array.from({ length: 24 }, (_, i) => ({ id: 'c' + String(i).padStart(2, '0'),
      title: zh ? `项目${v}-${i}数据发布` : `Project ${v}-${i} data release`,
      summary: zh ? `第${i}个同域项目，使用 report.csv，分片 SHARD${v}X${i}` : `Same-domain project ${i}, report.csv, shard SHARD${v}X${i}`,
      entities: ['report.csv', `SHARD${v}X${i}`], keywords: ['release', 'data'], lastState: 'waiting' }))
    add('large_catalog', [
      makeTurn(0, big[22].title + (zh ? '，修复发布脚本。' : ': repair the release script.'), 'c22', { must_include: [big[22].title] }),
      makeTurn(1, zh ? `回到 SHARD${v}X19 的报表。找到之前那份。` : `Return to the report for SHARD${v}X19. Find the earlier one.`, 'c19', { must_include: [`SHARD${v}X19`] }),
      makeTurn(2, zh ? `回到之前 SHARD${v}X23 的数据发布项目，那个 report.csv。` : `Return to the earlier data release project for SHARD${v}X23 and its report.csv.`, 'c23', { must_include: [`SHARD${v}X23`] })],
      { catalog: big, threads: big.map(t => ({ id: t.id, title: t.title, description: t.summary, domain: 'software' })), current_id: 'c00' })
    add('homonym', [makeTurn(0, names[0] + (zh ? '，编辑 report.csv。' : ': edit report.csv.'), 'a', { must_include: [names[0], 'report.csv'] }),
      makeTurn(1, names[1] + (zh ? '，同名 report.csv 的列名也要改。' : ': rename the columns in its own report.csv too.'), 'b', { must_include: [names[1], 'report.csv'] })])
    add('reference', [makeTurn(0, names[0] + (zh ? '，继续报告，同时参考' : ': continue the report, referring to ') + names[1] + (zh ? '的格式。' : ' formatting.'),
      'a', { must_include: names, gold: { thread: 'a', action: 'continue', refs: ['b'], explicit_binding: false, retract: [] } })])
    add('oneoff', [makeTurn(0, names[0] + (zh ? '，继续整理数据。' : ': organize the data.'), 'a'),
      makeTurn(1, '17 * 23?', null, { locked_text: true, gold: { thread: null, action: 'oneoff', refs: [], explicit_binding: false, retract: [] }, reply: '391' }),
      makeTurn(2, short, 'a', { style: 'implicit' })])
    add('new_task', [makeTurn(0, names[0] + (zh ? '，继续整理数据。' : ': organize the data.'), 'a'),
      makeTurn(1, zh ? '新话题：规划一次去海边的旅行。' : 'New topic: plan a beach holiday.', 'holiday',
        { gold: { thread: 'holiday', action: 'new', refs: [], explicit_binding: false, retract: [] } })],
      { threads: [...topics.map(t => ({ id: t.id, title: t.title, description: t.summary })), { id: 'holiday', title: 'Beach holiday', description: 'Plan a holiday' }] })
  }
  validateRoutingSet(sessions)
  return sessions
}

export async function renderRoutingSet(sessions, client) {
  validateRoutingSet(sessions)
  const rendered = new Map(), result = []
  for (const session of sessions) {
    const key = session.pair?.id ?? session.session_id
    if (!rendered.has(key)) {
      const answer = await client.complete({ system: RENDER_ROUTING, json: true, temperature: 0.6, maxTokens: 3000,
        tag: 'routing-render:' + key, session: key, user: JSON.stringify({ lang: session.lang, scenario: session.scenario,
          threads: session.threads, plan: session.turns }) })
      const messages = answer?.messages
      if (!Array.isArray(messages) || messages.length !== session.turns.length ||
          new Set(messages.map(m => m.i)).size !== messages.length) throw new Error(key + ': incomplete rendered messages')
      for (const turn of session.turns) {
        const message = messages.find(m => m.i === turn.i)
        if (!message || !message.text?.trim() || typeof message.reply !== 'string') throw new Error(key + ': missing text/reply')
        if (turn.locked_text) message.text = turn.text
        const anchors = [...turn.must_include ?? [], ...session.threads.map(t => t.title).filter(title => turn.text.includes(title)), ...(turn.worker_actions ?? []).flatMap(a => a.arguments.items?.map(i => i.evidenceQuote) ?? [])]
        if (anchors.some(anchor => !message.text.includes(anchor))) throw new Error(key + ': lost required evidence/object')
      }
      rendered.set(key, messages)
    }
    result.push({ ...session, generation: 'model-rendered', turns: session.turns.map(turn => {
      const message = rendered.get(key).find(m => m.i === turn.i)
      return { ...turn, text: message.text, reply: message.reply }
    }) })
  }
  validateRoutingSet(result)
  return result
}

export function datasetManifest(sessions, jsonl) {
  const count = selected => ({ sessions: selected.length, messages: selected.reduce((n, s) => n + s.turns.length, 0),
    mechanisms: Object.fromEntries([...Map.groupBy(selected, s => s.scenario)].map(([key, group]) => [key, {
      sessions: group.length, messages: group.reduce((n, s) => n + s.turns.length, 0) }])),
    explicit_binding: selected.reduce((n, s) => n + s.turns.filter(t => t.gold.explicit_binding).length, 0),
    pair_groups: new Set(selected.filter(s => s.pair).map(s => s.pair.id)).size })
  return { version: 'interleave-v1', routing_schema: 'routing-v1', benchmark_revision: 'step7', generator: 'generate-routing-v1.mjs',
    generation: sessions[0]?.generation, sha256: createHash('sha256').update(jsonl).digest('hex'),
    split_policy: 'Whole variant groups, both languages and both pair sides stay together; last quarter is test.',
    ...count(sessions), splits: Object.fromEntries(['dev', 'test'].map(split => [split, count(sessions.filter(s => s.split === split))])) }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { templates: { type: 'boolean' }, 'dry-run': { type: 'boolean' },
    variants: { type: 'string', default: '8' }, out: { type: 'string' }, model: { type: 'string' } } })
  if (!values.templates && !values.out) throw new Error('Model generation requires --out pointing to a NEW dataset directory')
  const out = values.out ?? 'eval/data/interleave-v1'
  if (existsSync(join(out, 'sessions.jsonl'))) throw new Error('Refusing to overwrite an existing dataset: ' + out)
  let sessions = buildRoutingSet({ variants: Number(values.variants) })
  if (!values.templates) {
    const { createClient } = await import('./lib/llm.mjs')
    const client = await createClient({ model: values.model, fake: values['dry-run'] ? fileURLToPath(new URL('./test/fake-model.mjs', import.meta.url)) : undefined })
    sessions = await renderRoutingSet(sessions, client)
  }
  const jsonl = sessions.map(s => JSON.stringify(s)).join('\n') + '\n'
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'sessions.jsonl'), jsonl)
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(datasetManifest(sessions, jsonl), null, 2) + '\n')
  console.log(`Wrote ${sessions.length} routing-v1 sessions to ${out}`)
}
