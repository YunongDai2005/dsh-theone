// Routing evidence from what each topic has already said. Before the classifier runs, the details a
// message names (numbers, codes, names, uncommon words) are looked up in every topic's own messages
// and card; a detail only one topic has ever mentioned is a clue to where the message belongs.
// After the classifier, a decision that goes against a strong clue is asked again, with thinking on.

import type { Decision } from './types.ts'
import { redactRoutingText } from './routing-policy.ts'

/** What a topic has said: its messages, and what its card and catalog entry know. */
export interface TopicMemory { id: string; texts: readonly string[] }

/** Details of the message that only this topic has mentioned. Strong: a number, code or name. */
export interface Evidence { contextId: string; terms: string[]; strong: boolean }

export const EVIDENCE_LIMITS = { topics: 3, terms: 4 } as const

const STOP = new Set(['what', 'when', 'where', 'which', 'with', 'that', 'this', 'there', 'their', 'then', 'than', 'they', 'them',
  'have', 'from', 'about', 'should', 'would', 'could', 'into', 'just', 'like', 'also', 'still', 'does', 'make', 'need', 'want',
  'next', 'thing', 'things', 'think', 'much', 'many', 'more', 'some', 'only', 'even', 'here', 'your', 'yours', 'okay', 'sure',
  'actually', 'again', 'other', 'really', 'right', 'good', 'help', 'know', 'mean', 'said', 'going', 'back', 'part', 'stuff'])
const CJK_STOP = new Set(['什么', '怎么', '可以', '一下', '这个', '那个', '我们', '你们', '觉得', '是不是', '要不要', '多少', '时候',
  '现在', '已经', '还是', '应该', '需要', '问题', '帮我', '一个', '这样', '那样', '然后', '还有', '如果', '的话', '我想', '能不能',
  '有没有', '怎么样', '为什么', '就是', '不是', '没有', '一点', '大概', '实际', '比较', '感觉', '下一步', '接下来', '顺便', '另外'])

const normalize = (text: string) => redactRoutingText(text).toLowerCase().replace(/(\d),(?=\d{3}\b)/g, '$1')

/** The details of a message worth looking up, each marked strong (number, code, name) or not. */
export function evidenceTerms(text: string): { term: string; strong: boolean }[] {
  const source = redactRoutingText(text)
  const found = new Map<string, boolean>()
  const add = (term: string, strong: boolean) => { if (!term.startsWith('redacted')) found.set(term, (found.get(term) ?? false) || strong) }
  for (const match of source.matchAll(/[A-Za-z]+[-_]?\d[\w-]*|\d[\d,]*(?:\.\d+)?/g)) {
    const term = match[0].toLowerCase().replace(/,/g, '').replace(/[-_]+$/, '')
    const digits = term.replace(/\D/g, '').length
    if (digits >= 2 || /[a-z]/.test(term)) add(term, digits >= 3 || /[a-z]/.test(term) || term.includes('.'))
  }
  for (const match of source.matchAll(/[A-Za-z][A-Za-z'-]{2,}/g)) {
    const word = match[0].replace(/'s$/i, '')
    if (word.length < 4 || STOP.has(word.toLowerCase())) continue
    // A capitalized word inside a sentence is usually a name.
    const before = source.slice(0, match.index)
    const inside = match.index > 0 && (!/[.!?。！？]\s*$/.test(before) || /\b(?:Mr|Mrs|Ms|Dr|St)\.\s*$/.test(before))
    add(word.toLowerCase(), inside && /^[A-Z][a-z]/.test(word))
  }
  for (const run of source.replace(/[的了和与及把在是吗呢吧也就都还要给让被个]/g, ' ').match(/[一-鿿]{2,}/g) ?? [])
    for (let size = Math.min(4, run.length); size >= 2; size--)
      for (let start = 0; start + size <= run.length; start++) {
        const term = run.slice(start, start + size)
        if (!CJK_STOP.has(term)) add(term, false)
      }
  return [...found].map(([term, strong]) => ({ term, strong }))
}

/** Topics holding details of `text` that no other topic holds, the most telling first. */
export function routingEvidence(text: string, topics: readonly TopicMemory[]): Evidence[] {
  if (topics.length < 2) return []
  const memory = topics.map(topic => ({ id: topic.id, text: normalize(topic.texts.join('\n')) }))
  const byTopic = new Map<string, { term: string; strong: boolean }[]>()
  for (const candidate of evidenceTerms(text)) {
    const holders = memory.filter(topic => topic.text.includes(candidate.term))
    if (holders.length !== 1) continue
    const list = byTopic.get(holders[0].id) ?? []
    byTopic.set(holders[0].id, [...list, candidate])
  }
  const evidence = [...byTopic].map(([contextId, terms]) => {
    // A longer detail says it all: drop the pieces of it.
    const kept = terms.filter(item => !terms.some(other => other.term !== item.term && other.term.includes(item.term)))
      .sort((a, b) => Number(b.strong) - Number(a.strong) || b.term.length - a.term.length).slice(0, EVIDENCE_LIMITS.terms)
    return { contextId, terms: kept.map(item => item.term), strong: kept.some(item => item.strong), weight: kept.reduce((sum, item) => sum + item.term.length + (item.strong ? 10 : 0), 0) }
  })
  return evidence.sort((a, b) => b.weight - a.weight).slice(0, EVIDENCE_LIMITS.topics).map(({ weight: _, ...item }) => item)
}

/**
 * The topic a strong clue points to when the decision went elsewhere (another topic, a new topic,
 * or a question), or undefined. Only one topic may hold strong clues; several cancel out.
 */
export function evidenceConflict(decision: Decision, evidence: readonly Evidence[]): string | undefined {
  const strong = evidence.filter(item => item.strong)
  if (strong.length !== 1) return undefined
  return decision.contextId === strong[0].contextId ? undefined : strong[0].contextId
}

/** Added to the routing prompt only when evidence is offered. */
export const EVIDENCE_PROMPT = `
evidence（可能没有）是程序在各话题已有的消息和卡片里查到的：本轮 text 提到的细节（数字、编号、名字、少见的词）中，只有这个话题出现过的那些。strong 为 true 表示其中有数字、编号或名字。它是线索，不是结论：细节可能只是碰巧相同，也可能是新事情第一次提到；结合整句意思判断。`

/** Added when a decision went against a strong clue and the classifier is asked again. */
export const RECHECK_PROMPT = `
recheck 表示你上一次的判断和程序找到的线索不一致：上次选了 recheck.previous，但 text 里的 recheck.terms 只在话题 recheck.contextId 里出现过。重新判断一次：如果这句话确实在说那个话题的事，就选它；如果只是碰巧提到相同的细节，保持原判断。`
