// Prompts for writing benchmark sessions. Instructions are in English; the output follows `lang`.
// The user turn is always a JSON payload, so each step's inputs are explicit and cacheable.

export const DOMAINS = ['software project', 'academic writing', 'travel planning', 'personal finance', 'fitness and health',
  'home repair', 'learning a skill', 'job search', 'event planning', 'small business', 'data analysis', 'cooking',
  'paperwork and legal', 'school and parenting', 'music or photography hobby', 'moving house', 'buying a car or appliance']

export const SPEC_SYSTEM = `You design realistic test data for a benchmark of chat routing: one person uses a single chat with an AI assistant for several unrelated pieces of work at once. Output one JSON object only.

From the payload, invent a persona (one sentence) and exactly threadCount work threads this person pursues in parallel over a few days, one per given domain, in the given order.
Each thread:
- title: a short name (at most 6 words, or 12 Chinese characters)
- domain: the given domain
- goal: one sentence, what they want to achieve
- description: one or two sentences on what is being worked on
- facts: exactly 3 concrete specifics a helper must get right (numbers, dates, names, versions, amounts), each {"key": short label, "value": value, "update": a changed value that may come later, or null}; give at least one fact a non-null update
- constraints: 0 or 1 short rule the work must respect
If twin is true, threads 2 and 3 share a domain and vocabulary but have different goals and facts (for example two different trips, two different codebases), so that telling them apart takes attention.
Write every value in the language given by lang ("zh" = Simplified Chinese, "en" = English). Keep it everyday and plausible; no famous people.
Output: {"persona": "...", "threads": [{"title": "...", "domain": "...", "goal": "...", "description": "...", "facts": [{"key": "...", "value": "...", "update": null}], "constraints": []}]}`

export const RENDER_SYSTEM = `You write the user's side of a chat with an AI assistant, following a plan exactly. The assistant's replies are not shown. Output one JSON object only.

The payload has the persona, the work threads (id, title, goal, description, facts), the last messages already written (with their thread), and a plan: one entry per message to write now, in order. For each plan entry write one user message:
- thread: the work thread the message belongs to; "ONE-OFF" means a quick self-contained question that belongs to none of the threads (a definition, a conversion, a translation, a small calculation)
- action: new = opens this thread and says what they want; continue = keeps going on the same thread as the previous message; switch = moves to another thread used recently; return = comes back to a thread after a long time
- style:
  explicit = names the subject clearly in their own words (not necessarily the exact title)
  cue = points to the thread only through one specific detail (a fact value, a file, a person, a place), without naming the subject
  pronoun = only vague references ("that one", "the thing from before", "那个", "之前那件事"), as people do; it must still make sense from the flow of the chat
  implicit = a short follow-up that only works as a continuation of the previous message ("ok next step", "make it shorter", "what about the second option", "这个不行"), with no topic words at all
- refs: the message also uses something from these other threads (say what, e.g. "use the numbers from ... here")
- fact: kind intro = state this fact's value naturally; kind update = say the value has changed to the update value
Write like a real person typing: mostly short (3 to 25 words, or 5 to 40 Chinese characters), casual, varied openings, sometimes without punctuation or with a small typo. Never mention thread ids or the words thread/topic/话题. Do not greet. Write in lang ("zh" = Simplified Chinese, "en" = English).
Output: {"messages": [{"n": <plan n>, "text": "..."}]} with exactly one message per plan entry.`

export const JUDGE_SYSTEM = `You label which work thread each new chat message belongs to. One person uses a single chat for several pieces of work. Output one JSON object only.

The payload lists the threads (id, title, description), the earlier messages with their correct labels, and new messages in order. Label each new message in order (you may rely on your own labels for the earlier new messages):
- a thread id when the message belongs to that thread
- "none" when it is a self-contained question that belongs to no thread
- "ambiguous" when a careful reader could not tell between two or more threads; list them in candidates
Output: {"labels": [{"n": <n>, "thread": "t1" | "none" | "ambiguous", "candidates": []}]}`

/** Did a message that should not name its subject give it away anyway? */
export function leaksTitle(text, title, lang) {
  const message = text.toLowerCase(), name = title.toLowerCase().trim()
  if (name && message.includes(name)) return true
  if (lang === 'zh') {
    const plain = name.replace(/[^一-鿿]/g, '')
    for (let index = 0; index + 3 <= plain.length; index++) if (message.includes(plain.slice(index, index + 3))) return true
    return false
  }
  const STOP = new Set(['about', 'their', 'there', 'which', 'would', 'plans', 'project', 'trip', 'new', 'with', 'from'])
  return name.split(/[^a-z0-9]+/).some(word => word.length >= 5 && !STOP.has(word) && new RegExp(`\\b${word}`).test(message))
}

// v1 adds the assistant's side and the life of each fact: stated, changed, proposed and accepted or
// turned down, withdrawn. v0's prompts above stay as they are, so v0 can still be regenerated.

