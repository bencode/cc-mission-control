import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const MACOS_APP_BIN = '/Applications/WezTerm.app/Contents/MacOS/wezterm'

const resolveBin = (): string => {
  if (process.env.WEZTERM_BIN) return process.env.WEZTERM_BIN
  return existsSync(MACOS_APP_BIN) ? MACOS_APP_BIN : 'wezterm'
}

const WEZTERM_BIN = resolveBin()

/** Screen dumps of large panes can be sizable; allow plenty of headroom. */
const MAX_BUFFER = 16 * 1024 * 1024

const run = (args: string[]): Promise<string> =>
  execFileAsync(WEZTERM_BIN, args, { maxBuffer: MAX_BUFFER }).then((r) => r.stdout)

export type WeztermPane = {
  window_id: number
  tab_id: number
  pane_id: number
  workspace: string
  title: string
  cwd: string
  size: { rows: number; cols: number }
}

export const listPanes = async (): Promise<WeztermPane[]> =>
  JSON.parse(await run(['cli', 'list', '--format', 'json'])) as WeztermPane[]

type WeztermClient = { focused_pane_id: number; idle_time: { secs: number } }

/**
 * The single pane the user is currently focused on. `cli list` marks every
 * tab's active pane, so it can't tell us this; `list-clients` can. With several
 * clients (multiple GUI windows), the least-idle one is the live one.
 */
export const focusedPaneId = async (): Promise<number | null> => {
  try {
    const clients = JSON.parse(await run(['cli', 'list-clients', '--format', 'json'])) as WeztermClient[]
    if (clients.length === 0) return null
    return clients.reduce((a, b) => (b.idle_time.secs < a.idle_time.secs ? b : a)).focused_pane_id
  } catch {
    return null // older wezterm without list-clients, or no GUI client attached
  }
}

/** Capture the visible screen of a pane, including ANSI color escapes. */
export const getScreen = (paneId: number): Promise<string> =>
  run(['cli', 'get-text', '--pane-id', String(paneId), '--escapes'])

export const activatePane = async (paneId: number): Promise<void> => {
  await run(['cli', 'activate-pane', '--pane-id', String(paneId)])
}

export const sendText = async (paneId: number, text: string): Promise<void> => {
  await run(['cli', 'send-text', '--pane-id', String(paneId), '--no-paste', '--', text])
}

/** Bring the WezTerm app window to the foreground (macOS only; no-op elsewhere). */
export const bringToFront = async (): Promise<void> => {
  if (process.platform !== 'darwin') return
  await execFileAsync('osascript', ['-e', 'tell application "WezTerm" to activate'])
}

/**
 * `activate-pane` cannot switch the GUI's active workspace, so cross-workspace
 * focus goes through a request file picked up by the optional Lua bridge
 * (see integrations/wezterm-focus.lua) running inside WezTerm.
 */
const FOCUS_REQUEST_DIR = join(homedir(), '.cache', 'cc-mission-control')
const FOCUS_REQUEST_FILE = join(FOCUS_REQUEST_DIR, 'focus-request')

export const writeFocusRequest = async (paneId: number): Promise<void> => {
  await mkdir(FOCUS_REQUEST_DIR, { recursive: true })
  await writeFile(FOCUS_REQUEST_FILE, `${paneId}\n`)
}

/** Drop any request left over from a previous run (e.g. bridge not installed yet). */
export const clearFocusRequest = (): Promise<void> =>
  rm(FOCUS_REQUEST_FILE, { force: true })
