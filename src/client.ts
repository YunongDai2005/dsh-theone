import { createElement as h, useEffect, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { MainPanelId, PanelInfo } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { CatalogSnapshot } from './catalog-types.ts'
import { GatewayNavigation } from './client-navigation.ts'

// ui-workspace retains the selected conversation with this public source label.
declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap { mainView: unknown }
}

export const inject = ['slots', 'sessions', 'workspaces', 'layout', 'uiWorkspace', 'modelDirectories', 'remote.session']
const panelId = 'theone-gateway' as MainPanelId
const catalogPanelId = 'theone-catalog' as MainPanelId

export function apply(ctx: Context) {
  const lifetime = new AbortController()
  async function workspaceForGateway() {
    const known = ctx.workspaces.list.getSnapshot().items
    const workspace = known[0] ?? await ctx.workspaces.initializeDefault(lifetime.signal)
    if (!workspace) throw new Error('Create a DSH workspace before opening TheOne')
    return workspace.workspaceId
  }
  const navigation = new GatewayNavigation({
    async exists(id) { await ctx.sessions.refresh(); return ctx.sessions.list.getSnapshot().ids.includes(id as SessionId) },
    async create(id) { await ctx.sessions.create({ sessionId: id as SessionId, workspaceId: await workspaceForGateway() }) },
    async prepare(id) {
      const target = id as SessionId
      if (!ctx.sessions.list.getSnapshot().byId[target]?.cwd) {
        await ctx.sessions.create({sessionId:target,workspaceId:await workspaceForGateway()})
      }
      await ctx.sessions.using(target, { source: 'controllerOperation', signal: lifetime.signal }, async reference => {
        await reference.ready
        lifetime.signal.throwIfAborted()
        const selected = await ctx.modelDirectories.directoryFor(target).select({provider:'theone',model:'gateway'})
        if (!selected.ok) throw selected.error
        const renamed = await reference.binding.session.rename('TheOne · 主聊天')
        if (!renamed.ok) throw renamed.error
      })
      // Archiving the underlying session must not strand the fixed entry.
      await ctx.uiWorkspace.unarchiveSession(target)
    },
    open(id) { if (!lifetime.signal.aborted) ctx.uiWorkspace.openSession(id as SessionId) },
    beginNavigation() { return AbortSignal.any([ctx.layout.beginNavigation(),lifetime.signal]) },
  }, window.localStorage, `dsh-theone.gateway.v1:${location.pathname}`, () => crypto.randomUUID())

  function SidebarEntry({size}: PropsRuntime<'sidebar.panellist'>) {
    const id = useSyncExternalStore(navigation.subscribe,navigation.getSnapshot)
    const sessions = useSyncExternalStore<SessionListState>(ctx.sessions.list.subscribe,ctx.sessions.list.getSnapshot)
    const panel = useSyncExternalStore<PanelInfo>(ctx.layout.panelInfo.subscribe,ctx.layout.panelInfo.getSnapshot)
    const active = panel.activePanelId === panelId || (panel.activePanelId === null && !!id && !!sessions.byId[id as SessionId]?.retainedBy.mainView)
    return h('span',{className:'theone-nav','data-wide':size === 16,'data-active':active},
      h('span',{className:'theone-symbol'}),
      size === 16 && h('span',{className:'theone-entry-copy'},
        h('span',{className:'theone-entry-title'},
          h('span',{className:'theone-wordmark',translate:'no'},h('span',{className:'theone-word-the'},'The'),
            h('span',{className:'theone-word-one'},'One',h('span',{className:'theone-word-dot'}))),
          h('span',{className:'theone-entry-label'},'主聊天')),
        h('span',{className:'theone-entry-sub'},'从这里继续聊')))
  }

  function GatewayPanel() {
    const [error,setError] = useState<string>()
    const [attempt,setAttempt] = useState(0)
    useEffect(() => {
      let mounted = true
      setError(undefined)
      void navigation.open().catch(error => {
        console.warn('TheOne gateway navigation failed:', error instanceof Error ? error.message : 'Unknown navigation error')
        if (mounted) setError('主聊天暂时无法打开，请检查 DSH 连接和 TheOne 插件状态。')
      })
      return () => { mounted = false }
    },[attempt])
    return h('section',{className:'theone-opening','aria-live':'polite'},
      h('p',null,error ?? '正在打开 TheOne 主聊天…'),
      error && h('button',{type:'button',onClick:()=>setAttempt(value=>value+1)},'重试'))
  }

  function CatalogPanel() {
    const [snapshot, setSnapshot] = useState<CatalogSnapshot>()
    const [error, setError] = useState<string>()
    const [busy, setBusy] = useState<string>()
    useEffect(() => {
      const controller = new AbortController()
      const signal = AbortSignal.any([controller.signal, lifetime.signal])
      let reading = false
      async function load() {
        if (reading || signal.aborted) return
        reading = true
        try {
          const response = await fetch('/api/theone/catalog', { signal, cache: 'no-store' })
          if (!response.ok) throw new Error('Catalog unavailable')
          const value = await response.json() as CatalogSnapshot
          if (!signal.aborted) { setSnapshot(value); setError(undefined) }
        } catch { if (!signal.aborted) setError('暂时无法读取话题，请检查 DSH 连接。') }
        finally { reading = false }
      }
      void load()
      const timer = setInterval(() => { void load() }, 5000)
      return () => { controller.abort(); clearInterval(timer) }
    }, [])
    async function continueTopic(contextId: string) {
      setBusy(contextId); setError(undefined)
      try {
        const response = await fetch('/api/theone/context/mount', { method: 'POST',
          headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contextId }), signal: lifetime.signal })
        if (!response.ok) throw new Error('Mount unavailable')
        await navigation.open()
      } catch { setError('暂时无法继续这个话题，请等当前聊天结束后重试。') }
      finally { setBusy(undefined) }
    }
    async function refresh() {
      setBusy('refresh'); setError(undefined)
      try {
        const response = await fetch('/api/theone/catalog/refresh', { method: 'POST', signal: lifetime.signal })
        if (!response.ok) throw new Error('Refresh unavailable')
      } catch { setError('暂时无法整理历史，请检查 DSH 模型配置。') }
      finally { setBusy(undefined) }
    }
    const assigned = new Set(snapshot?.groups.flatMap(group => group.contextIds) ?? [])
    const groups = [...snapshot?.groups ?? [], ...(snapshot?.contexts.some(c => !assigned.has(c.id)) ? [{ id: 'pending', title: '待整理', summary: '这些话题还在等待自动归类。', contextIds: snapshot.contexts.filter(c => !assigned.has(c.id)).map(c => c.id) }] : [])]
    const status = snapshot?.status
    return h('section', { className: 'theone-catalog', translate: 'no' },
      h('header', { className: 'theone-catalog-header' },
        h('div', null, h('h1', null, '话题工作区'), h('p', null, '相关的事情放在一起，随时回到主聊天继续。')),
        h('button', { type: 'button', onClick: refresh, disabled: !!busy || status?.running }, '整理历史')),
      h('p', { className: 'theone-catalog-status', role: 'status' }, snapshot
        ? `${snapshot.contexts.length} 个话题 · ${snapshot.groups.length} 个分组` + (status?.running ? ' · 正在整理历史…' : status?.pending ? ` · 还有 ${status.pending} 个会话待整理` : ' · 历史目录已更新')
        : '正在读取话题…'),
      status?.failed ? h('p', { className: 'theone-catalog-warning' }, `${status.failed} 个会话暂时未能整理，稍后会重试。已有话题仍可查看。`) : null,
      error ? h('p', { role: 'alert', className: 'theone-catalog-warning' }, error) : null,
      snapshot && !snapshot.contexts.length ? h('p', { className: 'theone-catalog-empty' }, status?.running ? '正在从以前的聊天中整理话题。你也可以先回到主聊天。' : '目前还没有整理出话题。开始聊天后，它们会自动出现在这里。') : null,
      h('div', { className: 'theone-catalog-groups' }, ...groups.map(group =>
        h('section', { key: group.id, className: 'theone-topic-group' },
          h('h2', null, group.title, h('span', null, ` ${group.contextIds.length}`)),
          group.summary ? h('p', { className: 'theone-group-summary' }, group.summary) : null,
          ...group.contextIds.flatMap(id => {
            const topic = snapshot?.contexts.find(c => c.id === id)
            if (!topic) return []
            return [h('article', { key: id, className: 'theone-topic-card' },
              h('h3', null, topic.title), h('p', null, topic.summary),
              h('div', { className: 'theone-topic-actions' },
                h('button', { type: 'button', disabled: !!busy, onClick: () => { void continueTopic(id) } }, busy === id ? '正在打开…' : '继续聊天'),
                ...topic.sourceSessionIds.slice(0, 3).map((sessionId, i) => h('button', { key: sessionId, type: 'button', className: 'theone-source-link',
                  onClick: () => { ctx.layout.beginNavigation(); ctx.uiWorkspace.openSession(sessionId as SessionId) } }, `查看原会话${topic.sourceSessionIds.length > 1 ? ' ' + (i + 1) : ''}`))))]
          }))))
    )
  }

  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-theone'
    style.textContent = sidebarCss + catalogCss
    document.head.append(style)
    return () => { lifetime.abort(); style.remove() }
  })
  // Wait for the owning plugins' declarations; retain their normal browser and chat.
  ctx.slots.inject('main', () => [
    ctx.slots.register({name:'main',key:panelId},GatewayPanel),
    ctx.slots.register({name:'main',key:catalogPanelId},CatalogPanel),
  ])
  ctx.slots.inject('sidebar.panellist', () => [
    ctx.slots.register({name:'sidebar.panellist',id:panelId,order:-1000,label:'TheOne · 主聊天'},SidebarEntry),
    ctx.slots.register({name:'sidebar.panellist',id:catalogPanelId,order:-999,label:'话题工作区'}, ({size}: PropsRuntime<'sidebar.panellist'>) =>
      h('span',{className:'theone-catalog-entry'},h('span',null,'▦'),size === 16 ? h('span',null,'话题工作区') : null)),
  ])
}

