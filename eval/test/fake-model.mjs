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
        facts: [{ key: 'budget', value: `${(index + 1) * 100}`, update: `${(index + 1) * 90}`, alternative: `${(index + 1) * 100 + 50}` },
          { key: 'date', value: `D${index + 3}`, update: null, alternative: `D${index + 7}` }, { key: 'owner', value: `P${index}`, update: null, alternative: `Q${index}` }],
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
  if (step === 'render1' || step === 'rewrite1') {
    // v1: an exchange per entry; the fact step is carried by fixed phrases the fake extractor reads.
    const zh = payload.lang === 'zh'
    const title = id => payload.threads.find(thread => thread.id === id)?.title ?? ''
    const write = entry => {
      if (entry.thread === 'ONE-OFF') return { user: zh ? '17乘23等于多少' : 'what is 17 times 23', assistant: '391' }
      const fact = entry.fact
      const refs = entry.refs.length ? (zh ? `，用上${title(entry.refs[0])}那边的数` : `, use the numbers from ${title(entry.refs[0])}`) : ''
      const lead = { implicit: zh ? '好的下一步' : 'next step', pronoun: zh ? '回到那个事' : 'back to that one', cue: zh ? '关于那份清单' : 'about the list' }[entry.style]
        ?? (zh ? `${title(entry.thread)}：继续` : `${title(entry.thread)}: let's continue`)
      let user = lead + refs, assistant = zh ? '明白。' : 'Got it.'
      if (fact) {
        const say = {
          intro: zh ? ` ${fact.key} ${fact.value}` : ` ${fact.key} ${fact.value}`,
          update: zh ? ` ${fact.key} 改成 ${fact.value}` : ` ${fact.key} now ${fact.value}`,
          propose: zh ? ` ${fact.key} 你建议定多少` : ` what ${fact.key} do you suggest`,
          accept: zh ? `。好，就按你说的` : `. ok, go with that`,
          reject: zh ? `。不行，${fact.key} 用 ${fact.value}` : `. no, ${fact.key} ${fact.value}`,
          retract: zh ? ` ${fact.key} 先不定了` : ` ${fact.key} is off for now`,
        }[fact.kind]
        user += say
        if (fact.kind === 'propose') assistant = zh ? `建议 ${fact.key} ${fact.value}` : `I suggest ${fact.key} ${fact.value}`
      }
      return { user, assistant }
    }
    return JSON.stringify({ messages: payload.plan.map(entry => ({ n: entry.n, ...write(entry) })) })
  }
  if (step === 'check1') {
    // Reads the fixed phrases the fake writer uses for each step.
    const said = text => text.includes(payload.value)
    const ok = { intro: said(payload.user), update: said(payload.user), reject: said(payload.user),
      propose: said(payload.assistant) && !said(payload.user), accept: /好，就按你说的|go with that/.test(payload.user),
      retract: /先不定了|is off/.test(payload.user) }[payload.step]
    return JSON.stringify({ ok: !!ok, why: 'fake' })
  }
  if (step === 'extract') {
    // Reads the fixed phrases above. It also records the assistant's suggestions, as a careless
    // extractor would, so the evidence check is exercised.
    const id = label => payload.facts.find(fact => fact.label === label)?.factId ?? null
    const KEY = '(budget|date|owner)'
    const items = []
    const off = payload.user.match(new RegExp(`${KEY} (先不定了|is off)`))
    const accept = payload.user.match(/好，就按你说的|ok, go with that/)
    const suggested = [...payload.assistant.matchAll(new RegExp(`(?:建议|I suggest) ${KEY} (\\S+)`, 'g'))].at(-1)
    const stated = payload.user.match(new RegExp(`${KEY} (?:改成 |now |用 )?([A-Z]?\\d+)`))
    if (off) items.push({ op: 'retract', factId: id(off[1]), evidenceQuote: off[0] })
    else if (accept && suggested) items.push({ op: 'set', factId: id(suggested[1]), label: suggested[1], kind: 'fact', value: suggested[2], evidenceQuote: accept[0], acceptsQuote: suggested[0] })
    else if (stated) items.push({ op: 'set', factId: id(stated[1]), label: stated[1], kind: 'fact', value: stated[2], evidenceQuote: stated[0] })
    if (suggested && !accept) items.push({ op: 'set', factId: id(suggested[1]), label: suggested[1], kind: 'fact', value: suggested[2], evidenceQuote: suggested[0] })
    return JSON.stringify(items)
  }
  if (step === 'summary') {
    return payload.messages.map(message => message.user).join(' / ')
  }
  if (step === 'answer') {
    // The last value said for the asked key anywhere in what it was given; withdrawn means undecided.
    const key = ['budget', 'date', 'owner'].find(name => payload.question.includes(name))
    const lines = [...payload.conversation.map(message => message.text), payload.notes].join('\n').split('\n')
    let value
    for (const line of lines) {
      const at = line.indexOf(key)
      if (at < 0) continue
      const rest = line.slice(at).replace(/（第.*$/, '')
      if (/先不定了|is off|已撤回|没有确认/.test(rest)) value = 'withdrawn'
      else value = rest.match(/[A-Z]?\d+/g)?.at(-1) ?? value
    }
    const undecided = payload.question.includes('未确定') ? '未确定' : 'undecided'
    return !value || value === 'withdrawn' ? undecided : value
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
  if (step === 'route' && payload.texts) {
    // A burst decided message by message: the same rules, following topics created earlier in it.
    let current = payload.currentId
    const decisions = payload.texts.map((text, k) => {
      const named = payload.contexts.find(context => text.toLowerCase().startsWith(context.title.toLowerCase()))
      const existing = named?.id ?? current
      const row = existing
        ? { action: 'EXISTING', contextId: existing, title: null, question: null, reason: named ? 'named' : 'continues', historyIndependent: null, candidateIds: [], relatedIds: [] }
        : { action: 'CREATE', contextId: null, title: text.slice(0, 30) || 'New', question: null, reason: 'new', historyIndependent: true, candidateIds: [], relatedIds: [] }
      current = existing ?? `new:${k}`
      return row
    })
    return JSON.stringify({ decisions })
  }
  if (step === 'route') {
    // TheOne's routing payload: stay on the current topic unless a title is named; create otherwise.
    // With facts offered: import those whose topic and name the message mentions.
    const imports = (payload.symbols ?? []).filter(symbol => payload.text.includes(symbol.topic) && payload.text.includes(symbol.label)).map(symbol => symbol.id)
    const decide = decision => JSON.stringify(payload.symbols ? { ...decision, imports } : decision)
    const named = payload.contexts.find(context => payload.text.toLowerCase().startsWith(context.title.toLowerCase()))
    if (named) return decide({ action: 'EXISTING', contextId: named.id, title: null, question: null, reason: 'named', historyIndependent: null, candidateIds: [], relatedIds: [] })
    if (payload.currentId) return decide({ action: 'EXISTING', contextId: payload.currentId, title: null, question: null, reason: 'continues', historyIndependent: null, candidateIds: [], relatedIds: [] })
    return decide({ action: 'CREATE', contextId: null, title: payload.text.slice(0, 30) || 'New', question: null, reason: 'new', historyIndependent: true, candidateIds: [], relatedIds: [] })
  }
  throw new Error(`fake model: unknown step ${step}`)
}
