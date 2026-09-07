import '@xterm/xterm/css/xterm.css'

import type { PaneSnapshot, SessionStatus, StreamEvent } from '../types.ts'
import { createTile, type Tile } from './tile.ts'
import { updateSessionSummary, summarizeSessions } from './ui.ts'
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
let expandedPaneId: number | null = null
let expandedOrder: number[] | null = null
let columnCount = 5
let selectedStatus: SessionStatus | 'all' = 'all'
let receivedSnapshot = false
const search = document.querySelector('#session-search') as HTMLInputElement
const workspaceFilter = document.querySelector('#workspace-select') as HTMLSelectElement
const shellToggle = document.querySelector('#show-shells') as HTMLInputElement

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

const visibleEntries = (): Entry[] => {
  const query = search.value.trim().toLocaleLowerCase()
  return [...entries.values()].filter(({ snapshot }) =>
    (shellToggle.checked || snapshot.status !== 'shell')
    && (selectedStatus === 'all' || snapshot.status === selectedStatus)
    && (!workspaceFilter.value || snapshot.workspace === workspaceFilter.value)
    && [snapshot.title, snapshot.workspace, snapshot.cwd].some((value) => value.toLocaleLowerCase().includes(query)),
  ).sort((a, b) => STATUS_ORDER[a.snapshot.status] - STATUS_ORDER[b.snapshot.status]
    || a.snapshot.workspace.localeCompare(b.snapshot.workspace) || a.snapshot.paneId - b.snapshot.paneId)
}

const clearExpansion = (): number | null => {
  const id = expandedPaneId
  if (id !== null) entries.get(id)?.tile.setExpanded(false)
  expandedPaneId = null
  expandedOrder = null
  return id
}

const refreshBoard = (): void => {
  const visible = visibleEntries()
  const ids = visible.map((entry) => entry.snapshot.paneId)
  const visibleIds = new Set(ids)
  if (expandedPaneId !== null && !visibleIds.has(expandedPaneId)) {
    clearExpansion()
    zoom.close()
  }
  const order = expandedOrder === null ? ids
    : [...expandedOrder.filter((id) => visibleIds.has(id)), ...ids.filter((id) => !expandedOrder?.includes(id))]
  if (expandedOrder !== null) expandedOrder = order
  const focused = document.activeElement
  entries.forEach((entry, id) => { entry.tile.root.hidden = !visibleIds.has(id) })
  order.forEach((id, index) => {
    const root = entries.get(id)!.tile.root
    if (board.children[index] !== root) board.insertBefore(root, board.children[index] ?? null)
  })
  if (focused instanceof HTMLElement && board.contains(focused) && focused.getClientRects().length) {
    focused.focus({ preventScroll: true })
  }
  const nextEnabled = visible.some((entry) => entry.snapshot.status === 'waiting' && entry.snapshot.paneId !== expandedPaneId)
  if (expandedPaneId !== null) entries.get(expandedPaneId)?.tile.setNextWaiting(nextEnabled)
  document.querySelector('#visible-count')!.textContent = `${ids.length} visible`
  const empty = document.querySelector('#empty-state') as HTMLElement
  empty.hidden = ids.length > 0
  empty.querySelector('h2')!.textContent = receivedSnapshot ? 'No sessions to show' : 'Waiting for sessions…'
  const filtered = Boolean(search.value || workspaceFilter.value || selectedStatus !== 'all')
  document.querySelector('#empty-message')!.textContent = filtered
    ? 'Try another search or clear your filters.' : 'Start a session in WezTerm to see it here.'
  ;(document.querySelector('#clear-filters') as HTMLElement).hidden = !filtered
}

const refreshSummary = (): void => {
  const counts = summarizeSessions([...entries.values()].map((entry) => entry.snapshot))
  updateSessionSummary(summary, counts, selectedStatus, shellToggle.checked)
  const waiting = counts.waiting.codex + counts.waiting.claude
  document.title = waiting > 0 ? `(${waiting} waiting) Mission Control` : 'Mission Control'
  const current = workspaceFilter.value
  const names = [...new Set([...entries.values()].map((entry) => entry.snapshot.workspace))].sort()
  if (current && !names.includes(current)) names.push(current)
  const existing = [...workspaceFilter.options].slice(1).map((option) => option.value)
  if (names.length !== existing.length || names.some((name, index) => name !== existing[index])) {
    workspaceFilter.replaceChildren(new Option('All workspaces', ''), ...names.map((name) => new Option(name, name)))
    workspaceFilter.value = current
  }
  refreshBoard()
}

const collapsePane = (): void => {
  const id = clearExpansion()
  refreshBoard()
  if (id === null) return
  requestAnimationFrame(() => {
    entries.get(id)?.tile.root.scrollIntoView({ block: 'nearest' })
    entries.get(id)?.tile.root.querySelector<HTMLButtonElement>('.expand')?.focus({ preventScroll: true })
  })
}

const expandPane = (paneId: number): void => {
  if (expandedPaneId === paneId) { collapsePane(); return }
  clearExpansion()
  const order = visibleEntries().map((entry) => entry.snapshot.paneId)
  const index = order.indexOf(paneId)
  if (index < 0) return
  order.splice(index, 1)
  order.splice(Math.floor(index / columnCount) * columnCount, 0, paneId)
  expandedPaneId = paneId
  expandedOrder = order
  entries.get(paneId)?.tile.setExpanded(true)
  refreshBoard()
  requestAnimationFrame(() => entries.get(paneId)?.tile.root.scrollIntoView({ block: 'nearest' }))
}

