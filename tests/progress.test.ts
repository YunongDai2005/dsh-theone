import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { ContextStore, progressText } from '../src/store.ts'
import { harness, ask, textResponse, FixtureModel } from './harness.ts'

test('a topic keeps where it stands in three parts; its note is written from them, and a catalog re-index keeps them', () => {
  const store = new ContextStore(':memory:')
  try {
    const parts = (fingerprint: string) => [{ seq: 0, endSeq: 4, text: '', fingerprint }]
    const topic = (contextId: string | null, lastState: string) => ({ contextId, title: '论文', summary: '摘要', entities: [], keywords: [],
      lastState, turns: [0], groupId: null, groupTitle: '研究', groupSummary: '' })
    store.importTopics('source', '/tmp', parts('a'), [topic(null, '目录状态')])
    const context = store.contexts()[0]
    store.updateState(context.id, { goal: '投稿 CVPR', done: '第三章实验跑完', next: '补消融表' }, context.workingSessionId, 3)
    let after = store.contexts()[0]
    assert.deepEqual(after.progress, { goal: '投稿 CVPR', done: '第三章实验跑完', next: '补消融表' })
    assert.equal(after.lastState, '目标：投稿 CVPR\n进度：第三章实验跑完\n下一步：补消融表')
    store.importTopics('source', '/tmp', parts('b'), [topic(context.id, '目录重新抽取的状态')])
    after = store.contexts()[0]
    assert.deepEqual(after.progress, { goal: '投稿 CVPR', done: '第三章实验跑完', next: '补消融表' })
    assert.equal(after.lastState, '目标：投稿 CVPR\n进度：第三章实验跑完\n下一步：补消融表')
    // A free note replaces the parts, so the two never disagree.
    store.updateState(context.id, '改成投 ICCV 了', context.workingSessionId, 4)
    after = store.contexts()[0]
    assert.equal(after.progress, undefined)
    assert.equal(after.lastState, '改成投 ICCV 了')
    assert.throws(() => store.updateState(context.id, { goal: '', done: '', next: '' }, context.workingSessionId, 5), /Invalid/)
    assert.throws(() => store.updateState(context.id, { goal: 'x'.repeat(301), done: '', next: '' }, context.workingSessionId, 5), /Invalid/)
    assert.throws(() => store.updateState(context.id, { goal: '部署', done: 'password: hunter2', next: '' }, context.workingSessionId, 5), /credentials/)
  } finally { store.close() }
})

test('labels follow the language the parts were written in, and empty parts are left out', () => {
  assert.equal(progressText({ goal: 'Ship the invoice app', done: 'Login works', next: '' }), 'Goal: Ship the invoice app\nDone: Login works')
  assert.equal(progressText({ goal: '', done: '', next: '等用户确认预算' }), '下一步：等用户确认预算')
})

test('the topic saves its goal, progress and next step with its tool, and gets them in its briefing next time', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-progress-'))
  const model = new FixtureModel()
  let calls = 0
  model.behavior = async function* () {
    if (calls++ === 0) {
      const id = ToolCallId('state-1')
      const args = JSON.stringify({ goal: '让 Qwen 在 9070 XT 上跑起来', progress: '驱动装好了', next: '下载模型' })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'theone_update_state', arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else if (calls === 2) yield* textResponse('记下了')
    else if (calls === 3) {
      // Only the next step changes; the goal and progress stay.
      const id = ToolCallId('state-2')
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'theone_update_state', arguments: JSON.stringify({ next: '跑一次推理测试' }) } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else yield* textResponse('好')
  }
  const app = await harness(root, model)
  try {
    await ask(app.gateway, 'Qwen 显卡那个，驱动装好了')
    const topic = () => app.ctx.theone.store.contexts().find(item => item.id === 'ctx_qwen_9070xt')!
    assert.deepEqual(topic().progress, { goal: '让 Qwen 在 9070 XT 上跑起来', done: '驱动装好了', next: '下载模型' })
    await ask(app.gateway, 'Qwen 模型也下好了')
    assert.deepEqual(topic().progress, { goal: '让 Qwen 在 9070 XT 上跑起来', done: '驱动装好了', next: '跑一次推理测试' })
    // The second turn's briefing carried the three parts as they stood then.
    const briefing = model.requests[2].messages.filter(item => 'source' in item && item.source?.kind === 'theone-context').at(-1)
    const text = briefing && 'content' in briefing && Array.isArray(briefing.content) ? briefing.content.map(block => block.type === 'text' ? block.text : '').join('') : ''
    assert.match(text, /"progress":\{"goal":"让 Qwen 在 9070 XT 上跑起来","done":"驱动装好了","next":"下载模型"\}/)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})