export const SPEC_SYSTEM_V1 = SPEC_SYSTEM.replace('give at least one fact a non-null update',
  'give at least one fact a non-null update; also give every fact "alternative": a different, equally plausible value an assistant might suggest instead (same form as value, not equal to value or update)')
  .replace('"update": null}', '"update": null, "alternative": "..."}')

export const RENDER_SYSTEM_V1 = `You write a chat between a person and an AI assistant, following a plan exactly. Output one JSON object only.

The payload has the persona, the work threads (id, title, goal, description), the last exchanges already written (with their thread), and a plan: one entry per exchange to write now, in order. For each plan entry write the user's message and the assistant's reply.
The user's message:
- thread: the work thread the message belongs to; "ONE-OFF" means a quick self-contained question that belongs to none of the threads (a definition, a conversion, a translation, a small calculation)
- action: new = opens this thread and says what they want; continue = keeps going on the same thread as the previous message; switch = moves to another thread used recently; return = comes back to a thread after a long time
- style:
  explicit = names the subject clearly in their own words (not necessarily the exact title)
  cue = points to the thread only through one specific detail (a file, a person, a place), without naming the subject
  pronoun = only vague references ("that one", "the thing from before", "那个", "之前那件事"), as people do; it must still make sense from the flow of the chat
  implicit = a short follow-up that only works as a continuation of the previous message ("ok next step", "make it shorter", "这个不行"), with no topic words at all
- refs: the message also uses something from these other threads (say what, e.g. "use the numbers from ... here")
Write like a real person typing: mostly short (3 to 25 words, or 5 to 40 Chinese characters), casual, varied openings, sometimes without punctuation or with a small typo. Never mention thread ids or the words thread/topic/话题. Do not greet.
The assistant's reply: 1 to 3 short sentences, helpful and concrete, about what the user just said; for ONE-OFF, just answer it. Outside the fact step below, the assistant never suggests or states a value for any of the threads' facts.
fact (when present): what happens in this exchange to one fact of the thread, named by key. Write the given value exactly as given:
  intro: the user states the fact's value
  update: the user says the value has changed to value
  propose: the user asks for advice on it or leaves it open, without giving any value; the assistant suggests value, clearly as a suggestion ("I'd go with …", "建议…")
  accept: the user plainly accepts the assistant's earlier suggestion (value) without repeating the value, as a statement, not a question ("ok, go with that", "好，就按你说的来"); the assistant acknowledges without repeating it
  reject: the user turns down the assistant's earlier suggestion (rejected) and states value instead ("no, …", "不行，…")
  retract: the user says the fact is no longer settled (called off, back to open, decide later) without giving a new value; the assistant acknowledges
Write in lang ("zh" = Simplified Chinese, "en" = English).
Output: {"messages": [{"n": <plan n>, "user": "...", "assistant": "..."}]} with exactly one entry per plan entry.`

/** A summary of one thread, for the summary baseline: what another topic would get instead of facts. */
export const SUMMARY_SYSTEM = `You summarize one piece of work from a chat, for another assistant who will need its details later. Output plain text only.
Give the goal and where things stand, with every concrete value (numbers, dates, names, amounts) as it stands now. Say when a value was changed, withdrawn, or only suggested and not yet agreed. At most 120 words, or 200 Chinese characters, in the chat's language.`

export const ANSWER_SYSTEM = `You are the assistant in one topic of a person's chat. The payload has reference notes (possibly empty), this topic's conversation so far, and the user's new question.
Answer the question in one short line with just the value, using only what the notes and the conversation say. If they do not settle it, answer with the word the question gives for "not settled". Do not guess.`

/**
 * Did a written exchange do what its fact step asked? Judged by meaning, by a model, so the data does
 * not keep only the phrasings some word list (or the plugin itself) happens to recognise.
 */
export const STEP_CHECK_SYSTEM = `You check one exchange of a chat against what it was meant to do with one fact. Output one JSON object only: {"ok": true or false, "why": "a few words"}.
The payload has the fact's key, the step, the value (for reject also the rejected suggestion), the user's message and the assistant's reply. Judge the meaning as a careful reader would, not the wording. The value must match in substance (same numbers, dates, names), though it may be phrased differently ("$400" and "400 a month", "学到第8课" and "已完成第8课").
- intro: the user states the value as what they have decided. Asking for reassurance afterwards ("is that enough?") is fine; a value only asked about ("should it be 6 hours?") is not stated.
- update: the user says the value is now value.
- propose: the assistant suggests value, and the user has not given that value themselves.
- accept: the user accepts the assistant's earlier suggestion of value (repeating the value is fine); not a question, not a refusal.
- reject: the user turns down the suggestion (rejected) and chooses value instead.
- retract: the user says the fact is no longer settled (called off, reopened, to be decided later) without choosing a new value.`
