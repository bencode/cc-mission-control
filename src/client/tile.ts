import { Terminal } from '@xterm/xterm'

import type { PaneSnapshot, SessionStatus } from '../types.ts'

const TILE_WIDTH = 480

const TERMINAL_THEME = {
  background: '#0d1117',
  foreground: '#c9d1d9',
}

export type Tile = {
  root: HTMLElement
  update: (snapshot: PaneSnapshot) => void
  dispose: () => void
}

const displayTitle = (title: string): string => title.replace(/^[⠀-⣿✳]\s*/, '')

const el = (tag: string, className: string): HTMLElement => {
  const node = document.createElement(tag)
  node.className = className
  return node
}

const buildActions = (paneId: number, onSend: (paneId: number, text: string) => void): HTMLElement => {
  const actions = el('span', 'actions')
  const buttons: Array<[string, string, string]> = [
    ['✓ Approve', '1', 'approve'],
    ['✗ Esc', '', 'dismiss'],
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
 * Scale the rendered terminal down so its full width fits the tile.
 * Measures the inner `.xterm-screen` element: it carries the true pixel size
 * (cols × cell width), while the outer element is clamped by the container.
 */
const fitToTile = (terminal: Terminal, screen: HTMLElement, wrap: HTMLElement): void => {
  requestAnimationFrame(() => {
    const rendered = terminal.element?.querySelector<HTMLElement>('.xterm-screen')
    if (!rendered || rendered.offsetWidth === 0) return
    const scale = TILE_WIDTH / rendered.offsetWidth
    screen.style.transform = `scale(${scale})`
    wrap.style.height = `${Math.round(rendered.offsetHeight * scale)}px`
  })
}

export const createTile = (
  snapshot: PaneSnapshot,
  onFocus: (paneId: number) => void,
  onSend: (paneId: number, text: string) => void,
): Tile => {
  const root = el('article', 'tile')
  root.dataset.paneId = String(snapshot.paneId)
  root.addEventListener('click', () => onFocus(snapshot.paneId))

  const header = el('header', 'tile-header')
  const light = el('span', 'light')
  const title = el('span', 'title')
  const status = el('span', 'status-label')
  const actions = buildActions(snapshot.paneId, onSend)
  header.append(light, title, status, actions)

  const wrap = el('div', 'screen-wrap')
  const screen = el('div', 'screen')
  wrap.appendChild(screen)
  root.append(header, wrap)

  const terminal = new Terminal({
    cols: snapshot.cols,
    rows: snapshot.rows,
    fontSize: 12,
    scrollback: 0,
    disableStdin: true,
    cursorBlink: false,
    theme: TERMINAL_THEME,
  })
  terminal.open(screen)

  let size = { cols: snapshot.cols, rows: snapshot.rows }
  let currentStatus: SessionStatus | undefined

  const update = (next: PaneSnapshot): void => {
    if (next.cols !== size.cols || next.rows !== size.rows) {
      size = { cols: next.cols, rows: next.rows }
      terminal.resize(next.cols, next.rows)
      fitToTile(terminal, screen, wrap)
    }
    if (next.status !== currentStatus) {
      currentStatus = next.status
      root.className = `tile status-${next.status}`
      status.textContent = next.status
    }
    title.textContent = displayTitle(next.title)
    if (next.screen !== undefined) {
      terminal.reset()
      terminal.write(next.screen.replace(/(?:\r?\n)+$/, ''))
    }
  }

  update(snapshot)
  fitToTile(terminal, screen, wrap)
  return { root, update, dispose: () => terminal.dispose() }
}
