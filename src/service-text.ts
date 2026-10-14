import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextDescriptor, Decision } from './types.ts'

export function redactDescriptor(text: string): string {
  return text.replace(/\bsk-[a-zA-Z0-9_-]{16,}|\bBearer\s+\S+/gi, '[REDACTED]')
    .replace(/((?:api[_ -]?key|password|密码|密钥)\s*[:=：]\s*)\S+/gi, '$1[REDACTED]')
}

/** DSH's goal tools; in a topic they act on main chat's goal. */
export const GOAL_TOOLS = new Set(['get_goal', 'create_goal', 'update_goal'])

/** TheOne's own questions, in the language the message was written in; the classifier writes its own. */
export const CLARIFY_TEXT: Record<string, { zh: string; en: string }> = {
  CATALOG_NOT_READY: { zh: '你指的是之前哪件事？可以补充目标或链接，我就能继续处理。', en: 'Which earlier matter do you mean? Add the goal or a link and I can carry on.' },
  HISTORY_SEARCH_UNAVAILABLE: { zh: '历史检索暂时不可用，请稍后再试。', en: 'Searching your history is unavailable right now; please try again shortly.' },
  CATALOG_REVIEW_LIMIT: { zh: '暂时没有找到明确相关的旧话题。你是在说一件新的事情吗？', en: 'I found no earlier topic that clearly matches. Is this something new?' },
  ROUTER_MODEL_MISSING: { zh: '请先在 DSH 中选择一个已配置的聊天模型，再打开 TheOne。无需另配 API Key。', en: 'Choose a configured chat model in DSH first, then open TheOne. No separate API key is needed.' },
  'correction-unclear': { zh: '应该放到哪个话题？可以说「分错了，是 某某 的」，我会把上一条交给它重新处理。', en: 'Which topic should it go to? Say "wrong topic, it is about …" and I will redo the last message there.' },
  'multiple-contexts': { zh: '这句话涉及多个话题，请指定先处理哪个。', en: 'This touches several topics; which one first?' },
}
export const writtenInEnglish = (text: string) => !!text.trim() && !/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(text)
export function clarifyText(decision: Decision, text: string): string {
  const fixed = CLARIFY_TEXT[decision.reason]
  return fixed ? fixed[writtenInEnglish(text) ? 'en' : 'zh'] : decision.question!
}

/**
 * Messages that wake a session to work on its own, as DSH shows them ("Subtask status updated" and the
 * like), plus a late answer to a question. Notes DSH adds itself (a mode switch) wake nothing.
 */
export const WAKING_SOURCES = new Set(['subagent-settled', 'agent-message', 'team-message', 'tool-jobs', 'schedule', 'webhook',
  'cordis-host-runner', 'user-question-reply'])

/** The words of a message, without its attachments. */
export function messageText(message: UserMessage): string {
  return message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
}

/** The topic descriptor as valid JSON within `budget` characters: fields are shortened, never the JSON. */
export function descriptorJson(context: Pick<ContextDescriptor, 'title' | 'summary' | 'lastState'>, budget: number): string {
  const clip = (text: string, max: number) => text.length > max ? text.slice(0, Math.max(0, max - 1)) + '…' : text
  const title = clip(context.title, 120)
  const room = Math.max(64, budget - title.length - 60)
  const lastState = clip(context.lastState, Math.floor(room / 3))
  return JSON.stringify({ title, summary: clip(context.summary, room - lastState.length), lastState })
}

export const TERMS_PROMPT = `你在帮话题路由器从用户的更正中学习。用户确认这条 message 属于 rightTopic（而不是 wrongTopic）。
从 message 原文中挑出最多 4 个能把它和 rightTopic 联系起来、又能和 wrongTopic 区分开的词语：项目名、术语、产品、人名、文件名等，每个 2–12 个字，必须在 message 中原样出现。
不要选泛泛的词（如「帮我」「这个」「问题」），不要选 wrongTopic 的名字。只输出 JSON 字符串数组，例如 ["消融实验","第三章"]。`

/** The first words of a new main chat, in the interface language. */
export function welcomeText(locale: string): string {
  return locale.toLowerCase().startsWith('zh')
    ? '你好！以后所有的事都在这里聊就行。TheOne 会判断每句话属于哪件事，交给那件事自己的后台会话去做，过程原样显示在这里。你以前在 DSH 里聊过的内容，会整理到左侧的「话题工作区」。'
    : 'Hi! From now on, just talk here about anything. TheOne works out which topic each message belongs to, hands it to that topic\'s own background session, and shows the work right here. Your earlier DSH conversations are organized under **Topic workspaces** in the sidebar.'
}

/** Why a message went where it did, as a short phrase for the "show every decision" notice. */
export function reasonLabel(reason: string, english = false): string {
  const fixed: Record<string, string> = english ? {
    'steering': 'added during the reply', 'short-continuation': 'continuing', 'attachment-only': 'attachment', 'correction': 'your correction',
    'explicit-new-topic': 'new topic', 'no-history-evidence': 'new question', 'entity-or-keyword': 'mentions this topic',
    'keyword-only-switch': 'mentions this topic', 'current-reference': 'same topic', 'combined-contexts': 'combines topics',
    'insufficient-evidence': 'no matching topic', 'multiple-contexts': 'several topics fit', 'weak-keyword-match': 'new question', 'no-history-match': 'new question',
    'CATALOG_NOT_READY': 'history still being catalogued', 'CATALOG_REVIEW_LIMIT': 'no clearly related topic', 'HISTORY_SEARCH_UNAVAILABLE': 'history search unavailable',
    'goal-round': 'goal round',
  } : {
    'steering': '回复中补充', 'short-continuation': '接着说', 'attachment-only': '附件', 'correction': '按你的更正',
    'explicit-new-topic': '明确的新话题', 'no-history-evidence': '新的问题', 'entity-or-keyword': '提到了这个话题',
    'keyword-only-switch': '提到了这个话题', 'current-reference': '接着当前话题', 'combined-contexts': '结合多个话题',
    'insufficient-evidence': '没有匹配的旧话题', 'multiple-contexts': '多个话题都可能', 'weak-keyword-match': '新的问题', 'no-history-match': '新的问题', 'CATALOG_NOT_READY': '历史还在整理',
    'CATALOG_REVIEW_LIMIT': '没有找到明确相关的旧话题', 'HISTORY_SEARCH_UNAVAILABLE': '历史检索暂不可用', 'goal-round': '推进目标',
  }
  if (fixed[reason]) return fixed[reason]
  if (reason.startsWith('router-fallback:')) return english ? 'classifier unavailable, routed by rules' : '分类暂不可用，按规则判断'
  const text = reason.replace(/\s+/g, ' ').trim()
  return text.length > 60 ? text.slice(0, 59) + '…' : text
}
