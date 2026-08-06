import assert from 'node:assert/strict'
import { test } from 'node:test'

import { serializeFocusRequest } from '../src/wezterm.ts'

test('serializeFocusRequest writes the versioned expiring mailbox format', () => {
  assert.equal(
    serializeFocusRequest({ requestId: 7, paneId: 2543, expiresAtSeconds: 1_785_972_004 }),
    'v1\t7\t2543\t1785972004\n',
  )
})
