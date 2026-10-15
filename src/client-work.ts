import { createElement as h, useEffect, useRef, useState } from 'react'
import type { ResearchTask } from './persistent-work.ts'
import type { WorkState } from './work-store.ts'
import type { TheOneLocaleKey } from './client-locales.ts'

interface TaskView {
  id: string; state: WorkState; due: number; runs: number; error?: string; task: ResearchTask
  result?: { summary?: string; nextStep?: string; checkedAt?: number; snapshot?: { sha?: string; partial?: boolean } }
}
type Text = (key: TheOneLocaleKey, params?: Record<string, string | number>) => string

export function createWorkPanel(useText: () => Text, lifetime: AbortSignal, openMain: () => void) {
  return function WorkPanel() {
    const t = useText()
    const [tasks, setTasks] = useState<TaskView[]>([])
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)
    const [objective, setObjective] = useState('')
    const [url, setUrl] = useState('')
    const [interval, setIntervalValue] = useState(15)
    const [maxChecks, setMaxChecks] = useState(96)
    const [completion, setCompletion] = useState('closed')
    const [hours, setHours] = useState(24)
    const mounted = useRef<AbortSignal>(lifetime)
    const reload = useRef(async () => {})
    const requestId = useRef<string>()
    const submitting = useRef(false)
    useEffect(() => {
      const local = new AbortController()
      const signal = AbortSignal.any([local.signal, lifetime])
      mounted.current = signal
      let loading: Promise<void> | undefined
      reload.current = () => loading ??= (async () => {
        try {
          const response = await fetch('/api/theone/tasks', { signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]), cache: 'no-store' })
          if (!response.ok) throw new Error('unavailable')
          const value = await response.json() as TaskView[]
          if (!signal.aborted) { setTasks(value); setError(current => current === t('tasks.loadError') ? '' : current) }
        } catch { if (!signal.aborted) setError(t('tasks.loadError')) }
      })().finally(() => { loading = undefined })
      void reload.current()
      const timer = setInterval(() => { void reload.current() }, 5000)
      return () => { local.abort(); clearInterval(timer) }
    }, [t])
    async function act(body: Record<string, unknown>) {
      if (submitting.current || mounted.current.aborted) return
      submitting.current = true; setBusy(true); setError('')
      try {
        const response = await fetch('/api/theone/tasks', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body), signal: AbortSignal.any([mounted.current, AbortSignal.timeout(15000)]) })
        const value = await response.json() as { error?: string }
        if (!response.ok) throw new Error(value.error === 'OPEN_MAIN_CHAT_FIRST' ? t('tasks.openMain') : t('tasks.actionError'))
        if (mounted.current.aborted) return
        if (body.action === 'create') { requestId.current = undefined; setObjective(''); setUrl('') }
        if (body.action === 'review') openMain()
        // Let an earlier poll finish before fetching the mutation's result.
        await reload.current(); await reload.current()
      } catch (cause) { if (!mounted.current.aborted) setError(cause instanceof Error ? cause.message : t('tasks.actionError')) }
      finally { submitting.current = false; if (!mounted.current.aborted) setBusy(false) }
    }
    const label = (key: TheOneLocaleKey, control: ReturnType<typeof h>) => h('label', { className: 'theone-task-field' }, t(key), control)
    const button = (title: string, action: string, id: string) => h('button', { type: 'button', disabled: busy, onClick: () => void act({ action, id }) }, title)
    return h('section', { className: 'theone-tasks' },
      h('h2', null, t('tasks.title')), h('p', null, t('tasks.help')),
      error ? h('p', { role: 'alert' }, error) : null,
      h('form', { onSubmit: (event: { preventDefault(): void }) => {
        event.preventDefault()
        requestId.current ??= crypto.randomUUID()
        void act({ action: 'create', requestId: requestId.current, objective, url, intervalMinutes: interval, maxChecks, completion, deadline: Date.now() + hours * 3600000 })
      } },
      label('tasks.objective', h('input', { required: true, maxLength: 1000, value: objective, disabled: busy, onChange: (e: { target: { value: string } }) => { setObjective(e.target.value); requestId.current = undefined } })),
      label('tasks.url', h('input', { type: 'url', required: true, maxLength: 1000, placeholder: 'https://github.com/owner/repo/pull/123', value: url, disabled: busy,
        onChange: (e: { target: { value: string } }) => { setUrl(e.target.value); requestId.current = undefined } })),
      label('tasks.interval', h('input', { type: 'number', required: true, min: 5, max: 1440, value: interval, disabled: busy, onChange: (e: { target: { value: string } }) => { setIntervalValue(Number(e.target.value)); requestId.current = undefined } })),
      label('tasks.budget', h('input', { type: 'number', required: true, min: 1, max: 1000, value: maxChecks, disabled: busy, onChange: (e: { target: { value: string } }) => { setMaxChecks(Number(e.target.value)); requestId.current = undefined } })),
      label('tasks.hours', h('input', { type: 'number', required: true, min: 1, max: 720, value: hours, disabled: busy, onChange: (e: { target: { value: string } }) => { setHours(Number(e.target.value)); requestId.current = undefined } })),
      label('tasks.completion', h('select', { value: completion, disabled: busy, onChange: (e: { target: { value: string } }) => { setCompletion(e.target.value); requestId.current = undefined } },
        h('option', { value: 'closed' }, t('tasks.closed')), h('option', { value: 'checks-passed' }, t('tasks.passed')))),
      h('button', { type: 'submit', disabled: busy }, t('tasks.create'))),
      !tasks.length ? h('p', null, t('tasks.empty')) : null,
      ...tasks.slice().reverse().map(job => h('article', { key: job.id, className: 'theone-task' },
        h('h3', null, job.task.objective), h('p', null, t(`tasks.state.${job.state}`)),
        h('a', { href: job.task.url, target: '_blank', rel: 'noopener noreferrer' }, job.task.url),
        h('p', null, `${t('tasks.used')}: ${Math.min(job.runs, job.task.maxChecks)} / ${job.task.maxChecks} · ${t('tasks.deadline')}: ${new Date(job.task.deadline).toLocaleString()}`),
        job.state === 'queued' ? h('p', null, `${t('tasks.next')}: ${new Date(job.due).toLocaleString()}`) : null,
        job.result?.summary ? h('p', null, job.result.summary) : null,
        job.result?.nextStep ? h('p', null, job.result.nextStep) : null,
        job.result?.checkedAt ? h('small', null, `${t('tasks.checked')}: ${new Date(job.result.checkedAt).toLocaleString()} · ${job.result.snapshot?.sha?.slice(0, 8) ?? ''}`) : null,
        job.error ? h('p', { role: 'status' }, job.error === 'WORK_BUDGET_REACHED' ? t('tasks.exhausted') : t('tasks.failure')) : null,
        h('div', { className: 'theone-task-actions' },
          ['queued', 'running'].includes(job.state) ? button(t('tasks.pause'), 'pause', job.id) : null,
          ['paused', 'failed'].includes(job.state) ? button(t('tasks.resume'), 'resume', job.id) : null,
          job.state === 'queued' ? button(t('tasks.check'), 'wake', job.id) : null,
          !['completed', 'cancelled'].includes(job.state) ? button(t('tasks.cancel'), 'cancel', job.id) : null,
          job.result ? button(t('tasks.review'), 'review', job.id) : null))))
  }
}

export const workCss = `.theone-tasks{padding:24px;max-width:900px;margin:auto;overflow:auto;height:100%;box-sizing:border-box;color:var(--dsw-alias-label-primary);font-size:14px;line-height:1.6}.theone-tasks form{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;padding:16px;border:1px solid var(--dsw-alias-border-l2,#8885);border-radius:12px}.theone-task-field{display:flex;flex-direction:column;gap:4px}.theone-tasks input,.theone-tasks select{color:inherit;background:transparent;padding:8px;border:1px solid #8887;border-radius:6px;min-width:0}.theone-tasks button{font:inherit;color:inherit;background:var(--dsw-specific-sidebar-fill,#8882);padding:6px 12px;border:1px solid #8886;border-radius:6px;cursor:pointer}.theone-tasks button:disabled{opacity:.5;cursor:default}.theone-task{padding:16px;margin-top:16px;border:1px solid #8885;border-radius:12px;overflow-wrap:anywhere}.theone-task h3{margin-top:0}.theone-task-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.theone-task p{white-space:pre-wrap}.theone-tasks a{color:var(--dsw-alias-label-link,#529bdb)}`