/** Target only the row containing our own slot marker; no generated DSH class names. */
const sidebarCss = `
button:has(.theone-nav){--one-accent:#a75b1e;--one-tint:#fff5ec;--one-line:#eed3bb;--one-glow:0 0 22px 4px #ff6b0024,0 4px 32px 6px #ff76000d;border:1px solid var(--one-line);background:var(--one-tint);box-shadow:var(--one-glow);overflow:visible;border-radius:12px;color:var(--dsw-alias-label-primary);flex:none}
[data-ds-dark-theme] button:has(.theone-nav){--one-accent:#93c8f3;--one-tint:#1d2a37;--one-line:#344d64;--one-glow:0 0 22px 4px #80bae924}
button:has(.theone-nav[data-wide=true]){padding:12px 10px;min-height:64px;margin-top:4px;margin-bottom:18px}
button:has(.theone-nav[data-wide=true])>span:not(:has(.theone-nav)){display:none}
button:has(.theone-nav):hover{background:var(--one-tint);border-color:color-mix(in srgb,var(--one-accent) 40%,var(--one-line))}
button:has(.theone-nav[data-active=true]){border-color:color-mix(in srgb,var(--one-accent) 40%,var(--one-line))}
.theone-nav{display:flex;align-items:center;gap:10px;color:var(--one-accent);font-family:inherit}
.theone-symbol{width:18px;height:18px;border:1px solid currentColor;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;flex:none}
.theone-symbol:after{content:'';width:4px;height:4px;border-radius:50%;background:currentColor}
.theone-nav[data-wide=true] .theone-symbol{margin:0 3px}
.theone-entry-copy{display:flex;flex-direction:column;align-items:flex-start;gap:2px}
.theone-entry-title{display:flex;align-items:center;gap:9px;line-height:22px}
.theone-wordmark{display:inline-flex;align-items:baseline;gap:1px;white-space:nowrap}
.theone-word-the{font-size:12px;font-weight:400;letter-spacing:-.25px;color:var(--dsw-alias-label-secondary)}
.theone-word-one{position:relative;font-family:ui-rounded,'SF Pro Rounded','Avenir Next',sans-serif;font-size:19px;line-height:1.15;font-weight:500;letter-spacing:-1px;transform:rotate(-4deg);padding-right:7px}
.theone-word-dot{position:absolute;right:0;top:2px;width:4px;height:4px;border-radius:50%;background:currentColor}
.theone-entry-label{font-size:12px;font-weight:400}
.theone-entry-sub{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.theone-opening{padding:32px;color:var(--dsw-alias-label-primary);font:inherit}
.theone-opening button{padding:8px 16px;font:inherit;color:inherit;background:var(--dsw-alias-interactive-bg-hover);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;cursor:pointer}
`

