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
import type { CatalogSnapshot, LinkageSnapshot } from './catalog-types.ts'
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

  function SidebarEntry({size}: PropsRuntime<'sidebar.panellist'>) {
    const t = useText()
    const marker = useRef<HTMLSpanElement>(null)
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
      h('span',{className:'theone-symbol'}),
      size === 16 && h('span',{className:'theone-entry-copy'},
        h('span',{className:'theone-entry-title'},
          h('span',{className:'theone-wordmark',translate:'no'},h('span',{className:'theone-word-the'},'The'),
            h('span',{className:'theone-word-one'},'One',h('span',{className:'theone-word-dot'}))),
          h('span',{className:'theone-entry-label'},t('gateway.label'))),
        h('span',{className:'theone-entry-sub'},t('gateway.subtitle'))))
  }

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
      ['models', ['workerProvider', 'workerModel', 'routerMode', 'routerTransport']],
      ['history', ['historyCatalog', 'catalogIntervalMs']],
      ['linkage', ['linkScope', 'routeNotice']],
      ['limits', ['maxDescriptorChars', 'maxResponseChars']],
      ['storage', ['databasePath', 'contextsPath', 'gatewayKey']],
      ['legacy', ['routerBaseUrl', 'routerModel', 'routerApiKeyEnv']],
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
          if (!signal.aborted) setMessage(response.status === 409 ? 'settings.conflict' : failure.error === 'LEGACY_KEY_MISSING' ? 'settings.keyMissing' : 'settings.saveError')
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
      if (field === 'historyCatalog') return select(String(draft.historyCatalog), [{ value: 'true', label: t('settings.on') }, { value: 'false', label: t('settings.off') }], v => change(field, v === 'true'))
      if (field === 'linkScope' || field === 'routeNotice') {
        const values = field === 'linkScope' ? ['auto', 'workspace', 'off'] : ['switch', 'hidden', 'all']
        return select(draft[field], values.map(value => ({ value, label: t(`settings.${field === 'linkScope' ? 'scope' : 'notice'}.${value}` as TheOneLocaleKey) })), v => change(field, v as never))
      }
      if (field === 'routerMode' || field === 'routerTransport') {
        const values = field === 'routerMode' ? ['llm', 'rules'] : ['dsh', 'legacy']
        return select(draft[field], values.map(value => ({ value, label: t(`settings.${value === 'legacy' ? 'legacyCall' : value}` as TheOneLocaleKey) })), v => change(field, v))
      }
      if (field === 'workerProvider') {
        const providers = [...new Set([snapshot.model?.provider, snapshot.values.workerProvider, snapshot.savedValues.workerProvider].filter((value): value is string => !!value && value !== 'theone'))]
        return select(draft.workerProvider ?? '', [{ value: '', label: t('settings.follow') }, ...providers.map(value => ({ value, label: value }))], v => {
          const model = v === snapshot.model?.provider ? snapshot.model.model : v === snapshot.savedValues.workerProvider ? snapshot.savedValues.workerModel : snapshot.values.workerModel
          setDraft(current => current && { ...current, workerProvider: v || null, workerModel: v ? model ?? null : null }); setMessage(undefined)
        })
      }
      if (field === 'workerModel') {
        const models = [...new Set([draft.workerModel, draft.workerProvider === snapshot.model?.provider ? snapshot.model?.model : null].filter((value): value is string => !!value))]
        return select(draft.workerModel ?? '', [{ value: '', label: t(draft.workerProvider ? 'settings.none' : 'settings.follow') }, ...models.map(value => ({ value, label: value }))], v => change(field, v || null))
      }
      if (field === 'catalogIntervalMs' || field === 'maxDescriptorChars' || field === 'maxResponseChars') {
        const interval = field === 'catalogIntervalMs'
        return h('input', { ...props, type: 'number', required: true, step: 1, min: interval ? 10 : 128,
          max: interval ? 86400 : field === 'maxDescriptorChars' ? 1000000 : 10000000,
          value: Number.isFinite(draft[field]) ? draft[field] / (interval ? 1000 : 1) : '',
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => change(field, event.target.valueAsNumber * (interval ? 1000 : 1)) })
      }
      return h('input', { ...props, type: field === 'routerBaseUrl' ? 'url' : 'text', value: draft[field] ?? '', required: true,
        maxLength: field === 'routerBaseUrl' ? 2048 : field === 'routerApiKeyEnv' ? 128 : 256,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => change(field, event.target.value) })
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
          group === 'legacy' ? h('p', { className: 'theone-settings-help' }, t('settings.legacyHint')) : null,
          h('dl', null, ...keys.map(key => h('div', { className: 'theone-settings-row', key, 'data-inactive': group === 'legacy' && (draft.routerTransport !== 'legacy' || draft.routerMode !== 'llm') },
            h('dt', null, h('strong', null, t(`settings.${key}`)), h('p', null, t(`settings.help.${key}`)), h('code', null, key)),
            h('dd', null, control(key), key === 'catalogIntervalMs' && Number.isFinite(draft.catalogIntervalMs) ? h('small', null, t('settings.seconds', { count: draft.catalogIntervalMs / 1000 })) : null)))))),
        h('footer', { className: 'theone-settings-footer' },
          h('p', { role: message === 'settings.saveError' || message === 'settings.conflict' || message === 'settings.keyMissing' ? 'alert' : 'status' },
            message ? t(message) : dirty ? t('settings.unsaved') : snapshot.restartRequired ? t('settings.restart') : ''),
          message === 'settings.conflict' ? h('button', { type: 'button', onClick: () => setAttempt(n => n + 1) }, t('settings.reload')) : null,
          h('button', { type: 'button', disabled: saving || !dirty, onClick: () => { setDraft(snapshot.savedValues); setMessage(undefined) } }, t('settings.reset')),
          h('button', { type: 'submit', disabled: saving || !dirty, className: 'theone-settings-save' }, t(saving ? 'settings.saving' : 'settings.save'))))
    )
  }

  function CatalogPanel() {
    const t = useText()
    const [snapshot, setSnapshot] = useState<CatalogSnapshot>()
    const [error, setError] = useState<TheOneLocaleKey>()
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
        } catch { if (!signal.aborted) setError('catalog.loadError') }
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
      } catch { setError('catalog.continueError') }
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
          snapshot?.linkage && snapshot.linkage.scope !== 'off' ? h('button', { type: 'button', disabled: !!busy, title: t('link.clearLearnedHint'),
            onClick: () => { void editLinks({ action: 'clearLearned' }) } }, t('link.clearLearned')) : null,
          h('button', { type: 'button', onClick: refresh, disabled: !!busy || status?.running }, t('catalog.refresh')))),
      snapshot?.linkage?.scope === 'off' ? h('p', { className: 'theone-catalog-status' }, t('link.off')) : null,
      h('p', { className: 'theone-catalog-status', role: 'status' }, snapshot
        ? t('catalog.counts', { topics: snapshot.contexts.length, groups: snapshot.groups.length, topicSuffix: snapshot.contexts.length === 1 ? '' : 's', groupSuffix: snapshot.groups.length === 1 ? '' : 's' }) + ' · ' + (status?.running ? t('catalog.indexing') : status?.pending ? t('catalog.pending', { count: status.pending, sessionSuffix: status.pending === 1 ? '' : 's' }) : t('catalog.updated'))
        : t('catalog.reading')),
      status?.failed ? h('p', { className: 'theone-catalog-warning' }, t('catalog.failed', { count: status.failed, sessionSuffix: status.failed === 1 ? '' : 's' })) : null,
      status?.searchUnavailable ? h('p', { className: 'theone-catalog-warning' }, t('catalog.searchUnavailable')) : null,
      error ? h('p', { role: 'alert', className: 'theone-catalog-warning' }, t(error)) : null,
      snapshot && !snapshot.contexts.length ? h('p', { className: 'theone-catalog-empty' }, t(status?.running ? 'catalog.emptyIndexing' : 'catalog.empty')) : null,
      h('div', { className: 'theone-catalog-groups' }, ...groups.map(group =>
        h('section', { key: group.id, className: 'theone-topic-group' },
          h('h2', null, group.title, h('span', null, ` ${group.contextIds.length}`)),
          group.summary ? h('p', { className: 'theone-group-summary' }, group.summary) : null,
          ...group.contextIds.flatMap(id => {
            const topic = snapshot?.contexts.find(c => c.id === id)
            if (!topic) return []
            return [h('article', { key: id, className: 'theone-topic-card' },
              h('h3', null, topic.title), h('p', null, topic.summary), linkRow(id),
              h('div', { className: 'theone-topic-actions' },
                h('button', { type: 'button', disabled: !!busy, onClick: () => { void continueTopic(id) } }, t(busy === id ? 'topic.opening' : 'topic.continue')),
                ...topic.sourceSessionIds.slice(0, 3).map((sessionId, i) => h('button', { key: sessionId, type: 'button', className: 'theone-source-link',
                  onClick: () => { ctx.layout.beginNavigation(); ctx.uiWorkspace.openSession(sessionId as SessionId) } }, t('topic.source') + (topic.sourceSessionIds.length > 1 ? ' ' + (i + 1) : '')))))]
          }))))
    )
  }

  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-theone'
    style.textContent = sidebarCss + catalogCss + settingsCss
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
.theone-catalog-header{display:flex;justify-content:space-between;align-items:center;gap:16px}.theone-catalog h1{font-size:24px;margin:0 0 8px}.theone-catalog-header p,.theone-catalog-status,.theone-group-summary{opacity:.65;margin:0 0 18px;line-height:1.6}.theone-catalog button{border:1px solid #8883;border-radius:9px;padding:8px 13px;background:transparent;color:inherit;cursor:pointer;font:inherit;white-space:nowrap}.theone-catalog button:disabled{opacity:.5;cursor:default}.theone-catalog-groups{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,310px),1fr));gap:20px}.theone-topic-group{border:1px solid #8882;border-radius:16px;padding:20px;background:#88805}.theone-topic-group h2{font-size:18px;margin:0 0 8px}.theone-topic-group h2 span{font-size:13px;opacity:.5}.theone-topic-card{border-top:1px solid #8882;padding:16px 0}.theone-topic-card:last-child{padding-bottom:0}.theone-topic-card h3{font-size:15px;line-height:1.5;margin:0 0 7px}.theone-topic-card p{font-size:13px;line-height:1.7;opacity:.75;margin:0 0 12px;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}.theone-topic-actions{display:flex;gap:8px;flex-wrap:wrap}.theone-topic-actions button{font-size:12px}.theone-topic-actions .theone-source-link{border-color:transparent;opacity:.6}.theone-catalog-warning{background:#ff900011;padding:12px;border-radius:10px;font-size:13px}.theone-catalog-entry{display:flex;align-items:center;gap:10px;font-size:14px}.theone-catalog-empty{padding:40px 0;opacity:.65;line-height:1.8}.theone-catalog-tools{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.theone-topic-links{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:0 0 12px;font-size:12px}.theone-links-label,.theone-links-empty{opacity:.6}.theone-link-chip{display:inline-flex;align-items:center;gap:2px;border:1px solid #8883;border-radius:999px;padding:2px 4px 2px 9px}.theone-catalog .theone-link-chip button{border:0;padding:0 5px;opacity:.6;font-size:13px;line-height:1}.theone-topic-links select{font:inherit;font-size:12px;color:inherit;background:transparent;border:1px solid #8883;border-radius:8px;padding:2px 6px}.theone-link-private{display:inline-flex;align-items:center;gap:4px;opacity:.75;cursor:pointer}@media(max-width:640px){.theone-catalog{padding:20px}.theone-catalog-header{align-items:flex-start}.theone-catalog-header h1{font-size:21px}}
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
