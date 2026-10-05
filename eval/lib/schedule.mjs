// Turn plans for one interleaved session: which work thread each user message belongs to, and how
// it is said. The plan is the ground truth; messages are written from it afterwards.

/** Small seeded generator (mulberry32), so a seed always yields the same plan. */
export function rng(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pick = (random, weights) => {
  const entries = Object.entries(weights)
  let roll = random() * entries.reduce((sum, [, weight]) => sum + weight, 0)
  for (const [key, weight] of entries) if ((roll -= weight) < 0) return key
  return entries.at(-1)[0]
}

export const DEFAULTS = {
  /** Chance that a message moves to another thread instead of continuing. */
  switchRate: 0.3,
  /** Chance of a one-off question that belongs to no thread. */
  oneOffRate: 0.05,
  /** Chance that a message also draws on another thread. */
  crossRate: 0.12,
  /** A return after at least this many turns away is a "return" rather than a "switch". */
  returnGap: 12,
  /** How messages are phrased, by action. */
  styles: {
    continue: { implicit: 0.45, pronoun: 0.25, explicit: 0.3 },
    switch: { explicit: 0.55, cue: 0.3, pronoun: 0.15 },
    return: { explicit: 0.55, cue: 0.3, pronoun: 0.15 },
  },
}

/**
 * Plan the turns of one session.
 * @param threads - [{ id, facts: [{ key, update? }], twinOf? }], in order of first appearance.
 * @param length - number of user messages.
 * @returns [{ i, thread, action, style, refs, fact?, tags }] where thread is null for a one-off.
 */
export function buildSchedule(threads, length, seed, options = {}) {
  const config = { ...DEFAULTS, ...options, styles: { ...DEFAULTS.styles, ...options.styles } }
  const random = rng(seed)
  if (threads.length < 2 || length < threads.length * 4) throw new Error('Too few turns for these threads')
  // Threads after the first start somewhere in the first 60% of the session, in order.
  const starts = new Map([[threads[0].id, 0]])
  const slots = threads.slice(1).map(() => 3 + Math.floor(random() * (length * 0.6 - 3)))
    .sort((a, b) => a - b).map((slot, index) => slot + index * 2)
  threads.slice(1).forEach((thread, index) => starts.set(thread.id, Math.min(slots[index], length - 4)))
  const startAt = new Map([...starts].map(([id, turn]) => [turn, id]))

  const twins = new Set(threads.flatMap(thread => thread.twinOf ? [thread.id, thread.twinOf] : []))
  const lastSeen = new Map()
  const facts = new Map(threads.map(thread => [thread.id, (thread.facts ?? []).map(fact => ({ ...fact, state: 'pending' }))]))
  const turns = []
  let current
  for (let i = 0; i < length; i++) {
    const introduced = threads.filter(thread => starts.get(thread.id) < i || startAt.get(i) === thread.id)
    let thread, action
    if (startAt.has(i)) { thread = startAt.get(i); action = 'new' }
    else {
      const roll = random()
      const others = introduced.filter(item => item.id !== current)
      if (roll < config.oneOffRate) { thread = null; action = 'oneoff' }
      else if (roll < config.oneOffRate + config.switchRate && others.length) {
        // Recently used threads come back more often, but long-forgotten ones do return.
        const weights = Object.fromEntries(others.map(item => [item.id, 1 / (1 + (i - (lastSeen.get(item.id) ?? 0)) / 8) + 0.15]))
        thread = pick(random, weights)
        action = i - (lastSeen.get(thread) ?? 0) >= config.returnGap ? 'return' : 'switch'
      } else { thread = current; action = 'continue' }
    }
    const style = action === 'new' ? 'explicit' : action === 'oneoff' ? 'oneoff' : pick(random, config.styles[action])
    const refs = []
    if (thread && action !== 'new' && random() < config.crossRate) {
      const candidates = introduced.filter(item => item.id !== thread && lastSeen.has(item.id))
      if (candidates.length) refs.push(candidates[Math.floor(random() * candidates.length)].id)
    }
    // Facts are stated early in a thread and some are changed later on.
    let fact
    if (thread) {
      const list = facts.get(thread)
      const pending = list.find(item => item.state === 'pending')
      const stale = list.find(item => item.state === 'stated' && item.update && i - item.at >= 10)
      if (pending && (action === 'new' || random() < 0.35)) { pending.state = 'stated'; pending.at = i; fact = { key: pending.key, kind: 'intro' } }
      else if (stale && random() < 0.25) { stale.state = 'updated'; fact = { key: stale.key, kind: 'update' } }
    }
    const tags = [style]
    if (refs.length) tags.push('cross')
    if (thread && twins.has(thread)) tags.push('twin')
    if (action === 'return') tags.push('long_gap')
    turns.push({ i, thread, action, style, refs, ...(fact ? { fact } : {}), tags })
    if (thread) { lastSeen.set(thread, i); current = thread }
  }
  return turns
}

/**
 * v1: how each fact of a thread comes about, laid over a plan from `buildSchedule`. Besides the user
 * stating and later changing a value, the assistant proposes values the user then accepts or turns
 * down, and some values are withdrawn. Returns new turns (the input is not changed) and the timeline
 * of every fact: the ground truth of what was confirmed when.
 * @param threads - [{ id, facts: [{ key, value, update, alternative }] }]
 */
export function planFactEpisodes(turns, threads, seed) {
  const random = rng(seed ^ 0x5eed)
  const kinds = { stated: 0.45, accepted: 0.2, rejected: 0.2, withdrawn: 0.15 }
  const facts = new Map(threads.map(thread => [thread.id, (thread.facts ?? []).map(fact => {
    let type = pick(random, kinds)
    if (type === 'rejected' && !fact.alternative) type = 'stated'
    const steps = type === 'stated' ? [{ kind: 'intro', value: fact.value }, ...(fact.update ? [{ kind: 'update', value: fact.update, gap: 8 }] : [])]
      : type === 'accepted' ? [{ kind: 'propose', value: fact.value }, { kind: 'accept', value: fact.value, reply: true }]
      : type === 'rejected' ? [{ kind: 'propose', value: fact.alternative }, { kind: 'reject', value: fact.value, reply: true }]
      : [{ kind: 'intro', value: fact.value }, { kind: 'retract', value: null, gap: 8 }]
    return { key: fact.key, type, steps, at: -Infinity }
  })]))
  const timeline = []
  const out = turns.map(turn => {
    const { fact: _, ...rest } = turn
    if (!turn.thread) return rest
    const list = facts.get(turn.thread)
    // An answer to a proposal comes at the thread's very next message.
    let chosen = list.find(fact => fact.steps[0]?.reply)
    if (!chosen && (turn.action === 'new' || random() < 0.35)) chosen = list.find(fact => fact.steps.length && !fact.steps[0].reply && turn.i - fact.at >= (fact.steps[0].gap ?? 0))
    if (!chosen) return rest
    const step = chosen.steps.shift()
    chosen.at = turn.i
    const status = step.kind === 'propose' ? 'proposed' : step.kind === 'retract' ? 'retracted' : 'confirmed'
    timeline.push({ thread: turn.thread, key: chosen.key, turn: turn.i, kind: step.kind, status, value: step.value })
    return { ...rest, fact: { key: chosen.key, kind: step.kind, value: step.value } }
  })
  return { turns: out, timeline, types: Object.fromEntries([...facts].map(([id, list]) => [id, Object.fromEntries(list.map(fact => [fact.key, fact.type]))])) }
}

/** What was settled about one fact right after turn `at`: the confirmed value, or null if none. */
export function factState(timeline, thread, key, at) {
  let value = null
  for (const event of timeline) {
    if (event.thread !== thread || event.key !== key || event.turn > at) continue
    if (event.status === 'confirmed') value = event.value
    else if (event.status === 'retracted') value = null
  }
  return value
}
