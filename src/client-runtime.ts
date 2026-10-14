import { createElement as h, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { LocaleSnapshot } from '@deepseek-ai/dsh-client-locale/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { GatewayNavigation } from './client-navigation.ts'
import { zh, en } from './client-locales.ts'
import type { TheOneLocaleKey } from './client-locales.ts'
import type { UpdateStatus } from './update.ts'
import type { Notice } from './notices.ts'

/** Main chat's panel and the two side panels, as the host layout names them. */
export const panelId = 'theone-gateway' as MainPanelId
export const catalogPanelId = 'theone-catalog' as MainPanelId
export const settingsPanelId = 'theone-settings' as MainPanelId

/** TheOne's texts, bound to the "theone" namespace. */
export type TheOneText = TranslateNS<'theone'>
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

export type ClientIconName = keyof typeof ICONS

/**
 * State and services every panel shares: locale texts, gateway navigation, the update and notice
 * stores, and the dialogs several surfaces open. Created once per client apply().
 */
export interface ClientRuntime {
  readonly ctx: Context
  readonly lifetime: AbortController
  readonly t: TheOneText
  readonly useText: () => TheOneText
  readonly localeSnapshot: () => LocaleSnapshot
  readonly navigation: GatewayNavigation
  /** Shared update status: checked when the sidebar mounts and every six hours after. */
  update: UpdateStatus | undefined
  readonly subscribeUpdate: (listener: () => void) => () => void
  readonly setUpdate: (value: UpdateStatus) => void
  readonly readUpdate: (method?: 'GET' | 'POST', body?: Record<string, unknown>, force?: boolean) => Promise<boolean>
  readonly startUpdate: (status: UpdateStatus) => void
  readonly updateHint: (status: UpdateStatus) => string
  /** Notices from TheOne's maintainer, shared by the dialog and the strip under the main chat input. */
  notices: Notice[]
  readonly subscribeNotices: (listener: () => void) => () => void
  readonly localized: (value: { zh?: string; en?: string }) => string
  readonly dismissNotice: (id: string) => void
  readonly openFeedbackDialog: (messageId?: string) => void
  readonly icon: (name: ClientIconName, size?: number) => ReactElement
}

/** Assemble the shared runtime: locale, navigation, update and notice stores, dialogs and icons. */
export function createClientRuntime(ctx: Context): ClientRuntime {
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

  return {
    ctx, lifetime, t, useText, localeSnapshot, navigation,
    get update() { return update },
    setUpdate, subscribeUpdate, readUpdate, startUpdate, updateHint,
    get notices() { return notices },
    subscribeNotices, localized, dismissNotice, openFeedbackDialog, icon,
  }
}
