import type { ContextDescriptor, Decision } from './types.ts'

/** Keep credentials out of classifier payloads and automatically generated titles. */
export function redactRoutingText(text: string): string {
  return text.replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_KEY]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/((?:api[_-]?key|access[_-]?token|password|secret|密码|密钥)\s*[=:：]\s*)[^\s,;，；]+/gi, '$1[REDACTED]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '[REDACTED_IP]')
}

/** Routing needs old conversation state only for an actual backward reference.
 * Missing factual knowledge (including an unfamiliar name) is the Worker's job.
 */
export function referencesHistory(text: string): boolean {
  const input = text.trim()
  return /(?:上次|之前|此前|刚才|昨天|前天|上周|先前|原来|你说的|我们聊的).{0,16}(?:那个|那件|那份|那项|方案|链接|文件|配置|项目|会话|聊天|提到|说过|讨论|发的|资料|任务)/.test(input)
    || /(?:继续|接着|回到|恢复).{0,6}(?:上次|之前|此前|刚才|昨天|前天|上周)/.test(input)
    || /(?:之前|上次|刚才)(?:提到|说|聊|发|做|用|定|选|给)|你(?:还)?记得|我们(?:之前|上次)聊/.test(input)
    || /^(?:继续|接着|再来|那(?:个|件|份|项)|这个|它|还有你说的|你说的)(?:[，,。.!！?？\s]|$)/.test(input)
    || /^(?:那个|这个|它的)|不是这个|是另一个|说错.{0,8}话题/.test(input)
    || /\b(?:last time|previous (?:chat|conversation|session)|earlier (?:chat|conversation)|(?:link|file|plan|project|task) (?:from |we discussed )?(?:yesterday|before)|(?:you|we) (?:mentioned|discussed|said|sent)|(?:continue|resume) (?:the |our )?(?:previous|last|earlier)|remember when)\b/i.test(input)
    || /\b(?:previous|earlier|last|that) (?:link|file|plan|project|task|conversation|session)\b/i.test(input)
    || /^(?:continue|resume|go on|do that|that one|it)\s*[.!?]*$/i.test(input)
}

export function newIndependentTopic(text: string, contexts: ContextDescriptor[], reason: string): Decision {
  const base = redactRoutingText(text).trim().replace(/\s+/g, ' ').slice(0, 80) || 'New topic'
  let title = base
  // A question can be new even if its text happens to equal a directory title.
  for (let index = 2; contexts.some(context => context.title.toLowerCase() === title.toLowerCase()); index++)
    title = `${base.slice(0, 68)} (${index})`
  return { action: 'CREATE', title, reason, historyIndependent: true }
}

/** A bare acknowledgement or "go on" can only continue the mounted topic, so it needs no classifier call. */
export function continuesCurrent(text: string): boolean {
  const input = text.trim()
  return input.length <= 16 && /^(?:继续(?:说|写|做)?|接着(?:说|写|做|来)?|然后呢?|还有呢|好的?|好吧|可以|行|嗯+|对的?|是的|没问题|收到|谢谢|多谢|辛苦了|为什么|为啥|怎么说|详细(?:点|些|一点|说说)|展开(?:说说|讲讲)?|再详细(?:点|些|一点)?|ok(?:ay)?|yes|thanks?|thank you|go on|continue|why|more)[\s!！。.,，?？~～…]*$/i.test(input)
}
