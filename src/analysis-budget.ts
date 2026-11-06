import { symbols } from '@deepseek-ai/cordis'

export interface AnalysisDelay { code: 'ROUTER_RATE_LIMITED' | 'ROUTER_CIRCUIT_OPEN'; retryAfterMs: number }

/** One budget per host runtime, shared by routing and tool-free background analysis (not Worker replies). */
class AnalysisBudget {
  private calls: number[] = []
  private failures = 0
  private lastFailureAt = -Infinity
  private blockedUntil = 0
  constructor(private readonly now: () => number) {}
  delay(): AnalysisDelay | undefined {
    const now = this.now()
    this.calls = this.calls.filter(at => at > now - 60000)
    if (this.blockedUntil > now) return { code: 'ROUTER_CIRCUIT_OPEN', retryAfterMs: this.blockedUntil - now }
    if (this.calls.length >= 30) return { code: 'ROUTER_RATE_LIMITED', retryAfterMs: this.calls[0] + 60000 - now }
  }
  /** Called synchronously immediately before each stream, including retries. */
  take(): AnalysisDelay | undefined {
    const delay = this.delay()
    if (delay) return delay
    this.calls.push(this.now())
  }
  succeeded(): void { this.failures = 0; this.blockedUntil = 0 }
  failed(status?: number): void {
    const now = this.now()
    // Concurrent review-page failures count as one outage, as they did in DshRouter.
    if (now - this.lastFailureAt > 2000) this.failures++
    this.lastFailureAt = now
    const wait = status === 401 || status === 403 ? 60000 : status === 429 ? 15000 : this.failures >= 3 ? 30000 : 0
    if (wait) this.blockedUntil = Math.max(this.blockedUntil, now + wait)
  }
}

const budgets = new WeakMap<object, AnalysisBudget>()
export function analysisBudget(runtime: object, now: () => number = Date.now): AnalysisBudget {
  // Cordis creates a new context-bound proxy on service reads. Its documented original symbol
  // identifies the shared runtime without bypassing those proxies when actually making calls.
  const identity = Reflect.get(runtime, symbols.original) ?? runtime
  let budget = budgets.get(identity)
  if (!budget) { budget = new AnalysisBudget(now); budgets.set(identity, budget) }
  return budget
}
