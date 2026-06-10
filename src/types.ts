export type SessionStatus = 'working' | 'waiting' | 'idle' | 'shell'

export type PaneSnapshot = {
  paneId: number
  workspace: string
  title: string
  cwd: string
  cols: number
  rows: number
  status: SessionStatus
  /** True for the single pane currently focused in WezTerm. */
  active?: boolean
  /** Full-screen ANSI dump. Present only when content changed since the last event. */
  screen?: string
}

export type StreamEvent = {
  panes: PaneSnapshot[]
  /** Pane ids that disappeared since the last event. */
  removed: number[]
}
