import { CanvasAddon } from '@xterm/addon-canvas'
import { Terminal } from '@xterm/xterm'

import type { PaneSnapshot } from '../types.ts'
import { createActionButtons, displayTitle, el, type SendHandler } from './ui.ts'

const FONT_SIZE = 14
const VIEWPORT_MARGIN = 56
const HEADER_HEIGHT = 44

const TERMINAL_THEME = {
  background: '#0d1117',
  foreground: '#c9d1d9',
}

export type ZoomHandlers = {
  onFocus: (paneId: number) => void
  onSend: SendHandler
}

export type Zoom = {
  open: (snapshot: PaneSnapshot, screen: string | undefined) => void
  update: (snapshot: PaneSnapshot) => void
  close: () => void
  openPaneId: () => number | null
}

const writeScreen = (terminal: Terminal, screen: string): void => {
  terminal.reset()
  terminal.write(screen.replace(/(?:\r?\n)+$/, ''))
}

/** Scale the full-size terminal down just enough to fit the viewport. */
const fitToViewport = (terminal: Terminal, screen: HTMLElement, body: HTMLElement): void => {
  requestAnimationFrame(() => {
    const rendered = terminal.element?.querySelector<HTMLElement>('.xterm-screen')
    if (!rendered) return
    // getBoundingClientRect: the canvas renderer sizes glyphs onto an inner
    // canvas, so .xterm-screen's offsetWidth is unreliable; its rect is not.
    const rect = rendered.getBoundingClientRect()
    if (rect.width === 0) return
    const maxWidth = window.innerWidth - VIEWPORT_MARGIN * 2
    const maxHeight = window.innerHeight - VIEWPORT_MARGIN * 2 - HEADER_HEIGHT
    const scale = Math.min(maxWidth / rect.width, maxHeight / rect.height, 1)
    screen.style.transform = `scale(${scale})`
    body.style.width = `${Math.round(rect.width * scale)}px`
    body.style.height = `${Math.round(rect.height * scale)}px`
  })
}

export const createZoom = (handlers: ZoomHandlers): Zoom => {
  const backdrop = el('div', 'zoom-backdrop hidden')
  const panel = el('article', 'zoom-panel')
  const header = el('header', 'tile-header')
  const light = el('span', 'light')
  const title = el('span', 'title')
  const statusLabel = el('span', 'status-label')
  const body = el('div', 'zoom-body')
  const screen = el('div', 'screen')

  body.appendChild(screen)
  panel.append(header, body)
  backdrop.appendChild(panel)
  document.body.appendChild(backdrop)

  let terminal: Terminal | null = null
  let paneId: number | null = null

  const close = (): void => {
    backdrop.classList.add('hidden')
    document.removeEventListener('keydown', onKeydown, true)
    terminal?.dispose()
    terminal = null
    paneId = null
  }

  // Capture phase: xterm's helper textarea steals focus and swallows
  // bubbling key events, so Escape must be intercepted before it.
  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') close()
  }

  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close()
  })

  /** Always-visible controls; `.actions` (Approve/Esc) shows only for waiting panes. */
  const buildHeader = (snapshot: PaneSnapshot): void => {
    const actions = createActionButtons(snapshot.paneId, handlers.onSend)
    const controls = el('span', 'zoom-controls')
    const focusButton = el('button', 'action focus')
    focusButton.textContent = '⧉ Open in WezTerm'
    focusButton.addEventListener('click', () => handlers.onFocus(snapshot.paneId))
    const closeButton = el('button', 'action close')
    closeButton.textContent = '✕'
    closeButton.addEventListener('click', close)
    controls.append(focusButton, closeButton)
    header.replaceChildren(light, title, statusLabel, actions, controls)
  }

  const applyState = (snapshot: PaneSnapshot): void => {
    panel.className = `zoom-panel status-${snapshot.status}`
    title.textContent = `${snapshot.workspace} · ${displayTitle(snapshot.title)}`
    statusLabel.textContent = snapshot.status
  }

  const open = (snapshot: PaneSnapshot, lastScreen: string | undefined): void => {
    if (terminal) close()
    paneId = snapshot.paneId
    terminal = new Terminal({
      cols: snapshot.cols,
      rows: snapshot.rows,
      fontSize: FONT_SIZE,
      scrollback: 0,
      disableStdin: true,
      cursorBlink: false,
      theme: TERMINAL_THEME,
    })
    screen.replaceChildren()
    screen.style.transform = ''
    terminal.open(screen)
    terminal.loadAddon(new CanvasAddon()) // after open(), before first write()
    if (lastScreen !== undefined) writeScreen(terminal, lastScreen)
    buildHeader(snapshot)
    applyState(snapshot)
    fitToViewport(terminal, screen, body)
    backdrop.classList.remove('hidden')
    terminal.blur()
    document.addEventListener('keydown', onKeydown, true)
  }

  const update = (snapshot: PaneSnapshot): void => {
    if (terminal === null || snapshot.paneId !== paneId) return
    applyState(snapshot)
    if (snapshot.screen !== undefined) writeScreen(terminal, snapshot.screen)
  }

  return { open, update, close, openPaneId: () => paneId }
}
