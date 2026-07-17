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
    ['✓ Approve', '1', 'approve'],
    ['✗ Esc', '\x1b', 'dismiss'],
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
 * click arms it (✕ → 确认?), a second click within the window kills, and it
 * auto-disarms after a timeout so a stray click never lingers in the armed state.
 */
export const createCloseButton = (paneId: number, onClose: CloseHandler, label = '✕'): HTMLElement => {
  const button = el('button', 'action kill')
  button.textContent = label
  button.title = '关闭 session'
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
    button.textContent = '确认?'
    timer = window.setTimeout(disarm, 3000)
  })
  return button
}