const catalogCss = `
button:has(.theone-catalog-entry)>span:not(:has(.theone-catalog-entry)){display:none}
.theone-catalog{padding:32px;max-width:1180px;margin:auto;box-sizing:border-box;height:100%;overflow:auto;color:var(--dsw-alias-label-primary)}
.theone-catalog-header{display:flex;justify-content:space-between;align-items:center;gap:16px}.theone-catalog h1{font-size:24px;margin:0 0 8px}.theone-catalog-header p,.theone-catalog-status,.theone-group-summary{opacity:.65;margin:0 0 18px;line-height:1.6}.theone-catalog button{border:1px solid #8883;border-radius:9px;padding:8px 13px;background:transparent;color:inherit;cursor:pointer;font:inherit;white-space:nowrap}.theone-catalog button:disabled{opacity:.5;cursor:default}.theone-catalog-groups{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,310px),1fr));gap:20px}.theone-topic-group{border:1px solid #8882;border-radius:16px;padding:20px;background:#88805}.theone-topic-group h2{font-size:18px;margin:0 0 8px}.theone-topic-group h2 span{font-size:13px;opacity:.5}.theone-topic-card{border-top:1px solid #8882;padding:16px 0}.theone-topic-card:last-child{padding-bottom:0}.theone-topic-card h3{font-size:15px;line-height:1.5;margin:0 0 7px}.theone-topic-card p{font-size:13px;line-height:1.7;opacity:.75;margin:0 0 12px;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}.theone-topic-actions{display:flex;gap:8px;flex-wrap:wrap}.theone-topic-actions button{font-size:12px}.theone-topic-actions .theone-source-link{border-color:transparent;opacity:.6}.theone-catalog-warning{background:#ff900011;padding:12px;border-radius:10px;font-size:13px}.theone-catalog-entry{display:flex;align-items:center;gap:10px;font-size:14px}.theone-catalog-empty{padding:40px 0;opacity:.65;line-height:1.8}@media(max-width:640px){.theone-catalog{padding:20px}.theone-catalog-header{align-items:flex-start}.theone-catalog-header h1{font-size:21px}}
`
