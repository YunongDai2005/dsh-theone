import type { ContextDescriptor, Decision } from './types.ts'

const normalize = (value: string): string => value.toLowerCase().replace(/[\s/_-]+/g, '')

/** Conservative lexical routing. Ambiguous references need clarification. */
export function resolveContext(text: string, contexts: ContextDescriptor[], currentId?: string): Decision {
  const current = contexts.find(context => context.id === currentId)
  const input = text.trim()
  const newTopic = input.match(/^(?:新话题[：:]\s*|我想开始|开始一个新项目[：:]?\s*)(.+)/)
  if (newTopic) return { action: 'CREATE', title: newTopic[1].trim().slice(0, 80), reason: 'explicit-new-topic' }
  // Negated/deferred clauses don't nominate a Context. A later explicit resumption
  // specifies the active focus, while a request to combine topics stays ambiguous.
  const positiveText = input.replace(/我的意思是/g, '，我的意思是').replace(/(?:不是|不要|别用|先不管|暂时不管)[^，,。；;]*(?:[，,。；;]|$)/g, '')
  const focus = /结合|一起用|对比/.test(input) ? positiveText
    : positiveText.match(/(?:然后|接着)\s*(?:继续|配置|处理)(.+)$/)?.[1] ?? positiveText
  const positive = normalize(focus)
  const candidates = contexts.filter(context =>
    [...context.entities, ...context.keywords, context.title]
      .some(term => normalize(term).length >= 2 && positive.includes(normalize(term))),
  )
  if (candidates.length > 1 || (/结合|一起用|对比/.test(input) && candidates.length === 1 && current && candidates[0].id !== current.id)) {
    return { action: 'CLARIFY', reason: 'multiple-contexts', question: '这句话涉及多个话题，请指定先处理哪个。' }
  }
  // Corrections to details inside the selected topic are ordinary continuations.
  if (candidates.length === 1) {
    const context = candidates[0]
    const explicitEntity = [...context.entities, context.title].some(term => normalize(term).length >= 2 && positive.includes(normalize(term)))
    if (current && context.id !== current.id && !explicitEntity && !/回到|切换|换到|先.*(?:处理|修|聊)|谈谈|聊聊/.test(input)) {
      return { action: 'CLARIFY', reason: 'keyword-only-switch', question: `你是在继续“${current.title}”，还是切换到“${context.title}”？` }
    }
    return { action: current?.id === context.id ? 'KEEP' : current ? 'SWAP' : 'MOUNT', contextId: context.id, reason: 'entity-or-keyword' }
  }
  const unresolvedSwitch = /昨天|前天|上周|回到|换个|另外|另一个|不是这个|不是.{0,8}话题|说错.{0,8}话题/.test(input)
  const reference = /^(?:继续|那|这个|它|接着|再|为什么|怎么|好|可以|还有你说的|你说的|你帮我|算了)/.test(input)
    || /(?:它的|这个.{0,12}(?:配置|修复)|里面已经开好了|合成.{0,12}归档)/.test(input)
  if (current && reference && !unresolvedSwitch) {
    return { action: 'KEEP', contextId: current.id, reason: 'current-reference' }
  }
  const examples = contexts.slice(0, 2).map(context => `“${context.entities[0] ?? context.title}”`).join('或')
  return { action: 'CLARIFY', reason: 'insufficient-evidence', question: `你指的是哪个话题？${examples ? `可以说${examples}；` : ''}新话题请以“新话题：”开头。` }
}
