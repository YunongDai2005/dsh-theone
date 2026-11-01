// Routing event schema is opt-in: the existing fact-lifecycle v1 is not this protocol.
export const ROUTING_SCHEMA = 'routing-v1'
export const isRoutingV1 = session => session.routing_schema === ROUTING_SCHEMA
const fail = message => { throw new Error('routing-v1: ' + message) }
export function validateRoutingSession(session) {
  if (!session.routing_schema) return
  if (!isRoutingV1(session)) fail('unknown routing_schema')
  if (!session.session_id || !['zh', 'en'].includes(session.lang) || !['dev', 'test'].includes(session.split)) fail('invalid session header')
  const topics = new Set(session.threads.map(t => t.id))
  if (topics.size !== session.threads.length) fail('duplicate topic')
  const catalog = new Set()
  for (const topic of session.catalog ?? []) {
    if (!topics.has(topic.id) || catalog.has(topic.id)) fail('invalid catalog id')
    catalog.add(topic.id)
    if (!['id', 'title', 'summary', 'lastState'].every(k => typeof topic[k] === 'string' && topic[k].length) ||
        !['entities', 'keywords'].every(k => Array.isArray(topic[k]) && topic[k].every(x => typeof x === 'string'))) fail('invalid catalog descriptor')
  }
  if (session.current_id && !catalog.has(session.current_id)) fail('current_id outside catalog')
  const events = new Map(), turns = new Set()
  let time = -Infinity, previous = -1
  for (const turn of session.turns) {
    const at = Date.parse(turn.at)
    if (!Number.isFinite(at) || at < time || !Number.isInteger(turn.i) || turn.i <= previous) fail('invalid time/order')
    time = at; previous = turn.i
    if (typeof turn.text !== 'string' || !turn.text.trim()) fail('empty text')
    const gold = turn.gold
    if (!gold || (gold.thread !== null && !topics.has(gold.thread)) || typeof gold.explicit_binding !== 'boolean' ||
        !Array.isArray(gold.retract) || !Array.isArray(gold.refs) || gold.refs.some(id => !topics.has(id)) ||
        typeof turn.ambiguous !== 'boolean' || !Array.isArray(turn.tags)) fail('invalid gold/tags')
    for (const event of turn.events_before ?? []) {
      if (!event.id || events.has(event.id)) fail('duplicate event id')
      if (event.at && (!Number.isFinite(Date.parse(event.at)) || Date.parse(event.at) > at)) fail('event time after turn')
      if (['foreground', 'background'].includes(event.type)) {
        if (!topics.has(event.topic_id) || typeof event.text !== 'string') fail('invalid visible source')
        if (event.type === 'background' && event.visible !== false) fail('background cannot set foreground visibility')
      } else if (event.type === 'pending') {
        if (!topics.has(event.owner_id) || !['question', 'approval'].includes(event.kind) ||
            event.message_id && events.get(event.message_id)?.type !== 'foreground') fail('invalid pending owner/source')
      } else if (event.type === 'correction') {
        if (!turns.has(event.turn_i)) fail('correction must refer to an earlier turn')
        if (!catalog.has(event.target_topic_id) || typeof event.text !== 'string') fail('invalid correction target')
      } else if (event.type !== 'restart') fail('unknown event type')
      events.set(event.id, event)
    }
    const input = turn.input ?? {}
    for (const key of Object.keys(input)) if (!['reply_to', 'pending_response', 'steering_of'].includes(key)) fail('unknown input binding')
    if (input.reply_to && events.get(input.reply_to)?.type !== 'foreground') fail('dangling reply_to')
    if (input.pending_response && events.get(input.pending_response)?.type !== 'pending') fail('dangling pending_response')
    if (input.steering_of !== undefined && (session.turns.findIndex(t => t.i === input.steering_of) !== session.turns.indexOf(turn) - 1 ||
        turn.events_before?.length || session.turns.find(t => t.i === input.steering_of)?.input?.steering_of !== undefined))
      fail('steering_of requires the immediately preceding ordinary turn and no intervening events')
    for (const target of gold.retract) {
      if (!turns.has(target.turn_i) || (!catalog.has(target.from_topic_id) && target.from_topic_id !== '$routed') || !Array.isArray(target.markers) ||
          target.markers.some(x => typeof x !== 'string' || !x)) fail('invalid retraction label')
    }
    for (const action of turn.worker_actions ?? []) {
      if (!['theone_record', 'theone_update_state'].includes(action.name) || !action.arguments || typeof action.arguments !== 'object')
        fail('worker_actions allow only internal fact/state tools')
    }
    turns.add(turn.i)
  }
  return session
}

// Only the declared owner and its gold label may differ. Text, catalog, timestamps,
// input identity, all other events, and dev/test membership must be identical.
export function pairInvariant(session) {
  const copy = structuredClone(session)
  delete copy.session_id
  delete copy.pair.side
  for (const turn of copy.turns) {
    if (turn.i === copy.pair.turn_i) turn.gold.thread = '<owner>'
    for (const event of turn.events_before ?? []) if (event.id === copy.pair.event_id)
      event[copy.pair.kind === 'foreground' ? 'topic_id' : 'owner_id'] = '<owner>'
  }
  return copy
}

export function validateRoutingSet(sessions) {
  const ids = new Set(), pairs = new Map()
  for (const session of sessions) {
    validateRoutingSession(session)
    if (ids.has(session.session_id)) fail('duplicate session')
    ids.add(session.session_id)
    if (session.pair) pairs.set(session.pair.id, [...pairs.get(session.pair.id) ?? [], session])
  }
  for (const group of pairs.values()) {
    if (group.length !== 2 || new Set(group.map(s => s.pair.side)).size !== 2 ||
        group[0].turns.find(t => t.i === group[0].pair.turn_i).gold.thread === group[1].turns.find(t => t.i === group[1].pair.turn_i).gold.thread ||
        JSON.stringify(pairInvariant(group[0])) !== JSON.stringify(pairInvariant(group[1]))) fail('invalid owner-only pair')
  }
}
