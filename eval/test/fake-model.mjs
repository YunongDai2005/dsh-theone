// A stand-in model for dry runs and tests: answers each pipeline step from its JSON payload, so the
// whole pipeline runs offline. Its messages are crude on purpose; never publish its output.
const TOPICS = {
  en: ['Kitchen tap replacement', 'Rust CLI release', 'Lisbon weekend trip', 'Half marathon training', 'Tax return 2026', 'Wedding seating plan'],
  zh: ['换厨房水龙头', '记账小程序上线', '成都周末旅行', '半马训练计划', '年度个税申报', '婚礼座位安排'],
}

export default async function answer({ user, tag }) {
  const payload = JSON.parse(user)
  const step = tag.split(':')[0]
  if (step === 'spec') {
    const names = TOPICS[payload.lang]
    return JSON.stringify({ persona: payload.lang === 'zh' ? '一位在上班的设计师' : 'A designer with a day job',
      threads: payload.domains.map((domain, index) => ({ title: payload.twin && index === 2 ? `${names[1]} 2` : names[index], domain,
        goal: `goal ${index + 1}`, description: `${names[index]} — ${domain}`,
        facts: [{ key: 'budget', value: `${(index + 1) * 100}`, update: `${(index + 1) * 90}` }, { key: 'date', value: `day ${index + 3}`, update: null }, { key: 'owner', value: `P${index}`, update: null }],
        constraints: index === 0 ? ['keep it short'] : [] })) })
  }
  if (step === 'render' || step === 'rewrite') {
    const title = id => payload.threads.find(thread => thread.id === id)?.title ?? ''
    const zh = payload.lang === 'zh'
    const write = entry => {
      if (entry.thread === 'ONE-OFF') return zh ? '17乘23等于多少' : 'what is 17 times 23'
      const fact = entry.fact ? ` ${entry.fact.key} ${entry.fact.kind === 'update' ? entry.fact.update : entry.fact.value}` : ''
      const refs = entry.refs.length ? (zh ? `，用上${title(entry.refs[0])}那边的数` : `, use the numbers from ${title(entry.refs[0])}`) : ''
      switch (entry.style) {
        case 'implicit': return (zh ? '好的下一步' : 'ok next step') + fact + refs
        case 'pronoun': return (zh ? '回到那个事' : 'back to that one') + fact + refs
        case 'cue': return (zh ? `关于 ${entry.fact?.value ?? '那个数'} 的事` : `about the ${entry.fact?.value ?? 'number'} thing`) + fact + refs
        default: return (zh ? `${title(entry.thread)}：继续` : `${title(entry.thread)}: let's continue`) + fact + refs
      }
    }
    return JSON.stringify({ messages: payload.plan.map(entry => ({ n: entry.n, text: write(entry) })) })
  }
  if (step === 'judge') {
    let last = payload.earlier.at(-1)?.thread ?? 'none'
    const labels = payload.messages.map(message => {
      const named = payload.threads.find(thread => message.text.startsWith(thread.title))
      const thread = /17/.test(message.text) ? 'none' : named?.id ?? (last === 'none' ? 'ambiguous' : last)
      if (thread !== 'none' && thread !== 'ambiguous') last = thread
      return { n: message.n, thread, candidates: thread === 'ambiguous' ? payload.threads.slice(0, 2).map(item => item.id) : [] }
    })
    return JSON.stringify({ labels })
  }
  if (step === 'route') {
    // TheOne's routing payload: stay on the current topic unless a title is named; create otherwise.
    const named = payload.contexts.find(context => payload.text.toLowerCase().startsWith(context.title.toLowerCase()))
    if (named) return JSON.stringify({ action: 'EXISTING', contextId: named.id, title: null, question: null, reason: 'named', historyIndependent: null, candidateIds: [], relatedIds: [] })
    if (payload.currentId) return JSON.stringify({ action: 'EXISTING', contextId: payload.currentId, title: null, question: null, reason: 'continues', historyIndependent: null, candidateIds: [], relatedIds: [] })
    return JSON.stringify({ action: 'CREATE', contextId: null, title: payload.text.slice(0, 30) || 'New', question: null, reason: 'new', historyIndependent: true, candidateIds: [], relatedIds: [] })
  }
  throw new Error(`fake model: unknown step ${step}`)
}
