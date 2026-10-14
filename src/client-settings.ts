import { createElement as h, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import qrcode from 'qrcode-generator'
import type { TheOneLocaleKey } from './client-locales.ts'
import { EDITABLE_SETTINGS_KEYS, type EditableSettings, type SettingsSnapshot } from './settings-types.ts'
import type { WeixinStatus } from './weixin-link.ts'
import type { TelegramStatus } from './telegram-bot.ts'
import type { IMessageStatus } from './imessage-db.ts'
import type { LinkStatus } from './remote-link.ts'
import type { ClientRuntime } from './client-runtime.ts'
import { panelId } from './client-runtime.ts'

export function createSettingsPanel(rt: ClientRuntime) {
  const { ctx, useText, localeSnapshot, lifetime, subscribeUpdate, readUpdate, startUpdate, updateHint } = rt
  /** Settings' own way to look for and install a new version, beside the automatic check. */
  function UpdateSection() {
    const t = useText()
    const status = useSyncExternalStore(subscribeUpdate, () => rt.update)
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

  /**
   * One messaging app's status from TheOne, polled quickly while a sign-in is under way; `act` sends
   * an action and keeps the error code of a refused one for the section to explain.
   */
  function useRemote<T extends LinkStatus>(name: string, fast: (status: T | undefined) => boolean) {
    const [status, setStatus] = useState<T>()
    const [failed, setFailed] = useState(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string>()
    const call = async (body?: Record<string, unknown>) => {
      try {
        const response = await fetch(`/api/theone/${name}`, { signal: lifetime.signal, cache: 'no-store',
          ...(body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) })
        const value = await response.json().catch(() => ({})) as T & { error?: string }
        if (!response.ok) { if (body && value.error) { setError(value.error); return } throw new Error('Status unavailable') }
        setStatus(value); setFailed(false); if (body) setError(undefined)
      } catch { if (!lifetime.signal.aborted) setFailed(true) }
    }
    const act = async (body: Record<string, unknown>) => { setBusy(true); try { await call(body) } finally { setBusy(false) } }
    const quick = fast(status)
    useEffect(() => {
      void call()
      const timer = setInterval(() => { void call() }, quick ? 1500 : 15000)
      return () => clearInterval(timer)
    }, [quick])
    return { status, failed, busy, error, act }
  }

  /** A QR code for `url`, to scan with the phone. */
  function qrImage(url: string, alt: string) {
    const qr = qrcode(0, 'M'); qr.addData(url); qr.make()
    return h('img', { className: 'theone-weixin-qr', src: qr.createDataURL(6, 3), alt, width: 220, height: 220 })
  }

  /** What every app shows: where it stands, the last error, and pause / resume / log out once signed in. */
  function remoteState(t: (key: TheOneLocaleKey, params?: Record<string, unknown>) => string, remote: { status?: LinkStatus; failed: boolean },
    expiredKey: TheOneLocaleKey, explain: (code: string) => string = code => code) {
    const { status, failed } = remote
    const account = status?.account ?? ''
    const line = !status ? (failed ? t('settings.remoteError') : t('settings.loading'))
      : status.state === 'online' ? t('settings.remoteOnline', { account })
      : status.state === 'connecting' ? t('settings.remoteConnecting', { account })
      : status.state === 'paused' ? t('settings.remotePaused', { account, minutes: Math.max(1, Math.ceil(((status.pausedUntil ?? Date.now()) - Date.now()) / 60000)) })
      : status.state === 'expired' ? t(expiredKey)
      : account ? t('settings.remoteOff', { account }) : ''
    return [line ? h('p', { role: 'status', key: 'line' }, line) : null,
      status?.lastError && status.state !== 'off' ? h('p', { className: 'theone-settings-update-version', key: 'error' }, t('settings.remoteLastError', { error: explain(status.lastError) })) : null]
  }

  function remoteButton(t: (key: TheOneLocaleKey) => string, busy: boolean, act: (body: Record<string, unknown>) => void, label: TheOneLocaleKey, body: Record<string, unknown>, primary = false) {
    return h('button', { type: 'button', key: label, disabled: busy, className: primary ? 'theone-settings-save' : undefined, onClick: () => act(body) }, t(label))
  }

  /** Pause or resume, and log out, for a signed-in app. */
  function remoteControls(t: (key: TheOneLocaleKey) => string, remote: { status?: LinkStatus; busy: boolean; act: (body: Record<string, unknown>) => void }) {
    const { status, busy, act } = remote
    if (!status?.account || status.state === 'expired') return []
    return [status.state === 'off' ? remoteButton(t, busy, act, 'settings.remoteResume', { action: 'enable' }, true) : remoteButton(t, busy, act, 'settings.remotePause', { action: 'disable' }),
      remoteButton(t, busy, act, 'settings.remoteLogout', { action: 'logout' })]
  }

  /** Bind WeChat by scanning a code, and pause, resume or log out; applies at once, outside the form below. */
  function WeixinSection() {
    const t = useText()
    const remote = useRemote<WeixinStatus>('weixin', status => !!status?.login && status.login.step !== 'failed')
    const { status, busy } = remote
    const act = (body: Record<string, unknown>) => { void remote.act(body) }
    const [code, setCode] = useState('')
    const login = status?.login
    const waiting = !!login && login.step !== 'failed'
    const button = (label: TheOneLocaleKey, body: Record<string, unknown>, primary = false) => remoteButton(t, busy, act, label, body, primary)
    return h('section', { className: 'theone-settings-group theone-settings-update theone-weixin' },
      h('h2', null, t('settings.weixin')),
      h('p', null, t('settings.weixinIntro')),
      ...remoteState(t, remote, 'settings.weixinExpired'),
      login?.step === 'qr' ? h('div', { className: 'theone-weixin-login' }, qrImage(login.url, t('settings.weixinScan')), h('p', null, t('settings.weixinScan'))) : null,
      login?.step === 'scanned' ? h('p', { role: 'status' }, t('settings.weixinScanned')) : null,
      login?.step === 'verify' ? h('form', { className: 'theone-settings-update-actions', onSubmit: (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault(); if (code.trim()) { act({ action: 'verify', code }); setCode('') } } },
        h('label', { htmlFor: 'theone-weixin-code' }, t('settings.weixinVerify')),
        h('input', { id: 'theone-weixin-code', value: code, maxLength: 16, autoComplete: 'one-time-code', onChange: (event: React.ChangeEvent<HTMLInputElement>) => setCode(event.target.value) }),
        h('button', { type: 'submit', disabled: busy || !code.trim() }, t('settings.weixinVerifySubmit'))) : null,
      login?.step === 'failed' ? h('p', { role: 'alert' }, t('settings.weixinFailed', { reason: login.reason })) : null,
      h('div', { className: 'theone-settings-update-actions' },
        waiting ? button('settings.weixinCancel', { action: 'cancel' })
          : !status?.account ? button('settings.weixinBind', { action: 'login' }, true)
          : status.state === 'expired' ? button('settings.weixinRescan', { action: 'login' }, true) : null,
        ...waiting ? [] : remoteControls(t, { ...remote, act })),
      h('p', { className: 'theone-settings-update-version' }, t('settings.weixinNote')))
  }

  /** Bind a Telegram bot: paste its token, then send it the pairing code (or scan the code that opens it). */
  function TelegramSection() {
    const t = useText()
    const remote = useRemote<TelegramStatus>('telegram', status => !!status?.pairing)
    const { status, busy, error } = remote
    const act = (body: Record<string, unknown>) => { void remote.act(body) }
    const [token, setToken] = useState('')
    const pairing = status?.pairing
    const asking = !status?.account || status.state === 'expired'
    return h('section', { className: 'theone-settings-group theone-settings-update theone-weixin' },
      h('h2', null, t('settings.telegram')),
      h('p', null, t('settings.telegramIntro')),
      ...pairing ? [h('p', { role: 'status', key: 'line' }, t('settings.telegramWaiting', { account: `@${pairing.bot}` }))] : remoteState(t, remote, 'settings.telegramExpired'),
      pairing ? h('div', { className: 'theone-weixin-login' }, qrImage(`https://t.me/${pairing.bot}?start=${pairing.code}`, t('settings.telegramPairScan')),
        h('p', null, t('settings.telegramPair', { bot: `@${pairing.bot}`, code: pairing.code }))) : null,
      asking ? h('form', { className: 'theone-settings-update-actions', onSubmit: (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault(); if (token.trim()) { act({ action: 'connect', token }); setToken('') } } },
        h('label', { htmlFor: 'theone-telegram-token' }, t('settings.telegramToken')),
        h('input', { id: 'theone-telegram-token', type: 'password', value: token, maxLength: 200, autoComplete: 'off', spellCheck: false,
          placeholder: '123456789:AA…', onChange: (event: React.ChangeEvent<HTMLInputElement>) => setToken(event.target.value) }),
        h('button', { type: 'submit', className: 'theone-settings-save', disabled: busy || !token.trim() }, t('settings.remoteConnect'))) : null,
      error ? h('p', { role: 'alert' }, t(error === 'TELEGRAM_TOKEN_INVALID' ? 'settings.telegramTokenInvalid' : 'settings.telegramUnreachable')) : null,
      h('div', { className: 'theone-settings-update-actions' }, ...remoteControls(t, { ...remote, act })),
      h('p', { className: 'theone-settings-update-version' }, t('settings.telegramNote')))
  }

  /** Bind iMessage on a Mac: name the phone number or Apple ID the user texts from. */
  function IMessageSection() {
    const t = useText()
    const remote = useRemote<IMessageStatus>('imessage', () => false)
    const { status, busy, error } = remote
    const act = (body: Record<string, unknown>) => { void remote.act(body) }
    const [handle, setHandle] = useState('')
    const explain = (code: string) => code === 'IMESSAGE_NO_ACCESS' ? t('settings.imessageNoAccess') : code
    const asking = status?.supported && !status.account
    return h('section', { className: 'theone-settings-group theone-settings-update theone-weixin' },
      h('h2', null, t('settings.imessage')),
      h('p', null, t('settings.imessageIntro')),
      status && !status.supported && !status.account ? h('p', { role: 'status' }, t('settings.imessageUnsupported')) : null,
      ...remoteState(t, remote, 'settings.imessageNoAccess', explain),
      asking ? h('form', { className: 'theone-settings-update-actions', onSubmit: (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault(); if (handle.trim()) act({ action: 'connect', handle }) } },
        h('label', { htmlFor: 'theone-imessage-handle' }, t('settings.imessageHandle')),
        h('input', { id: 'theone-imessage-handle', value: handle, maxLength: 200, autoComplete: 'off', placeholder: '+86 138 0000 0000',
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => setHandle(event.target.value) }),
        h('button', { type: 'submit', className: 'theone-settings-save', disabled: busy || !handle.trim() }, t('settings.remoteConnect'))) : null,
      error ? h('p', { role: 'alert' }, error === 'IMESSAGE_NO_ACCESS' ? t('settings.imessageNoAccess')
        : t(error === 'IMESSAGE_HANDLE_INVALID' ? 'settings.imessageHandleInvalid' : 'settings.imessageUnsupported')) : null,
      h('div', { className: 'theone-settings-update-actions' }, ...remoteControls(t, { ...remote, act })),
      status?.supported ? h('p', { className: 'theone-settings-update-version' }, t('settings.imessageNote')) : null)
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
      h(WeixinSection),
      h(TelegramSection),
      h(IMessageSection),
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

  return SettingsPanel
}
