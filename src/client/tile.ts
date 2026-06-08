import { CanvasAddon } from '@xterm/addon-canvas'
import { Terminal } from '@xterm/xterm'

import type { PaneSnapshot, SessionStatus } from '../types.ts'
import { createActionButtons, displayTitle, el, type SendHandler } from './ui.ts'

const TILE_WIDTH = 480

const TERMINAL_THEME = {
  background: '#0d1117',
  foreground: '#c9d1d9',
}

export type Tile = {
  root: HTMLElement
  /** Update the header (always) and the screen (only while mounted). */
  update: (snapshot: PaneSnapshot) => void
  /** Create the xterm terminal and render the current screen. */
  mount: (snapshot: PaneSnapshot) => void
  /** Dispose the terminal to free its canvas compositor layers. */
  unmount: () => void
  isMounted: () => boolean
  dispose: () => void
}

export type TileHandlers = {
  onZoom: (paneId: number) => void
  onFocus: (paneId: number) => void
  onSend: SendHandler
}

/**
 * Scale the rendered terminal down so its full width fits the tile.
 * Measures the inner `.xterm-screen` element: it carries the true pixel size
 * (cols × cell width), while the outer element is clamped by the container.
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
    if (rect.width === 0) return
    const scale = TILE_WIDTH / rect.width
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
  header.append(light, title, status, actions)

  const wrap = el('div', 'screen-wrap')
  const screen = el('div', 'screen')
  wrap.appendChild(screen)
  root.append(header, wrap)

  // Terminal is created lazily on mount; placeholders carry only the header.
  let terminal: Terminal | null = null
  let size = { cols: snapshot.cols, rows: snapshot.rows }
  let currentStatus: SessionStatus | undefined

  const writeScreen = (text: string): void => {
    terminal?.reset()
    terminal?.write(text.replace(/(?:\r?\n)+$/, ''))
  }

  const renderHeader = (next: PaneSnapshot): void => {
    if (next.status !== currentStatus) {
      currentStatus = next.status
      root.className = `tile status-${next.status}`
      status.textContent = next.status
    }
    title.textContent = displayTitle(next.title)
  }

  const mount = (next: PaneSnapshot): void => {
    if (terminal) return
    size = { cols: next.cols, rows: next.rows }
    terminal = new Terminal({
      cols: next.cols,
      rows: next.rows,
      fontSize: 12,
      scrollback: 0,
      disableStdin: true,
      cursorBlink: false,
      theme: TERMINAL_THEME,
    })
    terminal.open(screen)
    terminal.loadAddon(new CanvasAddon()) // after open(), before first write()
    if (next.screen !== undefined) writeScreen(next.screen)
    fitToTile(terminal, screen, wrap)
  }

  const unmount = (): void => {
    if (!terminal) return
    terminal.dispose() // frees the canvas layers; wrap keeps its height, no reflow
    terminal = null
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
    if (next.screen !== undefined) writeScreen(next.screen)
  }

  renderHeader(snapshot)
  return { root, update, mount, unmount, isMounted: () => terminal !== null, dispose: () => terminal?.dispose() }
}
