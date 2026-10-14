import { createElement as h, useEffect, useRef, useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { CatalogContext, CatalogSnapshot, LinkageSnapshot, TopicGroup } from './catalog-types.ts'
import type { RouteView } from './types.ts'
import type { TheOneLocaleKey } from './client-locales.ts'
import type { ClientRuntime } from './client-runtime.ts'

export function createCatalogPanel(rt: ClientRuntime) {
  const { ctx, t, useText, localeSnapshot, lifetime, navigation, openFeedbackDialog } = rt
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
                h('h3', null, topic.title, topic.topicStatus && topic.topicStatus !== 'active'
                  ? h('span', { className: `theone-tag theone-status-${topic.topicStatus}` }, t(`topic.status.${topic.topicStatus}` as TheOneLocaleKey)) : null),
                topic.summary && topic.summary.trim() !== topic.title.trim() ? h('p', { className: 'theone-topic-summary' }, topic.summary) : null,
                topic.hidden ? h('p', { className: 'theone-topic-warning' }, t(topic.hidden === 'archived' ? 'topic.hiddenArchived' : 'topic.hiddenOrphaned')) : null,
                topic.lastState || constraints || topic.projectInfo || (links && !open) ? h('dl', { className: 'theone-topic-meta' },
                  topic.projectInfo ? [h('dt', { key: 'p' }, label(t('topic.project'))), h('dd', { key: 'pv', title: topic.projectInfo.path }, topic.projectInfo.name)] : null,
                  topic.lastState ? [h('dt', { key: 's' }, label(t('topic.state'))), h('dd', { key: 'sv' }, topic.lastState)] : null,
                  constraints ? [h('dt', { key: 'c' }, label(t('topic.constraints'))), h('dd', { key: 'cv' }, constraints)] : null,
                  open ? null : links) : null),
              h('div', { className: 'theone-topic-actions' },
                // A hidden topic has nothing left to continue: its conversations are gone or archived.
                h('button', { type: 'button', className: 'theone-continue', disabled: !!busy || !!topic.hidden, title: topic.hidden ? t('topic.continueHidden') : undefined,
                  onClick: () => { void continueTopic(id) } }, t(busy === id ? 'topic.opening' : 'topic.continue'), h('span', { 'aria-hidden': true }, ' →')),
                h('button', { type: 'button', className: 'theone-quiet', 'aria-expanded': open, onClick: () => setManaging(current => current === id ? undefined : id) }, t(open ? 'manage.close' : 'manage.open')),
                topic.hidden ? null : h('button', { type: 'button', className: 'theone-quiet', disabled: !!busy,
                  onClick: () => { void post('/api/theone/topics', { action: 'status', id, done: topic.topicStatus !== 'done' }) } },
                  t(topic.topicStatus === 'done' ? 'topic.reopen' : 'topic.markDone')),
                ...(topic.hidden === 'orphaned' ? [] : topic.sourceSessionIds).slice(0, 3).map((sessionId, i) => h('button', { key: sessionId, type: 'button', className: 'theone-quiet',
                  onClick: () => { ctx.layout.beginNavigation(); ctx.uiWorkspace.openSession(sessionId as SessionId) } }, t('topic.source') + (topic.sourceSessionIds.length > 1 ? ' ' + (i + 1) : '')))),
              open ? h('div', { className: 'theone-topic-edit' }, links,
                h(TopicManager, { key: `${id}:${topic.title}:${topic.summary}:${constraints}`, topic, constraints, groups: snapshot!.groups, contexts: snapshot!.contexts, post, busy: !!busy })) : null)]
          })))))
    )
  }

  return CatalogPanel
}
