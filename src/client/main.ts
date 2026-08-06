import '@xterm/xterm/css/xterm.css'

import type { PaneSnapshot, SessionStatus, StreamEvent } from '../types.ts'
import { createTile, type Tile } from './tile.ts'
import { renderSessionSummary, summarizeSessions } from './ui.ts'
import { createZoom } from './zoom.ts'

type Entry = {
  tile: Tile
  snapshot: PaneSnapshot
  /** Latest full screen; stream events omit `screen` when unchanged. */
  lastScreen?: string
  inViewport: boolean
  /** Current placement, tracked so a status/workspace change can re-parent the tile
      and prune the section it left behind. */
  status: SessionStatus
  workspace: string
}

const STATUS_ORDER: Record<SessionStatus, number> = { waiting: 0, working: 1, idle: 2, shell: 3 }

const board = document.querySelector('#board') as HTMLElement
const summary = document.querySelector('#summary') as HTMLElement
const entries = new Map<number, Entry>()
const statusGroups = new Map<SessionStatus, HTMLElement>() // status → <section class="status-group">
const wsSections = new Map<string, HTMLElement>() // `${status} ${workspace}` → <section class="workspace">

const wsKey = (status: SessionStatus, workspace: string): string => `${status} ${workspace}`
const FOCUS_TIMEOUT_MS = 5_000

type PendingFocus = {
  generation: number
  paneId: number
  timeoutId: number
}

