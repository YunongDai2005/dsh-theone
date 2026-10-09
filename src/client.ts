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
    async current() {
      const response = await fetch('/api/theone/gateway', { signal: lifetime.signal, cache: 'no-store' })
      return response.ok ? ((await response.json()) as { current?: string | null }).current ?? undefined : undefined
    },
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
        // DSH saves a session's model as the default for new chats; TheOne puts the user's back in prepare.
        await fetch('/api/theone/gateway/hold', { method: 'POST', signal: lifetime.signal }).catch(() => undefined)
        const selected = await ctx.modelDirectories.directoryFor(target).select({provider:'theone',model:'gateway'})
        if (!selected.ok) throw selected.error
        const renamed = await reference.binding.session.rename(t('gateway.title'))
        if (!renamed.ok) throw renamed.error
      })
      const prepared = await fetch('/api/theone/gateway/prepare', { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: id, locale: localeSnapshot().active }), signal: lifetime.signal })
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
  const readUpdate = async (method: 'GET' | 'POST' = 'GET', body?: Record<string, unknown>, force = false): Promise<boolean> => {
    try {
      const response = await fetch(force ? '/api/theone/update?force' : '/api/theone/update', { method, signal: lifetime.signal, cache: 'no-store',
        ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) })
      // A refused request (409 busy, 400 the exemption could not be written) still reports the status.
      if (response.ok || response.status === 409 || response.status === 400) setUpdate(await response.json() as UpdateStatus)
      if (update?.state === 'reloading') void awaitReload(update.current)
      return response.ok
    } catch { return false /* Offline: the button simply stays hidden. */ }
  }
  /** What pressing Update does, from the sidebar button or from Settings. */
  function startUpdate(status: UpdateStatus) {
    if (status.state === 'installing' || status.state === 'reloading' || status.state === 'restart') return
    const waiting = !!status.waiting && !status.available && !status.state
    // Once TheOne is exempt, asking again would not help; the explanation says what pnpm still refuses.
    if (!status.exempt && (waiting || (status.state === 'failed' && status.error === 'MINIMUM_RELEASE_AGE'))) { openReleaseAgeDialog(status); return }
    if (!status.installable) { window.open('https://github.com/YunongDai2005/dsh-theone#readme', '_blank', 'noopener'); return }
    setUpdate({ ...status, state: 'installing' })
    void readUpdate('POST')
  }
  /** The state of an update in words, shared by the sidebar button's tooltip and Settings. */
  function updateHint(status: UpdateStatus) {
    const waiting = !!status.waiting && !status.available && !status.state
    return waiting ? t('update.waitingHint', { latest: status.waiting!.version }) : status.error === 'GATEWAY_BUSY' ? t('update.busy') : status.state === 'reloading' ? t('update.reloadingHint')
      : status.state === 'restart' ? t('update.restartHint')
      : status.state === 'failed' ? (status.error === 'OTHER_RELEASE_AGE' ? t('update.otherAge', { names: status.detail ?? '' })
        : status.error === 'MINIMUM_RELEASE_AGE' ? (status.exempt ? t('update.ageStill', { detail: status.detail ?? '' }) : t('update.tooNew'))
        : status.error === 'NETWORK' ? t('update.network')
        : t('update.failedHint', { error: status.detail ?? status.error ?? '' }))
      : status.installable ? t('update.hint', { current: status.current, latest: status.latest ?? '' })
      : t('update.manualHint', { current: status.current, latest: status.latest ?? '' })
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

  /**
   * Report a problem, about TheOne in general or one routed message. The report is drafted by
   * TheOne, shown here in full together with what the user types, and sent only on Send; copying
   * it for an email always works, also when the feedback server cannot be reached.
   */
  function openFeedbackDialog(messageId?: string) {
    if (document.querySelector('.theone-dialog-backdrop')) return
    const backdrop = document.createElement('div')
    backdrop.className = 'theone-dialog-backdrop'; backdrop.setAttribute('translate', 'no')
    const card = document.createElement('div')
    card.className = 'theone-dialog theone-feedback'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true')
    const title = document.createElement('h2'); title.id = 'theone-feedback-title'; title.textContent = t(messageId ? 'feedback.titleMessage' : 'feedback.title')
    card.setAttribute('aria-labelledby', title.id)
    const intro = document.createElement('p'); intro.textContent = t('feedback.intro')
    const description = document.createElement('textarea'); description.maxLength = 4000; description.rows = 4; description.placeholder = t('feedback.description')
    description.setAttribute('aria-label', t('feedback.description'))
    const contact = document.createElement('input'); contact.maxLength = 200; contact.placeholder = t('feedback.contact'); contact.setAttribute('aria-label', t('feedback.contact'))
    const include = document.createElement('input'); include.type = 'checkbox'
    const includeLabel = document.createElement('label'); includeLabel.className = 'theone-feedback-check'; includeLabel.append(include, ' ', t('feedback.includeReply'))
    const preview = document.createElement('details'); preview.className = 'theone-feedback-preview'
    const summary = document.createElement('summary'); summary.textContent = t('feedback.preview')
    const pre = document.createElement('pre'); preview.append(summary, pre)
    const privacy = document.createElement('p'); privacy.className = 'theone-dialog-note'; privacy.textContent = t('feedback.privacy')
    const status = document.createElement('p'); status.className = 'theone-dialog-note'; status.setAttribute('role', 'status'); status.textContent = t('feedback.loading')
    const footer = document.createElement('div'); footer.className = 'theone-dialog-actions'
    const button = (text: string, primary: boolean, act: () => void) => {
      const element = document.createElement('button'); element.type = 'button'; element.textContent = text
      if (primary) element.className = 'theone-dialog-primary'
      element.addEventListener('click', act); footer.append(element); return element
    }
    let draft: Record<string, unknown> | undefined
    let email = 'theone@yulid.org'
    let direct = false
    let sentId: string | undefined
    let sending = false
    const language = () => (localeSnapshot().active.startsWith('zh') ? 'zh' : 'en')
    const report = () => ({ description: description.value.trim(), ...(contact.value.trim() ? { contact: contact.value.trim() } : {}), lang: language(), ...(draft ?? {}) })
    const render = () => {
      pre.textContent = JSON.stringify(report(), null, 2)
      send.disabled = sending || !!sentId || !direct || !draft || !description.value.trim()
      send.textContent = t(sending ? 'feedback.sending' : 'feedback.send')
    }
    const load = async () => {
      status.textContent = t('feedback.loading'); draft = undefined; render()
      try {
        const response = await fetch('/api/theone/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: lifetime.signal,
          body: JSON.stringify({ action: 'draft', ...(messageId ? { messageId, includeReply: include.checked } : {}) }) })
        const body = await response.json() as { draft?: Record<string, unknown>; email?: string; direct?: boolean }
        if (!response.ok || !body.draft) throw new Error('draft')
        draft = body.draft; email = body.email ?? email; direct = body.direct === true
        status.textContent = direct ? '' : t('feedback.fallback', { email })
      } catch { status.textContent = t('feedback.loadError', { email }) }
      render()
    }
    const close = () => { backdrop.remove(); document.removeEventListener('keydown', keydown, true) }
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); close() } }
    const text = () => sentId ? sentId : JSON.stringify(report(), null, 2)
    button(t('feedback.cancel'), false, close)
    const copy = button(t('feedback.copy'), false, () => {
      void navigator.clipboard?.writeText(text()).then(() => { copy.textContent = t('feedback.copied'); setTimeout(() => { copy.textContent = t('feedback.copy') }, 2000) }, () => {})
    })
    button(t('feedback.email'), false, () => {
      // Mail clients cut long links, so the body carries the description and as much detail as fits.
      const subject = `TheOne ${String(draft?.version ?? '')} ${description.value.trim().split('\n')[0].slice(0, 40)}`.trim()
      window.open(`mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text().slice(0, 1800))}`, '_self')
    })
    const send = button(t('feedback.send'), true, () => {
      if (send.disabled) return
      sending = true; render()
      void (async () => {
        try {
          const response = await fetch('/api/theone/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: lifetime.signal,
            body: JSON.stringify({ action: 'send', draft, description: description.value, contact: contact.value, lang: language() }) })
          const body = await response.json().catch(() => ({})) as { id?: string; error?: string }
          if (!response.ok || !body.id) throw new Error(body.error ?? 'other')
          sentId = body.id
          status.textContent = t('feedback.sent', { id: body.id })
          description.disabled = contact.disabled = include.disabled = true
        } catch (error) {
          const code = error instanceof Error ? error.message : ''
          const known = ['UNREACHABLE', 'RATE_LIMITED', 'REJECTED', 'SERVER_ERROR', 'DESCRIPTION_REQUIRED', 'TOO_LARGE', 'DIRECT_OFF'].includes(code)
          status.textContent = `${t((known ? `feedback.error.${code}` : 'feedback.error.other') as TheOneLocaleKey)} ${t('feedback.fallback', { email })}`
        } finally { sending = false; render() }
      })()
    })
    description.addEventListener('input', render)
    contact.addEventListener('input', render)
    include.addEventListener('change', () => { void load() })
    card.append(title, intro, description, contact, ...(messageId ? [includeLabel] : []), preview, privacy, status, footer)
    backdrop.append(card)
    backdrop.addEventListener('pointerdown', event => { if (event.target === backdrop && !description.value.trim()) close() })
    document.addEventListener('keydown', keydown, true)
    document.body.append(backdrop)
    description.focus()
    void load()
  }

  /** Line icons (24-unit grid), drawn inline so host styles cannot reshape them; the text lives in title and aria-label. */
  const ICONS = {
    download: ['M12 4v11', 'M7 10l5 5 5-5', 'M5 20h14'],
    restart: ['M20 12a8 8 0 1 1-2.34-5.66L20 8.5', 'M20 4v4.5h-4.5'],
    alert: ['M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0', 'M12 7.5v5.5', 'M12 16.5h.01'],
    notice: ['M4 10v4h3l6 4V6L7 10H4z', 'M16.5 9a4 4 0 0 1 0 6', 'M19 6.5a7.5 7.5 0 0 1 0 11'],
    external: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
    close: ['M6 6l12 12', 'M18 6L6 18'],
    layers: ['M12 3.5l8.5 4.5-8.5 4.5L3.5 8z', 'M3.5 12.5l8.5 4.5 8.5-4.5', 'M3.5 16.5l8.5 4.5 8.5-4.5'],
    chevron: ['M6 15l6-6 6 6'],
    grid: ['M4 4h6.5v6.5H4z', 'M13.5 4H20v6.5h-6.5z', 'M4 13.5h6.5V20H4z', 'M13.5 13.5H20V20h-6.5z'],
  } as const
  const icon = (name: keyof typeof ICONS, size = 16) => h('svg', { className: 'theone-icon', viewBox: '0 0 24 24', width: size, height: size, fill: 'none',
    stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false },
    ...ICONS[name].map(d => h('path', { key: d, d })))

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
    const hint = updateHint(status)
    // The button is only an icon; its state and the full explanation are in the tooltip.
    const title = `${label} · ${hint}`
    const act = (event: React.SyntheticEvent) => {
      // The entry itself is a button that opens main chat; this click is only the update's.
      event.preventDefault(); event.stopPropagation()
      startUpdate(status)
    }
    return h('span', { className: 'theone-update', role: 'button', tabIndex: 0, title, 'aria-label': title, 'data-state': waiting ? 'waiting' : status.state ?? 'available',
      onClick: act, onPointerDown: (event: React.PointerEvent) => event.stopPropagation(),
      onKeyDown: (event: React.KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') act(event) } },
      status.state === 'installing' || status.state === 'reloading' ? h('span', { className: 'theone-update-spin', 'aria-hidden': true })
        : icon(status.state === 'restart' ? 'restart' : status.state === 'failed' ? 'alert' : 'download', 15))
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
      h('span', { className: 'theone-bg-caption', 'aria-hidden': true }, icon('layers', 15)),
      h('span', { className: 'theone-bg-text' }, label),
      h('span', { className: 'theone-bg-chevron', 'aria-hidden': true }, saving ? '…' : icon('chevron', 12)))
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
      h('span', { className: 'theone-notice-tag', title: t('notice.label'), 'aria-label': t('notice.label'), role: 'img' }, icon('notice', 14)),
      h('span', { className: 'theone-notice-text', title: `${title}\n${body}` }, h('strong', null, title), ' ', body),
      notice.link ? h('button', { type: 'button', className: 'theone-notice-link', 'aria-label': t('notice.more'), title: t('notice.more'),
        onClick: () => { window.open(notice.link, '_blank', 'noopener') } }, icon('external', 14)) : null,
      h('button', { type: 'button', className: 'theone-notice-close', 'aria-label': t('notice.close'), title: t('notice.close'), onClick: () => dismissNotice(notice.id) }, icon('close', 14)))
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

  /** Settings' own way to look for and install a new version, beside the automatic check. */
  function UpdateSection() {
    const t = useText()
    const status = useSyncExternalStore(subscribeUpdate, () => update)
    const [checking, setChecking] = useState(false)
    const [failed, setFailed] = useState(false)
    const check = async () => { setChecking(true); setFailed(false); setFailed(!await readUpdate('GET', undefined, true)); setChecking(false) }
    const waiting = !!status?.waiting && !status.available && !status.state
    const busy = status?.state === 'installing' || status?.state === 'reloading'
    const pending = !!status && (status.available || waiting || !!status.state)
    const line = checking ? t('settings.updateChecking') : failed ? t('settings.updateCheckFailed') : !status ? t('settings.updateUnknown')
      : pending ? updateHint(status) : t('settings.updateLatest')
    return h('section', { className: 'theone-settings-group theone-settings-update' },
      h('h2', null, t('settings.update')),
      status && !pending ? h('p', { className: 'theone-settings-update-version' }, t('settings.updateCurrent', { current: status.current })) : null,
      h('p', { role: 'status' }, line),
      h('div', { className: 'theone-settings-update-actions' },
        h('button', { type: 'button', disabled: checking || busy, onClick: () => { void check() } }, t('settings.updateCheck')),
        h('button', { type: 'button', className: 'theone-settings-save', disabled: checking || busy || !status || !pending || status.state === 'restart',
          onClick: () => { if (status) startUpdate(status) } }, t(status?.state === 'installing' ? 'update.installing' : status?.state === 'reloading' ? 'update.reloading' : 'settings.updateInstall'))))
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
      ['linkage', ['linkScope', 'routeNotice', 'factLinks', 'factExtraction']],
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
      if (field === 'historyCatalog' || field === 'notices' || field === 'factLinks' || field === 'factExtraction') return select(String(draft[field]), [{ value: 'true', label: t('settings.on') }, { value: 'false', label: t('settings.off') }], v => change(field, v === 'true'))
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
      h(UpdateSection),
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

  /** A field name as a column label: "进展：" → "进展". */
  const label = (text: string) => text.replace(/\s*[:：]\s*$/, '')

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
          h('time', null, new Date(route.at).toLocaleTimeString(localeSnapshot().active, { hour: '2-digit', minute: '2-digit' })),
          h('q', null, route.excerpt || '…'),
          h('div', { className: 'theone-route-target' },
            h('strong', null, route.decision.action === 'CLARIFY' ? t('routes.clarify') : `→ ${titleOf(target)}`),
            h('small', null, details)),
          h('div', { className: 'theone-route-actions' },
            h('button', { type: 'button', className: 'theone-quiet', onClick: () => openFeedbackDialog(route.messageId) }, t('routes.report')),
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
      // Read-only unless the topic is open for managing: the list stays a list.
      if (managing !== id) return own.related.length || own.private ? [h('dt', { key: 'dt' }, label(t('link.label'))),
        h('dd', { key: 'dd' }, own.related.map(topic => topic.title).join(' · '), own.private ? h('span', { className: 'theone-tag' }, t('link.private')) : null)] : null
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
    const kept = routeStats?.total ? Math.round(100 * (routeStats.total - routeStats.corrected) / routeStats.total) : undefined
    const figure = (value: string | number, name: string) => h('div', { key: name }, h('dd', null, value), h('dt', null, name))
    return h('section', { className: 'theone-catalog', translate: 'no' },
      h('header', { className: 'theone-catalog-header' },
        h('div', { className: 'theone-catalog-heading' },
          h('p', { className: 'theone-overline' }, 'TheOne'),
          h('h1', null, t('catalog.title')),
          h('p', { className: 'theone-catalog-lede' }, t('catalog.subtitle'))),
        snapshot ? h('dl', { className: 'theone-figures' },
          figure(snapshot.contexts.length, t('catalog.figTopics')),
          figure(snapshot.groups.length, t('catalog.figGroups')),
          kept !== undefined ? figure(`${kept}%`, t('catalog.figKept')) : null) : null),
      h('div', { className: 'theone-toolbar' },
        h('p', { className: 'theone-catalog-status', role: 'status' }, snapshot
          ? (status?.running ? t('catalog.indexing') : status?.pending ? t('catalog.pending', { count: status.pending, sessionSuffix: status.pending === 1 ? '' : 's' }) : t('catalog.updated'))
          : t('catalog.reading')),
        h('div', { className: 'theone-catalog-tools' },
          h('button', { type: 'button', className: 'theone-primary', disabled: !!busy, onClick: () => setCreating(open => !open) }, t('manage.create')),
          h('button', { type: 'button', onClick: refresh, disabled: !!busy || status?.running }, t('catalog.refresh')),
          snapshot?.linkage && snapshot.linkage.scope !== 'off' ? h('button', { type: 'button', className: 'theone-quiet', disabled: !!busy, title: t('link.clearLearnedHint'),
            onClick: () => { void editLinks({ action: 'clearLearned' }) } }, t('link.clearLearned')) : null,
          h('button', { type: 'button', className: 'theone-quiet', onClick: () => openFeedbackDialog() }, t('feedback.open')))),
      creating ? h('form', { className: 'theone-manage theone-create', onSubmit: (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); void post('/api/theone/topics', { action: 'create', title: newTitle }) } },
        h('input', { value: newTitle, maxLength: 80, autoFocus: true, placeholder: t('manage.title'), disabled: !!busy, onChange: (event: React.ChangeEvent<HTMLInputElement>) => setNewTitle(event.target.value) }),
        h('button', { type: 'submit', className: 'theone-primary', disabled: !!busy || !newTitle.trim() }, t('manage.createButton')),
        h('button', { type: 'button', className: 'theone-quiet', onClick: () => { setCreating(false); setNewTitle('') } }, t('manage.cancel'))) : null,
      snapshot?.linkage?.scope === 'off' ? h('p', { className: 'theone-catalog-note' }, t('link.off')) : null,
      status?.failed ? h('p', { className: 'theone-catalog-warning' }, t('catalog.failed', { count: status.failed, sessionSuffix: status.failed === 1 ? '' : 's' })) : null,
      status?.searchUnavailable ? h('p', { className: 'theone-catalog-warning' }, t('catalog.searchUnavailable')) : null,
      error ? h('p', { role: 'alert', className: 'theone-catalog-warning' }, t(error)) : null,
      snapshot ? h(RouteList, { routes, stats: routeStats, contexts: snapshot.contexts, post, busy: !!busy }) : null,
      snapshot && !snapshot.contexts.length ? h('p', { className: 'theone-catalog-empty' }, t(status?.running ? 'catalog.emptyIndexing' : 'catalog.empty')) : null,
      h('div', { className: 'theone-catalog-groups' }, ...groups.map((group, index) =>
        h('section', { key: group.id, className: 'theone-topic-group' },
          h('header', { className: 'theone-group-head' },
            h('span', { className: 'theone-group-index' }, String(index + 1).padStart(2, '0')),
            h('h2', null, group.title, h('span', null, group.contextIds.length)),
            group.summary ? h('p', { className: 'theone-group-summary' }, group.summary) : null),
          h('ol', { className: 'theone-topic-list' }, ...group.contextIds.flatMap(id => {
            const topic = snapshot?.contexts.find(c => c.id === id)
            if (!topic) return []
            const constraints = snapshot?.linkage?.topics[id]?.constraints ?? ''
            const open = managing === id
            const links = linkRow(id)
            return [h('li', { key: id, className: `theone-topic-card${open ? ' theone-open' : ''}${topic.hidden ? ' theone-hidden' : ''}` },
              h('div', { className: 'theone-topic-main' },
                h('h3', null, topic.title),
                topic.summary && topic.summary.trim() !== topic.title.trim() ? h('p', { className: 'theone-topic-summary' }, topic.summary) : null,
                topic.hidden ? h('p', { className: 'theone-topic-warning' }, t(topic.hidden === 'archived' ? 'topic.hiddenArchived' : 'topic.hiddenOrphaned')) : null,
                topic.lastState || constraints || (links && !open) ? h('dl', { className: 'theone-topic-meta' },
                  topic.lastState ? [h('dt', { key: 's' }, label(t('topic.state'))), h('dd', { key: 'sv' }, topic.lastState)] : null,
                  constraints ? [h('dt', { key: 'c' }, label(t('topic.constraints'))), h('dd', { key: 'cv' }, constraints)] : null,
                  open ? null : links) : null),
              h('div', { className: 'theone-topic-actions' },
                // A hidden topic has nothing left to continue: its conversations are gone or archived.
                h('button', { type: 'button', className: 'theone-continue', disabled: !!busy || !!topic.hidden, title: topic.hidden ? t('topic.continueHidden') : undefined,
                  onClick: () => { void continueTopic(id) } }, t(busy === id ? 'topic.opening' : 'topic.continue'), h('span', { 'aria-hidden': true }, ' →')),
                h('button', { type: 'button', className: 'theone-quiet', 'aria-expanded': open, onClick: () => setManaging(current => current === id ? undefined : id) }, t(open ? 'manage.close' : 'manage.open')),
                ...(topic.hidden === 'orphaned' ? [] : topic.sourceSessionIds).slice(0, 3).map((sessionId, i) => h('button', { key: sessionId, type: 'button', className: 'theone-quiet',
                  onClick: () => { ctx.layout.beginNavigation(); ctx.uiWorkspace.openSession(sessionId as SessionId) } }, t('topic.source') + (topic.sourceSessionIds.length > 1 ? ' ' + (i + 1) : '')))),
              open ? h('div', { className: 'theone-topic-edit' }, links,
                h(TopicManager, { key: `${id}:${topic.title}:${topic.summary}:${constraints}`, topic, constraints, groups: snapshot!.groups, contexts: snapshot!.contexts, post, busy: !!busy })) : null)]
          })))))
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
      return h('span',{className:'theone-catalog-entry',translate:'no'},icon('grid',16),size === 16 ? h('span',null,t('catalog.title')) : null)
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
.theone-icon{display:block;flex:none;overflow:visible}
.theone-update{margin-left:auto;align-self:center;flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;box-sizing:border-box;padding:0;border-radius:50%;border:1px solid color-mix(in srgb,var(--one-accent) 45%,transparent);background:color-mix(in srgb,var(--one-accent) 12%,transparent);color:var(--one-accent);font-size:12px;line-height:16px;white-space:nowrap;cursor:pointer;transition:background 150ms ease}
.theone-update:hover{background:color-mix(in srgb,var(--one-accent) 22%,transparent)}
.theone-update:focus-visible{outline:2px solid var(--one-accent);outline-offset:2px}
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
.theone-feedback{width:min(560px,100%);max-height:calc(100vh - 32px);overflow:auto}
.theone-feedback textarea,.theone-feedback input:not([type=checkbox]){display:block;width:100%;box-sizing:border-box;margin:0 0 10px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2,#ffffff1f);border-radius:9px;background:transparent;color:inherit;font:inherit;resize:vertical}
.theone-feedback .theone-feedback-check{display:block;margin:0 0 10px;font-size:13px;color:var(--dsw-alias-label-secondary,#a0a0a6)}
.theone-feedback-preview{margin:0 0 10px;font-size:13px}
.theone-feedback-preview summary{cursor:pointer;color:var(--dsw-alias-label-secondary,#a0a0a6)}
.theone-feedback-preview pre{max-height:220px;overflow:auto;margin:6px 0 0;padding:8px 10px;border-radius:9px;background:#0000001f;font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-word}
.theone-notice{display:flex;align-items:center;gap:8px;margin:6px 4px 0;padding:6px 8px 6px 10px;border:1px solid var(--dsw-alias-border-l2,#ffffff1f);border-radius:10px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#a0a0a6);min-width:0}
.theone-notice-tag{flex:none;display:inline-flex;padding:3px;border-radius:6px;background:#3b6fb033;color:#7fa9dd}
.theone-notice-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.theone-notice-text strong{color:var(--dsw-alias-label-primary,#e8e8ea);font-weight:500}
.theone-notice button{flex:none;display:inline-flex;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;padding:4px;border-radius:6px}
.theone-notice button:hover{background:var(--dsw-alias-interactive-bg-hover,#ffffff12)}
.theone-notice-link{color:#7fa9dd!important}
.theone-update-spin{width:12px;height:12px;border-radius:50%;border:1.5px solid currentColor;border-right-color:transparent;animation:theone-spin 800ms linear infinite}
@keyframes theone-spin{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.theone-update-spin{animation:none}}
.theone-entry-copy{display:flex;flex-direction:column;align-items:flex-start;gap:2px;min-width:0}
.theone-entry-title{display:flex;align-items:center;gap:9px;line-height:22px}
.theone-wordmark{display:inline-flex;align-items:baseline;gap:1px;white-space:nowrap}
.theone-word-the{font-size:12px;font-weight:400;letter-spacing:-.25px;color:var(--dsw-alias-label-secondary)}
.theone-word-one{position:relative;font-family:ui-rounded,'SF Pro Rounded','Avenir Next',sans-serif;font-size:19px;line-height:1.15;font-weight:500;letter-spacing:-1px;transform:rotate(-4deg);padding-right:7px}
.theone-word-dot{position:absolute;right:0;top:2px;width:4px;height:4px;border-radius:50%;background:currentColor}
.theone-entry-label{font-size:12px;font-weight:400;white-space:nowrap}
.theone-entry-sub{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.theone-opening{padding:32px;color:var(--dsw-alias-label-primary);font:inherit}
.theone-opening button{padding:8px 16px;font:inherit;color:inherit;background:var(--dsw-alias-interactive-bg-hover);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;cursor:pointer}
`

const catalogCss = `
button:has(.theone-catalog-entry)>span:not(:has(.theone-catalog-entry)){display:none}
.theone-catalog{--t-fg:var(--dsw-alias-label-primary,#18181b);--t-muted:var(--dsw-alias-label-secondary,#6b6b72);--t-rule:var(--dsw-alias-border-l2,#18181b1f);--t-accent:#b4531c;--t-warn:#c2410c;--t-field:#18181b0a;
  container-type:inline-size;box-sizing:border-box;height:100%;overflow:auto;padding:48px 56px 96px;color:var(--t-fg);font-feature-settings:"tnum" 1}
[data-ds-dark-theme] .theone-catalog{--t-accent:#8cc2ef;--t-warn:#fb923c;--t-field:#ffffff0d}
.theone-catalog>*{max-width:1120px;margin-left:auto;margin-right:auto}
.theone-catalog button{font:inherit;font-size:13px;line-height:1.4;color:inherit;background:transparent;border:1px solid var(--t-rule);border-radius:6px;padding:6px 12px;cursor:pointer;white-space:nowrap}
.theone-catalog button:hover:not(:disabled){border-color:var(--t-fg)}
.theone-catalog button:disabled{opacity:.4;cursor:default}
.theone-catalog button:focus-visible{outline:2px solid var(--t-accent);outline-offset:2px}
.theone-catalog .theone-primary{background:var(--t-fg);border-color:var(--t-fg);color:var(--dsw-alias-bg-primary,#fff)}
[data-ds-dark-theme] .theone-catalog .theone-primary{color:#111}
.theone-catalog .theone-quiet{border-color:transparent;color:var(--t-muted);padding-left:6px;padding-right:6px}
.theone-catalog .theone-quiet:hover:not(:disabled){border-color:transparent;color:var(--t-fg);text-decoration:underline;text-underline-offset:3px}
.theone-catalog .theone-continue{border-color:transparent;color:var(--t-accent);font-weight:600;padding-left:0;padding-right:6px}
.theone-catalog .theone-continue:hover:not(:disabled){border-color:transparent;text-decoration:underline;text-underline-offset:3px}
.theone-catalog-header{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:24px 48px;padding-bottom:28px;border-bottom:2px solid var(--t-fg)}
.theone-overline{margin:0 0 14px;font-size:12px;font-weight:600;letter-spacing:.06em;color:var(--t-accent)}
.theone-catalog h1{margin:0;font-size:44px;line-height:1.05;font-weight:700;letter-spacing:-.02em}
.theone-catalog-lede{margin:14px 0 0;max-width:34em;font-size:15px;line-height:1.6;color:var(--t-muted)}
.theone-figures{display:flex;gap:40px;margin:0}
.theone-figures>div{display:flex;flex-direction:column-reverse;gap:6px;min-width:64px}
.theone-figures dd{margin:0;font-size:40px;line-height:1;font-weight:600;letter-spacing:-.02em}
.theone-figures dt{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--t-muted)}
.theone-toolbar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px 24px;padding:14px 0 40px}
.theone-catalog-status{margin:0;font-size:13px;color:var(--t-muted)}
.theone-catalog-tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.theone-catalog-note,.theone-catalog-empty{color:var(--t-muted);font-size:14px;line-height:1.7}
.theone-catalog-empty{padding:48px 0}
.theone-catalog-warning{margin:0 0 24px;padding:10px 0 10px 14px;border-left:2px solid var(--t-warn);font-size:13px;line-height:1.6}
.theone-catalog-entry{display:flex;align-items:center;gap:10px;font-size:14px}
.theone-routes{margin-bottom:56px;border-top:1px solid var(--t-rule);border-bottom:1px solid var(--t-rule)}
.theone-routes summary{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px;padding:14px 0;cursor:pointer;font-size:13px;font-weight:600;letter-spacing:.04em;list-style:none}
.theone-routes summary::-webkit-details-marker{display:none}
.theone-routes summary::before{content:"+";display:inline-block;width:14px;color:var(--t-muted);font-weight:400}
.theone-routes[open] summary::before{content:"−"}
.theone-routes summary>span{color:var(--t-muted);font-weight:400}
.theone-route-stats{font-weight:400;color:var(--t-muted);font-size:12px}
.theone-routes .theone-manage-hint{margin:0 0 12px 26px;max-width:46em}
.theone-routes ol{list-style:none;margin:0;padding:0 0 8px}
.theone-routes li{display:grid;grid-template-columns:52px minmax(0,1.3fr) minmax(0,1fr) auto;gap:4px 20px;align-items:baseline;padding:10px 0;border-top:1px solid var(--t-rule);font-size:13px}
.theone-routes time{color:var(--t-muted)}
.theone-routes q{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;quotes:none}
.theone-route-target{display:flex;flex-direction:column;gap:2px;min-width:0}
.theone-route-target strong{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.theone-route-target small{color:var(--t-muted);font-size:12px}
.theone-route-actions{display:flex;gap:8px;align-items:center;justify-content:flex-end}
.theone-route-fixed{color:var(--t-muted);font-size:12px}
.theone-routes select{width:auto;max-width:150px;padding-top:4px;padding-bottom:4px;font-size:12px}
.theone-catalog-groups{display:flex;flex-direction:column;gap:56px}
.theone-topic-group{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,9fr);gap:0 40px;border-top:2px solid var(--t-fg);padding-top:16px}
.theone-group-head{position:sticky;top:0;align-self:start}
.theone-group-index{display:block;margin-bottom:10px;font-size:13px;font-weight:600;color:var(--t-accent)}
.theone-topic-group h2{margin:0;font-size:22px;line-height:1.2;font-weight:700;letter-spacing:-.01em}
.theone-topic-group h2 span{margin-left:8px;font-size:13px;font-weight:400;color:var(--t-muted)}
.theone-group-summary{margin:10px 0 0;font-size:13px;line-height:1.6;color:var(--t-muted)}
.theone-topic-list{list-style:none;margin:0;padding:0}
.theone-topic-card{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 32px;padding:18px 0 20px;border-top:1px solid var(--t-rule)}
.theone-topic-card:first-child{border-top:0;padding-top:4px}
.theone-topic-card.theone-hidden .theone-topic-main{opacity:.6}
.theone-topic-card h3{margin:0;font-size:16px;line-height:1.4;font-weight:600}
.theone-topic-summary{margin:6px 0 0;max-width:42em;font-size:14px;line-height:1.6;color:var(--t-muted);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.theone-topic-meta{display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px 16px;margin:14px 0 0;max-width:46em;font-size:13px;line-height:1.55}
.theone-topic-meta dt{color:var(--t-muted);font-size:12px;white-space:nowrap}
.theone-topic-meta dd{margin:0}
.theone-tag{display:inline-block;margin-left:8px;padding:0 6px;border:1px solid var(--t-rule);border-radius:4px;font-size:11px;color:var(--t-muted)}
.theone-topic-warning{margin:10px 0 0;padding-left:12px;border-left:2px solid var(--t-warn);font-size:12px;line-height:1.6}
.theone-topic-actions{display:flex;flex-direction:column;align-items:flex-end;gap:0}.theone-topic-actions button{padding-top:3px;padding-bottom:3px}
.theone-topic-edit{grid-column:1/-1;margin-top:12px;padding:4px 0 4px 20px;border-left:2px solid var(--t-accent)}
.theone-topic-links{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;margin:0 0 16px;font-size:13px}
.theone-links-label,.theone-links-empty{color:var(--t-muted)}
.theone-link-chip{display:inline-flex;align-items:center;gap:2px;padding:2px 2px 2px 10px;border:1px solid var(--t-rule);border-radius:4px}
.theone-catalog .theone-link-chip button{border:0;padding:0 6px;font-size:14px;line-height:1;color:var(--t-muted)}
.theone-link-private{display:inline-flex;align-items:center;gap:6px;color:var(--t-muted);cursor:pointer}
.theone-catalog input:not([type=checkbox]),.theone-catalog textarea,.theone-catalog select{font:inherit;font-size:13px;color:inherit;background:var(--t-field);border:1px solid transparent;border-bottom-color:var(--t-rule);border-radius:4px 4px 0 0;padding:7px 10px;box-sizing:border-box;min-width:0}
.theone-catalog input:not([type=checkbox]):focus,.theone-catalog textarea:focus,.theone-catalog select:focus{outline:none;border-bottom-color:var(--t-accent)}
.theone-manage{display:flex;flex-direction:column;gap:14px;font-size:13px}
.theone-create{flex-direction:row;flex-wrap:wrap;align-items:center;gap:8px;margin:0 0 40px;padding:16px 0;border-top:1px solid var(--t-rule);border-bottom:1px solid var(--t-rule)}
.theone-create input{flex:1;min-width:200px}
.theone-manage-field{display:flex;flex-direction:column;gap:6px}
.theone-manage-field>span{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--t-muted)}
.theone-manage textarea{resize:vertical;width:100%}
.theone-manage-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.theone-manage-row select,.theone-manage-row input{flex:1;min-width:160px}
.theone-manage-hint{margin:0;font-size:12px;line-height:1.6;color:var(--t-muted)}
.theone-catalog .theone-danger{color:var(--t-warn);border-color:var(--t-warn)}
@container (max-width:860px){.theone-topic-group{grid-template-columns:1fr}.theone-group-head{position:static;margin-bottom:20px}.theone-catalog-header{grid-template-columns:1fr}.theone-figures{gap:32px}}
@container (max-width:640px){.theone-catalog h1{font-size:32px}.theone-figures dd{font-size:30px}.theone-topic-card{grid-template-columns:1fr}.theone-topic-actions{flex-direction:row;flex-wrap:wrap;align-items:center}.theone-routes li{grid-template-columns:44px minmax(0,1fr)}.theone-route-target,.theone-route-actions{grid-column:2}.theone-route-actions{justify-content:flex-start}}
@media(max-width:640px){.theone-catalog{padding:28px 16px 64px}}
`

const composerCss = `
.theone-bg{display:inline-flex;align-items:center;gap:5px;height:32px;padding:0 10px;border:0;border-radius:10px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;white-space:nowrap;cursor:pointer;max-width:220px}
.theone-bg:hover,.theone-bg[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover)}
.theone-bg:focus-visible{outline:2px solid var(--dsw-focus-ring-color,#4a7fb5);outline-offset:1px}
.theone-bg:disabled{opacity:.6;cursor:default}
.theone-bg-caption,.theone-bg-chevron{color:var(--dsw-alias-label-secondary)}
.theone-bg-text{overflow:hidden;text-overflow:ellipsis;display:var(--dsh-composer-model-text-display,inline)}
.theone-bg-caption,.theone-bg-chevron{display:inline-flex}
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
.theone-settings-update p{margin:0 0 10px;line-height:1.7}.theone-settings-update-version{color:var(--dsw-alias-label-secondary);font-size:13px}.theone-settings-update-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:6px}
.theone-settings-summary,.theone-settings-group{border:1px solid var(--dsw-alias-border-l2);border-radius:16px;padding:22px;margin-bottom:20px}.theone-settings-summary{background:#88804}.theone-settings-summary dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}.theone-settings dl{margin:0}.theone-settings-summary dt{font-size:12px;color:var(--dsw-alias-label-secondary);margin-bottom:8px}.theone-settings dd{margin:0;overflow-wrap:anywhere;line-height:1.6}.theone-settings-summary dd{font-size:15px}.theone-settings-summary p{font-size:13px;line-height:1.7;color:var(--dsw-alias-label-secondary);margin:16px 0 0}
.theone-settings-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(160px,42%);gap:24px;padding:16px 0;border-top:1px solid var(--dsw-alias-border-l2)}.theone-settings-row:first-child{border-top:0;padding-top:0}.theone-settings-row:last-child{padding-bottom:0}.theone-settings-row strong{font-size:14px;font-weight:500}.theone-settings-row p{font-size:13px;line-height:1.6;color:var(--dsw-alias-label-secondary);margin:6px 0}.theone-settings-row code{font-size:11px;color:var(--dsw-alias-label-secondary)}.theone-settings-row dd{font-size:13px;padding-top:1px}.theone-settings-row[data-inactive=true]{opacity:.6}
@media(max-width:640px){.theone-settings{padding:20px 16px}.theone-settings-header{flex-wrap:wrap}.theone-settings-summary,.theone-settings-group{padding:18px}.theone-settings-summary dl{grid-template-columns:1fr}.theone-settings-row{grid-template-columns:1fr;gap:10px}}
`
