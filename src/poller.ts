import { createHash } from 'node:crypto'

import { listAgentProcesses } from './processes.ts'
import { detectAgent, detectStatus, stripAnsi } from './status.ts'
import type { AgentKind, PaneSnapshot, StreamEvent } from './types.ts'
import { focusedPaneId, getScreen, listPanes, type WeztermPane } from './wezterm.ts'

type PaneState = { hash: string; snapshot: PaneSnapshot }

const hashOf = (text: string): string => createHash('sha1').update(text).digest('hex')
const FOCUS_INTERVAL_MS = 250

const snapshotHash = (snapshot: PaneSnapshot): string =>
  hashOf(`${snapshot.agent}\0${snapshot.title}\0${snapshot.active}\0${snapshot.screen ?? ''}`)

const toSnapshot = (
  pane: WeztermPane,
  screen: string,
  processAgent?: Exclude<AgentKind, 'shell'>,
): PaneSnapshot => {
  const agent = detectAgent(pane.title, processAgent)
  return {
    paneId: pane.pane_id,
    agent,
    workspace: pane.workspace,
    title: pane.title,
    cwd: pane.cwd.replace(/^file:\/\/[^/]*/, ''),
    cols: pane.size.cols,
    rows: pane.size.rows,
    status: detectStatus(agent, pane.title, stripAnsi(screen)),
    screen,
  }
}

const capturePane = async (
  pane: WeztermPane,
  processAgent?: Exclude<AgentKind, 'shell'>,
): Promise<PaneSnapshot | null> => {
  try {
    const screen = await getScreen(pane.pane_id)
    return screen === null ? null : toSnapshot(pane, screen, processAgent)
  } catch (error) {
    console.warn(`capture failed for pane ${pane.pane_id}:`, error)
    return null
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
  let screenTimer: NodeJS.Timeout | undefined
  let focusTimer: NodeJS.Timeout | undefined
  let screenTicking = false
  let focusTicking = false

  const emit = (panes: PaneSnapshot[], removed: number[] = []): void => {
    if (panes.length === 0 && removed.length === 0) return
    const event: StreamEvent = { panes, removed }
    listeners.forEach((listener) => listener(event))
  }

  const store = (snapshot: PaneSnapshot): boolean => {
    const hash = snapshotHash(snapshot)
    if (states.get(snapshot.paneId)?.hash === hash) return false
    states.set(snapshot.paneId, { hash, snapshot })
    return true
  }

  const screenTick = async (): Promise<void> => {
    const [panes, processAgents] = await Promise.all([
      listPanes(),
      listAgentProcesses().catch((error) => {
        console.error('agent process listing failed:', error)
        return new Map<string, Exclude<AgentKind, 'shell'>>()
      }),
    ])
    const changed: PaneSnapshot[] = []
    const seen = new Set(panes.map((pane) => pane.pane_id))

    // Sequential capture avoids flooding the WezTerm mux with one cli process per pane.
    for (const pane of panes) {
      const tty = pane.tty_name?.replace(/^\/dev\//, '')
      const snapshot = await capturePane(pane, tty ? processAgents.get(tty) : undefined)
      if (snapshot === null) continue
      const next = { ...snapshot, active: states.get(snapshot.paneId)?.snapshot.active ?? false }
      if (store(next)) changed.push(next)
    }

    const removed = [...states.keys()].filter((id) => !seen.has(id))
    removed.forEach((id) => states.delete(id))
    emit(changed, removed)
  }

  const focusTick = async (): Promise<void> => {
    const focusedId = await focusedPaneId()
    if (focusedId === undefined) return
    const changed: PaneSnapshot[] = []
    states.forEach((state) => {
      const active = state.snapshot.paneId === focusedId
      if ((state.snapshot.active ?? false) === active) return
      const next = { ...state.snapshot, active }
      store(next)
      changed.push({ ...next, screen: undefined })
    })
    emit(changed)
  }

  const safeScreenTick = async (): Promise<void> => {
    if (screenTicking) return
    screenTicking = true
    try {
      await screenTick()
    } catch (error) {
      console.error('screen poll failed:', error)
    } finally {
      screenTicking = false
    }
  }

  const safeFocusTick = async (): Promise<void> => {
    if (focusTicking) return
    focusTicking = true
    try {
      await focusTick()
    } catch (error) {
      console.error('focus poll failed:', error)
    } finally {
      focusTicking = false
    }
  }

  return {
    fullState: () => ({ panes: [...states.values()].map((s) => s.snapshot), removed: [] }),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    start: () => {
      if (screenTimer !== undefined) return
      void safeScreenTick()
      void safeFocusTick()
      screenTimer = setInterval(() => void safeScreenTick(), intervalMs)
      focusTimer = setInterval(() => void safeFocusTick(), FOCUS_INTERVAL_MS)
    },
    stop: () => {
      clearInterval(screenTimer)
      clearInterval(focusTimer)
      screenTimer = undefined
      focusTimer = undefined
    },
  }
}
