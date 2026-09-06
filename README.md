# CC Mission Control

A mission-control dashboard for [Claude Code](https://claude.com/claude-code) and Codex sessions running in [WezTerm](https://wezterm.org).

Monitor Claude Code and Codex sessions in one dense, live terminal wall. The UI keeps every visible session's full terminal preview, with an in-grid reading view for the agent you want to inspect.

![Status](https://img.shields.io/badge/status-experimental-orange)

![CC Mission Control live terminal wall with an expanded session](docs/screenshot.png)

The live terminal wall keeps other agents visible while one session expands in place for reading. Search, workspace and status filters help you find the next session to inspect.

## Features

- **Continuous terminal wall** — sessions fill one grid, ordered by waiting, working, idle, then shell; workspace labels stay inside the cards. Auto columns adapt to the window, up to five columns. On a 1536×1024 desktop, the compact layout fits 20 normal cards.
- **Search and filters** — combine title/workspace/directory search, a workspace selector, and status filters. Shell sessions are hidden by default. Filters change only the displayed cards.
- **Expand in place** — click a card to move it to the start of its row and expand it across two columns and two rows. Other terminals keep updating. Status changes do not reorder cards during reading; collapse restores the normal order. On a single-column screen, expansion uses one column.
- **Readable output** — small previews fit the entire terminal screen. Expanded cards use 14px text and native scrolling, following the bottom until you scroll away. Maximize opens a larger reading view; Back or Escape returns to the expanded card.
- **Explicit actions** — Open in WezTerm uses the existing focus bridge. Approve (send 1) and Send Esc send the same keys as before. Close session still requires two clicks within three seconds. Action controls appear in the expanded and maximized views.
- **Next waiting** — cycles through waiting sessions in the current filters. The currently expanded session remains open when its status changes; new waiting sessions do not take over the reading view.
- **Focus and connection indicators** — Active in WezTerm identifies the actual terminal focus independently of the expanded card. External focus follows the original scrolling behavior in the overview, but does not scroll away from an expanded reading view. Reconnecting indicates potentially stale screens.

### Keyboard and display controls

Tab to a card title and press Enter or Space to expand/collapse it. Escape closes the maximized view first, then collapses the in-grid view; it does not send Escape to WezTerm. The column selector retains each browser's preference, with narrow windows limiting the actual number of columns. Full screen uses the browser's fullscreen mode.

The terminal capture, agent/status detection, SSE and reconnection, viewport-based mounting, screen writer, and focus/send/close endpoints are unchanged. The UI does not add terminal input, history, task inference, automatic approval, or retries.

## Requirements

- WezTerm (tested with `20240203-110809`) — the dashboard talks to `wezterm cli`
- Node.js ≥ 22, pnpm
- macOS for the bring-to-front behavior (everything else is cross-platform)

## Usage

```sh
pnpm install
pnpm dev          # builds the client and starts the server
open http://localhost:6080
```

Environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `6080` | HTTP port |
| `POLL_INTERVAL_MS` | `1000` | Screen capture interval |
| `WEZTERM_BIN` | auto-detected | Path to the `wezterm` binary |

## Click-to-focus bridge (required)

The dashboard uses one focus path for every session: a bundled Lua bridge that can switch
the GUI workspace, tab, and pane. Load it in your `wezterm.lua` before `return config`:

```lua
local focus_bridge = '/path/to/cc-mission-control/integrations/wezterm-focus.lua'
wezterm.add_to_config_reload_watch_list(focus_bridge)
dofile(focus_bridge)
```

After installing the bridge, reload the WezTerm configuration or restart WezTerm once.
The bridge then watches its own file, so later updates reload automatically. The
dashboard writes short-lived focus requests to
`~/.cache/cc-mission-control/focus-request`; the bridge checks for the latest request
every `200ms`. Expired requests are discarded, so a delayed bridge
cannot unexpectedly execute an old click.

The bridge timer is independent of `status_update_interval`; with no request file each
tick is only one failing `io.open`.

## How it works

```
wezterm cli list/get-text ── screen poll (1s, sequential capture) ──┐
wezterm cli list-clients ─── focus poll (250ms) ───────────────────┤
                                                                   ▼
                                                        node:http server ── SSE ──▶ browser
                                                                   ▲
POST /api/focus ── expiring mailbox ── Lua focus bridge ──────────┘
POST /api/send ─── wezterm cli send-text
```

- `src/wezterm.ts` — thin wrappers around `wezterm cli` (the only WezTerm-specific code; a tmux adapter would slot in here)
- `src/status.ts` — pure functions mapping pane title + screen text to `working | waiting | idle | shell`
- `src/poller.ts` — independent screen and focus polling, emits only changed panes
- `src/server.ts` — SSE stream, focus/send actions, static files
- `src/client/` — continuous tile grid, filtering, in-grid expansion, and xterm reading views

## Development

```sh
pnpm test         # status detection unit tests (real captured fixtures)
pnpm typecheck
```

## Limitations

- Only sees Claude Code and Codex sessions running inside WezTerm panes (not VS Code, web, or other terminals).
- Card focus requires the Lua bridge above; the WezTerm CLI alone cannot switch workspaces consistently.
- Status detection is heuristic — it parses pane titles, attached terminal processes, and selected visible-screen patterns. New Claude Code or Codex UI wording may need a pattern update in `src/status.ts`.
- Approve (send 1) sends the literal keystroke `1`. Read the current prompt before acting; waiting status detection is heuristic.

## License

MIT
