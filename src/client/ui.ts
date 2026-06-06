export const el = (tag: string, className: string): HTMLElement => {
  const node = document.createElement(tag)
  node.className = className
  return node
}

/** Strip the status glyph (braille spinner or ✳) Claude Code prefixes to titles. */
export const displayTitle = (title: string): string => title.replace(/^[⠀-⣿✳]\s*/, '')

export type SendHandler = (paneId: number, text: string) => void

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
