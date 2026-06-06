import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { detectStatus, isClaudePane, stripAnsi } from '../src/status.ts'

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

test('working: braille spinner title wins regardless of screen content', () => {
  assert.equal(detectStatus('⠐ add-basic-validation-checks', fixture('working.txt')), 'working')
  assert.equal(detectStatus('⠂ another-task', ''), 'working')
})

test('idle: ✳ title with a plain prompt on screen', () => {
  assert.equal(detectStatus('✳ refactor-parser-module', fixture('idle.txt')), 'idle')
})

test('waiting: ✳ title with a permission dialog on screen', () => {
  assert.equal(detectStatus('✳ some-task', fixture('waiting.txt')), 'waiting')
})

test('shell: non-Claude titles', () => {
  assert.equal(detectStatus('../work/example-project', fixture('shell.txt')), 'shell')
  assert.equal(detectStatus('pnpm', ''), 'shell')
  assert.equal(detectStatus('cd', ''), 'shell')
})

test('isClaudePane distinguishes Claude panes from shells', () => {
  assert.equal(isClaudePane('✳ Claude Code'), true)
  assert.equal(isClaudePane('⠂ fix-flaky-integration-test'), true)
  assert.equal(isClaudePane('~/work/example-project'), false)
})

test('stripAnsi removes CSI, OSC and charset sequences', () => {
  const colored = '\x1b[38:2::72:150:140mplan\x1b[39m \x1b(B\x1b[0mmode \x1b]0;title\x07on'
  assert.equal(stripAnsi(colored), 'plan mode on')
})
