/**
 * One messaging app bound to main chat: its link (receiving) and relay (into main chat and back),
 * started with TheOne, plus the settings route every app shares. Each app adds its own sign-in.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { RelayHost, RemoteRelay } from './remote-relay.ts'
import type { LinkSaved, RemoteLink } from './remote-link.ts'

/** What a messaging app needs from TheOne: main chat, and where its login is kept. */
export interface AppHost<S> extends RelayHost {
  load(): S | undefined
  save(saved: S | undefined): void
  version: string
}

export abstract class RemoteApp<S extends LinkSaved> {
  abstract readonly link: RemoteLink<S>
  abstract readonly relay: RemoteRelay

  constructor(protected readonly ctx: Context) {}

  /** Answer main chat's turns for the app, and receive while TheOne runs. */
  apply(): void {
    this.relay.apply()
    this.ctx.effect(() => {
      this.link.start()
      return async () => {
        this.cancel()
        await this.link.stop()
      }
    })
  }

  /** The app's own sign-in actions: undefined when done, or a refusal (also for an action it does not know). */
  protected abstract action(row: Record<string, unknown>): Promise<Response | undefined> | Response | undefined
  /** Stop a sign-in under way. */
  protected cancel(): void {}

  /** The settings page: status, and sign-in, pause, resume and logout. */
  async handle(request: Request): Promise<Response> {
    if (request.method === 'POST') {
      let row: Record<string, unknown>
      try { row = await request.json() as Record<string, unknown> } catch { return Response.json({ error: 'INVALID_INPUT' }, { status: 400 }) }
      switch (row?.action) {
        case 'enable': case 'disable': await this.link.setEnabled(row.action === 'enable'); break
        case 'logout': this.cancel(); await this.link.logout(); break
        default: {
          const failed = await this.action(row ?? {})
          if (failed) return failed
        }
      }
    }
    return Response.json(this.link.status(), { headers: { 'cache-control': 'no-store' } })
  }
}

/** A refusal the settings page can explain: `code` names it. */
export function refused(code: string, status = 400): Response {
  return Response.json({ error: code }, { status })
}
