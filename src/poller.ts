import { createHash } from 'node:crypto'

import { detectStatus, stripAnsi } from './status.ts'
import type { PaneSnapshot, StreamEvent } from './types.ts'
import { focusedPaneId, getScreen, listPanes, type WeztermPane } from './wezterm.ts'

type PaneState = { hash: string; snapshot: PaneSnapshot }

const hashOf = (text: string): string => createHash('sha1').update(text).digest('hex')

const toSnapshot = (pane: WeztermPane, screen: string): PaneSnapshot => ({
  paneId: pane.pane_id,
  workspace: pane.workspace,
  title: pane.title,
  cwd: pane.cwd.replace(/^file:\/\/[^/]*/, ''),
  cols: pane.size.cols,
  rows: pane.size.rows,
  status: detectStatus(pane.title, stripAnsi(screen)),
  screen,
})

const capturePane = async (pane: WeztermPane): Promise<PaneSnapshot | null> => {
  try {
    return toSnapshot(pane, await getScreen(pane.pane_id))
  } catch {
    return null // pane may have closed between list and capture
  }
}

export type Poller = {
  /** Latest full state including screens, for newly connected clients. */
  fullState: () => StreamEvent
  subscribe: (listener: (event: StreamEvent) => void) => () => void
  start: () => void
  stop: () => void
}

export const createPoller = (intervalMs: number): Poller => {
  const states = new Map<number, PaneState>()
  const listeners = new Set<(event: StreamEvent) => void>()
  let timer: NodeJS.Timeout | undefined
  let ticking = false

  const tick = async (): Promise<void> => {
    const [panes, focusedId] = await Promise.all([listPanes(), focusedPaneId()])
    const captured = (await Promise.all(panes.map(capturePane))).filter((s) => s !== null)

    const changed: PaneSnapshot[] = []
    const seen = new Set<number>()
    for (const captured0 of captured) {
      seen.add(captured0.paneId)
      const snapshot: PaneSnapshot = { ...captured0, active: captured0.paneId === focusedId }
      // active is in the hash so focus moves repaint even when title/screen are unchanged
      const hash = hashOf(`${snapshot.title}\0${snapshot.active}\0${snapshot.screen ?? ''}`)
      if (states.get(snapshot.paneId)?.hash === hash) continue
      states.set(snapshot.paneId, { hash, snapshot })
      changed.push(snapshot)
    }

    const removed = [...states.keys()].filter((id) => !seen.has(id))
    removed.forEach((id) => states.delete(id))

    if (changed.length === 0 && removed.length === 0) return
    const event: StreamEvent = { panes: changed, removed }
    listeners.forEach((listener) => listener(event))
  }

  const safeTick = async (): Promise<void> => {
    if (ticking) return // skip overlapping ticks when capture is slow
    ticking = true
    try {
      await tick()
    } catch (error) {
      console.error('poll tick failed:', error)
    } finally {
      ticking = false
    }
  }

  return {
    fullState: () => ({ panes: [...states.values()].map((s) => s.snapshot), removed: [] }),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    start: () => {
      if (timer !== undefined) return
      void safeTick()
      timer = setInterval(() => void safeTick(), intervalMs)
    },
    stop: () => {
      clearInterval(timer)
      timer = undefined
    },
  }
}
