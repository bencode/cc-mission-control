# CC Mission Control

A mission-control dashboard for [Claude Code](https://claude.com/claude-code) and Codex sessions running in [WezTerm](https://wezterm.org).

When you run a dozen agent sessions across WezTerm workspaces and tabs, you lose track of who is working, who is stuck waiting for your approval, and who has been idle for an hour. This tool gives you the movie-style control-room wall: every session as a live, full-color terminal thumbnail, grouped by workspace, with status at a glance.

![Status](https://img.shields.io/badge/status-experimental-orange)

![CC Mission Control dashboard](docs/screenshot.png)

> Live capture of a real session wall, grouped by workspace. The violet ring marks the pane currently focused in WezTerm; waiting sessions pulse amber with an Approve button right on the tile.

## Features

- **Live terminal thumbnails** — each pane rendered by xterm.js from WezTerm's ANSI screen dump, scaled down. What you see is exactly what the terminal shows, in color.
- **Status detection, zero config** — Claude Code and Codex sessions are detected from WezTerm pane titles plus attached terminal processes. Claude title markers and Codex action-required titles map to `working | waiting | idle`, with permission dialogs and approvals shown as `waiting` with an amber pulse.
- **Click to zoom** — click a tile to open the session near full size in a lightbox (live-updating), so you can read exactly what is on screen before acting. Jump to the pane in WezTerm from there, or press Escape to go back to the wall.
- **Quick approve, with eyes open** — sessions blocked on a permission prompt show `✓ Approve` / `✗ Esc` buttons on both the tile and the zoom view: glance at the title for routine prompts, or zoom in to read the full dialog before approving.
- **Workspace grouping & summary** — tiles grouped by WezTerm workspace; the top bar breaks `working · waiting · idle` down by Codex/Claude counts, reports the shell total, and the page title flags all waiting sessions for your browser tab.

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

The dashboard uses one focus path for every card: a bundled Lua bridge that can switch
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
- `src/client/` — tile grid, xterm rendering, workspace grouping

## Development

```sh
pnpm test         # status detection unit tests (real captured fixtures)
pnpm typecheck
```

## Limitations

- Only sees Claude Code and Codex sessions running inside WezTerm panes (not VS Code, web, or other terminals).
- Card focus requires the Lua bridge above; the WezTerm CLI alone cannot switch workspaces consistently.
- Status detection is heuristic — it parses pane titles, attached terminal processes, and selected visible-screen patterns. New Claude Code or Codex UI wording may need a pattern update in `src/status.ts`.
- The approve button sends the keystroke `1`, which selects "Yes" in current permission dialogs.

## License

MIT
