import { createElement as h, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { MainPanelId, PanelInfo } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { CatalogContext, CatalogSnapshot, LinkageSnapshot, TopicGroup } from './catalog-types.ts'
import type { RouteView } from './types.ts'
import type { UpdateStatus } from './update.ts'
import type { Notice } from './notices.ts'
import { EDITABLE_SETTINGS_KEYS, type EditableSettings, type SettingsSnapshot } from './settings-types.ts'
import { GatewayNavigation } from './client-navigation.ts'
import { zh, en, type TheOneLocaleKey } from './client-locales.ts'

// ui-workspace retains the selected conversation with this public source label.
declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap { mainView: unknown }
}

export const inject = ['slots', 'locale', 'sessions', 'workspaces', 'layout', 'uiWorkspace', 'modelDirectories', 'remote.session']
const panelId = 'theone-gateway' as MainPanelId
const catalogPanelId = 'theone-catalog' as MainPanelId
const settingsPanelId = 'theone-settings' as MainPanelId

export function apply(ctx: Context) {
  const lifetime = new AbortController()
  ctx.effect(() => ctx.locale.register('theone', { zh, en }))
  const t = ctx.locale.bind('theone')
  const subscribeLocale = ctx.locale.subscribe.bind(ctx.locale)
  const localeSnapshot = ctx.locale.getSnapshot.bind(ctx.locale)
  function useText() { useSyncExternalStore(subscribeLocale, localeSnapshot); return t }
  async function createGateway(id: string) {
    const response = await fetch('/api/theone/gateway', { signal: lifetime.signal, cache: 'no-store' })
    if (!response.ok) throw new Error('Global gateway directory unavailable')
    const { cwd } = await response.json() as { cwd: string }
    // The native create API accepts an explicit cwd without attaching a Workspace.
    await ctx.sessions.create({ sessionId: id as SessionId, cwd })
  }
  const navigation = new GatewayNavigation({
    async exists(id) { await ctx.sessions.refresh(); return ctx.sessions.list.getSnapshot().ids.includes(id as SessionId) },
    create: createGateway,
    async prepare(id) {
      const target = id as SessionId
      if (!ctx.sessions.list.getSnapshot().byId[target]?.cwd) {
        await createGateway(id)
      }
      await ctx.sessions.using(target, { source: 'controllerOperation', signal: lifetime.signal }, async reference => {
        await reference.ready
        lifetime.signal.throwIfAborted()
        const selected = await ctx.modelDirectories.directoryFor(target).select({provider:'theone',model:'gateway'})
        if (!selected.ok) throw selected.error
        const renamed = await reference.binding.session.rename(t('gateway.title'))
        if (!renamed.ok) throw renamed.error
      })
      const prepared = await fetch('/api/theone/gateway/prepare', { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: id }), signal: lifetime.signal })
      if (!prepared.ok) throw new Error('Global gateway preparation failed')
      // Archiving the underlying session must not strand the fixed entry.
      await ctx.uiWorkspace.unarchiveSession(target)
    },
    open(id) { if (!lifetime.signal.aborted) ctx.uiWorkspace.openSession(id as SessionId) },
    beginNavigation() { return AbortSignal.any([ctx.layout.beginNavigation(),lifetime.signal]) },
  }, window.localStorage, `dsh-theone.gateway.v1:${location.pathname}`, () => crypto.randomUUID())

  ctx.effect(() => {
    let active = localeSnapshot().active
    let pending = Promise.resolve()
    return subscribeLocale(() => {
      if (active === localeSnapshot().active) return
      active = localeSnapshot().active
      // Change the display title without navigating or creating a new Session.
      pending = pending.catch(() => {}).then(async () => {
        const id = navigation.getSnapshot() as SessionId | null
        if (!id || lifetime.signal.aborted || !ctx.sessions.list.getSnapshot().byId[id]) return
        await ctx.sessions.using(id, { source: 'controllerOperation', signal: lifetime.signal }, async reference => {
          await reference.ready
          lifetime.signal.throwIfAborted()
          const result = await reference.binding.session.rename(t('gateway.title'))
          if (!result.ok) throw result.error
        })
      })
      void pending.catch(() => {})
    })
  })

  /** Shared update status: checked when the sidebar mounts and every six hours after. */
  let update: UpdateStatus | undefined
  const updateListeners = new Set<() => void>()
  const setUpdate = (value: UpdateStatus) => { update = value; for (const listener of updateListeners) listener() }
  const subscribeUpdate = (listener: () => void) => { updateListeners.add(listener); return () => { updateListeners.delete(listener) } }
  const readUpdate = async (method: 'GET' | 'POST' = 'GET', body?: Record<string, unknown>) => {
    try {
      const response = await fetch('/api/theone/update', { method, signal: lifetime.signal, cache: 'no-store',
        ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) })
      if (response.ok || response.status === 409) setUpdate(await response.json() as UpdateStatus)
      if (update?.state === 'reloading') void awaitReload(update.current)
    } catch { /* Offline: the button simply stays hidden. */ }
  }
  /** TheOne restarts itself with the new version; once it answers again, the page loads the new interface. */
  async function awaitReload(previous: string) {
    for (const started = Date.now(); Date.now() - started < 120000;) {
      await new Promise(resolve => setTimeout(resolve, 1500))
      try {
        const response = await fetch('/api/theone/update', { cache: 'no-store' })
        if (response.ok && (await response.json() as UpdateStatus).current !== previous) { window.location.reload(); return }
      } catch { /* Still reloading. */ }
    }
    if (update) setUpdate({ ...update, state: 'restart' })
  }
  ctx.effect(() => {
    void readUpdate()
    const timer = setInterval(() => { void readUpdate() }, 6 * 3600000)
    return () => clearInterval(timer)
  })

  /**
   * pnpm only installs npm versions published a day ago. Explain that, and offer to exempt TheOne
   * (only TheOne) so the update installs now.
   */
  function openReleaseAgeDialog(status: UpdateStatus) {
    const backdrop = document.createElement('div')
    backdrop.className = 'theone-dialog-backdrop'; backdrop.setAttribute('translate', 'no')
    const card = document.createElement('div')
    card.className = 'theone-dialog'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true')
    const title = document.createElement('h2'); title.id = 'theone-dialog-title'; title.textContent = t('age.title'); card.setAttribute('aria-labelledby', title.id)
    const paragraph = (text: string, className?: string) => { const p = document.createElement('p'); p.textContent = text; if (className) p.className = className; return p }
    const version = status.waiting?.version ?? status.latest ?? ''
    card.append(title, paragraph(t('age.why', { version })), paragraph(t(status.canExempt ? 'age.allowHow' : 'age.cannot')))
    if (status.waiting) card.append(paragraph(t('age.readyAt', { time: new Date(status.waiting.readyAt).toLocaleString(localeSnapshot().active, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }), 'theone-dialog-note'))
    const footer = document.createElement('div'); footer.className = 'theone-dialog-actions'
    const button = (text: string, primary: boolean, act: () => void) => {
      const element = document.createElement('button'); element.type = 'button'; element.textContent = text
      if (primary) element.className = 'theone-dialog-primary'
      element.addEventListener('click', act); footer.append(element); return element
    }
    const close = () => { backdrop.remove(); document.removeEventListener('keydown', keydown, true) }
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); close() } }
    button(t(status.canExempt ? 'age.wait' : 'age.ok'), !status.canExempt, close)
    const allow = status.canExempt ? button(t('age.allow'), true, () => {
      close(); setUpdate({ ...status, state: 'installing', error: undefined }); void readUpdate('POST', { allowFresh: true })
    }) : undefined
    card.append(footer); backdrop.append(card)
    backdrop.addEventListener('pointerdown', event => { if (event.target === backdrop) close() })
    document.addEventListener('keydown', keydown, true)
    document.body.append(backdrop)
    ;(allow ?? footer.querySelector('button'))?.focus()
  }

  /** One-click update on the right of the entry; it shows only when there is something to do. */
  function UpdateButton() {
    const t = useText()
    const status = useSyncExternalStore(subscribeUpdate, () => update)
    // A newer npm version still inside pnpm's one-day wait is shown too, with the choice to install it now.
    const waiting = !!status?.waiting && !status.available && !status.state
    if (!status || (!status.available && !status.state && !waiting)) return null

    const label = waiting ? t('update.waiting') : status.state === 'installing' ? t('update.installing') : status.state === 'reloading' ? t('update.reloading')
      : status.state === 'restart' ? t('update.restart')
      : status.state === 'failed' ? t('update.failed') : t('update.available')
    const title = waiting ? t('update.waitingHint', { latest: status.waiting!.version }) : status.error === 'GATEWAY_BUSY' ? t('update.busy') : status.state === 'reloading' ? t('update.reloadingHint')
      : status.state === 'restart' ? t('update.restartHint')
      : status.state === 'failed' ? (status.error === 'MINIMUM_RELEASE_AGE' ? t('update.tooNew') : status.error === 'NETWORK' ? t('update.network')
        : t('update.failedHint', { error: status.error ?? '' }))
      : status.installable ? t('update.hint', { current: status.current, latest: status.latest ?? '' })
      : t('update.manualHint', { current: status.current, latest: status.latest ?? '' })
    const act = (event: React.SyntheticEvent) => {
      // The entry itself is a button that opens main chat; this click is only the update's.
      event.preventDefault(); event.stopPropagation()
      if (status.state === 'installing' || status.state === 'reloading' || status.state === 'restart') return
      if (waiting || (status.state === 'failed' && status.error === 'MINIMUM_RELEASE_AGE')) { openReleaseAgeDialog(status); return }
      if (!status.installable) { window.open('https://github.com/YunongDai2005/dsh-theone#readme', '_blank', 'noopener'); return }
      setUpdate({ ...status, state: 'installing' })
      void readUpdate('POST')
    }
    return h('span', { className: 'theone-update', role: 'button', tabIndex: 0, title, 'aria-label': title, 'data-state': waiting ? 'waiting' : status.state ?? 'available',
      onClick: act, onPointerDown: (event: React.PointerEvent) => event.stopPropagation(),
      onKeyDown: (event: React.KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') act(event) } },
      status.state === 'installing' || status.state === 'reloading' ? h('span', { className: 'theone-update-spin', 'aria-hidden': true }) : null, label,
      !status.state && (waiting ? status.waiting!.version : status.latest) ? h('small', null, `v${waiting ? status.waiting!.version : status.latest}`) : null)
  }

  /** The One mark: a ring around a dot, drawn so host styles cannot reshape it. */
  const symbol = () => h('svg', { className: 'theone-symbol', viewBox: '0 0 20 20', width: 20, height: 20, 'aria-hidden': true, focusable: false },
    h('circle', { cx: 10, cy: 10, r: 8.6, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 }),
    h('circle', { cx: 10, cy: 10, r: 2.4, fill: 'currentColor' }))

  function SidebarEntry({size}: PropsRuntime<'sidebar.panellist'>) {
    const t = useText()
    const marker = useRef<HTMLSpanElement>(null)
    const pending = useSyncExternalStore(subscribeUpdate, () => !!update?.available && !update.state)
    const id = useSyncExternalStore(navigation.subscribe,navigation.getSnapshot)
    const sessions = useSyncExternalStore<SessionListState>(ctx.sessions.list.subscribe,ctx.sessions.list.getSnapshot)
    const panel = useSyncExternalStore<PanelInfo>(ctx.layout.panelInfo.subscribe,ctx.layout.panelInfo.getSnapshot)
    const active = panel.activePanelId === panelId || (panel.activePanelId === null && !!id && !!sessions.byId[id as SessionId]?.retainedBy.mainView)
    useEffect(() => {
      const button = marker.current?.closest('button')
      if (!button) return
      let menu: HTMLDivElement | undefined
      const close = () => {
        menu?.remove(); menu = undefined
        document.removeEventListener('pointerdown', outside, true)
        document.removeEventListener('keydown', keydown, true)
        window.removeEventListener('resize', close)
        window.removeEventListener('scroll', close, true)
        window.removeEventListener('blur', close)
      }
      const outside = (event: PointerEvent) => { if (!menu?.contains(event.target as Node)) close() }
      const keydown = (event: KeyboardEvent) => {
        if (event.key === 'Escape' || event.key === 'Tab') {
          event.preventDefault(); close(); button.focus()
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
          event.preventDefault(); menu?.querySelector('button')?.focus()
        }
      }
      const open = (x: number, y: number) => {
        close()
        menu = document.createElement('div')
        menu.className = 'theone-context-menu'
        menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', t('settings.title'))
        menu.setAttribute('translate', 'no')
        const item = document.createElement('button')
        item.type = 'button'; item.setAttribute('role', 'menuitem'); item.textContent = t('settings.menu')
        item.addEventListener('click', () => { close(); ctx.layout.selectPanel(settingsPanelId) })
        menu.append(item); document.body.append(menu)
        const bounds = menu.getBoundingClientRect()
        menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8))}px`
        menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8))}px`
        document.addEventListener('pointerdown', outside, true)
        document.addEventListener('keydown', keydown, true)
        window.addEventListener('resize', close)
        window.addEventListener('scroll', close, true)
        window.addEventListener('blur', close)
        item.focus()
      }
      const contextmenu = (event: MouseEvent) => {
        event.preventDefault(); event.stopPropagation()
        const bounds = button.getBoundingClientRect()
        open(event.clientX || bounds.left, event.clientY || bounds.bottom)
      }
      const keyboard = (event: KeyboardEvent) => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          event.preventDefault()
          const bounds = button.getBoundingClientRect(); open(bounds.left, bounds.bottom)
        }
      }
      button.addEventListener('contextmenu', contextmenu)
      button.addEventListener('keydown', keyboard)
      return () => { close(); button.removeEventListener('contextmenu', contextmenu); button.removeEventListener('keydown', keyboard) }
    }, [size])
    useEffect(() => {
      const button = marker.current?.closest('button')
      if (!button || !active) return
      const move = (event: PointerEvent) => {
        if (event.pointerType === 'touch') return
        const bounds = button.getBoundingClientRect()
        button.style.setProperty('--one-pointer-x', `${event.clientX - bounds.left}px`)
        button.style.setProperty('--one-pointer-y', `${event.clientY - bounds.top}px`)
        button.dataset.oneTracking = 'true'
      }
      const leave = () => { delete button.dataset.oneTracking }
      button.addEventListener('pointermove', move, { passive: true })
      button.addEventListener('pointerleave', leave)
      button.addEventListener('pointercancel', leave)
      return () => {
        button.removeEventListener('pointermove', move)
        button.removeEventListener('pointerleave', leave)
        button.removeEventListener('pointercancel', leave)
        leave()
        button.style.removeProperty('--one-pointer-x')
        button.style.removeProperty('--one-pointer-y')
      }
    }, [active, size])
    return h('span',{ref:marker,className:'theone-nav',translate:'no','data-wide':size === 16,'data-active':active},
      h('span',{className:'theone-symbol-wrap'},symbol(),size !== 16 && pending ? h('span',{className:'theone-update-dot','aria-hidden':true}) : null),
      size === 16 && h('span',{className:'theone-entry-copy'},
        h('span',{className:'theone-entry-title'},
          h('span',{className:'theone-wordmark',translate:'no'},h('span',{className:'theone-word-the'},'The'),
            h('span',{className:'theone-word-one'},'One',h('span',{className:'theone-word-dot'}))),
          h('span',{className:'theone-entry-label'},t('gateway.label'))),
        h('span',{className:'theone-entry-sub'},t('gateway.subtitle'))),
      size === 16 && h(UpdateButton))
  }

  /** Settings as the background-model button reads and writes them. */
  const readSettings = async () => {
    const response = await fetch('/api/theone/settings', { signal: lifetime.signal, cache: 'no-store' })
    if (!response.ok) throw new Error('Settings unavailable')
    return await response.json() as SettingsSnapshot
  }
  /** Pin (or with null, release) the background model; a concurrent edit elsewhere is retried once on fresh settings. */
  const saveBackgroundModel = async (choice: { provider: string; model: string } | null) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const current = await readSettings()
      const response = await fetch('/api/theone/settings', { method: 'PUT', signal: lifetime.signal, cache: 'no-store', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ revision: current.revision, values: { ...current.savedValues, workerProvider: choice?.provider ?? null, workerModel: choice?.model ?? null } }) })
      if (response.ok) return await response.json() as SettingsSnapshot
      if (response.status !== 409) break
    }
    throw new Error('Background model not saved')
  }

  type DirectoryStore = { subscribe(listener: () => void): () => void; getSnapshot(): { current: { provider: string; model: string } | null; pending: { provider: string; model: string } | null } }

  /**
   * Beside main chat's model button while TheOne is selected: which model does the routing and the
   * background work. Following DSH uses the default model; picking one pins it, as in Settings.
   */
  function BackgroundModel({ directory }: { directory: DirectoryStore }) {
    const t = useText()
    const state = useSyncExternalStore(listener => directory.subscribe(listener), () => directory.getSnapshot())
    const selection = state.pending ?? state.current
    const theone = selection?.provider === 'theone'
    const [settings, setSettings] = useState<SettingsSnapshot>()
    const [failed, setFailed] = useState(false)
    const [saving, setSaving] = useState(false)
    const button = useRef<HTMLButtonElement>(null)
    const closeMenu = useRef<() => void>()
    useEffect(() => {
      if (!theone) return
      let alive = true
      readSettings().then(value => { if (alive) setSettings(value) }, () => {})
      return () => { alive = false; closeMenu.current?.() }
    }, [theone])
    if (!theone) return null
    const pinned = settings?.values.workerProvider && settings.values.workerModel ? { provider: settings.values.workerProvider, model: settings.values.workerModel } : null
    const nameOf = (provider: string, model: string) => settings?.models.find(item => item.provider === provider && item.id === model)?.name ?? model
    const effective = settings?.model ? nameOf(settings.model.provider, settings.model.model) : undefined
    // Following DSH still names the model doing the work.
    const label = pinned ? nameOf(pinned.provider, pinned.model) : effective ?? t('bg.follow')
    const choose = async (choice: { provider: string; model: string } | null) => {
      closeMenu.current?.(); setSaving(true); setFailed(false)
      try { setSettings(await saveBackgroundModel(choice)) } catch { setFailed(true) } finally { setSaving(false) }
    }
    const open = () => {
      const anchor = button.current
      if (!anchor || closeMenu.current) { closeMenu.current?.(); return }
      const menu = document.createElement('div')
      menu.className = 'theone-bg-menu'; menu.setAttribute('role', 'menu'); menu.setAttribute('translate', 'no'); menu.setAttribute('aria-label', t('bg.title'))
      const heading = document.createElement('div'); heading.className = 'theone-bg-heading'; heading.textContent = t('bg.title')
      const list = document.createElement('div'); list.className = 'theone-bg-list'
      const models = (settings?.models ?? []).filter(item => item.provider !== 'theone')
      const item = (text: string, sub: string | undefined, checked: boolean, pick: () => void) => {
        const row = document.createElement('button')
        row.type = 'button'; row.setAttribute('role', 'menuitemradio'); row.setAttribute('aria-checked', String(checked)); row.className = 'theone-bg-item'
        const name = document.createElement('span'); name.textContent = text; row.append(name)
        if (sub) { const small = document.createElement('small'); small.textContent = sub; row.append(small) }
        const mark = document.createElement('span'); mark.className = 'theone-bg-check'; mark.textContent = checked ? '✓' : ''; row.append(mark)
        row.addEventListener('click', pick)
        return row
      }
      const render = (query: string) => {
        list.replaceChildren(item(t('bg.followItem'), !pinned && effective ? effective : undefined, !pinned, () => { void choose(null) }))
        const needle = query.trim().toLowerCase()
        const matched = models.filter(model => !needle || `${model.name} ${model.id} ${model.provider}`.toLowerCase().includes(needle))
        for (const provider of [...new Set(matched.map(model => model.provider))]) {
          const group = document.createElement('div'); group.className = 'theone-bg-group'; group.textContent = provider; list.append(group)
          for (const model of matched.filter(entry => entry.provider === provider))
            list.append(item(model.name, model.name !== model.id ? model.id : undefined, pinned?.provider === model.provider && pinned.model === model.id, () => { void choose({ provider: model.provider, model: model.id }) }))
        }
        if (!matched.length && needle) { const empty = document.createElement('p'); empty.className = 'theone-bg-empty'; empty.textContent = t('bg.none'); list.append(empty) }
      }
      menu.append(heading)
      let search: HTMLInputElement | undefined
      if (models.length > 8) {
        search = document.createElement('input'); search.type = 'search'; search.className = 'theone-bg-search'; search.placeholder = t('bg.search')
        search.addEventListener('input', () => render(search!.value)); menu.append(search)
      }
      menu.append(list); render('')
      document.body.append(menu)
      anchor.setAttribute('aria-expanded', 'true')
      const place = () => {
        const bounds = anchor.getBoundingClientRect(), size = menu.getBoundingClientRect()
        menu.style.left = `${Math.max(8, Math.min(bounds.right - size.width, window.innerWidth - size.width - 8))}px`
        menu.style.top = `${Math.max(8, bounds.top - size.height - 8)}px`
      }
      place()
      const rows = () => [...menu.querySelectorAll<HTMLButtonElement>('.theone-bg-item')]
      const outside = (event: PointerEvent) => { if (!menu.contains(event.target as Node) && !anchor.contains(event.target as Node)) close() }
      const keydown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') { event.preventDefault(); close(); anchor.focus() }
        else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          const all = rows(), index = all.indexOf(document.activeElement as HTMLButtonElement)
          all[(index + (event.key === 'ArrowDown' ? 1 : all.length - 1) + (index < 0 && event.key === 'ArrowUp' ? 1 : 0)) % all.length]?.focus()
        }
      }
      const close = () => {
        menu.remove(); closeMenu.current = undefined; anchor.setAttribute('aria-expanded', 'false')
        document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', keydown, true)
        window.removeEventListener('resize', close); window.removeEventListener('blur', close)
      }
      closeMenu.current = close
      document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', keydown, true)
      window.addEventListener('resize', close); window.addEventListener('blur', close)
      ;(search ?? rows().find(row => row.getAttribute('aria-checked') === 'true') ?? rows()[0])?.focus()
    }
    const title = failed ? t('bg.error') : t(pinned ? 'bg.hint' : 'bg.hintFollow', { model: label })
    return h('button', { ref: button, type: 'button', className: 'theone-bg', title, 'aria-label': title, 'aria-haspopup': 'menu', 'data-failed': failed, disabled: saving,
      onClick: () => { if (settings) open(); else readSettings().then(value => { setSettings(value) }, () => setFailed(true)) } },
      h('span', { className: 'theone-bg-caption' }, t('bg.label')),
      h('span', { className: 'theone-bg-text' }, label),
      h('span', { className: 'theone-bg-chevron', 'aria-hidden': true }, saving ? '…' : '⌃'))
  }

  /** Notices from TheOne's maintainer, shared by the dialog and the strip under the main chat input. */
  let notices: Notice[] = []
  const noticeListeners = new Set<() => void>()
  const setNotices = (value: Notice[]) => { notices = value; for (const listener of noticeListeners) listener() }
  const subscribeNotices = (listener: () => void) => { noticeListeners.add(listener); return () => { noticeListeners.delete(listener) } }
  const localized = (value: { zh?: string; en?: string }) => localeSnapshot().active.startsWith('zh') ? value.zh ?? value.en ?? '' : value.en ?? value.zh ?? ''
  const shownDialogs = new Set<string>()
  const dismissNotice = (id: string) => {
    setNotices(notices.filter(notice => notice.id !== id))
    void fetch('/api/theone/notices', { method: 'POST', signal: lifetime.signal, cache: 'no-store', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dismiss: id }) }).catch(() => {})
  }
  /** An important notice opens once as a dialog; closing it dismisses it. */
  function openNoticeDialog(notice: Notice) {
    shownDialogs.add(notice.id)
    const backdrop = document.createElement('div')
    backdrop.className = 'theone-dialog-backdrop'; backdrop.setAttribute('translate', 'no')
    const card = document.createElement('div')
    card.className = 'theone-dialog'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true')
    const title = document.createElement('h2'); title.id = 'theone-notice-title'; title.textContent = localized(notice.title); card.setAttribute('aria-labelledby', title.id)
    const body = document.createElement('p'); body.className = 'theone-dialog-body'; body.textContent = localized(notice.body)
    const footer = document.createElement('div'); footer.className = 'theone-dialog-actions'
    const close = () => { backdrop.remove(); document.removeEventListener('keydown', keydown, true); dismissNotice(notice.id) }
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); close() } }
    if (notice.link) {
      const more = document.createElement('button'); more.type = 'button'; more.textContent = t('notice.more')
      more.addEventListener('click', () => { window.open(notice.link, '_blank', 'noopener'); close() }); footer.append(more)
    }
    const ok = document.createElement('button'); ok.type = 'button'; ok.className = 'theone-dialog-primary'; ok.textContent = t('notice.ok')
    ok.addEventListener('click', close); footer.append(ok)
    card.append(title, body, footer); backdrop.append(card)
    document.addEventListener('keydown', keydown, true)
    document.body.append(backdrop); ok.focus()
  }
  const readNotices = async () => {
    try {
      const response = await fetch('/api/theone/notices', { signal: lifetime.signal, cache: 'no-store' })
      if (!response.ok) return
      setNotices(((await response.json()) as { notices: Notice[] }).notices)
      const important = notices.find(notice => notice.level === 'important' && !shownDialogs.has(notice.id))
      if (important && !document.querySelector('.theone-dialog-backdrop')) openNoticeDialog(important)
    } catch { /* No notices when offline. */ }
  }
  ctx.effect(() => {
    void readNotices()
    const timer = setInterval(() => { void readNotices() }, 3 * 3600000)
    return () => clearInterval(timer)
  })

  /** Ordinary notices: one quiet line under the main chat input while TheOne is selected. */
  function NoticeStrip({ directory }: { directory: DirectoryStore }) {
    const t = useText()
    const state = useSyncExternalStore(listener => directory.subscribe(listener), () => directory.getSnapshot())
    const list = useSyncExternalStore(subscribeNotices, () => notices)
    const notice = list.find(item => item.level === 'info')
    if ((state.pending ?? state.current)?.provider !== 'theone' || !notice) return null
    const title = localized(notice.title), body = localized(notice.body)
    return h('div', { className: 'theone-notice', role: 'status', translate: 'no' },
      h('span', { className: 'theone-notice-tag' }, t('notice.label')),
      h('span', { className: 'theone-notice-text', title: `${title}\n${body}` }, h('strong', null, title), ' ', body),
      notice.link ? h('button', { type: 'button', className: 'theone-notice-link', onClick: () => { window.open(notice.link, '_blank', 'noopener') } }, t('notice.more')) : null,
      h('button', { type: 'button', className: 'theone-notice-close', 'aria-label': t('notice.close'), title: t('notice.close'), onClick: () => dismissNotice(notice.id) }, '×'))
  }

  // Beside main chat's model button, only while TheOne is the selected model.
  ctx.inject(['slots', 'modelDirectories'], scope => {
    const slots = scope.slots as unknown as { inject(name: string, factory: () => () => void): void; register(options: Record<string, unknown>, component: unknown): () => void }
    slots.inject('conversation.input.right', () => slots.register({ name: 'conversation.input.right', id: 'theone.background-model', order: 100,
      inject: (sessionId: SessionId) => ({ directory: scope.modelDirectories.directoryFor(sessionId).store }) }, BackgroundModel))
    slots.inject('conversation.composer.dock', () => slots.register({ name: 'conversation.composer.dock', id: 'theone.notice', order: 100,
      inject: (sessionId: SessionId) => ({ directory: scope.modelDirectories.directoryFor(sessionId).store }) }, NoticeStrip))
  })

  function GatewayPanel() {
    const t = useText()
    const [error,setError] = useState<TheOneLocaleKey>()
    const [attempt,setAttempt] = useState(0)
    useEffect(() => {
      let mounted = true
      setError(undefined)
      void navigation.open().catch(error => {
        console.warn('TheOne gateway navigation failed:', error instanceof Error ? error.message : 'Unknown navigation error')
        if (mounted) setError('gateway.error')
      })
      return () => { mounted = false }
    },[attempt])
    return h('section',{className:'theone-opening','aria-live':'polite'},
      h('p',null,t(error ?? 'gateway.opening')),
      error && h('button',{type:'button',onClick:()=>setAttempt(value=>value+1)},t('retry')))
  }

  function SettingsPanel() {
    const t = useText()
    const heading = useRef<HTMLHeadingElement>(null)
    const [snapshot, setSnapshot] = useState<SettingsSnapshot>()
    const [draft, setDraft] = useState<EditableSettings>()
    const [saving, setSaving] = useState(false)
    const [message, setMessage] = useState<TheOneLocaleKey>()
    const saveRequest = useRef<AbortController>()
    useEffect(() => () => saveRequest.current?.abort(), [])
    const [error, setError] = useState(false)
    const [attempt, setAttempt] = useState(0)
    useEffect(() => {
      heading.current?.focus()
      const controller = new AbortController()
      const signal = AbortSignal.any([controller.signal, lifetime.signal])
      setError(false)
      void (async () => {
        try {
          const response = await fetch('/api/theone/settings', { signal, cache: 'no-store' })
          if (!response.ok) throw new Error('Settings unavailable')
          const value = await response.json() as SettingsSnapshot
          if (!signal.aborted) { setSnapshot(value); setDraft(value.savedValues); setMessage(undefined) }
        } catch { if (!signal.aborted) setError(true) }
      })()
      return () => controller.abort()
    }, [attempt])
    const groups = [
      ['models', ['workerProvider', 'workerModel', 'routerMode']],
      ['history', ['historyCatalog', 'catalogIntervalMs']],
      ['linkage', ['linkScope', 'routeNotice']],
      ['limits', ['maxDescriptorChars', 'maxResponseChars']],
      ['storage', ['contextsPath', 'databasePath', 'gatewayKey']],
      ['other', ['notices']],
    ] as const
    const display = (key: keyof SettingsSnapshot['values']) => {
      const value = snapshot!.values[key]
      if (value === null) return t(key === 'workerProvider' || key === 'workerModel' ? 'settings.follow' : 'settings.none')
      if (typeof value === 'boolean') return t(value ? 'settings.on' : 'settings.off')
      if (key === 'linkScope') return t(`settings.scope.${value}` as TheOneLocaleKey)
      if (key === 'routeNotice') return t(`settings.notice.${value}` as TheOneLocaleKey)
      if (key === 'catalogIntervalMs') return t('settings.seconds', { count: Number(value) / 1000 })
      return typeof value === 'number' ? value.toLocaleString(localeSnapshot().active) : value || t('settings.none')
    }
    const dirty = !!snapshot && !!draft && EDITABLE_SETTINGS_KEYS.some(key => draft[key] !== snapshot.savedValues[key])
    const change = (key: keyof EditableSettings, value: EditableSettings[keyof EditableSettings]) => {
      setDraft(current => current && { ...current, [key]: value }); setMessage(undefined)
    }
    const save = async () => {
      if (!snapshot || !draft || saving) return
      const controller = new AbortController(); saveRequest.current = controller
      const signal = AbortSignal.any([controller.signal, lifetime.signal])
      setSaving(true); setMessage(undefined)
      try {
        const response = await fetch('/api/theone/settings', { method: 'PUT', signal, cache: 'no-store',
          headers: { 'content-type': 'application/json' }, body: JSON.stringify({ values: draft, revision: snapshot.revision }) })
        if (!response.ok) {
          const failure = await response.json().catch(() => ({})) as { error?: string }
          if (!signal.aborted) setMessage(response.status === 409 ? 'settings.conflict' : failure.error === 'CONTEXTS_UNREADABLE' ? 'settings.contextsUnreadable' : 'settings.saveError')
          return
        }
        const value = await response.json() as SettingsSnapshot
        if (!signal.aborted) { setSnapshot(value); setDraft(value.savedValues); setMessage(value.restartRequired ? 'settings.restart' : 'settings.saved') }
      } catch { if (!signal.aborted) setMessage('settings.saveError') }
      finally { if (!signal.aborted) setSaving(false) }
    }
    const control = (key: keyof SettingsSnapshot['values']) => {
      if (!draft || !snapshot || !EDITABLE_SETTINGS_KEYS.includes(key as keyof EditableSettings)) return display(key)
      const field = key as keyof EditableSettings
      const props = { 'aria-label': t(`settings.${key}`), disabled: saving, id: `theone-setting-${key}` }
      const select = (value: string, choices: { value: string; label: string }[], selectValue: (value: string) => void) =>
        h('select', { ...props, value, required: field === 'workerModel' && !!draft.workerProvider, onChange: (event: React.ChangeEvent<HTMLSelectElement>) => selectValue(event.target.value) },
          ...choices.map(choice => h('option', { key: choice.value, value: choice.value }, choice.label)))
      if (field === 'historyCatalog' || field === 'notices') return select(String(draft[field]), [{ value: 'true', label: t('settings.on') }, { value: 'false', label: t('settings.off') }], v => change(field, v === 'true'))
      if (field === 'linkScope' || field === 'routeNotice') {
        const values = field === 'linkScope' ? ['auto', 'workspace', 'off'] : ['switch', 'hidden', 'all']
        return select(draft[field], values.map(value => ({ value, label: t(`settings.${field === 'linkScope' ? 'scope' : 'notice'}.${value}` as TheOneLocaleKey) })), v => change(field, v as never))
      }
      if (field === 'routerMode')
        return select(draft.routerMode, ['llm', 'rules'].map(value => ({ value, label: t(`settings.${value}` as TheOneLocaleKey) })), v => change(field, v as EditableSettings['routerMode']))
      // Every model DSH offers, so the Workers can be pinned to any of them.
      const offered = (provider: string | null) => snapshot.models.filter(model => model.provider === provider)
      if (field === 'workerProvider') {
        const providers = [...new Set([...snapshot.models.map(model => model.provider), snapshot.savedValues.workerProvider].filter((value): value is string => !!value && value !== 'theone'))]
        return select(draft.workerProvider ?? '', [{ value: '', label: t('settings.follow') }, ...providers.map(value => ({ value, label: value }))], v => {
          const model = v === snapshot.savedValues.workerProvider ? snapshot.savedValues.workerModel : v === snapshot.model?.provider ? snapshot.model.model : offered(v)[0]?.id
          setDraft(current => current && { ...current, workerProvider: v || null, workerModel: v ? model ?? null : null }); setMessage(undefined)
        })
      }
      if (field === 'workerModel') {
        const models = offered(draft.workerProvider).map(model => ({ value: model.id, label: model.name && model.name !== model.id ? `${model.name} (${model.id})` : model.id }))
        if (draft.workerModel && !models.some(model => model.value === draft.workerModel)) models.unshift({ value: draft.workerModel, label: draft.workerModel })
        return select(draft.workerModel ?? '', [{ value: '', label: t(draft.workerProvider ? 'settings.none' : 'settings.follow') }, ...models], v => change(field, v || null))
      }
      if (field === 'catalogIntervalMs' || field === 'maxDescriptorChars' || field === 'maxResponseChars') {
        const interval = field === 'catalogIntervalMs'
        return h('input', { ...props, type: 'number', required: true, step: 1, min: interval ? 10 : 128,
          max: interval ? 86400 : field === 'maxDescriptorChars' ? 1000000 : 10000000,
          value: Number.isFinite(draft[field]) ? draft[field] / (interval ? 1000 : 1) : '',
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => change(field, event.target.valueAsNumber * (interval ? 1000 : 1)) })
      }
      return h('input', { ...props, type: 'text', value: draft.contextsPath ?? '', maxLength: 4096, placeholder: t('settings.none'),
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => change('contextsPath', event.target.value.trim() ? event.target.value : null) })
    }
    return h('section', { className: 'theone-settings', translate: 'no' },
      h('header', { className: 'theone-settings-header' },
        h('div', null, h('h1', { ref: heading, tabIndex: -1 }, t('settings.title')), h('p', null, t('settings.subtitle'))),
        h('button', { type: 'button', disabled: saving, onClick: () => ctx.layout.selectPanel(panelId) }, t('settings.back'))),
      h('p', { className: 'theone-settings-notice' }, t('settings.readOnly')),
      !snapshot && !error ? h('p', { role: 'status' }, t('settings.loading')) : null,
      error ? h('p', { role: 'alert' }, t('settings.error'), ' ', h('button', { type: 'button', onClick: () => setAttempt(n => n + 1) }, t('retry'))) : null,
      snapshot && draft && h('form', { onSubmit: (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); void save() } },
        h('section', { className: 'theone-settings-summary' },
          h('dl', null,
            h('div', null, h('dt', null, t('settings.model')), h('dd', null, snapshot.model ? `${snapshot.model.provider} / ${snapshot.model.model}` : t('settings.none'))),
            h('div', null, h('dt', null, t('settings.capacity')), h('dd', null, snapshot.model?.contextWindow?.toLocaleString(localeSnapshot().active) ?? t('settings.none'))),
            h('div', null, h('dt', null, t('settings.output')), h('dd', null, snapshot.model?.defaultMaxTokens?.toLocaleString(localeSnapshot().active) ?? t('settings.none')))),
          snapshot.modelUnavailable ? h('p', { role: 'status' }, t('settings.modelUnavailable')) : null,
          h('p', null, t('settings.inherited')),
          h('p', null, t('settings.compression'))),
        ...groups.map(([group, keys]) => h('section', { className: 'theone-settings-group', key: group },
          h('h2', null, t(`settings.${group}`)),
          h('dl', null, ...keys.map(key => h('div', { className: 'theone-settings-row', key },
            h('dt', null, h('strong', null, t(`settings.${key}`)), h('p', null, t(`settings.help.${key}`)), h('code', null, key)),
            h('dd', null, control(key), key === 'catalogIntervalMs' && Number.isFinite(draft.catalogIntervalMs) ? h('small', null, t('settings.seconds', { count: draft.catalogIntervalMs / 1000 })) : null)))))),
        h('footer', { className: 'theone-settings-footer' },
          h('p', { role: message === 'settings.saveError' || message === 'settings.conflict' || message === 'settings.contextsUnreadable' ? 'alert' : 'status' },
            message ? t(message) : dirty ? t('settings.unsaved') : snapshot.restartRequired ? t('settings.restart') : ''),
          message === 'settings.conflict' ? h('button', { type: 'button', onClick: () => setAttempt(n => n + 1) }, t('settings.reload')) : null,
          h('button', { type: 'button', disabled: saving || !dirty, onClick: () => { setDraft(snapshot.savedValues); setMessage(undefined) } }, t('settings.reset')),
          h('button', { type: 'submit', disabled: saving || !dirty, className: 'theone-settings-save' }, t(saving ? 'settings.saving' : 'settings.save'))))
    )
  }

  type Post = (path: string, body: Record<string, unknown>) => Promise<boolean>
  const ROUTE_REASONS = new Set(['steering', 'short-continuation', 'attachment-only', 'correction', 'correction-unclear', 'explicit-new-topic',
    'no-history-evidence', 'entity-or-keyword', 'keyword-only-switch', 'current-reference', 'combined-contexts', 'insufficient-evidence',
    'multiple-contexts', 'weak-keyword-match', 'no-history-match', 'CATALOG_NOT_READY', 'CATALOG_REVIEW_LIMIT', 'HISTORY_SEARCH_UNAVAILABLE'])
  const routeReason = (reason: string) => ROUTE_REASONS.has(reason) ? t(`route.reason.${reason}` as TheOneLocaleKey)
    : reason.startsWith('router-fallback:') ? t('route.reason.router-fallback') : reason

  /** Rename, describe, constrain, move, merge, attach history to or delete one topic. */
  function TopicManager({ topic, constraints, groups, contexts, post, busy }: {
    topic: CatalogContext; constraints: string; groups: TopicGroup[]; contexts: CatalogContext[]; post: Post; busy: boolean
  }) {
    const t = useText()
    const [title, setTitle] = useState(topic.title)
    const [summary, setSummary] = useState(topic.summary)
    const [rules, setRules] = useState(constraints)
    const groupOf = groups.find(group => group.contextIds.includes(topic.id))?.id ?? ''
    const [group, setGroup] = useState(groupOf)
    const [groupTitle, setGroupTitle] = useState('')
    const [into, setInto] = useState('')
    const [confirm, setConfirm] = useState<'merge' | 'delete'>()
    const [sessions, setSessions] = useState<{ id: string; title: string }[]>()
    const [session, setSession] = useState('')
    useEffect(() => {
      const controller = new AbortController()
      fetch('/api/theone/sessions', { signal: AbortSignal.any([controller.signal, lifetime.signal]), cache: 'no-store' })
        .then(response => response.ok ? response.json() : { sessions: [] }).then(value => setSessions((value as { sessions: { id: string; title: string }[] }).sessions))
        .catch(() => { if (!controller.signal.aborted) setSessions([]) })
      return () => controller.abort()
    }, [])
    const own = new Set(topic.sourceSessionIds)
    const edited = title.trim() !== topic.title || summary.trim() !== topic.summary || rules.trim() !== constraints
    const field = (label: TheOneLocaleKey, control: unknown) => h('label', { className: 'theone-manage-field' }, h('span', null, t(label)), control as never)
    return h('div', { className: 'theone-manage' },
      field('manage.title', h('input', { value: title, maxLength: 80, disabled: busy, onChange: (event: React.ChangeEvent<HTMLInputElement>) => setTitle(event.target.value) })),
      field('manage.summary', h('textarea', { value: summary, rows: 3, maxLength: 2000, disabled: busy, onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => setSummary(event.target.value) })),
      field('manage.constraintsLabel', h('textarea', { value: rules, rows: 2, maxLength: 400, disabled: busy, placeholder: t('manage.constraintsPlaceholder'), onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => setRules(event.target.value) })),
      h('div', { className: 'theone-manage-row' },
        h('button', { type: 'button', disabled: busy || !edited || !title.trim() || !summary.trim(),
          onClick: () => { void post('/api/theone/topics', { action: 'edit', id: topic.id, title, summary, constraints: rules }) } }, t('manage.save'))),
      field('manage.workspace', h('div', { className: 'theone-manage-row' },
        h('select', { value: group, disabled: busy, onChange: (event: React.ChangeEvent<HTMLSelectElement>) => setGroup(event.target.value) },
          h('option', { value: '' }, t('manage.unassigned')), ...groups.map(item => h('option', { key: item.id, value: item.id }, item.title)),
          h('option', { value: '__new' }, t('manage.newWorkspace'))),
        group === '__new' ? h('input', { value: groupTitle, maxLength: 80, placeholder: t('manage.newWorkspaceName'), disabled: busy, onChange: (event: React.ChangeEvent<HTMLInputElement>) => setGroupTitle(event.target.value) }) : null,
        h('button', { type: 'button', disabled: busy || group === groupOf || (group === '__new' && !groupTitle.trim()),
          onClick: () => { void post('/api/theone/topics', { action: 'move', id: topic.id, ...(group === '__new' ? { groupTitle } : group ? { groupId: group } : {}) }) } }, t('manage.move')))),
      field('manage.attach', h('div', { className: 'theone-manage-row' },
        h('select', { value: session, disabled: busy || !sessions, onChange: (event: React.ChangeEvent<HTMLSelectElement>) => setSession(event.target.value) },
          h('option', { value: '' }, sessions ? t('manage.attachPick') : t('manage.loadingSessions')),
          ...(sessions ?? []).filter(item => !own.has(item.id)).map(item => h('option', { key: item.id, value: item.id }, item.title))),
        h('button', { type: 'button', disabled: busy || !session, onClick: () => { void post('/api/theone/topics', { action: 'attach', id: topic.id, sessionId: session }).then(ok => { if (ok) setSession('') }) } }, t('manage.attachButton')))),
      h('p', { className: 'theone-manage-hint' }, t('manage.attachHint')),
      field('manage.merge', h('div', { className: 'theone-manage-row' },
        h('select', { value: into, disabled: busy, onChange: (event: React.ChangeEvent<HTMLSelectElement>) => { setInto(event.target.value); setConfirm(undefined) } },
          h('option', { value: '' }, t('manage.mergePick')), ...contexts.filter(item => item.id !== topic.id).map(item => h('option', { key: item.id, value: item.id }, item.title))),
        h('button', { type: 'button', disabled: busy || !into, className: confirm === 'merge' ? 'theone-danger' : undefined,
          onClick: () => { if (confirm !== 'merge') setConfirm('merge'); else void post('/api/theone/topics', { action: 'merge', id: topic.id, into }) } },
          t(confirm === 'merge' ? 'manage.confirm' : 'manage.mergeButton')))),
      h('p', { className: 'theone-manage-hint' }, t('manage.mergeHint')),
      h('div', { className: 'theone-manage-row' },
        h('button', { type: 'button', disabled: busy, className: 'theone-danger',
          onClick: () => { if (confirm !== 'delete') setConfirm('delete'); else void post('/api/theone/topics', { action: 'delete', id: topic.id }) } },
          t(confirm === 'delete' ? 'manage.deleteConfirm' : 'manage.delete')),
        confirm === 'delete' ? h('span', { className: 'theone-manage-hint' }, t('manage.deleteHint')) : null))
  }

  /** Where recent messages went and why; a misrouted one can be moved to the right topic. */
  type RouteStats = { total: number; corrected: number; clarified: number; fallback: number }
  function RouteList({ routes, stats, contexts, post, busy }: { routes: RouteView[]; stats?: RouteStats; contexts: CatalogContext[]; post: Post; busy: boolean }) {
    const t = useText()
    const titleOf = (id?: string) => contexts.find(context => context.id === id)?.title ?? t('routes.removed')
    return h('details', { className: 'theone-routes' },
      h('summary', null, t('routes.title'), h('span', null, ` ${routes.length}`),
        stats?.total ? h('small', { className: 'theone-route-stats' }, t('routes.stats', { total: stats.total, corrected: stats.corrected,
          rate: Math.round(100 * (stats.total - stats.corrected) / stats.total), clarified: stats.clarified })) : null),
      h('p', { className: 'theone-manage-hint' }, t('routes.hint')),
      routes.length ? h('ol', null, ...routes.map(route => {
        const target = route.decision.contextId
        const receipt = route.receipt
        const details = [routeReason(route.decision.reason), receipt?.mode === 'llm' ? receipt.model : receipt ? t('routes.rules') : undefined,
          receipt?.elapsedMs !== undefined ? `${(receipt.elapsedMs / 1000).toFixed(1)} s` : undefined,
          receipt?.errorCode ? t('routes.error', { code: receipt.errorCode }) : undefined].filter(Boolean).join(' · ')
        return h('li', { key: route.messageId },
          h('div', { className: 'theone-route-head' },
            h('time', null, new Date(route.at).toLocaleTimeString(localeSnapshot().active, { hour: '2-digit', minute: '2-digit' })),
            h('q', null, route.excerpt || '…')),
          h('div', { className: 'theone-route-body' },
            h('strong', null, route.decision.action === 'CLARIFY' ? t('routes.clarify') : `→ ${titleOf(target)}`),
            h('small', null, details),
            route.correctedTo ? h('span', { className: 'theone-route-fixed' }, t('routes.corrected', { title: titleOf(route.correctedTo) }))
              : h('select', { value: '', disabled: busy, 'aria-label': t('routes.move'),
                onChange: (event: React.ChangeEvent<HTMLSelectElement>) => { if (event.target.value) void post('/api/theone/routes', { messageId: route.messageId, contextId: event.target.value }) } },
                h('option', { value: '' }, t('routes.move')), ...contexts.filter(context => context.id !== target).map(context => h('option', { key: context.id, value: context.id }, context.title)))))
      })) : h('p', { className: 'theone-links-empty' }, t('routes.empty')))
  }

  function CatalogPanel() {
    const t = useText()
    const [snapshot, setSnapshot] = useState<CatalogSnapshot>()
    const [error, setError] = useState<TheOneLocaleKey>()
    const [busy, setBusy] = useState<string>()
    const [routes, setRoutes] = useState<RouteView[]>([])
    const [routeStats, setRouteStats] = useState<RouteStats>()
    const [managing, setManaging] = useState<string>()
    const [creating, setCreating] = useState(false)
    const [newTitle, setNewTitle] = useState('')
    const reload = useRef<() => Promise<void>>(async () => {})
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
          if (!signal.aborted) { setSnapshot(value); setError(current => current === 'catalog.loadError' ? undefined : current) }
          const recent = await fetch('/api/theone/routes', { signal, cache: 'no-store' }).then(r => r.ok ? r.json() as Promise<{ routes: RouteView[]; stats?: RouteStats }> : undefined).catch(() => undefined)
          if (recent && !signal.aborted) { setRoutes(recent.routes); setRouteStats(recent.stats) }
        } catch { if (!signal.aborted) setError('catalog.loadError') }
        finally { reading = false }
      }
      reload.current = async () => { while (reading) await new Promise(resolve => setTimeout(resolve, 50)); await load() }
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
      } catch { setError('catalog.continueError') }
      finally { setBusy(undefined) }
    }
    /** One directory edit; the directory reloads after it. */
    const post: Post = async (path, body) => {
      setBusy(path); setError(undefined)
      try {
        const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body), signal: lifetime.signal, cache: 'no-store' })
        if (!response.ok) {
          const failure = await response.json().catch(() => ({})) as { error?: string }
          setError(failure.error === 'GATEWAY_BUSY' ? 'manage.busy' : 'manage.error')
          return false
        }
        const value = await response.json().catch(() => ({})) as { id?: string }
        if (body.action === 'merge' || body.action === 'delete') setManaging(undefined)
        if (body.action === 'create' && value.id) { setCreating(false); setNewTitle(''); setManaging(value.id) }
        await reload.current()
        return true
      } catch { setError('manage.error'); return false }
      finally { setBusy(undefined) }
    }
    async function editLinks(body: Record<string, unknown>) {
      setBusy('links'); setError(undefined)
      try {
        const response = await fetch('/api/theone/links', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body), signal: lifetime.signal, cache: 'no-store' })
        if (!response.ok) throw new Error('Links unavailable')
        const linkage = await response.json() as LinkageSnapshot
        setSnapshot(current => current && { ...current, linkage })
      } catch { setError('link.error') }
      finally { setBusy(undefined) }
    }
    /** Related topics with why they relate; the user can link, unlink or stop a topic sharing. */
    function linkRow(id: string) {
      const linkage = snapshot?.linkage
      if (!linkage || linkage.scope === 'off') return null
      const own = linkage.topics[id]
      if (!own) return null
      const related = new Set(own.related.map(topic => topic.id))
      const others = snapshot!.contexts.filter(context => context.id !== id && !related.has(context.id))
      return h('div', { className: 'theone-topic-links' },
        h('span', { className: 'theone-links-label' }, t('link.label')),
        own.related.length ? null : h('span', { className: 'theone-links-empty' }, t('link.none')),
        ...own.related.map(topic => h('span', { key: topic.id, className: 'theone-link-chip', title: topic.reasons.map(reason => t(`link.reason.${reason}` as TheOneLocaleKey)).join(' · ') },
          topic.title, h('button', { type: 'button', 'aria-label': t('link.remove'), title: t('link.remove'), disabled: !!busy,
            onClick: () => { void editLinks({ action: 'unlink', a: id, b: topic.id }) } }, '×'))),
        others.length ? h('select', { 'aria-label': t('link.add'), value: '', disabled: !!busy,
          onChange: (event: React.ChangeEvent<HTMLSelectElement>) => { if (event.target.value) void editLinks({ action: 'link', a: id, b: event.target.value }) } },
          h('option', { value: '' }, t('link.add')), ...others.map(context => h('option', { key: context.id, value: context.id }, context.title))) : null,
        h('label', { className: 'theone-link-private', title: t('link.privateHint') },
          h('input', { type: 'checkbox', checked: own.private, disabled: !!busy,
            onChange: (event: React.ChangeEvent<HTMLInputElement>) => { void editLinks({ action: 'private', id, value: event.target.checked }) } }),
          t('link.private')))
    }
    async function refresh() {
      setBusy('refresh'); setError(undefined)
      try {
        const response = await fetch('/api/theone/catalog/refresh', { method: 'POST', signal: lifetime.signal })
        if (!response.ok) throw new Error('Refresh unavailable')
      } catch { setError('catalog.refreshError') }
      finally { setBusy(undefined) }
    }
    const assigned = new Set(snapshot?.groups.flatMap(group => group.contextIds) ?? [])
    const groups = [...snapshot?.groups ?? [], ...(snapshot?.contexts.some(c => !assigned.has(c.id)) ? [{ id: 'pending', title: t('catalog.unassigned'), summary: t('catalog.unassignedSummary'), contextIds: snapshot.contexts.filter(c => !assigned.has(c.id)).map(c => c.id) }] : [])]
    const status = snapshot?.status
    return h('section', { className: 'theone-catalog', translate: 'no' },
      h('header', { className: 'theone-catalog-header' },
        h('div', null, h('h1', null, t('catalog.title')), h('p', null, t('catalog.subtitle'))),
        h('div', { className: 'theone-catalog-tools' },
          h('button', { type: 'button', disabled: !!busy, onClick: () => setCreating(open => !open) }, t('manage.create')),
          snapshot?.linkage && snapshot.linkage.scope !== 'off' ? h('button', { type: 'button', disabled: !!busy, title: t('link.clearLearnedHint'),
            onClick: () => { void editLinks({ action: 'clearLearned' }) } }, t('link.clearLearned')) : null,
          h('button', { type: 'button', onClick: refresh, disabled: !!busy || status?.running }, t('catalog.refresh')))),
      creating ? h('form', { className: 'theone-manage theone-create', onSubmit: (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); void post('/api/theone/topics', { action: 'create', title: newTitle }) } },
        h('input', { value: newTitle, maxLength: 80, autoFocus: true, placeholder: t('manage.title'), disabled: !!busy, onChange: (event: React.ChangeEvent<HTMLInputElement>) => setNewTitle(event.target.value) }),
        h('button', { type: 'submit', disabled: !!busy || !newTitle.trim() }, t('manage.createButton')),
        h('button', { type: 'button', onClick: () => { setCreating(false); setNewTitle('') } }, t('manage.cancel'))) : null,
      snapshot?.linkage?.scope === 'off' ? h('p', { className: 'theone-catalog-status' }, t('link.off')) : null,
      h('p', { className: 'theone-catalog-status', role: 'status' }, snapshot
        ? t('catalog.counts', { topics: snapshot.contexts.length, groups: snapshot.groups.length, topicSuffix: snapshot.contexts.length === 1 ? '' : 's', groupSuffix: snapshot.groups.length === 1 ? '' : 's' }) + ' · ' + (status?.running ? t('catalog.indexing') : status?.pending ? t('catalog.pending', { count: status.pending, sessionSuffix: status.pending === 1 ? '' : 's' }) : t('catalog.updated'))
        : t('catalog.reading')),
      status?.failed ? h('p', { className: 'theone-catalog-warning' }, t('catalog.failed', { count: status.failed, sessionSuffix: status.failed === 1 ? '' : 's' })) : null,
      status?.searchUnavailable ? h('p', { className: 'theone-catalog-warning' }, t('catalog.searchUnavailable')) : null,
      error ? h('p', { role: 'alert', className: 'theone-catalog-warning' }, t(error)) : null,
      snapshot ? h(RouteList, { routes, stats: routeStats, contexts: snapshot.contexts, post, busy: !!busy }) : null,
      snapshot && !snapshot.contexts.length ? h('p', { className: 'theone-catalog-empty' }, t(status?.running ? 'catalog.emptyIndexing' : 'catalog.empty')) : null,
      h('div', { className: 'theone-catalog-groups' }, ...groups.map(group =>
        h('section', { key: group.id, className: 'theone-topic-group' },
          h('h2', null, group.title, h('span', null, ` ${group.contextIds.length}`)),
          group.summary ? h('p', { className: 'theone-group-summary' }, group.summary) : null,
          ...group.contextIds.flatMap(id => {
            const topic = snapshot?.contexts.find(c => c.id === id)
            if (!topic) return []
            const constraints = snapshot?.linkage?.topics[id]?.constraints ?? ''
            return [h('article', { key: id, className: 'theone-topic-card' },
              h('h3', null, topic.title), h('p', null, topic.summary),
              topic.lastState ? h('p', { className: 'theone-topic-state' }, h('span', null, t('topic.state')), topic.lastState) : null,
              constraints ? h('p', { className: 'theone-topic-state' }, h('span', null, t('topic.constraints')), constraints) : null,
              linkRow(id),
              h('div', { className: 'theone-topic-actions' },
                h('button', { type: 'button', disabled: !!busy, onClick: () => { void continueTopic(id) } }, t(busy === id ? 'topic.opening' : 'topic.continue')),
                h('button', { type: 'button', 'aria-expanded': managing === id, onClick: () => setManaging(current => current === id ? undefined : id) }, t(managing === id ? 'manage.close' : 'manage.open')),
                ...topic.sourceSessionIds.slice(0, 3).map((sessionId, i) => h('button', { key: sessionId, type: 'button', className: 'theone-source-link',
                  onClick: () => { ctx.layout.beginNavigation(); ctx.uiWorkspace.openSession(sessionId as SessionId) } }, t('topic.source') + (topic.sourceSessionIds.length > 1 ? ' ' + (i + 1) : '')))),
              managing === id ? h(TopicManager, { key: `${id}:${topic.title}:${topic.summary}:${constraints}`, topic, constraints, groups: snapshot!.groups, contexts: snapshot!.contexts, post, busy: !!busy }) : null)]
          }))))
    )
  }

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
    const update = () => {
      const id = navigation.getSnapshot()
      style.textContent = id
        ? `[role="treeitem"][data-row-key="${CSS.escape(`session:${id}`)}"]{display:none!important}`
        : ''
    }
    update()
    const unsubscribe = navigation.subscribe(update)
    window.addEventListener('storage', update)
    document.head.append(style)
    return () => { unsubscribe(); window.removeEventListener('storage', update); style.remove() }
  })
  // Wait for the owning plugins' declarations; retain their normal browser and chat.
  ctx.slots.inject('main', () => [
    ctx.slots.register({name:'main',key:panelId},GatewayPanel),
    ctx.slots.register({name:'main',key:catalogPanelId},CatalogPanel),
    ctx.slots.register({name:'main',key:settingsPanelId},SettingsPanel),
  ])
  ctx.slots.inject('sidebar.panellist', () => [
    ctx.slots.register({name:'sidebar.panellist',id:panelId,order:-1000,label:()=>t('gateway.title')},SidebarEntry),
    ctx.slots.register({name:'sidebar.panellist',id:catalogPanelId,order:-999,label:()=>t('catalog.title')}, ({size}: PropsRuntime<'sidebar.panellist'>) => {
      const t = useText()
      return h('span',{className:'theone-catalog-entry',translate:'no'},h('span',null,'▦'),size === 16 ? h('span',null,t('catalog.title')) : null)
    }),
  ])
}

