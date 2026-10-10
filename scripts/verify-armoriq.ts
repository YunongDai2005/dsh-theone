import assert from 'node:assert/strict'
import { TopicGuard } from '../src/armoriq.ts'

const apiKey = process.env.ARMORIQ_API_KEY
const email = process.env.ARMORIQ_USER_EMAIL
if (!apiKey || !email) throw new Error('Set ARMORIQ_API_KEY and ARMORIQ_USER_EMAIL for a real cloud verification. No fixture fallback is used.')
const guard = new TopicGuard(email, { apiKey })
try {
  const operations = [
    { owner: 'demo-travel', target: 'demo-travel', action: 'read', expect: true },
    { owner: 'demo-travel', target: 'demo-travel', action: 'write', expect: true },
    { owner: 'demo-travel', target: 'demo-finance', action: 'read', expect: false },
    { owner: 'demo-travel', target: 'demo-finance', action: 'write', expect: false },
    { owner: 'demo-travel', target: 'demo-travel', action: 'unapproved_terminal', expect: false },
  ]
  for (const operation of operations) {
    const decision = await guard.check(operation.owner, operation.target, operation.action)
    console.log(JSON.stringify({ at: new Date().toISOString(), ...operation, ...decision }))
    assert.equal(decision.allowed, operation.expect, `Unexpected decision for ${operation.action} targeting ${operation.target}`)
    assert.equal(decision.action, operation.expect ? 'allow' : 'block')
    if (!operation.expect) assert.match(decision.reason ?? '', /tool-not-in-plan/)
  }
} finally { await guard.close() }
