// Drives the real cluster engine (src/client-foam.ts) in a mock sidebar, to check the port against the prototype.
import { createFoam, foamCss, type FoamModel, type FoamTopic, type FoamPhase } from '../../src/client-foam.ts'

const style = document.createElement('style'); style.textContent = foamCss; document.head.append(style)
const button = document.querySelector<HTMLElement>('#card')!
const host = document.createElement('div'); document.body.append(host)
const log = document.querySelector<HTMLElement>('#log')!
const say = (s: string) => { log.textContent = s + '\n' + log.textContent!.slice(0, 600) }

const names: [string, number, string?][] = [['显卡选购', .95, '装机'], ['旅游', .9, '出行'], ['周末书单', .8, '读书'], ['晚餐灵感', .7], ['周报整理', .62, '工作'], ['论文润色', .55, '工作'], ['搬家清单', .48, '家'],
  ['基金定投', .42, '理财'], ['健身计划', .36], ['换季衣物', .3, '家'], ['租房合同', .26, '家'], ['日语', .22, '出行'], ['生日礼物', .18], ['咖啡豆', .14], ['猫粮', .1, '家'], ['读书笔记', .07, '读书']]
const topics: FoamTopic[] = names.map(([title, weight, group], i) => ({ id: 't' + i, title, weight, group, phase: 'idle' as FoamPhase }))
topics[0].current = true; topics[1].phase = 'running'; topics[1].startedAt = Date.now() - 12000; topics[2].phase = 'answered'
const model = (): FoamModel => ({ topics, links: [{ a: 't0', b: 't7', weight: .5 }, { a: 't1', b: 't9', weight: .35 }], pendingMerges: [] })

const foam = createFoam({
  host, mark: () => button.querySelector('svg'), side: () => document.querySelector('aside'),
  place: () => { const r = button.getBoundingClientRect(); host.style.left = r.left + 'px'; host.style.top = r.bottom + 'px'; host.style.width = r.width + 'px' },
  onHeight: h => { button.style.marginBottom = Math.round(h) + 10 + 'px' },
  onPulse: k => { (button.querySelector('svg') as SVGElement).style.transform = k > .002 ? `scale(${1 + .12 * k})` : '' },
  actions: {
    mount: id => { topics.forEach(t => t.current = t.id === id); foam.update(model()); say('mount ' + id) },
    merge: (id, into, later) => { say(`merge ${id} → ${into}${later ? ' (when idle)' : ''}`); if (!later) { topics.splice(topics.findIndex(t => t.id === id), 1); window.setTimeout(() => foam.update(model()), 900) } },
    attach: (id, s) => say(`attach ${s} → ${id}`),
    putAside: id => { const t = topics.find(t => t.id === id)!; t.aside = true; say('aside ' + id); window.setTimeout(() => foam.update(model()), 1500) },
    open: id => say('open ' + id), stop: id => say('stop ' + id), cancelQueued: id => say('cancel ' + id), remove: id => say('remove ' + id),
    showAnswer: id => say('show ' + id), reroute: async (m, to) => { say(`reroute ${m} → ${to}`); return 200 }, answer: id => say('answer ' + id), openWorkspace: () => say('open workspace'),
    text: (key, vars) => key + (vars ? ' ' + JSON.stringify(vars) : ''),
  },
})
foam.update(model())
;(window as unknown as Record<string, unknown>).harness = { foam, topics, model, refresh: () => foam.update(model()) }
let n = 0
const set = (i: number, phase: FoamPhase) => { topics[i].phase = phase; if (phase === 'running') topics[i].startedAt = Date.now(); foam.update(model()) }
const on = (id: string, f: () => void) => document.getElementById(id)!.addEventListener('click', f)
on('route', () => { const i = 3 + (n++ % 6); foam.event({ kind: 'route', to: topics[i].id, alternates: [topics[i + 1].id], messageId: 'msg' + n }); window.setTimeout(() => set(i, 'running'), 700) })
on('create', () => { const t: FoamTopic = { id: 'n' + n, title: ['周末露营', '面试准备', '牙医预约'][n++ % 3], weight: 1, phase: 'running', startedAt: Date.now() }; topics.push(t); foam.update(model()); foam.event({ kind: 'create', to: t.id }) })
on('finish', () => { const i = topics.findIndex(t => t.phase === 'running'); if (i >= 0) set(i, 'answered') })
on('show', () => { const i = topics.findIndex(t => t.phase === 'answered'); if (i >= 0) { topics.forEach(t => t.current = false); topics[i].current = true; set(i, 'idle') } })
on('wait', () => set(4, topics[4].phase === 'waiting' ? 'idle' : 'waiting'))
on('fail', () => set(5, topics[5].phase === 'failed' ? 'idle' : 'failed'))
on('blocked', () => foam.event({ kind: 'clarify', candidates: [topics[6].id, topics[10].id] }))
on('resolve', () => foam.event({ kind: 'resolve', to: topics[6].id }))
on('steer', () => { const t = topics.find(t => t.phase === 'running'); if (t) foam.event({ kind: 'supplement', to: t.id }) })
on('rail', () => { const r = !document.body.classList.toggle('wide'); foam.setRail(r) })
