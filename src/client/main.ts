import '@xterm/xterm/css/xterm.css'

import type { PaneSnapshot, SessionStatus, StreamEvent } from '../types.ts'
import { createTile, type Tile } from './tile.ts'

type Entry = { tile: Tile; workspace: string; status: SessionStatus }

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
    return entry ? STATUS_ORDER[entry.status] * 1e6 + Number((node as HTMLElement).dataset.paneId) : 0
  }
  const ordered = [...tiles.children].sort((a, b) => rank(a) - rank(b))
  if (ordered.some((node, i) => node !== tiles.children[i])) tiles.append(...ordered)
}

const refreshSummary = (): void => {
  const counts: Record<SessionStatus, number> = { working: 0, waiting: 0, idle: 0, shell: 0 }
  entries.forEach((entry) => counts[entry.status]++)
  summary.textContent = `${counts.working} working · ${counts.waiting} waiting · ${counts.idle} idle · ${counts.shell} shell`
  document.title = counts.waiting > 0 ? `(${counts.waiting}!) Mission Control` : 'Mission Control'
}

const upsert = (snapshot: PaneSnapshot): void => {
  const existing = entries.get(snapshot.paneId)
  if (existing) {
    existing.tile.update(snapshot)
    existing.status = snapshot.status
    return
  }
  const tile = createTile(snapshot, focusPane, sendToPane)
  entries.set(snapshot.paneId, { tile, workspace: snapshot.workspace, status: snapshot.status })
  sectionFor(snapshot.workspace).querySelector('.tiles')?.appendChild(tile.root)
}

const remove = (paneId: number): void => {
  const entry = entries.get(paneId)
  if (!entry) return
  entry.tile.dispose()
  entry.tile.root.remove()
  entries.delete(paneId)
  const section = sections.get(entry.workspace)
  if (section && section.querySelector('.tiles')?.children.length === 0) {
    section.remove()
    sections.delete(entry.workspace)
  }
}

const handleEvent = (event: StreamEvent): void => {
  event.panes.forEach(upsert)
  event.removed.forEach(remove)
  new Set(event.panes.map((p) => p.workspace)).forEach(reorderSection)
  refreshSummary()
}

const shellToggle = document.querySelector('#show-shells') as HTMLInputElement
shellToggle.addEventListener('change', () => {
  document.body.classList.toggle('show-shells', shellToggle.checked)
})

const stream = new EventSource('/api/stream')
stream.onmessage = (message) => handleEvent(JSON.parse(message.data) as StreamEvent)
