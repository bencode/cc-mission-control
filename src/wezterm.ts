import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
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

/**
 * Kill a cli call that hangs on a busy/unresponsive GUI. Without this the
 * poller's tick never settles and every later tick is skipped — the wall
 * freezes while heartbeats keep the stream looking alive.
 */
const CLI_TIMEOUT_MS = 5_000

const run = (args: string[]): Promise<string> =>
  execFileAsync(WEZTERM_BIN, args, { maxBuffer: MAX_BUFFER, timeout: CLI_TIMEOUT_MS }).then((r) => r.stdout)

const isMissingPaneError = (error: unknown, paneId: number): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'stderr' in error &&
  typeof error.stderr === 'string' &&
  error.stderr.includes(`Error: no such pane ${paneId}`)

export type WeztermPane = {
  window_id: number
  tab_id: number
  pane_id: number
  workspace: string
  title: string
  cwd: string
  tty_name?: string
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
export const focusedPaneId = async (): Promise<number | null | undefined> => {
  try {
    const clients = JSON.parse(await run(['cli', 'list-clients', '--format', 'json'])) as WeztermClient[]
    if (clients.length === 0) return null
    return clients.reduce((a, b) => (b.idle_time.secs < a.idle_time.secs ? b : a)).focused_pane_id
  } catch (error) {
    console.warn('wezterm list-clients failed; focused-pane tracking degraded:', error)
    return undefined // preserve the last known focus across transient cli failures
  }
}

/** Capture the visible screen of a pane, including ANSI color escapes. */
export const getScreen = async (paneId: number): Promise<string | null> => {
  try {
    return await run(['cli', 'get-text', '--pane-id', String(paneId), '--escapes'])
  } catch (error) {
    if (isMissingPaneError(error, paneId)) return null
    throw error
  }
}

export const sendText = async (paneId: number, text: string): Promise<void> => {
  await run(['cli', 'send-text', '--pane-id', String(paneId), '--no-paste', '--', text])
}

/** Terminate a pane and everything running in it; the poller drops it next tick. */
export const killPane = async (paneId: number): Promise<void> => {
  await run(['cli', 'kill-pane', '--pane-id', String(paneId)])
}

/** Bring the WezTerm app window to the foreground (macOS only; no-op elsewhere). */
export const bringToFront = async (): Promise<void> => {
  if (process.platform !== 'darwin') return
  await execFileAsync('osascript', ['-e', 'tell application "WezTerm" to activate'])
}

/** The Lua bridge is the sole focus executor, for both same- and cross-workspace jumps. */
const FOCUS_REQUEST_DIR = join(homedir(), '.cache', 'cc-mission-control')
const FOCUS_REQUEST_FILE = join(FOCUS_REQUEST_DIR, 'focus-request')
const FOCUS_REQUEST_TEMP_FILE = join(FOCUS_REQUEST_DIR, 'focus-request.tmp')

export type FocusRequest = {
  requestId: number
  paneId: number
  expiresAtSeconds: number
}

export const serializeFocusRequest = (request: FocusRequest): string =>
  `v1\t${request.requestId}\t${request.paneId}\t${request.expiresAtSeconds}\n`

let focusWrite = Promise.resolve()

export const writeFocusRequest = (request: FocusRequest): Promise<void> => {
  const pending = focusWrite.then(async () => {
    await mkdir(FOCUS_REQUEST_DIR, { recursive: true })
    await writeFile(FOCUS_REQUEST_TEMP_FILE, serializeFocusRequest(request))
    await rename(FOCUS_REQUEST_TEMP_FILE, FOCUS_REQUEST_FILE)
  })
  focusWrite = pending.catch(() => undefined)
  return pending
}

/** Drop any request left over from a previous run (e.g. bridge not installed yet). */
export const clearFocusRequest = async (): Promise<void> => {
  await Promise.all([
    rm(FOCUS_REQUEST_FILE, { force: true }),
    rm(FOCUS_REQUEST_TEMP_FILE, { force: true }),
  ])
}