const post = (path: string, body?: unknown): void => {
  void fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

let focusGeneration = 0
let pendingFocus: PendingFocus | undefined

const clearPendingFocus = (generation?: number): void => {
  if (!pendingFocus || (generation !== undefined && pendingFocus.generation !== generation)) return
  clearTimeout(pendingFocus.timeoutId)
  pendingFocus = undefined
  entries.forEach((entry) => entry.tile.setPending(false))
}

const requestFocus = async (paneId: number): Promise<void> => {
  const response = await fetch(`/api/focus/${paneId}`, { method: 'POST' })
  if (response.status !== 202) throw new Error(`focus request failed with ${response.status}`)
}

const focusPane = (paneId: number): void => {
  const generation = ++focusGeneration
  clearPendingFocus()

  if (entries.get(paneId)?.snapshot.active) {
    void requestFocus(paneId).catch((error) => console.warn('focus request failed:', error))
    return
  }

  entries.get(paneId)?.tile.setPending(true)
  const timeoutId = window.setTimeout(() => {
    if (pendingFocus?.generation !== generation) return
    console.warn(`focus request for pane ${paneId} timed out`)
    clearPendingFocus(generation)
  }, FOCUS_TIMEOUT_MS)
  pendingFocus = { generation, paneId, timeoutId }

  void requestFocus(paneId).catch((error) => {
    if (pendingFocus?.generation !== generation) return
    console.warn('focus request failed:', error)
    clearPendingFocus(generation)
  })
}
const sendToPane = (paneId: number, text: string): void => post(`/api/send/${paneId}`, { text })
const closePane = (paneId: number): void => post(`/api/close/${paneId}`)

const zoom = createZoom({ onFocus: focusPane, onSend: sendToPane, onClose: closePane })

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

/**
 * Mounting a terminal (xterm + canvas + first full-screen render) costs ~50ms,
 * so doing it synchronously in the observer makes scrolling stutter. Instead we
 * defer: nothing mounts while scrolling (placeholders fly by), and once activity
 * settles we mount one tile per frame, recomputing the work from live state each
 * frame so an entry that scrolled back out is simply skipped.
 */
let drainHandle = 0
let debounceHandle = 0

const drainStep = (): void => {
  drainHandle = 0
  if (document.hidden) return
  const next = [...entries.values()].find((e) => e.inViewport && !e.tile.isMounted())
  if (!next) return
  mountEntry(next)
  drainHandle = requestAnimationFrame(drainStep)
}

const scheduleDrain = (): void => {
  if (drainHandle === 0) drainHandle = requestAnimationFrame(drainStep)
}

/** Debounced so a continuous scroll keeps resetting it — mounts only after it stops. */
const queueMountPass = (): void => {
  clearTimeout(debounceHandle)
  debounceHandle = window.setTimeout(scheduleDrain, 120)
}

// rootMargin pre-mounts a buffer around the viewport so scrolling doesn't flicker.
const viewport = new IntersectionObserver(
  (observed) => {
    for (const obs of observed) {
      const entry = entries.get(Number((obs.target as HTMLElement).dataset.paneId))
      if (!entry) continue
      entry.inViewport = obs.isIntersecting
      if (!obs.isIntersecting) entry.tile.unmount() // cheap; mounting is deferred below
    }
    queueMountPass()
  },
  { rootMargin: '300px' },
)

const STATUS_LABEL: Record<SessionStatus, string> = { waiting: 'WAITING', working: 'WORKING', idle: 'IDLE', shell: 'SHELL' }

const statusGroupFor = (status: SessionStatus): HTMLElement => {
  const existing = statusGroups.get(status)
  if (existing) return existing
  const group = document.createElement('section')
  group.className = `status-group status-${status}`
  group.dataset.status = status
  group.innerHTML = `<header class="status-group-header"><h2>${STATUS_LABEL[status]}</h2><span class="count"></span><span class="split"></span></header><div class="status-body"></div>`
  statusGroups.set(status, group)
  const ordered = [...statusGroups.keys()].sort((a, b) => STATUS_ORDER[a] - STATUS_ORDER[b])
  board.insertBefore(group, board.children[ordered.indexOf(status)] ?? null)
  return group
}

const workspaceSectionFor = (status: SessionStatus, workspace: string): HTMLElement => {
  const key = wsKey(status, workspace)
  const existing = wsSections.get(key)
  if (existing) return existing
  const section = document.createElement('section')
  section.className = 'workspace'
  section.dataset.workspace = workspace
  section.innerHTML = `<h3>${workspace}</h3><div class="tiles"></div>`
  wsSections.set(key, section)
  const body = statusGroupFor(status).querySelector('.status-body') as HTMLElement
  const ordered = [...body.children].map((el) => (el as HTMLElement).dataset.workspace ?? '')
  ordered.push(workspace)
  ordered.sort()
  body.insertBefore(section, body.children[ordered.indexOf(workspace)] ?? null)
  return section
}

/** Drop a (status, workspace) section once its tiles empty out, and the whole status
    group when it has no workspace sections left. Called after a tile leaves or is removed. */
const prune = (status: SessionStatus, workspace: string): void => {
  const key = wsKey(status, workspace)
  const section = wsSections.get(key)
  if (section && section.querySelector('.tiles')?.children.length === 0) {
    section.remove()
    wsSections.delete(key)
  }
  const group = statusGroups.get(status)
  if (group && group.querySelector('.workspace') === null) {
    group.remove()
    statusGroups.delete(status)
  }
}

const refreshSummary = (): void => {
  const counts = summarizeSessions([...entries.values()].map((entry) => entry.snapshot))
  summary.replaceChildren(renderSessionSummary(counts))
  const waiting = counts.waiting.codex + counts.waiting.claude
  document.title = waiting > 0 ? `(${waiting}!) Mission Control` : 'Mission Control'
  // Repaint each present status section's header count (and codex·claude split) from
  // the same totals.
  for (const status of statusGroups.keys()) {
    const group = statusGroups.get(status)!
    const countEl = group.querySelector('.count')
    const splitEl = group.querySelector('.split')
    if (status === 'shell') {
      if (countEl) countEl.textContent = String(counts.shell)
      if (splitEl) splitEl.textContent = ''
      continue
    }
    const { codex, claude } = counts[status]
    if (countEl) countEl.textContent = String(codex + claude)
    if (splitEl) splitEl.textContent = codex || claude ? `(${codex}·${claude})` : ''
  }
}

const upsert = (snapshot: PaneSnapshot): void => {
  const existing = entries.get(snapshot.paneId)
  if (existing) {
    existing.lastScreen = snapshot.screen ?? existing.lastScreen
    existing.snapshot = { ...snapshot, screen: undefined }
    // update() refreshes the header always; the screen only when mounted and
    // visible. While hidden, writes would just pile up in xterm's throttled
    // (setTimeout-driven) write buffer; lastScreen keeps the latest so the
    // visibilitychange handler can repaint once when the tab returns.
    existing.tile.update({ ...existing.snapshot, screen: document.hidden ? undefined : existing.lastScreen })
    // A status or workspace change relocates the tile to its new (status, workspace)
    // section and prunes the one it left. (Re-parenting was missing entirely before.)
    if (existing.status !== snapshot.status || existing.workspace !== snapshot.workspace) {
      const { status, workspace } = existing
      existing.status = snapshot.status
      existing.workspace = snapshot.workspace
      workspaceSectionFor(snapshot.status, snapshot.workspace).querySelector('.tiles')?.appendChild(existing.tile.root)
      prune(status, workspace)
    }
    return
  }
  const tile = createTile(snapshot, { onZoom: openZoom, onFocus: focusPane, onSend: sendToPane, onClose: closePane })
  tile.setPending(pendingFocus?.paneId === snapshot.paneId)
  entries.set(snapshot.paneId, {
    tile,
    snapshot: { ...snapshot, screen: undefined },
    lastScreen: snapshot.screen,
    inViewport: false,
    status: snapshot.status,
    workspace: snapshot.workspace,
  })
  workspaceSectionFor(snapshot.status, snapshot.workspace).querySelector('.tiles')?.appendChild(tile.root)
  viewport.observe(tile.root) // mounts lazily once it enters the viewport
}

const remove = (paneId: number): void => {
  const entry = entries.get(paneId)
  if (!entry) return
  if (zoom.openPaneId() === paneId) zoom.close()
  viewport.unobserve(entry.tile.root)
  entry.tile.dispose()
  entry.tile.root.remove()
  const { status, workspace } = entry
  entries.delete(paneId)
  prune(status, workspace)
}

/**
 * Follow WezTerm focus: scroll the active tile into view only when *which* pane
 * is active changes. Re-sends of the same active pane (a working pane streaming
 * new screens) don't scroll, so browsing the wall while focused stays undisturbed.
 * The first event only records the active id (no scroll on page load).
 */
let activePaneId: number | undefined
let scrollFollowArmed = false

const followActive = (event: StreamEvent): void => {
  const active = event.panes.find((p) => p.active)
  if (!active || active.paneId === activePaneId) return
  if (scrollFollowArmed && !document.hidden) {
    entries.get(active.paneId)?.tile.root.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }
  activePaneId = active.paneId
}

const handleEvent = (event: StreamEvent): void => {
  event.panes.forEach(upsert)
  event.panes
    .filter((p) => p.paneId === zoom.openPaneId())
    .forEach((p) => zoom.update(document.hidden ? { ...p, screen: undefined } : p))
  event.removed.forEach(remove)
  if (
    pendingFocus &&
    (event.removed.includes(pendingFocus.paneId) || entries.get(pendingFocus.paneId)?.snapshot.active)
  ) {
    clearPendingFocus(pendingFocus.generation)
  }
  followActive(event)
  scrollFollowArmed = true
  refreshSummary()
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) return
  scheduleDrain() // mount visible tiles that were left as placeholders while hidden
  // Screens skipped writes while hidden; repaint mounted terminals from the
  // latest snapshots so nothing shows pre-hidden content.
  entries.forEach((entry) => entry.tile.update({ ...entry.snapshot, screen: entry.lastScreen }))
  const zoomedId = zoom.openPaneId()
  const zoomed = zoomedId === null ? undefined : entries.get(zoomedId)
  if (zoomed) zoom.update({ ...zoomed.snapshot, screen: zoomed.lastScreen })
  refreshSummary()
})