/** Target only the row containing our own slot marker; no generated DSH class names. */
const sidebarCss = `
button:has(.theone-nav){--one-accent:#a75b1e;--one-tint:#fff5ec;--one-line:#eed3bb;--one-heat:#ff78002b;--one-glow:0 0 22px 4px #ff6b0024,0 4px 32px 6px #ff76000d;border:1px solid var(--one-line);background:var(--one-tint);box-shadow:var(--one-glow);overflow:visible;border-radius:12px;color:var(--dsw-alias-label-primary);flex:none;position:relative;isolation:isolate}
[data-ds-dark-theme] button:has(.theone-nav){--one-accent:#93c8f3;--one-tint:#1d2a37;--one-line:#344d64;--one-heat:#80caff30;--one-glow:0 0 22px 4px #80bae924}
button:has(.theone-nav)::after{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:radial-gradient(85px circle at var(--one-pointer-x,50%) var(--one-pointer-y,50%),var(--one-heat),transparent 100%);opacity:0;transition:opacity 180ms ease;z-index:0}
button[data-one-tracking=true]:has(.theone-nav[data-active=true])::after{opacity:1}
@media(prefers-reduced-motion:reduce){button:has(.theone-nav)::after{transition:none}}
button:has(.theone-nav[data-wide=true]){padding:12px 10px;min-height:64px;margin-top:4px;margin-bottom:18px}
button:has(.theone-nav[data-wide=true])>span:not(:has(.theone-nav)){display:none}
button:has(.theone-nav):hover{background:var(--one-tint);border-color:color-mix(in srgb,var(--one-accent) 40%,var(--one-line))}
button:has(.theone-nav[data-active=true]){border-color:color-mix(in srgb,var(--one-accent) 40%,var(--one-line))}
.theone-nav{display:flex;align-items:center;gap:10px;color:var(--one-accent);font-family:inherit;position:relative;z-index:1}
.theone-symbol-wrap{position:relative;display:inline-flex;flex:none;width:20px;height:20px}
.theone-nav .theone-symbol{display:block;width:20px;height:20px;flex:none;overflow:visible;border:0;border-radius:0;background:none}
.theone-nav[data-wide=true] .theone-symbol-wrap{margin:0 2px}
.theone-update-dot{position:absolute;top:-2px;right:-2px;width:7px;height:7px;border-radius:50%;background:#e8590c;box-shadow:0 0 0 2px var(--one-tint)}
button:has(.theone-nav[data-wide=true])>span:has(.theone-nav){flex:1;min-width:0}
.theone-nav[data-wide=true]{width:100%}
.theone-update{margin-left:auto;align-self:center;display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border-radius:999px;border:1px solid color-mix(in srgb,var(--one-accent) 45%,transparent);background:color-mix(in srgb,var(--one-accent) 12%,transparent);color:var(--one-accent);font-size:12px;line-height:16px;white-space:nowrap;cursor:pointer;transition:background 150ms ease}
.theone-update:hover{background:color-mix(in srgb,var(--one-accent) 22%,transparent)}
.theone-update:focus-visible{outline:2px solid var(--one-accent);outline-offset:2px}
.theone-update small{font-size:11px;opacity:.75}
.theone-update[data-state=installing],.theone-update[data-state=reloading],.theone-update[data-state=restart]{cursor:default}
.theone-update[data-state=failed]{color:#d9480f;border-color:#d9480f66;background:#d9480f14}
.theone-update[data-state=waiting]{opacity:.8;border-style:dashed}
.theone-dialog-backdrop{position:fixed;inset:0;z-index:10001;display:flex;align-items:center;justify-content:center;padding:16px;background:#0008}
.theone-dialog{width:min(440px,100%);box-sizing:border-box;padding:22px 22px 18px;border:1px solid var(--dsw-alias-border-l2,#ffffff1f);border-radius:16px;background:var(--dsw-specific-sidebar-fill,#232326);color:var(--dsw-alias-label-primary,#e8e8ea);box-shadow:0 16px 48px #0005;font:inherit;font-size:14px;line-height:1.65}
.theone-dialog h2{margin:0 0 10px;font-size:17px}
.theone-dialog p{margin:0 0 10px;color:var(--dsw-alias-label-secondary,#a0a0a6)}
.theone-dialog .theone-dialog-note{font-size:13px}
.theone-dialog-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:16px}
.theone-dialog-actions button{padding:8px 14px;border:1px solid var(--dsw-alias-border-l2,#ffffff1f);border-radius:9px;background:transparent;color:inherit;font:inherit;cursor:pointer}
.theone-dialog-actions button:hover{background:var(--dsw-alias-interactive-bg-hover,#ffffff12)}
.theone-dialog-actions .theone-dialog-primary{border-color:transparent;background:#3b6fb0;color:#fff}
.theone-dialog-actions .theone-dialog-primary:hover{background:#4a7fc0}
.theone-dialog-actions button:focus-visible{outline:2px solid #4a7fc0;outline-offset:2px}
.theone-dialog .theone-dialog-body{white-space:pre-wrap;color:var(--dsw-alias-label-primary,#e8e8ea)}
.theone-notice{display:flex;align-items:center;gap:8px;margin:6px 4px 0;padding:6px 8px 6px 10px;border:1px solid var(--dsw-alias-border-l2,#ffffff1f);border-radius:10px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#a0a0a6);min-width:0}
.theone-notice-tag{flex:none;padding:0 6px;border-radius:6px;background:#3b6fb033;color:#7fa9dd}
.theone-notice-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.theone-notice-text strong{color:var(--dsw-alias-label-primary,#e8e8ea);font-weight:500}
.theone-notice button{flex:none;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;padding:2px 6px;border-radius:6px}
.theone-notice button:hover{background:var(--dsw-alias-interactive-bg-hover,#ffffff12)}
.theone-notice-link{color:#7fa9dd!important}
.theone-notice-close{font-size:15px;line-height:1}
.theone-update-spin{width:10px;height:10px;border-radius:50%;border:1.5px solid currentColor;border-right-color:transparent;animation:theone-spin 800ms linear infinite}
@keyframes theone-spin{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.theone-update-spin{animation:none}}
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
.theone-catalog-header{display:flex;justify-content:space-between;align-items:center;gap:16px}.theone-catalog h1{font-size:24px;margin:0 0 8px}.theone-catalog-header p,.theone-catalog-status,.theone-group-summary{opacity:.65;margin:0 0 18px;line-height:1.6}.theone-catalog button{border:1px solid #8883;border-radius:9px;padding:8px 13px;background:transparent;color:inherit;cursor:pointer;font:inherit;white-space:nowrap}.theone-catalog button:disabled{opacity:.5;cursor:default}.theone-catalog-groups{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,310px),1fr));gap:20px}.theone-topic-group{border:1px solid #8882;border-radius:16px;padding:20px;background:#88805}.theone-topic-group h2{font-size:18px;margin:0 0 8px}.theone-topic-group h2 span{font-size:13px;opacity:.5}.theone-topic-card{border-top:1px solid #8882;padding:16px 0}.theone-topic-card:last-child{padding-bottom:0}.theone-topic-card h3{font-size:15px;line-height:1.5;margin:0 0 7px}.theone-topic-card p{font-size:13px;line-height:1.7;opacity:.75;margin:0 0 12px;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}.theone-topic-actions{display:flex;gap:8px;flex-wrap:wrap}.theone-topic-actions button{font-size:12px}.theone-topic-actions .theone-source-link{border-color:transparent;opacity:.6}.theone-catalog-warning{background:#ff900011;padding:12px;border-radius:10px;font-size:13px}.theone-catalog-entry{display:flex;align-items:center;gap:10px;font-size:14px}.theone-catalog-empty{padding:40px 0;opacity:.65;line-height:1.8}.theone-catalog-tools{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.theone-topic-links{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:0 0 12px;font-size:12px}.theone-links-label,.theone-links-empty{opacity:.6}.theone-link-chip{display:inline-flex;align-items:center;gap:2px;border:1px solid #8883;border-radius:999px;padding:2px 4px 2px 9px}.theone-catalog .theone-link-chip button{border:0;padding:0 5px;opacity:.6;font-size:13px;line-height:1}.theone-topic-links select{font:inherit;font-size:12px;color:inherit;background:transparent;border:1px solid #8883;border-radius:8px;padding:2px 6px}.theone-link-private{display:inline-flex;align-items:center;gap:4px;opacity:.75;cursor:pointer}.theone-topic-card .theone-topic-state{font-size:12px;opacity:.8;-webkit-line-clamp:3}.theone-topic-state span{opacity:.6;margin-right:4px}.theone-manage{display:flex;flex-direction:column;gap:10px;margin-top:12px;padding:14px;border:1px solid #8883;border-radius:12px;font-size:12px}.theone-create{flex-direction:row;flex-wrap:wrap;align-items:center;margin:0 0 18px}.theone-create input{flex:1;min-width:180px}.theone-manage-field{display:flex;flex-direction:column;gap:5px}.theone-manage-field>span{opacity:.65}.theone-manage input,.theone-manage textarea,.theone-manage select,.theone-routes select{font:inherit;font-size:12px;color:inherit;background:transparent;border:1px solid #8883;border-radius:8px;padding:6px 8px;box-sizing:border-box;min-width:0}.theone-manage textarea{resize:vertical;width:100%}.theone-manage-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.theone-manage-row select,.theone-manage-row input{flex:1;min-width:140px}.theone-manage-hint{opacity:.6;font-size:12px;line-height:1.6;margin:0}.theone-catalog .theone-danger{color:#c4402f;border-color:#c4402f55}.theone-routes{border:1px solid #8882;border-radius:16px;padding:14px 20px;margin:0 0 20px}.theone-routes summary{cursor:pointer;font-weight:500}.theone-routes summary span{opacity:.5;font-size:13px}.theone-routes ol{list-style:none;margin:12px 0 0;padding:0;display:flex;flex-direction:column;gap:10px}.theone-routes li{border-top:1px solid #8882;padding-top:10px;font-size:12px;display:flex;flex-direction:column;gap:5px}.theone-route-head{display:flex;gap:10px;min-width:0}.theone-route-head time{opacity:.55;flex:none}.theone-route-head q{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.theone-route-body{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.theone-route-body small{opacity:.6}.theone-route-fixed{opacity:.75}.theone-route-stats{margin-left:10px;font-weight:400;opacity:.6;font-size:12px}@media(max-width:640px){.theone-catalog{padding:20px}.theone-catalog-header{align-items:flex-start}.theone-catalog-header h1{font-size:21px}}
`

