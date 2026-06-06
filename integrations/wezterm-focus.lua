-- cc-mission-control focus bridge
--
-- `wezterm cli activate-pane` cannot switch the GUI's active workspace, so the
-- dashboard writes the target pane id to a request file and this handler — which
-- runs inside the WezTerm GUI, where SwitchToWorkspace is available — picks it
-- up on the next status tick (~1s) and performs the full jump.
--
-- Install: add to your wezterm.lua, before `return config`:
--   dofile('/path/to/cc-mission-control/integrations/wezterm-focus.lua')

local wezterm = require 'wezterm'

local REQUEST_FILE = os.getenv('HOME') .. '/.cache/cc-mission-control/focus-request'

local function readRequest()
  local file = io.open(REQUEST_FILE, 'r')
  if not file then return nil end
  local pane_id = tonumber(file:read('*l'))
  file:close()
  os.remove(REQUEST_FILE)
  return pane_id
end

local function jumpToPane(window, pane, pane_id)
  local target = wezterm.mux.get_pane(pane_id)
  if not target then return end
  local tab = target:tab()
  local mux_window = tab and tab:window()
  if not mux_window then return end
  window:perform_action(
    wezterm.action.SwitchToWorkspace { name = mux_window:get_workspace() },
    pane
  )
  tab:activate()
  target:activate()
end

wezterm.on('update-status', function(window, pane)
  local ok, pane_id = pcall(readRequest)
  if ok and pane_id then pcall(jumpToPane, window, pane, pane_id) end
end)
