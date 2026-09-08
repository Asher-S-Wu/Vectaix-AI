"""servers.json read/write — mcpServers object format (Claude-Desktop compatible).

Shared by iOS (iSH) and Android (PRoot). The same file is also read/written by
the native Settings UI (Swift MCPStore / Kotlin), so the on-disk schema must
stay exactly the mcpServers object form:

    {
      "mcpServers": {
        "<name>": {
          "url": "...", "headers": {...},        # HTTP transport, OR
          "command": "...", "args": [...], "env": {...},  # STDIO transport
          "note": "...",
          "enabled": true
        }
      }
    }
"""

import json
import os

CONFIG_DIR = "/var/minis/mcp-servers"
CONFIG_PATH = os.path.join(CONFIG_DIR, "servers.json")

# Startup / handshake timeout for a STDIO MCP server's first `initialize` RPC.
# This is a Minis server-configuration knob, NOT part of the MCP protocol (MCP
# only standardizes the JSON-RPC exchange after the client connects, not the
# client's local process-launch timeout). Slow-starting servers (e.g. a cold
# `uvx mcp-atlassian` that fetches packages) can take well over a minute before
# they answer `initialize`; the default gives them headroom, and the per-server
# field lets an operator extend it further.
DEFAULT_STARTUP_TIMEOUT = 60
# Upper bound so a fat-fingered value can't wedge a call thread indefinitely.
MAX_STARTUP_TIMEOUT = 900
# Primary field (highest priority) first, then compat aliases from other MCP
# clients, in descending priority. resolve_startup_timeout() reads these in
# order and uses the first present.
STARTUP_TIMEOUT_KEYS = (
    "startupTimeoutSeconds",   # Minis primary field (camelCase)
    "startup_timeout_sec",     # snake_case compat
    "startupTimeout",          # compat alias
    "handshakeTimeout",        # compat alias
    "initializeTimeout",       # compat alias
)


def _ensure_dir():
    try:
        os.makedirs(CONFIG_DIR, exist_ok=True)
    except OSError:
        pass


def load_config():
    """Return the parsed config dict ({"mcpServers": {...}}). Empty on missing
    or unparseable file (callers treat that as "no servers")."""
    _ensure_dir()
    if not os.path.exists(CONFIG_PATH):
        return {"mcpServers": {}}
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return {"mcpServers": {}}
    if not isinstance(data, dict) or not isinstance(data.get("mcpServers"), dict):
        return {"mcpServers": {}}
    return data


def save_config(config):
    """Write the config back atomically (write temp + rename) so a concurrent
    reader (Settings UI / agent) never sees a half-written file."""
    _ensure_dir()
    tmp = CONFIG_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
    os.replace(tmp, CONFIG_PATH)


def get_servers():
    """Return the mcpServers dict (name -> server object)."""
    return load_config().get("mcpServers", {})


def get_server(name):
    """Return one server object or None."""
    return get_servers().get(name)


def upsert_server(name, server):
    """Add or overwrite a server (last-write-wins on name collision)."""
    config = load_config()
    config.setdefault("mcpServers", {})[name] = server
    save_config(config)


def remove_server(name):
    """Delete a server. Returns True if it existed."""
    config = load_config()
    servers = config.setdefault("mcpServers", {})
    if name in servers:
        del servers[name]
        save_config(config)
        return True
    return False


def set_enabled(name, enabled):
    """Flip a server's enabled flag. Returns True if the server existed."""
    config = load_config()
    server = config.get("mcpServers", {}).get(name)
    if server is None:
        return False
    server["enabled"] = bool(enabled)
    save_config(config)
    return True


def is_http(server):
    return bool(server.get("url"))


def is_stdio(server):
    return bool(server.get("command"))


def resolve_startup_timeout(server):
    """Resolve a STDIO server's startup/handshake timeout in seconds.

    Reads STARTUP_TIMEOUT_KEYS in priority order and returns the first present
    value, coerced to a positive int within [1, MAX_STARTUP_TIMEOUT]. Missing
    → DEFAULT_STARTUP_TIMEOUT with no warning.

    Never silently swallows a bad value: a non-numeric / zero / negative /
    over-limit value falls back to the default AND returns a human/AI-readable
    warning naming the field, the given value, the accepted range, and the
    value actually used, so a misconfiguration is self-correctable.

    Returns (timeout:int, warning:str|None).
    """
    server = server or {}
    for key in STARTUP_TIMEOUT_KEYS:
        if key not in server:
            continue
        raw = server[key]
        # bool is an int subclass; treat true/false as invalid, not 1/0.
        if isinstance(raw, bool):
            return DEFAULT_STARTUP_TIMEOUT, _timeout_warning(key, raw)
        # Accept ints and integer-valued numeric strings only. A fractional
        # value (1.5, "1.5") is a misconfiguration, not silently truncated.
        try:
            fvalue = float(raw)
        except (TypeError, ValueError):
            return DEFAULT_STARTUP_TIMEOUT, _timeout_warning(key, raw)
        if fvalue != int(fvalue):
            return DEFAULT_STARTUP_TIMEOUT, _timeout_warning(key, raw)
        value = int(fvalue)
        if value < 1 or value > MAX_STARTUP_TIMEOUT:
            return DEFAULT_STARTUP_TIMEOUT, _timeout_warning(key, raw)
        return value, None
    return DEFAULT_STARTUP_TIMEOUT, None


def _timeout_warning(field, given):
    return (
        "ignoring %s=%r: startup timeout must be an integer number of seconds "
        "in [1, %d]; using default %ds instead"
        % (field, given, MAX_STARTUP_TIMEOUT, DEFAULT_STARTUP_TIMEOUT)
    )