const nextWaiting = (): void => {
  const waiting = visibleEntries().filter((entry) => entry.snapshot.status === 'waiting')
  const index = waiting.findIndex((entry) => entry.snapshot.paneId === expandedPaneId)
  const next = waiting[(index + 1) % waiting.length]?.snapshot.paneId
  if (next !== undefined && next !== expandedPaneId) expandPane(next)
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
    return
  }
  const tile = createTile(snapshot, {
    onExpand: expandPane, onCollapse: collapsePane, onNextWaiting: nextWaiting,
    onZoom: openZoom, onFocus: focusPane, onSend: sendToPane, onClose: closePane,
  })
  tile.setPending(pendingFocus?.paneId === snapshot.paneId)
  entries.set(snapshot.paneId, {
    tile,
    snapshot: { ...snapshot, screen: undefined },
    lastScreen: snapshot.screen,
    inViewport: false,
  })
  board.appendChild(tile.root)
  viewport.observe(tile.root) // mounts lazily once it enters the viewport
}

const remove = (paneId: number): void => {
  const entry = entries.get(paneId)
  if (!entry) return
  if (zoom.openPaneId() === paneId) zoom.close()
  viewport.unobserve(entry.tile.root)
  entry.tile.dispose()
  entry.tile.root.remove()
  if (expandedPaneId === paneId) clearExpansion()
  entries.delete(paneId)
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
  if (scrollFollowArmed && !document.hidden && expandedPaneId === null) {
    entries.get(active.paneId)?.tile.root.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }
  activePaneId = active.paneId
}

const handleEvent = (event: StreamEvent): void => {
  receivedSnapshot = true
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

const applyFilters = (): void => refreshSummary()
search.addEventListener('input', applyFilters)
workspaceFilter.addEventListener('change', applyFilters)
shellToggle.addEventListener('change', () => {
  if (!shellToggle.checked && selectedStatus === 'shell') selectedStatus = 'all'
  applyFilters()
})
summary.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-status]')
  if (!button) return
  selectedStatus = button.dataset.status as SessionStatus | 'all'
  applyFilters()
})
document.querySelector('#clear-filters')!.addEventListener('click', () => {
  search.value = ''
  workspaceFilter.value = ''
  selectedStatus = 'all'
  applyFilters()
  search.focus()
})
// Capture Escape before xterm consumes it when its read-only screen has focus.
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || (zoom.openPaneId() === null && expandedPaneId === null)) return
  event.preventDefault()
  event.stopPropagation()
  if (zoom.openPaneId() !== null) zoom.close()
  else collapsePane()
}, true)

const refitAll = (): void => entries.forEach((entry) => entry.tile.refit())
const colsSelect = document.querySelector('#cols-select') as HTMLSelectElement
const chrome = document.querySelector('#chrome') as HTMLElement
const applyLayout = (): void => {
  const availableCols = Math.max(1, Math.min(5, Math.floor((board.clientWidth - 10) / 266)))
  const nextCols = colsSelect.value === 'auto' ? availableCols : Math.min(Number(colsSelect.value), availableCols)
  const chromeHeight = chrome.offsetHeight
  const rowHeight = Math.max(160, Math.min(240, Math.floor((window.innerHeight - chromeHeight - 34) / 4)))
  board.style.setProperty('--cols', String(nextCols))
  board.style.setProperty('--row-height', `${rowHeight}px`)
  board.style.setProperty('--expanded-cols', String(Math.min(2, nextCols)))
  document.documentElement.style.setProperty('--chrome-height', `${chromeHeight}px`)
  if (nextCols !== columnCount && expandedOrder && expandedPaneId !== null) {
    const index = expandedOrder.indexOf(expandedPaneId)
    expandedOrder.splice(index, 1)
    expandedOrder.splice(Math.floor(index / nextCols) * nextCols, 0, expandedPaneId)
  }
  columnCount = nextCols
  refreshBoard()
  refitAll()
}
try {
  const saved = localStorage.getItem('cols')
  colsSelect.value = saved && ['auto', '2', '3', '4', '5'].includes(saved) ? saved : 'auto'
} catch (error) {
  console.warn('Could not load column preference:', error)
  colsSelect.value = 'auto'
}
colsSelect.addEventListener('change', () => {
  try { localStorage.setItem('cols', colsSelect.value) }
  catch (error) { console.warn('Could not save column preference:', error) }
  applyLayout()
})
let resizeHandle = 0
const queueLayout = (): void => {
  clearTimeout(resizeHandle)
  resizeHandle = window.setTimeout(applyLayout, 150)
}
window.addEventListener('resize', queueLayout)
new ResizeObserver(queueLayout).observe(chrome)

const fullscreenToggle = document.querySelector('#fullscreen-toggle') as HTMLButtonElement
fullscreenToggle.addEventListener('click', () => {
  const action = document.fullscreenElement
    ? document.exitFullscreen()
    : document.documentElement.requestFullscreen()
  action.catch((error) => console.warn('fullscreen request blocked:', error))
})
document.addEventListener('fullscreenchange', () => {
  const on = document.fullscreenElement !== null
  fullscreenToggle.textContent = on ? 'Exit full screen' : 'Full screen'
  fullscreenToggle.title = fullscreenToggle.textContent
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
  conn.textContent = live ? 'Live' : 'Reconnecting…'
  conn.title = live ? 'Live' : 'Reconnecting — displayed screens may be stale'
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

refreshSummary()
applyLayout()
connect()
