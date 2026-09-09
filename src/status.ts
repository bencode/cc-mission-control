import type { AgentKind, SessionStatus } from './types.ts'

/**
 * Claude Code reflects its state in the pane title it sets:
 *   "⠐ task-name"  — a legacy braille spinner frame while the agent is working
 *   "◐ task-name"  — a current two-frame spinner while the agent is working
 *   "✳ task-name"  — idle (waiting for the user or between turns)
 * Anything else is treated as a plain shell pane.
 */
const BRAILLE_START = 0x2800
const BRAILLE_END = 0x28ff
const IDLE_MARKER = '✳'
const CODEX_ACTION_REQUIRED = /^\[\s*[!.]\s*\]\s*Action Required(?:\s*\|.*)?\s*$/

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
 * When Claude Code is blocked on user input — permission dialogs, plan
 * approval, AskUserQuestion — it renders a numbered option list with the `❯`
 * selection cursor on the active option. That cursor is the reliable signal:
 * prose Claude types into a finished reply ("Do you want me to… 1. … 2. …")
 * has no cursor, so matching it avoids reading a completed turn as "waiting"
 * just because its conversational text is still on screen.
 */
const WAITING_CURSOR = /❯\s+\d+\./
const CODEX_WAITING_CURSOR = /^\s*›\s+\d+\./m
const CODEX_WAITING_FOOTER = /\benter to (?:submit answer|select|confirm)\b/i

// The live dialog is anchored to the bottom of the pane; a resolved one scrolls
// up and collapses. Scanning only the tail keeps a stale cursor above from
// reading as waiting.
const TAIL_LINES = 30

const tail = (text: string): string => text.split('\n').slice(-TAIL_LINES).join('\n')

const isCodexWaitingScreen = (text: string): boolean => {
  const visibleTail = tail(text)
  return CODEX_WAITING_CURSOR.test(visibleTail) && CODEX_WAITING_FOOTER.test(visibleTail)
}

const isBrailleSpinner = (char: string): boolean => {
  const code = char.codePointAt(0) ?? 0
  return code >= BRAILLE_START && code <= BRAILLE_END
}

const isClaudeWorkingTitle = (title: string): boolean =>
  isBrailleSpinner(title.charAt(0)) || title.startsWith('◐') || title.startsWith('◑')

export const isClaudePane = (title: string): boolean =>
  title.startsWith(IDLE_MARKER) || isClaudeWorkingTitle(title)

export const isCodexActionRequiredTitle = (title: string): boolean =>
  CODEX_ACTION_REQUIRED.test(title)

export const detectAgent = (
  title: string,
  processAgent?: Exclude<AgentKind, 'shell'>,
): AgentKind => {
  if (processAgent) return processAgent
  if (isCodexActionRequiredTitle(title)) return 'codex'
  return isClaudePane(title) ? 'claude' : 'shell'
}

/**
 * Derive a session status from the pane title and its visible screen text.
 * `screenText` must already be stripped of ANSI escapes.
 */
export const detectStatus = (agent: AgentKind, title: string, screenText: string): SessionStatus => {
  if (agent === 'shell') return 'shell'

  if (agent === 'codex') {
    if (isCodexActionRequiredTitle(title) || isCodexWaitingScreen(screenText)) return 'waiting'
    return isBrailleSpinner(title.charAt(0)) ? 'working' : 'idle'
  }

  if (isClaudeWorkingTitle(title)) return 'working'
  if (!title.startsWith(IDLE_MARKER)) return 'idle'
  return WAITING_CURSOR.test(tail(screenText)) ? 'waiting' : 'idle'
}
