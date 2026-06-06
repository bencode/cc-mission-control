# CC Mission Control

A mission-control dashboard for [Claude Code](https://claude.com/claude-code) sessions running in [WezTerm](https://wezterm.org).

When you run a dozen Claude Code sessions across WezTerm workspaces and tabs, you lose track of who is working, who is stuck waiting for your approval, and who has been idle for an hour. This tool gives you the movie-style control-room wall: every session as a live, full-color terminal thumbnail, grouped by workspace, with status at a glance.

![Status](https://img.shields.io/badge/status-experimental-orange)

![CC Mission Control dashboard](docs/screenshot.png)

> Live capture of a real session wall — 20 panes across 6 workspaces. The amber tile is blocked on a permission prompt and can be approved right from the dashboard. (Terminal contents blurred for this screenshot.)

## Features

- **Live terminal thumbnails** — each pane rendered by xterm.js from WezTerm's ANSI screen dump, scaled down. What you see is exactly what the terminal shows, in color.
- **Status detection, zero config** — Claude Code already encodes its state in the pane title it sets (braille spinner = working, `✳` = idle). Permission dialogs and plan approvals are detected from the visible screen, shown as `waiting` with an amber pulse.
- **Click to focus** — click a tile and WezTerm jumps to that pane and comes to the foreground.
- **Quick approve** — sessions blocked on a permission prompt show `✓ Approve` / `✗ Esc` buttons right on the tile, so you can unblock them without switching over.
- **Workspace grouping & summary** — tiles grouped by WezTerm workspace; the top bar counts `working · waiting · idle · shell`, and the page title flags waiting sessions for your browser tab.

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

## How it works

```
wezterm cli list ──┐
wezterm cli get-text --escapes ──┤  poller (1s tick, per-pane content hash)
                                 ▼
                       node:http server ── SSE ──▶ browser
                                 ▲                  └─ one xterm.js instance per pane,
   POST /api/focus ── activate-pane                    created at the pane's real cols×rows,
   POST /api/send ──── send-text                       scaled down with CSS transform
```

- `src/wezterm.ts` — thin wrappers around `wezterm cli` (the only WezTerm-specific code; a tmux adapter would slot in here)
- `src/status.ts` — pure functions mapping pane title + screen text to `working | waiting | idle | shell`
- `src/poller.ts` — polling loop, emits only panes whose content changed
- `src/server.ts` — SSE stream, focus/send actions, static files
- `src/client/` — tile grid, xterm rendering, workspace grouping

## Development

```sh
pnpm test         # status detection unit tests (real captured fixtures)
pnpm typecheck
```

## Limitations

- Only sees Claude Code sessions running inside WezTerm panes (not VS Code, web, or other terminals).
- Status detection is heuristic — it parses what is on screen. New Claude Code UI wording may need a pattern update in `src/status.ts`.
- The approve button sends the keystroke `1`, which selects "Yes" in current permission dialogs.

## License

MIT
