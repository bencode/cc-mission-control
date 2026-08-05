import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Terminal } from '@xterm/xterm'

import { createScreenWriter } from '../src/client/screen-writer.ts'

const createFakeTerminal = () => {
  const writes: string[] = []
  const callbacks: (() => void)[] = []
  const terminal = {
    reset: () => {},
    write: (text: string, callback?: () => void) => {
      writes.push(text)
      if (callback) callbacks.push(callback)
    },
  } as unknown as Terminal
  return { writes, callbacks, terminal }
}

test('screen writer coalesces updates while a write is in flight', () => {
  const { writes, callbacks, terminal } = createFakeTerminal()
  const writer = createScreenWriter(() => terminal)

  writer.write('one')
  writer.write('two')
  writer.write('three')
  assert.deepEqual(writes, ['one']) // nothing more reaches xterm until the first write parses

  callbacks.shift()?.()
  assert.deepEqual(writes, ['one', 'three']) // superseded screens never parse at all
})

test('screen writer reset unblocks writes after the terminal is disposed', () => {
  const { writes, terminal } = createFakeTerminal()
  const writer = createScreenWriter(() => terminal)

  writer.write('one')
  writer.write('two')
  writer.reset() // disposed terminal's callback never fires; without reset every later write would queue forever
  writer.write('three')

  assert.deepEqual(writes, ['one', 'three'])
})
