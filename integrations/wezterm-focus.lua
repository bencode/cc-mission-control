-- cc-mission-control focus bridge
--
-- The dashboard writes every focus intent to a small mailbox. This handler runs
-- inside the WezTerm GUI, where SwitchToWorkspace is available, and is the sole
-- executor for both same- and cross-workspace jumps. Its 200ms timer is
-- independent of WezTerm's status update events.
--
-- Install: add to your wezterm.lua, before `return config`:
--   local focus_bridge = '/path/to/cc-mission-control/integrations/wezterm-focus.lua'
--   wezterm.add_to_config_reload_watch_list(focus_bridge)
--   dofile(focus_bridge)

local wezterm = require 'wezterm'

local REQUEST_FILE = os.getenv('HOME') .. '/.cache/cc-mission-control/focus-request'

local function readRequest()
  local file = io.open(REQUEST_FILE, 'r')
  if not file then return nil end
  local raw = file:read('*l')
  file:close()
  if not raw then return nil end
  local version, request_id, pane_id, expires_at = raw:match('^(v%d+)\t(%d+)\t(%d+)\t(%d+)$')
  return {
    raw = raw,
    valid = version == 'v1',
    request_id = tonumber(request_id),
    pane_id = tonumber(pane_id),
    expires_at = tonumber(expires_at),
  }
end

-- A newer click may overwrite the mailbox while this request is executing.
-- Remove only the exact request we read, so the latest intent always survives.
local function removeRequest(request)
  local current = readRequest()
  if current and current.raw == request.raw then os.remove(REQUEST_FILE) end
end

local function jumpToPane(window, pane, pane_id)
  local target = wezterm.mux.get_pane(pane_id)
  if not target then return false end
  local tab = target:tab()
  local mux_window = tab and tab:window()
  if not mux_window then return false end
  window:perform_action(
    wezterm.action.SwitchToWorkspace { name = mux_window:get_workspace() },
    pane
  )
  tab:activate()
  target:activate()
  return true
end

local function focusedWindow()
  if not wezterm.gui then return nil end
  local windows = wezterm.gui.gui_windows()
  for _, window in ipairs(windows) do
    if window:is_focused() then return window end
  end
  return nil
end

local function processRequest()
  local request = readRequest()
  if not request then return end
  if not request.valid or request.expires_at <= os.time() then
    removeRequest(request)
    return
  end

  local window = focusedWindow()
  if window and jumpToPane(window, window:active_pane(), request.pane_id) then
    removeRequest(request)
  end
end

local function poll()
  local ok, err = pcall(processRequest)
  if not ok then wezterm.log_error('cc-mission-control: focus request failed: ' .. tostring(err)) end
  wezterm.time.call_after(0.2, poll)
end

poll()
