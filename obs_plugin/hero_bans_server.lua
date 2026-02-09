local socket = require("socket")

local host = "127.0.0.1"
local port = 8787
local server = nil
local state = {
  team1 = { ban = "" },
  team2 = { ban = "" },
  updatedAt = 0
}

local function json_escape(value)
  return value:gsub("\\", "\\\\"):gsub("\"", "\\\"")
end

local function encode_state()
  return string.format(
    "{\"team1\":{\"ban\":\"%s\"},\"team2\":{\"ban\":\"%s\"},\"updatedAt\":%d}",
    json_escape(state.team1.ban or ""),
    json_escape(state.team2.ban or ""),
    tonumber(state.updatedAt) or 0
  )
end

local function parse_body(body)
  local team1 = body:match("\"team1\"%s*:%s*%{[^}]-\"ban\"%s*:%s*\"(.-)\"") or ""
  local team2 = body:match("\"team2\"%s*:%s*%{[^}]-\"ban\"%s*:%s*\"(.-)\"") or ""
  local updatedAt = tonumber(body:match("\"updatedAt\"%s*:%s*(%d+)") or "0") or 0
  return {
    team1 = { ban = team1 },
    team2 = { ban = team2 },
    updatedAt = updatedAt
  }
end

local function send_response(client, status, headers, body)
  local lines = { "HTTP/1.1 " .. status }
  for key, value in pairs(headers or {}) do
    table.insert(lines, key .. ": " .. value)
  end
  table.insert(lines, "")
  table.insert(lines, body or "")
  client:send(table.concat(lines, "\r\n"))
end

local function handle_state_get(client)
  local payload = encode_state()
  send_response(client, "200 OK", {
    ["Content-Type"] = "application/json",
    ["Cache-Control"] = "no-store",
    ["Content-Length"] = tostring(#payload)
  }, payload)
end

local function handle_state_post(client, body)
  local parsed = parse_body(body or "")
  state.team1.ban = parsed.team1.ban or ""
  state.team2.ban = parsed.team2.ban or ""
  state.updatedAt = parsed.updatedAt or 0
  send_response(client, "204 No Content", { ["Content-Length"] = "0" }, "")
end

local function read_headers(client)
  local headers = {}
  while true do
    local line = client:receive("*l")
    if not line or line == "" then
      break
    end
    local key, value = line:match("^(.-):%s*(.*)$")
    if key and value then
      headers[key:lower()] = value
    end
  end
  return headers
end

local function read_body(client, headers)
  local length = tonumber(headers["content-length"] or "0") or 0
  if length <= 0 then
    return ""
  end
  return client:receive(length) or ""
end

local function handle_client(client)
  client:settimeout(0.01)
  local request_line = client:receive("*l")
  if not request_line then
    client:close()
    return
  end
  local method, path = request_line:match("^(%u+)%s+([^%s]+)")
  local headers = read_headers(client)
  if path == "/state" and method == "GET" then
    handle_state_get(client)
  elseif path == "/state" and method == "POST" then
    local body = read_body(client, headers)
    handle_state_post(client, body)
  else
    send_response(client, "404 Not Found", { ["Content-Length"] = "0" }, "")
  end
  client:close()
end

local function tick()
  if not server then
    return
  end
  local client = server:accept()
  if client then
    handle_client(client)
  end
end

function script_description()
  return "Runs the OW2 Hero Bans local server so dock/control/overlays share state."
end

function script_properties()
  local props = obs.obs_properties_create()
  obs.obs_properties_add_int(props, "port", "Server Port", 1024, 65535, 1)
  return props
end

function script_defaults(settings)
  obs.obs_data_set_default_int(settings, "port", 8787)
end

function script_update(settings)
  port = obs.obs_data_get_int(settings, "port")
  if server then
    server:close()
    server = nil
  end
  server = assert(socket.bind(host, port))
  server:settimeout(0)
end

function script_load(settings)
  script_update(settings)
  obs.timer_add(tick, 50)
end

function script_unload()
  obs.timer_remove(tick)
  if server then
    server:close()
    server = nil
  end
end
