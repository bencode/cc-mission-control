import type { AgentKind, PaneSnapshot, SessionStatus } from '../types.ts'

type AgentStatus = Exclude<SessionStatus, 'shell'>
type AgentKindCount = Record<Exclude<AgentKind, 'shell'>, number>

export type SessionSummaryCounts = Record<AgentStatus, AgentKindCount> & { shell: number }

type SummarySnapshot = Pick<PaneSnapshot, 'agent' | 'status'>

export const summarizeSessions = (snapshots: Iterable<SummarySnapshot>): SessionSummaryCounts => {
  const counts: SessionSummaryCounts = {
    working: { codex: 0, claude: 0 },
    waiting: { codex: 0, claude: 0 },
    idle: { codex: 0, claude: 0 },
    shell: 0,
  }
  for (const snapshot of snapshots) {
    if (snapshot.status === 'shell') {
      counts.shell++
    } else if (snapshot.agent !== 'shell') {
      counts[snapshot.status][snapshot.agent]++
    }
  }
  return counts
}

export const STATUS_LABEL: Record<SessionStatus, string> = {
  waiting: 'Waiting', working: 'Working', idle: 'Idle', shell: 'Shell',
}
export const AGENT_LABEL: Record<AgentKind, string> = { codex: 'Codex', claude: 'Claude', shell: 'Shell' }

export const updateSessionSummary = (
  root: HTMLElement,
  counts: SessionSummaryCounts,
  selected: SessionStatus | 'all',
  showShells: boolean,
): void => {
  const statuses = ['all', 'waiting', 'working', 'idle', 'shell'] as const
  const total = (status: AgentStatus): number => counts[status].codex + counts[status].claude
  statuses.forEach((status) => {
    let button = root.querySelector<HTMLButtonElement>(`[data-status="${status}"]`)
    if (!button) {
      button = document.createElement('button')
      button.type = 'button'
      button.dataset.status = status
      button.className = `stat stat-${status}`
      const label = el('span', 'stat-label')
      label.textContent = status === 'all' ? 'All' : STATUS_LABEL[status]
      button.append(label, el('span', 'num'))
      root.append(button)
    }
    const number = status === 'all'
      ? total('waiting') + total('working') + total('idle') + (showShells ? counts.shell : 0)
      : status === 'shell' ? counts.shell : total(status)
    button.querySelector('.num')!.textContent = String(number)
    button.hidden = status === 'shell' && !showShells
    button.classList.toggle('zero', number === 0)
    button.setAttribute('aria-pressed', String(status === selected))
    button.title = status === 'all' || status === 'shell' ? ''
      : `Codex ${counts[status].codex} · Claude ${counts[status].claude}`
  })
}

export const actionButton = (label: string, onClick: () => void, className = ''): HTMLButtonElement => {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = `action ${className}`.trim()
  button.textContent = label
  button.addEventListener('click', (event) => {
    event.stopPropagation()
    onClick()
  })
  return button
}

export const el = (tag: string, className: string): HTMLElement => {
  const node = document.createElement(tag)
  node.className = className
  return node
}

/** Strip agent status prefixes from terminal titles. */
export const displayTitle = (title: string): string =>
  title
    .replace(/^\[\s*.\s*\]\s*Action Required\s*\|\s*/, '')
    .replace(/^[⠀-⣿✳]\s*/, '')

export type SendHandler = (paneId: number, text: string) => void

export type CloseHandler = (paneId: number) => void

/**
 * Approve / Esc buttons for sessions blocked on a confirmation prompt.
 * Visibility is controlled by the `.status-waiting .actions` CSS rule.
 */
export const createActionButtons = (paneId: number, onSend: SendHandler): HTMLElement => {
  const actions = el('span', 'actions')
  const buttons: Array<[string, string, string]> = [
    ['Approve (send 1)', '1', 'approve'],
    ['Send Esc', '\x1b', 'dismiss'],
  ]
  for (const [label, text, kind] of buttons) {
    const button = el('button', `action ${kind}`)
    button.textContent = label
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      onSend(paneId, text)
    })
    actions.appendChild(button)
  }
  return actions
}

/**
 * A ✕ that kills the pane, guarded by an inline two-step confirm: the first
 * click arms it (Close session → Confirm close?), a second click within the window kills, and it
 * auto-disarms after a timeout so a stray click never lingers in the armed state.
 */
export const createCloseButton = (paneId: number, onClose: CloseHandler, label = 'Close session'): HTMLElement => {
  const button = el('button', 'action kill')
  button.textContent = label
  button.title = 'Close session'
  let timer = 0
  const disarm = (): void => {
    timer = 0
    button.classList.remove('armed')
    button.textContent = label
  }
  button.addEventListener('click', (event) => {
    event.stopPropagation() // don't trigger the tile's focus click
    if (timer) {
      clearTimeout(timer)
      disarm()
      onClose(paneId)
      return
    }
    button.classList.add('armed')
    button.textContent = 'Confirm close?'
    timer = window.setTimeout(disarm, 3000)
  })
  return button
}
