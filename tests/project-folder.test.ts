import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Storage from '@deepseek-ai/dsh-storage'
import * as JsonStorage from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { harness, textResponse, ask, FixtureModel } from './harness.ts'
import { ROUTING_PROMPT } from '../src/llm-router.ts'

const words = (options: GenerateOptions) => options.messages.filter(message => message.role === 'user')
  .map(message => message.content.filter(block => block.type === 'text').map(block => block.text).join('')).join('\n')

test('a new topic about one of the user\'s projects works in that project\'s folder, without asking', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-project-folder-'))
  const model = new FixtureModel()
  const offered: { id: string; name: string }[][] = []
  model.behavior = async function* (options) {
    if (typeof options.system === 'string' && options.system.startsWith(ROUTING_PROMPT)) {
      const payload = JSON.parse(words(options)) as { text: string; projects?: { id: string; name: string }[] }
      offered.push(payload.projects ?? [])
      // The classifier's judgment, fixed here: the invoice request is work in the invoice-app project.
      const project = /发票/.test(payload.text) ? payload.projects?.find(item => item.name === 'invoice-app')?.id ?? null : null
      yield* textResponse(JSON.stringify({ action: 'CREATE', contextId: null, title: /发票/.test(payload.text) ? '发票 PDF 导出' : '晚饭', question: null,
        reason: '测试', historyIndependent: true, candidateIds: [], relatedIds: [], projectId: project }))
      return
    }
    yield* textResponse('好')
  }
  const app = await harness(root, model, { routerMode: 'llm', autoModel: true })
  try {
    await app.ctx.plugin(Storage)
    await app.ctx.plugin(JsonStorage, { root: join(root, 'workspace-store') })
    await app.ctx.plugin(StorageDomain, { backend: 'json' })
    await app.ctx.plugin(WorkspaceRegistry)
    for (const name of ['invoice-app', 'thesis-latex']) { await mkdir(join(root, name)); await app.ctx.workspaceRegistry.create(join(root, name)) }
    const invoice = app.ctx.workspaceRegistry.list().find(workspace => workspace.path.endsWith('invoice-app'))!

    await ask(app.gateway, '给发票那个项目加一个 PDF 导出')
    // Only folder names reach the classifier.
    assert.deepEqual(offered.at(-1)!.map(project => project.name).sort(), ['invoice-app', 'thesis-latex'])
    const store = app.ctx.theone.store
    const topic = store.contexts().find(context => context.title === '发票 PDF 导出')!
    assert.equal(store.origin(topic.id)?.cwd, invoice.path)
    const sessions = await app.ctx.sessionQuery.listSessions()
    const header = sessions.find(session => session.header.id === topic.workingSessionId)?.header as { cwd?: string } | undefined
    assert.equal(header?.cwd, invoice.path)
    // It works there but is not added to the project: the user's workspace lists stay as they were.
    assert.ok(!invoice.sessionIds.includes(topic.workingSessionId as never))

    await ask(app.gateway, '今晚吃什么')
    const dinner = store.contexts().find(context => context.title === '晚饭')!
    assert.equal(store.origin(dinner.id), undefined)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('each topic knows its project, routing sees it, and a topic the user marked done reopens when a message goes to it', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-project-status-'))
  const model = new FixtureModel()
  type Offered = { id: string; title: string; project?: string; status?: string }
  const seen: Offered[][] = []
  model.behavior = async function* (options) {
    if (typeof options.system === 'string' && options.system.startsWith(ROUTING_PROMPT)) {
      const payload = JSON.parse(words(options)) as { text: string; contexts: Offered[]; projects?: { id: string; name: string }[] }
      seen.push(payload.contexts)
      const existing = payload.contexts.find(context => /发票/.test(payload.text) && context.title === '发票 PDF 导出')
      if (existing) { yield* textResponse(JSON.stringify({ action: 'EXISTING', contextId: existing.id, title: null, question: null, reason: '测试', relatedIds: [] })); return }
      const project = /发票/.test(payload.text) ? payload.projects?.find(item => item.name === 'invoice-app')?.id ?? null : null
      yield* textResponse(JSON.stringify({ action: 'CREATE', contextId: null, title: /发票/.test(payload.text) ? '发票 PDF 导出' : '晚饭', question: null,
        reason: '测试', historyIndependent: true, candidateIds: [], relatedIds: [], projectId: project }))
      return
    }
    yield* textResponse('好')
  }
  const app = await harness(root, model, { routerMode: 'llm', autoModel: true })
  try {
    await app.ctx.plugin(Storage)
    await app.ctx.plugin(JsonStorage, { root: join(root, 'workspace-store') })
    await app.ctx.plugin(StorageDomain, { backend: 'json' })
    await app.ctx.plugin(WorkspaceRegistry)
    await mkdir(join(root, 'invoice-app')); await app.ctx.workspaceRegistry.create(join(root, 'invoice-app'))
    await ask(app.gateway, '给发票那个项目加一个 PDF 导出')
    await ask(app.gateway, '今晚吃什么')
    const service = app.ctx.theone as unknown as {
      topicStates(): Map<string, { status: string; project?: { name: string; path: string } }>
      editTopics(row: Record<string, unknown>): Promise<unknown>
    }
    const store = app.ctx.theone.store
    const invoice = store.contexts().find(context => context.title === '发票 PDF 导出')!
    const dinner = store.contexts().find(context => context.title === '晚饭')!
    assert.deepEqual(service.topicStates().get(invoice.id), { status: 'active', dormant: false, activity: '刚刚', project: { name: 'invoice-app', path: join(root, 'invoice-app') } } as never)
    assert.equal(service.topicStates().get(dinner.id)?.project, undefined)
    // The classifier sees the project by name (never its path), only where there is one.
    const offered = seen.at(-1)!
    assert.equal(offered.find(context => context.id === invoice.id)?.project, 'invoice-app')
    assert.equal(offered.find(context => context.id === dinner.id)?.project, undefined)

    await service.editTopics({ action: 'status', id: invoice.id, done: true })
    assert.equal(service.topicStates().get(invoice.id)?.status, 'done')
    await ask(app.gateway, '发票导出再加一个水印')
    assert.equal(seen.at(-1)!.find(context => context.id === invoice.id)?.status, 'done')
    // A message to it takes the matter up again.
    assert.equal(service.topicStates().get(invoice.id)?.status, 'active')
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})
