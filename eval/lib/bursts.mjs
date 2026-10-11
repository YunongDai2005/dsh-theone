// Messages sent in a burst: the user types several before any reply, and a router that waits a
// moment can take them as one request. InterleaveBench has no send times, so arrival is simulated:
// a message follows the previous one within the waiting window with probability `same` when both
// belong to the same thread, and `cross` otherwise (a burst that changes subject, which merging
// gets wrong). Sweeping both shows how much the result depends on that assumption.
import { rng } from './schedule.mjs'

/** For each turn, whether it arrived within the waiting window after the previous one. */
export function planArrivals(turns, { same = 0.35, cross = 0.05, seed = 1, maxBurst = 4 } = {}) {
  const random = rng(seed ^ 0xb0257)
  let run = 1
  return turns.map((turn, i) => {
    if (i === 0) return false
    const previous = turns[i - 1].gold.thread
    const p = previous && previous === turn.gold.thread ? same : cross
    const together = run < maxBurst && random() < p
    run = together ? run + 1 : 1
    return together
  })
}

const OPEN_END = /([，、；：,;:]|\.\.\.|…{1,2}|——|-)\s*$/
const CONNECTIVE_END = /(但是|不过|然后|还有|而且|另外|就是|所以|因为|比如|对了|还是|或者|and|but|also|so|then|plus|or|like)\s*$/i

/**
 * Should the router wait for more before routing this message? A message that stops mid-thought
 * (open punctuation, a dangling connective) or that is too short to route on its own.
 */
export function expectsMore(text) {
  const s = String(text ?? '').trim()
  if (!s) return false
  if (/[。！？!?]$/.test(s)) return false
  if (OPEN_END.test(s) || CONNECTIVE_END.test(s)) return true
  const cjk = (s.match(/[㐀-鿿]/g) ?? []).length
  const words = s.split(/\s+/).filter(Boolean).length
  return cjk ? cjk <= 6 : words <= 3
}

/**
 * Group turns into the requests a router would see.
 *   none      every message alone (today)
 *   all       always wait the window: everything that arrived together is one request
 *   adaptive  wait only after a message that `expectsMore`; otherwise route at once
 * Returns [{ turns: [...indices], waited }]; `waited` means the reply was held for the window.
 */
export function groupUnits(turns, arrivals, merge) {
  const units = []
  for (let i = 0; i < turns.length; i++) {
    const last = units.at(-1)
    // A request waits after its latest message; what arrives in that window joins it.
    if (last && arrivals[i] && last.waits) { last.turns.push(i); last.waited = true }
    else units.push({ turns: [i], waited: false, waits: false })
    const unit = units.at(-1)
    unit.waits = merge === 'all' || (merge === 'adaptive' && expectsMore(turns[i].text))
    if (unit.waits) unit.waited = true
  }
  return units
}
