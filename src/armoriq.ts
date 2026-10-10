import { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { ArmorIQClient, type ArmorIQSession, type EnforceResult, type SDKConfig } from '@armoriq/sdk'
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type {} from './index.ts'

export const name = 'theone-armoriq'
export const inject = ['theone', 'tools']
const noTelemetry = { enabled: false, endpoint: '', apiKey: '', product: 'theone-notes' }

export interface Config {
  /** The real ArmorIQ end-user identity; supplied by the operator, never the model. */
  userEmail: string
  databasePath: string
  apiKeyEnv?: string
  validitySeconds?: number
}

export function scopedAction(topic: string, action: string): string {
  const scope = createHash('sha256').update(topic).digest('hex')
  return `topic_${scope}_${action}`
}

/** Fixed operator plan. Model calls can request actions, but cannot expand this plan. */
export class TopicGuard {
  private readonly client: ArmorIQClient
  private readonly plans = new Map<string, Promise<{ session: ArmorIQSession; expiresAt: number }>>()
  constructor(private readonly email: string, options: Partial<SDKConfig>, private readonly validitySeconds = 300) {
    this.client = new ArmorIQClient({ ...options, observability: noTelemetry })
  }

  private prepare(topic: string) {
    const session = this.client.forUser(this.email).startSession({
      mode: 'local', trueReanchor: false, validitySeconds: this.validitySeconds,
      observability: noTelemetry,
      toolNameParser: action => ({ mcp: 'theone-notes', action }),
    })
    return session.startPlan(['read', 'write'].map(action => ({ name: scopedAction(topic, action) })),
      `Read and write notes belonging only to TheOne topic ${topic}. No other topic or tools are authorized.`)
      .then(token => ({ session, expiresAt: token.expiresAt }))
      .catch(async error => { await session.close('error'); throw error })
  }

  async check(owner: string, target: string, action: string, signal?: AbortSignal): Promise<EnforceResult> {
    signal?.throwIfAborted()
    try {
      let pending = this.plans.get(owner)
      if (!pending) { pending = this.prepare(owner); this.plans.set(owner, pending) }
      let plan = await pending
      // startPlan caches identical plans even when expired; create a fresh session instead.
      if (plan.expiresAt <= Date.now() / 1000 + 5) {
        if (this.plans.get(owner) === pending) {
          const old = plan.session
          pending = this.prepare(owner)
          this.plans.set(owner, pending)
          await old.close()
        } else pending = this.plans.get(owner)!
        plan = await pending
      }
      signal?.throwIfAborted()
      const decision = await plan.session.check(scopedAction(target, action), {})
      signal?.throwIfAborted()
      return decision
    } catch (error) {
      signal?.throwIfAborted()
      this.plans.delete(owner)
      // No exception text: HTTP errors can include credentials or response internals.
      return { allowed: false, action: 'block', reason: 'ArmorIQ plan or verification unavailable' }
    }
  }

  async close() {
    const plans = [...this.plans.values()]
    this.plans.clear()
    await Promise.allSettled(plans.map(async plan => (await plan).session.close()))
  }
}

export function apply(ctx: Context, config: Config) {
  if (!config.userEmail?.includes('@')) throw new Error('Set the ArmorIQ userEmail to the real end-user email')
  if (!config.databasePath || !isAbsolute(config.databasePath)) throw new Error('Set an absolute path for the ArmorIQ notes/audit database')
  const apiKey = process.env[config.apiKeyEnv ?? 'ARMORIQ_API_KEY']
  if (!apiKey) throw new Error('Set the ArmorIQ API key environment variable before enabling the addon')
  const validity = config.validitySeconds ?? 300
  if (!Number.isInteger(validity) || validity < 30 || validity > 3600) throw new Error('validitySeconds must be 30–3600')
  mkdirSync(dirname(config.databasePath), { recursive: true })
  const db = new DatabaseSync(config.databasePath)
  db.exec(`CREATE TABLE IF NOT EXISTS notes (topic TEXT, key TEXT, text TEXT NOT NULL, PRIMARY KEY(topic, key));
    CREATE TABLE IF NOT EXISTS decisions (id INTEGER PRIMARY KEY, at TEXT NOT NULL, agent TEXT NOT NULL,
      owner TEXT NOT NULL, target TEXT NOT NULL, action TEXT NOT NULL, allowed INTEGER NOT NULL, reason TEXT NOT NULL);`)
  const guard = new TopicGuard(config.userEmail, { apiKey }, validity)
  const owner = (agentId?: string) => agentId ? ctx.theone.store.contexts().find(topic => topic.workingSessionId === agentId)?.id : undefined

  ctx.on('tools/pre-execute', async (exec, next) => {
    const topic = owner(exec.agent?.id)
    // The main-chat mirror does not execute tools. Ordinary DSH agents are unchanged.
    if (!topic) return next()
    const args = exec.arguments as Record<string, unknown> | null
    const target = typeof args?.topicId === 'string' ? args.topicId : topic
    const action = exec.name === 'theone_notes' && (args?.operation === 'read' || args?.operation === 'write')
      ? args.operation : `unapproved_${exec.name}`
    const decision = await guard.check(topic, target, action, exec.signal)
    const allowed = decision.allowed === true && decision.action === 'allow'
    db.prepare('INSERT INTO decisions(at, agent, owner, target, action, allowed, reason) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(new Date().toISOString(), String(exec.agent!.id), topic, target, action, Number(allowed), decision.reason ?? decision.action)
    db.exec('DELETE FROM decisions WHERE id < (SELECT COALESCE(MAX(id), 0) - 1000 FROM decisions)')
    if (!allowed) return { kind: 'deny', reason: `ArmorIQ blocked the action: ${decision.reason ?? decision.action}` }
    return next()
  }, { prepend: true })

  ctx.tools.register(defineTool({
    name: 'theone_notes',
    description: 'Read or write a note in your own topic. ArmorIQ blocks access to other topics. Omit topicId to use your current topic. Other tools are unavailable in this restricted notes demo.',
    parameters: {
      operation: { type: 'string', required: true, enum: ['read', 'write'] },
      key: { type: 'string', required: true, description: 'A note name, up to 100 characters.' },
      text: { type: 'string', description: 'The note text to write, up to 20000 characters.' },
      topicId: { type: 'string', description: 'Optional target topic; only your own topic is authorized.' },
    },
    output: { schema: { type: 'string' }, render: (_args, value: string) => [{ type: 'text', text: value }] },
    execute: async (args, exec) => {
      exec.signal.throwIfAborted()
      const topic = owner(exec.agent?.id)
      // Defense in depth; no model-supplied filesystem paths or SQL identifiers.
      if (!topic || (args.topicId && args.topicId !== topic)) throw new Error('Only your own topic notes are accessible')
      if (!args.key.length || args.key.length > 100) throw new Error('Note key must be 1–100 characters')
      if (args.operation === 'write') {
        if (typeof args.text !== 'string' || args.text.length > 20000) throw new Error('Note text must be at most 20000 characters')
        db.prepare('INSERT INTO notes(topic, key, text) VALUES (?, ?, ?) ON CONFLICT(topic,key) DO UPDATE SET text=excluded.text')
          .run(topic, args.key, args.text)
        return `Saved note ${args.key} in topic ${topic}.`
      }
      const row = db.prepare('SELECT text FROM notes WHERE topic=? AND key=?').get(topic, args.key)
      return row ? String(row.text) : 'Note not found.'
    },
  }))
  ctx.effect(() => async () => { await guard.close(); db.close() })
}

export default { name, inject, apply }
