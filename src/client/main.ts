import '@xterm/xterm/css/xterm.css'

import type { PaneSnapshot, SessionStatus, StreamEvent } from '../types.ts'
import { createTile, type Tile } from './tile.ts'
import { createZoom } from './zoom.ts'

type Entry = {
  tile: Tile
  snapshot: PaneSnapshot
  /** Latest full screen; stream events omit `screen` when unchanged. */
  lastScreen?: string
  inViewport: boolean
}

const STATUS_ORDER: Record<SessionStatus, number> = { waiting: 0, working: 1, idle: 2, shell: 3 }

const board = document.querySelector('#board') as HTMLElement
const summary = document.querySelector('#summary') as HTMLElement
const entries = new Map<number, Entry>()
const sections = new Map<string, HTMLElement>()

const post = (path: string, body?: unknown): void => {
  void fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const focusPane = (paneId: number): void => post(`/api/focus/${paneId}`)
const sendToPane = (paneId: number, text: string): void => post(`/api/send/${paneId}`, { text })

const zoom = createZoom({ onFocus: focusPane, onSend: sendToPane })

const openZoom = (paneId: number): void => {
  const entry = entries.get(paneId)
  if (entry) zoom.open(entry.snapshot, entry.lastScreen)
}

/**
 * Mounting is gated to the viewport: only tiles that can actually be seen own a
 * live xterm terminal (and its costly canvas compositor layers). Off-screen tiles
 * keep a header-only placeholder. The latest screen lives in `lastScreen`, so a
 * tile always mounts with current content.
 */
const mountEntry = (entry: Entry): void => {
  if (!entry.tile.isMounted()) entry.tile.mount({ ...entry.snapshot, screen: entry.lastScreen })
}

// rootMargin pre-mounts a buffer around the viewport so scrolling doesn't flicker.
const viewport = new IntersectionObserver(
  (observed) => {
    for (const obs of observed) {
      const entry = entries.get(Number((obs.target as HTMLElement).dataset.paneId))
      if (!entry) continue
      entry.inViewport = obs.isIntersecting
      if (obs.isIntersecting) {
        if (!document.hidden) mountEntry(entry)
      } else {
        entry.tile.unmount()
      }
    }
  },
  { rootMargin: '300px' },
)

const sectionFor = (workspace: string): HTMLElement => {
  const existing = sections.get(workspace)
  if (existing) return existing
  const section = document.createElement('section')
  section.className = 'workspace'
  section.innerHTML = `<h2>${workspace}</h2><div class="tiles"></div>`
  sections.set(workspace, section)
  const ordered = [...sections.keys()].sort()
  board.insertBefore(section, board.children[ordered.indexOf(workspace)] ?? null)
  return section
}

const reorderSection = (workspace: string): void => {
  const tiles = sections.get(workspace)?.querySelector('.tiles')
  if (!tiles) return
  const rank = (node: Element): number => {
    const entry = entries.get(Number((node as HTMLElement).dataset.paneId))
    return entry ? STATUS_ORDER[entry.snapshot.status] * 1e6 + entry.snapshot.paneId : 0
  }
  const ordered = [...tiles.children].sort((a, b) => rank(a) - rank(b))
  if (ordered.some((node, i) => node !== tiles.children[i])) tiles.append(...ordered)
}

const refreshSummary = (): void => {
  const counts: Record<SessionStatus, number> = { working: 0, waiting: 0, idle: 0, shell: 0 }
  entries.forEach((entry) => counts[entry.snapshot.status]++)
  summary.textContent = `${counts.working} working · ${counts.waiting} waiting · ${counts.idle} idle · ${counts.shell} shell`
  document.title = counts.waiting > 0 ? `(${counts.waiting}!) Mission Control` : 'Mission Control'
}

const upsert = (snapshot: PaneSnapshot): void => {
  const existing = entries.get(snapshot.paneId)
  if (existing) {
    existing.lastScreen = snapshot.screen ?? existing.lastScreen
    existing.snapshot = { ...snapshot, screen: undefined }
    // update() refreshes the header always and the screen only when mounted.
    existing.tile.update({ ...existing.snapshot, screen: existing.lastScreen })
    return
  }
  const tile = createTile(snapshot, { onZoom: openZoom, onFocus: focusPane, onSend: sendToPane })
  entries.set(snapshot.paneId, {
    tile,
    snapshot: { ...snapshot, screen: undefined },
    lastScreen: snapshot.screen,
    inViewport: false,
  })
  sectionFor(snapshot.workspace).querySelector('.tiles')?.appendChild(tile.root)
  viewport.observe(tile.root) // mounts lazily once it enters the viewport
}

const remove = (paneId: number): void => {
  const entry = entries.get(paneId)
  if (!entry) return
  if (zoom.openPaneId() === paneId) zoom.close()
  viewport.unobserve(entry.tile.root)
  entry.tile.dispose()
  entry.tile.root.remove()
  entries.delete(paneId)
  const workspace = entry.snapshot.workspace
  const section = sections.get(workspace)
  if (section && section.querySelector('.tiles')?.children.length === 0) {
    section.remove()
    sections.delete(workspace)
  }
}

const handleEvent = (event: StreamEvent): void => {
  event.panes.forEach(upsert)
  event.panes.filter((p) => p.paneId === zoom.openPaneId()).forEach((p) => zoom.update(p))
  event.removed.forEach(remove)
  if (!document.hidden) new Set(event.panes.map((p) => p.workspace)).forEach(reorderSection)
  refreshSummary()
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) return
  entries.forEach((entry) => {
    if (entry.inViewport) mountEntry(entry)
  })
  new Set([...entries.values()].map((e) => e.snapshot.workspace)).forEach(reorderSection)
  refreshSummary()
})

