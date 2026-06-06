import type { SessionStatus } from './types.ts'

/**
 * Claude Code reflects its state in the pane title it sets:
 *   "⠐ task-name"  — a braille spinner frame while the agent is working
 *   "✳ task-name"  — idle (waiting for the user or between turns)
 * Anything else is treated as a plain shell pane.
 */
const BRAILLE_START = 0x2800
const BRAILLE_END = 0x28ff
const IDLE_MARKER = '✳'

const ANSI_PATTERN = new RegExp(
  [
    '\\x1b\\[[0-9;:?]*[ -/]*[@-~]', // CSI sequences (colors, cursor movement)
    '\\x1b\\][^\\x07\\x1b]*(?:\\x07|\\x1b\\\\)', // OSC sequences (titles, hyperlinks)
    '\\x1b[()][0-9A-Za-z]', // charset selection
    '\\x1b[=>]', // keypad modes
  ].join('|'),
  'g',
)

export const stripAnsi = (text: string): string => text.replace(ANSI_PATTERN, '')

/**
 * Patterns that appear on screen when Claude Code is blocked on user input:
 * permission dialogs, plan approval, and AskUserQuestion all render a
 * numbered option list with a selection cursor.
 */
const WAITING_PATTERNS = [
  /❯\s+1\./,
  /Do you want/,
  /Would you like/,
]

const isBrailleSpinner = (char: string): boolean => {
  const code = char.codePointAt(0) ?? 0
  return code >= BRAILLE_START && code <= BRAILLE_END
}

export const isClaudePane = (title: string): boolean =>
  title.startsWith(IDLE_MARKER) || isBrailleSpinner(title.charAt(0))

/**
 * Derive a session status from the pane title and its visible screen text.
 * `screenText` must already be stripped of ANSI escapes.
 */
export const detectStatus = (title: string, screenText: string): SessionStatus => {
  if (isBrailleSpinner(title.charAt(0))) return 'working'
  if (!title.startsWith(IDLE_MARKER)) return 'shell'
  return WAITING_PATTERNS.some((p) => p.test(screenText)) ? 'waiting' : 'idle'
}
