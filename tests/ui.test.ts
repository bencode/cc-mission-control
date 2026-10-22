import assert from 'node:assert/strict'
import { test } from 'node:test'

import { summarizeSessions } from '../src/client/ui.ts'

test('session summary separates agent kinds from status counts', () => {
  const counts = summarizeSessions([
    { agent: 'codex', status: 'working' },
    { agent: 'codex', status: 'waiting' },
    { agent: 'claude', status: 'working' },
    { agent: 'claude', status: 'idle' },
    { agent: 'pi', status: 'working' },
    { agent: 'pi', status: 'idle' },
    { agent: 'pi', status: 'idle' },
    { agent: 'shell', status: 'shell' },
  ])

  assert.deepEqual(counts, {
    working: { codex: 1, claude: 1, pi: 1 },
    waiting: { codex: 1, claude: 0, pi: 0 },
    idle: { codex: 0, claude: 1, pi: 2 },
    shell: 1,
  })
})

test('session summary initializes all buckets to zero', () => {
  assert.deepEqual(summarizeSessions([]), {
    working: { codex: 0, claude: 0, pi: 0 },
    waiting: { codex: 0, claude: 0, pi: 0 },
    idle: { codex: 0, claude: 0, pi: 0 },
    shell: 0,
  })
})
