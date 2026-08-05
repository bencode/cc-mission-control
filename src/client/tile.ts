import { CanvasAddon } from '@xterm/addon-canvas'
import { Terminal } from '@xterm/xterm'

import type { AgentKind, PaneSnapshot, SessionStatus } from '../types.ts'
import { createScreenWriter } from './screen-writer.ts'
import { createActionButtons, createCloseButton, displayTitle, el, type CloseHandler, type SendHandler } from './ui.ts'

// Tiles are scaled down to their card width anyway, so render at a small font:
// the canvas backing store scales with fontSize, making mounts and compositing
// cheaper. The zoom view renders its own terminal at a readable size.
const TILE_FONT_SIZE = 9

const TERMINAL_THEME = {
  background: '#0d1117',
  foreground: '#c9d1d9',
}

export type Tile = {
  root: HTMLElement
  /** Update the header (always) and the screen (only while mounted). */
  update: (snapshot: PaneSnapshot) => void
  /** Optimistically toggle the focus ring; the next SSE snapshot corrects it. */
  setActive: (active: boolean) => void
  /** Create the xterm terminal and render the current screen. */
  mount: (snapshot: PaneSnapshot) => void
  /** Dispose the terminal to free its canvas compositor layers. */
  unmount: () => void
  /** Re-scale to the current card width (after a column-count or window resize). */
  refit: () => void
  isMounted: () => boolean
  dispose: () => void
}

export type TileHandlers = {
  onZoom: (paneId: number) => void
  onFocus: (paneId: number) => void
  onSend: SendHandler
  onClose: CloseHandler
}

/**
 * Scale the rendered terminal down so its full width fits the tile.
 * Measures the inner `.xterm-screen` element: it carries the true pixel size
 * (cols × cell width), while the outer element is clamped by the container.
 * The target width is the card's own width (`wrap.clientWidth`), so tiles
 * re-fit to whatever the grid hands them as the column count or window changes.
 */
const fitToTile = (terminal: Terminal, screen: HTMLElement, wrap: HTMLElement): void => {
  // Clear any prior transform so the measured rect is the unscaled render size.
  screen.style.transform = ''
  requestAnimationFrame(() => {
    const rendered = terminal.element?.querySelector<HTMLElement>('.xterm-screen')
    if (!rendered) return
    // getBoundingClientRect: the canvas renderer no longer sizes .xterm-screen
    // via offsetWidth, but its layout box still reflects cols × cellWidth.
    const rect = rendered.getBoundingClientRect()
    const target = wrap.clientWidth
    if (rect.width === 0 || target === 0) return
    const scale = target / rect.width
    screen.style.transform = `scale(${scale})`
    wrap.style.height = `${Math.round(rect.height * scale)}px`
  })
}

export const createTile = (snapshot: PaneSnapshot, handlers: TileHandlers): Tile => {
  const root = el('article', 'tile')
  root.dataset.paneId = String(snapshot.paneId)
  root.title = '点击切到终端'
  root.addEventListener('click', () => handlers.onFocus(snapshot.paneId))

  const header = el('header', 'tile-header')
  const light = el('span', 'light')
  const title = el('span', 'title')
  title.title = '点击放大'
  title.addEventListener('click', (event) => {
    event.stopPropagation()
    handlers.onZoom(snapshot.paneId)
  })
  const status = el('span', 'status-label')
  const actions = createActionButtons(snapshot.paneId, handlers.onSend)
  const closeButton = createCloseButton(snapshot.paneId, handlers.onClose)
  header.append(light, title, status, actions, closeButton)

  const wrap = el('div', 'screen-wrap')
  const screen = el('div', 'screen')
  wrap.appendChild(screen)
  root.append(header, wrap)

  // Terminal is created lazily on mount; placeholders carry only the header.
  let terminal: Terminal | null = null
  const writer = createScreenWriter(() => terminal)
  let size = { cols: snapshot.cols, rows: snapshot.rows }
  let currentAgent: AgentKind | undefined
  let currentStatus: SessionStatus | undefined
  let currentActive: boolean | undefined

  const renderHeader = (next: PaneSnapshot): void => {
    const active = next.active ?? false
    if (next.agent !== currentAgent || next.status !== currentStatus || active !== currentActive) {
      currentAgent = next.agent
      currentStatus = next.status
      currentActive = active
      root.className = `tile status-${next.status} agent-${next.agent}${active ? ' active' : ''}`
      status.textContent = next.agent === 'shell' ? next.status : `${next.agent} ${next.status}`
    }
    title.textContent = displayTitle(next.title)
  }

  // Optimistic focus ring for click-to-focus: flip active without waiting for a poll.
  // renderHeader owns the canonical className and overwrites this on the next SSE event
  // (it recomputes the same string, so a successful focus won't flicker; a failed one
  // self-corrects within a tick).
  const setActive = (active: boolean): void => {
    if (active === currentActive) return
    currentActive = active
    const status = currentStatus ?? snapshot.status
    const agent = currentAgent ?? snapshot.agent
    root.className = `tile status-${status} agent-${agent}${active ? ' active' : ''}`
  }

  const mount = (next: PaneSnapshot): void => {
    if (terminal) return
    size = { cols: next.cols, rows: next.rows }
    terminal = new Terminal({
      cols: next.cols,
      rows: next.rows,
      fontSize: TILE_FONT_SIZE,
      scrollback: 0,
      disableStdin: true,
      cursorBlink: false,
      theme: TERMINAL_THEME,
    })
    terminal.open(screen)
    terminal.loadAddon(new CanvasAddon()) // after open(), before first write()
    if (next.screen !== undefined) writer.write(next.screen)
    fitToTile(terminal, screen, wrap)
  }

  const unmount = (): void => {
    if (!terminal) return
    terminal.dispose() // frees the canvas layers; wrap keeps its height, no reflow
    terminal = null
    writer.reset() // the disposed terminal's write callback will never fire
    screen.replaceChildren()
    screen.style.transform = ''
  }

  const update = (next: PaneSnapshot): void => {
    renderHeader(next) // header stays live even while unmounted
    if (!terminal) return
    if (next.cols !== size.cols || next.rows !== size.rows) {
      size = { cols: next.cols, rows: next.rows }
      terminal.resize(next.cols, next.rows)
      fitToTile(terminal, screen, wrap)
    }
    if (next.screen !== undefined) writer.write(next.screen)
  }

  const refit = (): void => {
    if (terminal) fitToTile(terminal, screen, wrap)
  }

  renderHeader(snapshot)
  return { root, update, setActive, mount, unmount, refit, isMounted: () => terminal !== null, dispose: () => terminal?.dispose() }
}
