import assert from 'node:assert/strict'
import { test } from 'node:test'

import { formatSessionSummary, summarizeSessions } from '../src/client/ui.ts'

test('session summary separates agent kinds from status counts', () => {
  const counts = summarizeSessions([
    { agent: 'codex', status: 'working' },
    { agent: 'codex', status: 'waiting' },
    { agent: 'claude', status: 'working' },
    { agent: 'claude', status: 'idle' },
    { agent: 'shell', status: 'shell' },
  ])

  assert.deepEqual(counts, {
    working: { codex: 1, claude: 1 },
    waiting: { codex: 1, claude: 0 },
    idle: { codex: 0, claude: 1 },
    shell: 1,
  })
  assert.equal(
    formatSessionSummary(counts),
    'codex/claude — working 1/1 · waiting 1/0 · idle 0/1 · shell 1',
  )
})

test('session summary keeps zero-value agent counts visible', () => {
  const counts = summarizeSessions([])

  assert.equal(
    formatSessionSummary(counts),
    'codex/claude — working 0/0 · waiting 0/0 · idle 0/0 · shell 0',
  )
})