const shellToggle = document.querySelector('#show-shells') as HTMLInputElement
shellToggle.addEventListener('change', () => {
  document.body.classList.toggle('show-shells', shellToggle.checked)
})

const fullscreenToggle = document.querySelector('#fullscreen-toggle') as HTMLButtonElement
fullscreenToggle.addEventListener('click', () => {
  const action = document.fullscreenElement
    ? document.exitFullscreen()
    : document.documentElement.requestFullscreen()
  action.catch(() => {}) // fullscreen may be blocked by policy; ignore
})
document.addEventListener('fullscreenchange', () => {
  const on = document.fullscreenElement !== null
  fullscreenToggle.textContent = on ? '⤢' : '⛶'
  fullscreenToggle.title = on ? '退出全屏' : '全屏'
})

/**
 * The stream must survive drops (server restart, sleep, proxy idle-out): a
 * silently frozen monitoring wall is worse than no wall. EventSource already
 * auto-reconnects on most drops; we only add a visible status and a watchdog
 * that rebuilds the EventSource if it ever gets stuck (readyState CLOSED) or
 * goes half-open. The server's `ping` keeps `lastMessageAt` fresh during quiet
 * periods so the watchdog doesn't fire on a healthy-but-idle connection.
 */
const STALE_MS = 25_000
const conn = document.querySelector('#conn') as HTMLElement
let stream: EventSource
let lastMessageAt = Date.now()

const setStatus = (live: boolean): void => {
  document.body.classList.toggle('disconnected', !live)
  conn.title = live ? 'live' : 'reconnecting…'
}

const markLive = (): void => {
  lastMessageAt = Date.now()
  setStatus(true)
}

const connect = (): void => {
  stream = new EventSource('/api/stream')
  stream.onopen = markLive
  stream.addEventListener('ping', markLive)
  stream.onmessage = (message) => {
    markLive()
    handleEvent(JSON.parse(message.data) as StreamEvent)
  }
  stream.onerror = () => setStatus(false) // EventSource retries itself; just surface it
}

// Backstop: if no event/ping for too long, the native reconnect is stuck — rebuild it.
setInterval(() => {
  if (Date.now() - lastMessageAt > STALE_MS) {
    setStatus(false)
    stream.close()
    connect()
  }
}, 5000)

connect()
