/**
 * Hosts the topic cluster under TheOne's sidebar card: keeps its box aligned under the card, makes room
 * for it, turns the user's gestures into TheOne's existing topic operations, and feeds it TheOne's state.
 * The box lives on document.body (DSH owns the sidebar's DOM), positioned under the card every frame.
 */
import { createFoam, type Foam, type FoamActions, type FoamModel, type FoamPhase, type FoamTextKey } from './client-foam.ts'
import type { CatalogSnapshot } from './catalog-types.ts'

export interface FoamHostOptions {
  /** The sidebar card (DSH's panel row button that holds TheOne's entry). */
  button: HTMLElement
  signal: AbortSignal
  text(key: FoamTextKey, vars?: Record<string, string | number>): string
  /** Main chat continues with this topic. */
  mount(contextId: string): Promise<void>
  /** Open the topic's own chat. */
  openSession(sessionId: string): void
  openWorkspace(): void
  openMainChat(): void
  /** How many topics the cluster shows; with none, the Topic workspaces row stays as the way in. */
  onTopics?(count: number): void
}

export interface FoamHost { setRail(on: boolean): void; refresh(): void; destroy(): void }

const post = async (path: string, body: unknown, signal: AbortSignal) => {
  const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal, cache: 'no-store' })
  return response.ok
}

/** Until the cluster's own state endpoint is there, the topic directory gives topics, workspaces, relatedness and status. */
export function modelFromCatalog(snapshot: CatalogSnapshot): FoamModel {
  const groupOf = new Map<string, string>()
  for (const group of snapshot.groups) for (const id of group.contextIds) groupOf.set(id, group.id)
  const visible = snapshot.contexts.filter(context => context.hidden !== 'orphaned' && context.hidden !== 'excluded')
  const topics = visible.map(context => {
    const status = context.topicStatus
    const phase: FoamPhase = status === 'waiting' ? 'waiting' : 'idle'
    // The directory has no usage counts (and is ordered by random id), so the topic's status stands in for its weight.
    return { id: context.id, title: context.title, phase, group: groupOf.get(context.id),
      weight: status === 'active' ? .7 : status === 'dormant' ? .15 : .4,
      aside: status === 'done' || context.hidden === 'archived' }
  })
  const links: FoamModel['links'] = []
  for (const [id, entry] of Object.entries(snapshot.linkage?.topics ?? {}))
    for (const other of entry.related) if (id < other.id) links.push({ a: id, b: other.id, weight: other.reasons.includes('manual') ? 1 : other.reasons.includes('learned') ? .5 : .3 })
  return { topics, links }
}

export function mountFoamHost(options: FoamHostOptions): FoamHost {
  const { button, signal } = options
  const host = document.createElement('div')
  host.setAttribute('translate', 'no')
  document.body.appendChild(host)
  const sessionOf = new Map<string, string>()
  const failed = () => { refresh() }
  const act = (body: Record<string, unknown>) => { void post('/api/theone/topics', body, signal).then(ok => { if (!ok) failed(); else refresh() }).catch(failed) }
  const actions: FoamActions = {
    mount: id => { void options.mount(id).finally(refresh) },
    merge: (id, into, whenIdle) => act({ action: 'merge', id, into, ...(whenIdle ? { whenIdle: true, requestId: `${id}>${into}` } : {}) }),
    attach: (id, sessionId) => act({ action: 'attach', id, sessionId }),
    putAside: id => act({ action: 'status', id, done: true }),
    open: id => { const session = sessionOf.get(id); if (session) options.openSession(session) },
    stop: () => options.openMainChat(),
    cancelQueued: () => options.openMainChat(),
    remove: () => options.openWorkspace(),
    showAnswer: () => options.openMainChat(),
    answer: () => options.openMainChat(),
    openWorkspace: options.openWorkspace,
    text: options.text,
  }
  const foam: Foam = createFoam({
    host, actions,
    mark: () => button.querySelector('.theone-symbol'),
    side: () => button.closest('[data-sidebar-collapsed]') ?? button.closest('nav')?.parentElement ?? null,
    place: () => {
      const r = button.getBoundingClientRect()
      if (!r.width || !button.isConnected) { host.style.visibility = 'hidden'; return }
      host.style.visibility = ''
      host.style.left = `${r.left}px`; host.style.top = `${r.bottom}px`; host.style.width = `${r.width}px`
    },
    onHeight: height => { button.style.marginBottom = `${Math.round(height) + 10}px` },
    onPulse: amount => {
      const mark = button.querySelector<SVGElement>('.theone-symbol')
      if (mark) mark.style.transform = amount > .002 ? `scale(${(1 + .12 * amount).toFixed(3)})` : ''
    },
  })

  let reading = false
  async function refresh() {
    if (reading || signal.aborted) return
    reading = true
    try {
      const response = await fetch('/api/theone/catalog', { signal, cache: 'no-store' })
      if (!response.ok) return
      const snapshot = await response.json() as CatalogSnapshot
      for (const context of snapshot.contexts) sessionOf.set(context.id, context.sourceSessionIds[0] ?? context.workingSessionId)
      const model = modelFromCatalog(snapshot)
      foam.update(model)
      options.onTopics?.(model.topics.length)
    } catch { /* The next round tries again. */ }
    finally { reading = false }
  }
  void refresh()
  const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, 4000)
  const focus = () => { void refresh() }
  window.addEventListener('focus', focus)

  return {
    setRail: on => foam.setRail(on),
    refresh: () => { void refresh() },
    destroy() {
      clearInterval(timer); window.removeEventListener('focus', focus)
      foam.destroy(); host.remove(); button.style.marginBottom = ''
      button.querySelector<SVGElement>('.theone-symbol')?.style.removeProperty('transform')
    },
  }
}
