import test from 'node:test'
import assert from 'node:assert/strict'
import { bindingProposal } from './bindings.mjs'
const live = ['a', 'b']
const snapshot = {
  messages: [{ messageId: 'reply-a', sessionId: 's', topicId: 'a', source: 'foreground' },
             { messageId: 'notice-b', sessionId: 's', topicId: 'b', source: 'background' }],
  pending: [{ id: 'qa', topicId: 'a', basis: 'host-request', kind: 'question' },
            { id: 'qb', topicId: 'b', basis: 'host-request', kind: 'question' },
            { id: 'guess', topicId: 'b', basis: 'question-form', kind: 'question' }],
  focus: { topicId: 'b' },
}
test('an explicit trusted reply binds to its resolved source despite background focus', () => {
  assert.deepEqual(bindingProposal({ replyTo: { sessionId: 's', messageId: 'reply-a', trusted: true } }, snapshot, live), { topicId: 'a', basis: ['explicit-reply'] })
})
test('two pending questions require the exact host request identity', () => {
  assert.deepEqual(bindingProposal({ requestId: 'qa', trustedHostResponse: true }, snapshot, live), { topicId: 'a', basis: ['host-request'] })
  assert.equal(bindingProposal({}, snapshot, live), undefined)
})
test('same-round steering requires a trusted active round binding', () => {
  assert.deepEqual(bindingProposal({ steering: { trusted: true, roundId: 'r', activeRoundId: 'r', topicId: 'a' } }, snapshot, live), { topicId: 'a', basis: ['same-round-steering'] })
  assert.equal(bindingProposal({ steering: { trusted: true, roundId: 'old', activeRoundId: 'r', topicId: 'a' } }, snapshot, live), undefined)
})
test('conflicting explicit owners abstain instead of silently taking precedence', () => {
  assert.equal(bindingProposal({ replyTo: { sessionId: 's', messageId: 'reply-a', trusted: true }, requestId: 'qb', trustedHostResponse: true }, snapshot, live), undefined)
})
test('untrusted references, question-form guesses, and background notices cannot bind', () => {
  assert.equal(bindingProposal({ replyTo: { sessionId: 's', messageId: 'reply-a' } }, snapshot, live), undefined)
  assert.equal(bindingProposal({ requestId: 'guess', trustedHostResponse: true }, snapshot, live), undefined)
  assert.equal(bindingProposal({ replyTo: { sessionId: 's', messageId: 'notice-b', trusted: true } }, snapshot, live), undefined)
})
test('stale topics and cross-session message identities cannot bind', () => {
  assert.equal(bindingProposal({ replyTo: { sessionId: 's', messageId: 'reply-a', trusted: true } }, snapshot, ['b']), undefined)
  assert.equal(bindingProposal({ replyTo: { sessionId: 'other', messageId: 'reply-a', trusted: true } }, snapshot, live), undefined)
})