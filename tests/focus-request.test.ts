import assert from 'node:assert/strict'
import { test } from 'node:test'

import { serializeFocusRequest } from '../src/wezterm.ts'

test('serializeFocusRequest writes the legacy single-line pane id format', () => {
  assert.equal(serializeFocusRequest(2543), '2543\n')
  assert.equal(serializeFocusRequest(2604), '2604\n')
})
