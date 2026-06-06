import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
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
