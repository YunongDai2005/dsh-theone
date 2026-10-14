import { createElement as h, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SettingsSnapshot } from './settings-types.ts'
import type { ClientRuntime } from './client-runtime.ts'

export function registerComposer(rt: ClientRuntime): void {
  const { ctx, useText, subscribeNotices, localized, dismissNotice, icon, lifetime } = rt
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
  /** Ordinary notices: one quiet line under the main chat input while TheOne is selected. */
  function NoticeStrip({ directory }: { directory: DirectoryStore }) {
    const t = useText()
    const state = useSyncExternalStore(listener => directory.subscribe(listener), () => directory.getSnapshot())
    const list = useSyncExternalStore(subscribeNotices, () => rt.notices)
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
}
