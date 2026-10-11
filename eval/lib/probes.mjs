// Questions that test whether a topic gets another topic's facts right: asked inside thread B about a
// fact of thread A, at moments chosen from the ground-truth timeline. Probes are not part of the chat;
// they are asked on the side, after a given turn.
import { factState, rng } from './schedule.mjs'

const QUESTION = {
  zh: (topic, source, label) => `在「${topic}」这件事上要用到「${source}」的「${label}」：它现在定的是什么？只回答这个值；如果还没有确定，回答「未确定」。`,
  en: (topic, source, label) => `For "${topic}", I need the ${label} from "${source}": what is it now? Answer with just the value, or "undecided" if it is not settled.`,
}

/**
 * Up to `max` probes for a session, in turn order. Categories:
 *   cross     a settled value, asked once
 *   stale     asked again after the value changed or was withdrawn, by the same topic as before
 *   proposal  asked right after the assistant proposed a value the user has not answered yet
 *   rejected  asked after the user turned a proposal down and chose another value
 *   accepted  asked after the user accepted a proposal without repeating its value
 * `decoys` are values that would be wrong: older values, proposals, the rejected alternative.
 */
export function buildProbes(session, timeline, seed, max = 8) {
  const random = rng(seed ^ 0x9e0b)
  const titles = new Map(session.threads.map(thread => [thread.id, thread.title]))
  const labels = new Map(session.threads.flatMap(thread => thread.facts.map(fact => [`${thread.id}/${fact.key}`, fact.key])))
  const startOf = new Map()
  for (const turn of session.turns) if (turn.gold.thread && !startOf.has(turn.gold.thread)) startOf.set(turn.gold.thread, turn.i)
  const last = session.turns.length - 1
  const probes = []
  const askers = (source, at) => session.threads.filter(thread => thread.id !== source && (startOf.get(thread.id) ?? Infinity) <= at)
  const add = (source, key, at, category, asker) => {
    const topic = asker ?? askers(source, at)[Math.floor(random() * askers(source, at).length)]?.id
    if (!topic) return undefined
    const values = timeline.filter(event => event.thread === source && event.key === key && event.turn <= at && event.value != null).map(event => event.value)
    const gold = factState(timeline, source, key, at)
    const probe = { after: at, thread: topic, source, key, category, gold, decoys: [...new Set(values.filter(value => value !== gold))],
      question: QUESTION[session.lang](titles.get(topic), titles.get(source), labels.get(`${source}/${key}`) ?? key) }
    probes.push(probe)
    return probe
  }
  const byFact = new Map()
  for (const event of timeline) {
    const id = `${event.thread}/${event.key}`
    if (!byFact.has(id)) byFact.set(id, [])
    byFact.get(id).push(event)
  }
  for (const events of byFact.values()) {
    const { thread: source, key } = events[0]
    const firstConfirmed = events.find(event => event.status === 'confirmed')
    const change = firstConfirmed && events.find(event => event.turn > firstConfirmed.turn && (event.kind === 'update' || event.kind === 'retract'))
    const proposal = events.find(event => event.kind === 'propose')
    const answer = proposal && events.find(event => event.turn > proposal.turn && (event.kind === 'accept' || event.kind === 'reject'))
    if (firstConfirmed && change) {
      // The same topic asks before and after the change: the second answer must not use the old value.
      const before = Math.min(change.turn - 1, firstConfirmed.turn + 1 + Math.floor(random() * Math.max(1, change.turn - firstConfirmed.turn - 1)))
      const first = add(source, key, before, 'cross')
      if (first) add(source, key, Math.min(last, change.turn + 1 + Math.floor(random() * 3)), 'stale', first.thread)
    } else if (proposal) {
      add(source, key, proposal.turn, 'proposal')
      if (answer?.kind === 'reject') add(source, key, Math.min(last, answer.turn + 1), 'rejected')
      else if (answer) add(source, key, Math.min(last, answer.turn + 1), 'accepted')
    } else if (firstConfirmed) add(source, key, Math.min(last, firstConfirmed.turn + 1 + Math.floor(random() * 5)), 'cross')
  }
  // A share of each category, so no one kind fills the session; then whatever is left, in this order.
  // A stale probe always comes with the earlier probe it is paired with.
  const quota = { stale: 2, proposal: 2, rejected: 2, accepted: 2, cross: Infinity }
  const keep = new Set(), taken = {}
  const take = probe => {
    if (keep.has(probe) || keep.size + (probe.category === 'stale' ? 2 : 1) > max) return
    keep.add(probe); taken[probe.category] = (taken[probe.category] ?? 0) + 1
    if (probe.category === 'stale') keep.add(probes.find(other => other.source === probe.source && other.key === probe.key && other.category === 'cross' && other.after < probe.after))
  }
  const order = Object.keys(quota)
  const sorted = [...probes].sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category))
  for (const probe of sorted) if ((taken[probe.category] ?? 0) < quota[probe.category]) take(probe)
  for (const probe of sorted) take(probe)
  return [...keep].filter(Boolean).sort((a, b) => a.after - b.after).map((probe, n) => ({ id: `${session.session_id}-p${n + 1}`, ...probe }))
}
