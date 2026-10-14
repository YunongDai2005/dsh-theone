import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ClientRuntime } from './client-runtime.ts'
import { catalogCss, composerCss, settingsCss, sidebarCss } from './client-css.ts'

export function installClientEffects(rt: ClientRuntime): void {
  const { ctx, lifetime, navigation } = rt
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-theone'
    style.textContent = sidebarCss + catalogCss + settingsCss + composerCss
    document.head.append(style)
    return () => { lifetime.abort(); style.remove() }
  })
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-theone-gateway-row'
    // DSH's grouped and flat lists expose the exact Session row identity.
    // Keep the host Session active; only its duplicate navigation row is hidden.
    // TheOne only organises: the sessions it made for itself (every main chat, each topic's background
    // session) stay out of DSH's list, which keeps showing exactly the sessions the user made.
    // Nothing is moved or archived; the rows are only not drawn, and come back if TheOne is removed.
    let owned: string[] = []
    // DSH puts sessions outside every workspace under "Unassigned". When only TheOne's are left there,
    // its heading and "show N more" row go too, as they would without TheOne.
    const onlyOursUnassigned = (ids: Set<string>) => {
      const workspaces = ctx.workspaces.list.getSnapshot()
      const list = ctx.sessions.list.getSnapshot()
      if (workspaces.phase !== 'ready') return false
      const accounted = new Set(workspaces.items.flatMap(workspace => workspace.sessionIds))
      const archived = new Set(workspaces.archivedSessionIds)
      const stray = list.ids.filter((id: SessionId) => { const row = list.byId[id]; return row && !accounted.has(id) && !archived.has(id) && row.origin !== 'subagent' && !row.blank })
      return stray.length > 0 && stray.every((id: SessionId) => ids.has(id))
    }
    const update = () => {
      const ids = new Set(owned)
      const id = navigation.getSnapshot()
      if (id) ids.add(id)
      const rules = [...ids].map(sessionId => `[role="treeitem"][data-row-key="${CSS.escape(`session:${sessionId}`)}"]{display:none!important}`)
      if (onlyOursUnassigned(ids)) rules.push('[data-row-key="workspace:"],[data-row-key="overflow:"]{display:none!important}')
      style.textContent = rules.join('\n')
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const readOwned = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        void fetch('/api/theone/owned', { signal: lifetime.signal, cache: 'no-store' })
          .then(response => response.ok ? response.json() as Promise<{ sessionIds: string[] }> : undefined)
          .then(value => { if (value && !lifetime.signal.aborted) { owned = value.sessionIds; update() } }).catch(() => {})
      }, 300)
    }
    update()
    readOwned()
    const unsubscribe = navigation.subscribe(update)
    // A new topic session appears in DSH's list: read TheOne's sessions again.
    let count = ctx.sessions.list.getSnapshot().ids.length
    const unsubscribeList = ctx.sessions.list.subscribe(() => {
      const next = ctx.sessions.list.getSnapshot().ids.length
      if (next !== count) { count = next; readOwned() } else update()
    })
    const unsubscribeWorkspaces = ctx.workspaces.list.subscribe(update)
    window.addEventListener('storage', update)
    document.head.append(style)
    return () => { unsubscribe(); unsubscribeList(); unsubscribeWorkspaces(); clearTimeout(timer); window.removeEventListener('storage', update); style.remove() }
  })
  // Main chat works through its topics: as far as its file panel and "@" file references go, its folder
  // is the folder of the topic in use. Only main chat's row in this browser's list changes; the
  // session, and every other session, stay as they are.
  ctx.effect(() => {
    const list = ctx.sessions.list as unknown as { getSnapshot(): SessionListState }
    const original = list.getSnapshot
    let folder: string | undefined
    let base: SessionListState | undefined, view: SessionListState | undefined, viewFolder: string | undefined, viewId: string | undefined
    list.getSnapshot = function (this: unknown) {
      const snapshot = original.call(this)
      const id = navigation.getSnapshot() as SessionId | null
      const row = id ? snapshot.byId[id] : undefined
      if (!folder || !id || !row || row.cwd === folder) return snapshot
      // The same inputs give the same object, as React's external stores require.
      if (snapshot !== base || viewFolder !== folder || viewId !== id) {
        base = snapshot; viewFolder = folder; viewId = id
        view = { ...snapshot, byId: { ...snapshot.byId, [id]: { ...row, cwd: folder } } }
      }
      return view!
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const read = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        void fetch('/api/theone/gateway', { signal: lifetime.signal, cache: 'no-store' })
          .then(response => response.ok ? response.json() as Promise<{ topicFolder?: string | null }> : undefined)
          .then(value => { if (value && !lifetime.signal.aborted) folder = value.topicFolder ?? undefined }).catch(() => {})
      }, 400)
    }
    read()
    // A routed message changes main chat's list entry; the topic in use may have changed with it.
    const unsubscribe = ctx.sessions.list.subscribe(read)
    return () => { unsubscribe(); clearTimeout(timer); list.getSnapshot = original }
  })
}
