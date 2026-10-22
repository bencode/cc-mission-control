import assert from 'node:assert/strict'
import { test } from 'node:test'

import { normalizeTty, parseAgentProcesses } from '../src/processes.ts'

test('normalizeTty strips /dev prefix', () => {
  assert.equal(normalizeTty('/dev/ttys000'), 'ttys000')
  assert.equal(normalizeTty('ttys001'), 'ttys001')
})

test('parseAgentProcesses maps exact codex and claude commands by tty', () => {
  // A standalone session is its own process-group leader (pid === pgid).
  const agents = parseAgentProcesses([
    '23386 23386 ttys000 codex',
    '7817 7817 ttys001 /Users/me/.local/bin/claude',
    '95535 95535 ttys007 node',
  ].join('\n'))

  assert.equal(agents.get('ttys000'), 'codex')
  assert.equal(agents.get('ttys001'), 'claude')
  assert.equal(agents.has('ttys007'), false)
})

test('parseAgentProcesses prefers the foreground group leader on a shared tty', () => {
  // Claude spawns a codex subprocess (code mode): same tty, claude is the pgid leader.
  const leaderFirst = parseAgentProcesses([
    '5956 5956 ttys003 /Users/me/.local/bin/claude',
    '5988 5956 ttys003 /Users/me/.local/bin/codex',
  ].join('\n'))
  assert.equal(leaderFirst.get('ttys003'), 'claude')

  // Order-independent: the leader still wins if the child is listed first.
  const childFirst = parseAgentProcesses([
    '5988 5956 ttys003 /Users/me/.local/bin/codex',
    '5956 5956 ttys003 /Users/me/.local/bin/claude',
  ].join('\n'))
  assert.equal(childFirst.get('ttys003'), 'claude')
})

test('parseAgentProcesses ignores command arguments that merely mention agents', () => {
  const agents = parseAgentProcesses([
    '81215 81213 ttys004 rg codex',
    '81216 81213 ttys005 node /tmp/claude-helper.js',
    '81217 81213 ?? codex',
    '81218 81213 ttys006 rg pi',
    '81219 81213 ttys007 node /tmp/pi-helper.js',
    '81220 81220 ?? pi',
  ].join('\n'))

  assert.equal(agents.size, 0)
})

test('parseAgentProcesses detects pi sessions, including launcher-owned groups', () => {
  const agents = parseAgentProcesses([
    '52054 52054 ttys035 pi',
    '63766 63765 ttys036 pi',
    '64000 64000 ttys037 /Users/me/.local/bin/pi',
    '64001 64000 ttys037 codex',
  ].join('\n'))

  assert.deepEqual([...agents], [
    ['ttys035', 'pi'],
    ['ttys036', 'pi'],
    ['ttys037', 'pi'],
  ])
})