const shellToggle = document.querySelector('#show-shells') as HTMLInputElement
shellToggle.addEventListener('change', () => {
  document.body.classList.toggle('show-shells', shellToggle.checked)
})

// Column count is a per-machine preference: the column-stretch grid divides the
// width evenly, and tiles re-scale to the new card width. Stored in localStorage
// so each browser/screen keeps its own choice.
const refitAll = (): void => entries.forEach((entry) => entry.tile.refit())

const colsSelect = document.querySelector('#cols-select') as HTMLSelectElement
const applyCols = (value: string): void => board.style.setProperty('--cols', value)
colsSelect.value = localStorage.getItem('cols') ?? '3'
applyCols(colsSelect.value)
colsSelect.addEventListener('change', () => {
  localStorage.setItem('cols', colsSelect.value)
  applyCols(colsSelect.value)
  refitAll()
})

// Card width also changes when the window resizes (or enters/exits fullscreen);
// debounce a re-fit so content stays crisp without thrashing during a drag.
let resizeHandle = 0
window.addEventListener('resize', () => {
  clearTimeout(resizeHandle)
  resizeHandle = window.setTimeout(refitAll, 150)
})

const fullscreenToggle = document.querySelector('#fullscreen-toggle') as HTMLButtonElement
fullscreenToggle.addEventListener('click', () => {
  const action = document.fullscreenElement
    ? document.exitFullscreen()
    : document.documentElement.requestFullscreen()
  action.catch((error) => console.warn('fullscreen request blocked:', error))
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