const composerCss = `
.theone-bg{display:inline-flex;align-items:center;gap:5px;height:32px;padding:0 10px;border:0;border-radius:10px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;white-space:nowrap;cursor:pointer;max-width:220px}
.theone-bg:hover,.theone-bg[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover)}
.theone-bg:focus-visible{outline:2px solid var(--dsw-focus-ring-color,#4a7fb5);outline-offset:1px}
.theone-bg:disabled{opacity:.6;cursor:default}
.theone-bg-caption,.theone-bg-chevron{color:var(--dsw-alias-label-secondary)}
.theone-bg-text{overflow:hidden;text-overflow:ellipsis;display:var(--dsh-composer-model-text-display,inline)}
.theone-bg-chevron{font-size:11px}
.theone-bg[data-failed=true] .theone-bg-caption{color:#d9480f}
.theone-bg-menu{position:fixed;z-index:10000;width:280px;max-height:min(420px,70vh);display:flex;flex-direction:column;padding:6px;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-specific-sidebar-fill);color:var(--dsw-alias-label-primary);box-shadow:0 10px 32px #0003;font:inherit;font-size:14px;box-sizing:border-box}
.theone-bg-heading{padding:8px 10px 6px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.theone-bg-search{margin:0 4px 6px;padding:7px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:13px;outline:none}
.theone-bg-search:focus{border-color:var(--dsw-focus-ring-color,#4a7fb5)}
.theone-bg-list{overflow:auto;min-height:0}
.theone-bg-group{padding:8px 10px 4px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.theone-bg-item{display:flex;align-items:center;gap:8px;width:100%;padding:9px 10px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.theone-bg-item:hover,.theone-bg-item:focus-visible{outline:none;background:var(--dsw-alias-interactive-bg-hover)}
.theone-bg-item span:first-child{flex:0 1 auto;min-width:40px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.theone-bg-item small{flex:0 100 auto;color:var(--dsw-alias-label-secondary);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.theone-bg-check{margin-left:auto;flex:none;width:14px;text-align:center;color:var(--dsw-alias-label-primary)}
.theone-bg-empty{margin:8px 10px;font-size:13px;color:var(--dsw-alias-label-secondary)}
`

