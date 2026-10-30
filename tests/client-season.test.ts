import assert from 'node:assert/strict'
import { test } from 'node:test'
import { halloween } from '../src/client-season.ts'

test('the pumpkin shows on 30 and 31 October only', () => {
  assert.equal(halloween(new Date(2026, 9, 29, 23, 59)), false)
  assert.equal(halloween(new Date(2026, 9, 30, 0, 0)), true)
  assert.equal(halloween(new Date(2026, 9, 31, 23, 59)), true)
  assert.equal(halloween(new Date(2026, 10, 1, 0, 0)), false)
  assert.equal(halloween(new Date(2027, 9, 30, 12)), true)
})
