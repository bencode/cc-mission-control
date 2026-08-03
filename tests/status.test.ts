import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { detectAgent, detectStatus, isClaudePane, stripAnsi } from '../src/status.ts'
import { displayTitle } from '../src/client/ui.ts'

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

test('working: braille spinner title wins regardless of screen content', () => {
  assert.equal(detectStatus('claude', '⠐ add-basic-validation-checks', fixture('working.txt')), 'working')
  assert.equal(detectStatus('claude', '⠂ another-task', ''), 'working')
})

test('idle: ✳ title with a plain prompt on screen', () => {
  assert.equal(detectStatus('claude', '✳ refactor-parser-module', fixture('idle.txt')), 'idle')
})

test('waiting: ✳ title with a permission dialog on screen', () => {
  assert.equal(detectStatus('claude', '✳ some-task', fixture('waiting.txt')), 'waiting')
})

test('idle: prose with a numbered list but no selection cursor is not waiting', () => {
  const reply = [
    'Do you want to:',
    '1. Log in + publish now, or',
    '2. Have me hold while you sort npm auth?',
    '',
    '───────────────────────────────',
    '❯',
    '───────────────────────────────',
  ].join('\n')
  assert.equal(detectStatus('claude', '✳ fix-queued-message-consumption', reply), 'idle')
})

test('shell: non-Claude titles', () => {
  assert.equal(detectStatus('shell', '../work/example-project', fixture('shell.txt')), 'shell')
  assert.equal(detectStatus('shell', 'pnpm', ''), 'shell')
  assert.equal(detectStatus('shell', 'cd', ''), 'shell')
})

test('codex: action-required title is waiting', () => {
  assert.equal(detectStatus('codex', '[ . ] Action Required | yimi', ''), 'waiting')
})

test('codex: braille title is working', () => {
  assert.equal(detectStatus('codex', '⠹ cc-mission-control', ''), 'working')
})

test('codex: process match with plain project title is idle', () => {
  assert.equal(detectStatus('codex', 'cc-mission-control', ''), 'idle')
})

test('claude: process match with plain project title is idle', () => {
  assert.equal(detectStatus('claude', 'cc-mission-control', ''), 'idle')
})

test('detectAgent prefers process signals but falls back to title heuristics', () => {
  assert.equal(detectAgent('cc-mission-control', 'codex'), 'codex')
  assert.equal(detectAgent('[ . ] Action Required | yimi'), 'codex')
  assert.equal(detectAgent('✳ Claude Code'), 'claude')
  assert.equal(detectAgent('cc-mission-control'), 'shell')
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

test('displayTitle strips Claude and Codex status prefixes', () => {
  assert.equal(displayTitle('✳ Claude Code'), 'Claude Code')
  assert.equal(displayTitle('⠹ cc-mission-control'), 'cc-mission-control')
  assert.equal(displayTitle('[ . ] Action Required | yimi'), 'yimi')
})