const settingsCss = `
.theone-settings{--one-settings-accent:#a75b1e}[data-ds-dark-theme] .theone-settings{--one-settings-accent:#93c8f3}
.theone-settings input,.theone-settings select{width:100%;box-sizing:border-box;min-height:38px;padding:8px 11px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;font:inherit;color:inherit;background:var(--dsw-specific-sidebar-fill)}.theone-settings input:focus-visible,.theone-settings select:focus-visible{outline:2px solid var(--one-settings-accent);outline-offset:2px}.theone-settings input:disabled,.theone-settings select:disabled,.theone-settings button:disabled{opacity:.5;cursor:default}.theone-settings small{display:block;margin-top:5px;color:var(--dsw-alias-label-secondary);font-size:12px}
.theone-settings-footer{position:sticky;bottom:0;display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:15px 16px;margin-top:22px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-specific-sidebar-fill);box-shadow:0 -4px 20px #00007;z-index:2}.theone-settings-footer p{flex:1;min-width:180px;margin:0;font-size:13px;line-height:1.6}.theone-settings .theone-settings-save{color:var(--one-settings-accent);border-color:color-mix(in srgb,var(--one-settings-accent) 35%,transparent);background:color-mix(in srgb,var(--one-settings-accent) 9%,var(--dsw-specific-sidebar-fill))}
.theone-context-menu{position:fixed;z-index:10000;min-width:160px;padding:5px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-specific-sidebar-fill);color:var(--dsw-alias-label-primary);box-shadow:0 8px 30px #0002;font:inherit}
.theone-context-menu button{display:block;width:100%;padding:9px 14px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.theone-context-menu button:hover,.theone-context-menu button:focus-visible{outline:none;background:var(--dsw-alias-interactive-bg-hover)}
.theone-settings{height:100%;overflow:auto;box-sizing:border-box;padding:32px max(24px,calc((100% - 980px)/2));color:var(--dsw-alias-label-primary);font:inherit}
.theone-settings-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.theone-settings h1{font-size:26px;margin:0 0 8px;outline:none}.theone-settings h2{font-size:17px;margin:0 0 16px}.theone-settings-header p,.theone-settings-help{color:var(--dsw-alias-label-secondary);line-height:1.6;margin:0 0 18px}
.theone-settings button{border:1px solid var(--dsw-alias-border-l2);border-radius:9px;padding:9px 14px;background:var(--dsw-alias-interactive-bg-hover);color:inherit;font:inherit;cursor:pointer;white-space:nowrap}.theone-settings button:focus-visible{outline:2px solid var(--dsw-focus-ring-color);outline-offset:2px}
.theone-settings-notice{padding:13px 16px;border:1px solid #ed9b412a;background:#f3940710;border-radius:12px;font-size:13px;line-height:1.7;margin:0 0 22px}
.theone-settings-summary,.theone-settings-group{border:1px solid var(--dsw-alias-border-l2);border-radius:16px;padding:22px;margin-bottom:20px}.theone-settings-summary{background:#88804}.theone-settings-summary dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}.theone-settings dl{margin:0}.theone-settings-summary dt{font-size:12px;color:var(--dsw-alias-label-secondary);margin-bottom:8px}.theone-settings dd{margin:0;overflow-wrap:anywhere;line-height:1.6}.theone-settings-summary dd{font-size:15px}.theone-settings-summary p{font-size:13px;line-height:1.7;color:var(--dsw-alias-label-secondary);margin:16px 0 0}
.theone-settings-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(160px,42%);gap:24px;padding:16px 0;border-top:1px solid var(--dsw-alias-border-l2)}.theone-settings-row:first-child{border-top:0;padding-top:0}.theone-settings-row:last-child{padding-bottom:0}.theone-settings-row strong{font-size:14px;font-weight:500}.theone-settings-row p{font-size:13px;line-height:1.6;color:var(--dsw-alias-label-secondary);margin:6px 0}.theone-settings-row code{font-size:11px;color:var(--dsw-alias-label-secondary)}.theone-settings-row dd{font-size:13px;padding-top:1px}.theone-settings-row[data-inactive=true]{opacity:.6}
@media(max-width:640px){.theone-settings{padding:20px 16px}.theone-settings-header{flex-wrap:wrap}.theone-settings-summary,.theone-settings-group{padding:18px}.theone-settings-summary dl{grid-template-columns:1fr}.theone-settings-row{grid-template-columns:1fr;gap:10px}}
`
