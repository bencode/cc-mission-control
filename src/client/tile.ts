import { CanvasAddon } from '@xterm/addon-canvas'
import { Terminal } from '@xterm/xterm'

import type { PaneSnapshot } from '../types.ts'
import { createScreenWriter } from './screen-writer.ts'
import { actionButton, AGENT_LABEL, createActionButtons, createCloseButton, displayTitle, el, STATUS_LABEL, type CloseHandler, type SendHandler } from './ui.ts'

const TILE_FONT_SIZE = 9
const READ_FONT_SIZE = 14
const TERMINAL_THEME = { background: '#0d1117', foreground: '#c9d1d9' }

export type Tile = {
  root: HTMLElement
  update: (snapshot: PaneSnapshot) => void
  setPending: (pending: boolean) => void
  setExpanded: (expanded: boolean) => void
  setNextWaiting: (enabled: boolean) => void
  mount: (snapshot: PaneSnapshot) => void
  unmount: () => void
  refit: () => void
  isMounted: () => boolean
  dispose: () => void
}

export type TileHandlers = {
  onExpand: (paneId: number) => void
  onCollapse: () => void
  onNextWaiting: () => void
  onZoom: (paneId: number) => void
  onFocus: (paneId: number) => void
  onSend: SendHandler
  onClose: CloseHandler
}

export const createTile = (snapshot: PaneSnapshot, handlers: TileHandlers): Tile => {
  const root = el('article', 'tile')
  root.dataset.paneId = String(snapshot.paneId)
  const header = el('header', 'tile-header')
  const heading = el('div', 'tile-heading')
  const light = el('span', 'light')
  light.setAttribute('aria-hidden', 'true')
  const title = actionButton('', () => handlers.onExpand(snapshot.paneId), 'title')
  const status = el('span', 'status-label')
  heading.append(light, title, status)
  const meta = el('div', 'tile-meta')
  const workspace = el('span', 'workspace-label')
  const active = el('span', 'active-label')
  active.textContent = 'Active in WezTerm'
  meta.append(workspace, active)
  const tools = el('div', 'expanded-tools')
  header.append(heading, meta, tools)
  const wrap = el('div', 'screen-wrap')
  wrap.id = `screen-${snapshot.paneId}`
  title.setAttribute('aria-controls', wrap.id)
  const stage = el('div', 'screen-stage')
  const screen = el('div', 'screen')
  stage.append(screen)
  const placeholder = el('span', 'screen-placeholder')
  placeholder.textContent = 'Loading terminal…'
  wrap.append(stage, placeholder)
  const footer = el('footer', 'tile-footer')
  const next = actionButton('Next waiting →', handlers.onNextWaiting, 'next-waiting')
  root.append(header, wrap, footer)

  let expanded = false
  let terminal: Terminal | null = null
  const writer = createScreenWriter(() => terminal)
  let size = { cols: snapshot.cols, rows: snapshot.rows }
  let frame = 0
  let following = true

  const refit = (): void => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      const rendered = terminal?.element?.querySelector<HTMLElement>('.xterm-screen')
      if (!rendered || !wrap.clientWidth || !wrap.clientHeight) return
      const width = rendered.offsetWidth
      const height = rendered.offsetHeight
      if (!width || !height) return
      const scale = expanded ? 1 : Math.min(wrap.clientWidth / width, wrap.clientHeight / height, 1)
      screen.style.transform = `scale(${scale})`
      stage.style.width = `${Math.ceil(width * scale)}px`
      stage.style.height = `${Math.ceil(height * scale)}px`
      if (expanded && following) wrap.scrollTop = wrap.scrollHeight
    })
  }
  const resize = new ResizeObserver(refit)
  resize.observe(wrap)
  wrap.addEventListener('scroll', () => {
    if (expanded) following = wrap.scrollHeight - wrap.clientHeight - wrap.scrollTop < 12
  })
  root.addEventListener('click', () => { if (!expanded) handlers.onExpand(snapshot.paneId) })

  const setExpanded = (value: boolean): void => {
    if (value === expanded) return
    expanded = value
    root.classList.toggle('expanded', value)
    title.setAttribute('aria-expanded', String(value))
    title.title = value ? 'Collapse session' : 'Expand session'
    wrap.tabIndex = value ? 0 : -1
    wrap.setAttribute('aria-label', 'Read-only terminal screen')
    tools.replaceChildren()
    footer.replaceChildren()
    if (value) {
      tools.append(
        actionButton('Open in WezTerm', () => handlers.onFocus(snapshot.paneId), 'focus'),
        actionButton('Maximize', () => handlers.onZoom(snapshot.paneId), 'maximize'),
        actionButton('Collapse', handlers.onCollapse),
        createCloseButton(snapshot.paneId, handlers.onClose),
      )
      footer.append(createActionButtons(snapshot.paneId, handlers.onSend), next)
    }
    if (terminal) terminal.options.fontSize = value ? READ_FONT_SIZE : TILE_FONT_SIZE
    wrap.scrollLeft = 0
    wrap.scrollTop = wrap.scrollHeight
    following = true
    refit()
  }

  const renderHeader = (next: PaneSnapshot): void => {
    root.classList.remove('status-working', 'status-waiting', 'status-idle', 'status-shell')
    root.classList.add(`status-${next.status}`)
    title.textContent = displayTitle(next.title) || `Session ${next.paneId}`
    status.textContent = STATUS_LABEL[next.status]
    workspace.textContent = `${next.workspace} · ${AGENT_LABEL[next.agent]}`
    workspace.title = next.cwd
    active.hidden = !next.active
    root.classList.toggle('active', Boolean(next.active))
  }

  const mount = (next: PaneSnapshot): void => {
    if (terminal) return
    size = { cols: next.cols, rows: next.rows }
    terminal = new Terminal({
      cols: next.cols, rows: next.rows, fontSize: expanded ? READ_FONT_SIZE : TILE_FONT_SIZE,
      scrollback: 0, disableStdin: true, cursorBlink: false, theme: TERMINAL_THEME,
    })
    terminal.attachCustomWheelEventHandler(() => false)
    terminal.open(screen)
    if (terminal.textarea) terminal.textarea.tabIndex = -1
    terminal.loadAddon(new CanvasAddon())
    terminal.onRender(refit)
    placeholder.hidden = true
    if (next.screen !== undefined) writer.write(next.screen)
    refit()
  }

  const unmount = (): void => {
    cancelAnimationFrame(frame)
    if (!terminal) return
    terminal.dispose()
    terminal = null
    writer.reset()
    screen.replaceChildren()
    screen.style.transform = ''
    placeholder.hidden = false
  }

  const update = (next: PaneSnapshot): void => {
    renderHeader(next)
    if (!terminal) return
    if (next.cols !== size.cols || next.rows !== size.rows) {
      size = { cols: next.cols, rows: next.rows }
      terminal.resize(next.cols, next.rows)
      refit()
    }
    if (next.screen !== undefined) writer.write(next.screen)
  }

  title.setAttribute('aria-expanded', 'false')
  title.title = 'Expand session'
  renderHeader(snapshot)
  return {
    root, update, setExpanded,
    setPending: (pending) => root.classList.toggle('pending-focus', pending),
    setNextWaiting: (enabled) => { next.disabled = !enabled },
    mount, unmount, refit, isMounted: () => terminal !== null,
    dispose: () => { resize.disconnect(); unmount() },
  }
}
