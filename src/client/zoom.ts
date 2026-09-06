import { CanvasAddon } from '@xterm/addon-canvas'
import { Terminal } from '@xterm/xterm'

import type { PaneSnapshot } from '../types.ts'
import { createScreenWriter } from './screen-writer.ts'
import { actionButton, AGENT_LABEL, createActionButtons, createCloseButton, displayTitle, el, STATUS_LABEL, type CloseHandler, type SendHandler } from './ui.ts'

const FONT_SIZE = 14
const TERMINAL_THEME = { background: '#0d1117', foreground: '#c9d1d9' }

export type ZoomHandlers = {
  onFocus: (paneId: number) => void
  onSend: SendHandler
  onClose: CloseHandler
}

export type Zoom = {
  open: (snapshot: PaneSnapshot, screen: string | undefined) => void
  update: (snapshot: PaneSnapshot) => void
  close: () => void
  openPaneId: () => number | null
}

export const createZoom = (handlers: ZoomHandlers): Zoom => {
  const backdrop = document.createElement('dialog')
  backdrop.className = 'zoom-backdrop'
  backdrop.setAttribute('aria-labelledby', 'zoom-title')
  const panel = el('article', 'zoom-panel')
  const header = el('header', 'tile-header')
  const heading = el('div', 'zoom-heading')
  const light = el('span', 'light')
  light.setAttribute('aria-hidden', 'true')
  const title = el('h2', 'title')
  title.id = 'zoom-title'
  title.style.margin = '0'
  const status = el('span', 'status-label')
  heading.append(light, title, status)
  const meta = el('div', 'zoom-meta')
  const controls = el('div', 'zoom-controls')
  header.append(heading, meta, controls)
  const body = el('div', 'zoom-body')
  body.tabIndex = 0
  body.setAttribute('aria-label', 'Read-only terminal screen')
  const stage = el('div', 'screen-stage')
  const screen = el('div', 'screen')
  stage.append(screen)
  body.append(stage)
  const footer = el('footer', 'tile-footer')
  panel.append(header, body, footer)
  backdrop.append(panel)
  document.body.append(backdrop)

  let terminal: Terminal | null = null
  let paneId: number | null = null
  const writer = createScreenWriter(() => terminal)
  let frame = 0
  let following = true

  const refit = (): void => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      const rendered = terminal?.element?.querySelector<HTMLElement>('.xterm-screen')
      if (!rendered || !backdrop.open) return
      stage.style.width = `${rendered.offsetWidth}px`
      stage.style.height = `${rendered.offsetHeight}px`
      if (following) body.scrollTop = body.scrollHeight
    })
  }
  new ResizeObserver(refit).observe(body)
  body.addEventListener('scroll', () => {
    following = body.scrollHeight - body.clientHeight - body.scrollTop < 12
  })

  const close = (): void => {
    if (!backdrop.open) return
    cancelAnimationFrame(frame)
    backdrop.close()
    paneId = null
    controls.replaceChildren()
    footer.replaceChildren()
  }
  backdrop.addEventListener('cancel', (event) => { event.preventDefault(); close() })
  backdrop.addEventListener('click', (event) => { if (event.target === backdrop) close() })

  const applyState = (snapshot: PaneSnapshot): void => {
    panel.className = `zoom-panel status-${snapshot.status}`
    title.textContent = displayTitle(snapshot.title) || `Session ${snapshot.paneId}`
    status.textContent = STATUS_LABEL[snapshot.status]
    meta.textContent = `${snapshot.workspace} · ${AGENT_LABEL[snapshot.agent]} · ${snapshot.cwd}${snapshot.active ? ' · Active in WezTerm' : ''}`
  }

  const update = (snapshot: PaneSnapshot): void => {
    if (!terminal || snapshot.paneId !== paneId) return
    applyState(snapshot)
    if (terminal.cols !== snapshot.cols || terminal.rows !== snapshot.rows) terminal.resize(snapshot.cols, snapshot.rows)
    if (snapshot.screen !== undefined) writer.write(snapshot.screen)
    refit()
  }

  const open = (snapshot: PaneSnapshot, lastScreen: string | undefined): void => {
    if (backdrop.open) close()
    paneId = snapshot.paneId
    applyState(snapshot)
    controls.append(
      actionButton('Back', close),
      actionButton('Open in WezTerm', () => handlers.onFocus(snapshot.paneId), 'focus'),
      createCloseButton(snapshot.paneId, handlers.onClose),
    )
    footer.append(createActionButtons(snapshot.paneId, handlers.onSend))
    backdrop.showModal()
    // Retain this read-only renderer across opens; xterm viewport callbacks can outlive disposal.
    if (!terminal) {
      terminal = new Terminal({
        cols: snapshot.cols, rows: snapshot.rows, fontSize: FONT_SIZE, scrollback: 0,
        disableStdin: true, cursorBlink: false, theme: TERMINAL_THEME,
      })
      terminal.attachCustomWheelEventHandler(() => false)
      terminal.open(screen)
      if (terminal.textarea) terminal.textarea.tabIndex = -1
      terminal.loadAddon(new CanvasAddon())
      terminal.onRender(refit)
    }
    body.scrollLeft = 0
    body.scrollTop = body.scrollHeight
    following = true
    update({ ...snapshot, screen: lastScreen ?? '' })
    controls.querySelector<HTMLButtonElement>('button')?.focus()
  }

  return { open, update, close, openPaneId: () => paneId }
}
