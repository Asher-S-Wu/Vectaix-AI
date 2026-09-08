"""STDIO MCP transport — spawn a child process, talk JSON-RPC over stdin/stdout.

Flow: spawn -> initialize handshake -> tools/list / tools/call. Each line on the
child's stdout is one JSON-RPC message (newline-delimited JSON, the MCP stdio
convention). Crash (non-zero exit / broken pipe before a reply) triggers ONE
automatic retry. 5-minute overall timeout per call.

`$ENV_VAR` references in env values are expanded from the parent environment.
Missing commands (npx/uvx/...) are auto-resolved via utils.deps first.
"""

import json
import os
import subprocess
import threading

from transport.http import MCPError, expand_env  # reuse error type + expander
from utils import deps

TIMEOUT_SECONDS = 300  # 5 min


def _expand_env_map(env):
    merged = dict(os.environ)
    for k, v in (env or {}).items():
        merged[k] = expand_env(v)
    return merged


class STDIOTransport:
    def __init__(self, server, server_name):
        self.command = server.get("command", "")
        self.args = server.get("args", []) or []
        self.env = _expand_env_map(server.get("env"))
        self.server_name = server_name
        self._id = 0

    def _next_id(self):
        self._id += 1
        return self._id

    def _spawn(self):
        deps.ensure_command(self.command)
        try:
            return subprocess.Popen(
                [self.command] + list(self.args),
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                env=self.env,
                text=True,
                bufsize=1,
            )
        except FileNotFoundError:
            raise MCPError("CONNECTION_ERROR", "command not found: %s" % self.command)
        except OSError as exc:
            raise MCPError("CONNECTION_ERROR", str(exc))

    def _send(self, proc, method, params=None, notify=False):
        body = {"jsonrpc": "2.0", "method": method}
        if not notify:
            body["id"] = self._next_id()
        if params is not None:
            body["params"] = params
        try:
            proc.stdin.write(json.dumps(body) + "\n")
            proc.stdin.flush()
        except (BrokenPipeError, ValueError):
            raise MCPError("STDIO_CRASH", "child closed stdin")

    def _read_reply(self, proc, want_id):
        """Read newline-delimited JSON until we see the reply for want_id.
        Raises STDIO_CRASH on EOF, TIMEOUT on the watchdog."""
        result_box = {}

        def reader():
            try:
                for line in proc.stdout:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        msg = json.loads(line)
                    except ValueError:
                        continue
                    if msg.get("id") == want_id:
                        result_box["msg"] = msg
                        return
            except (ValueError, OSError):
                pass
            result_box.setdefault("eof", True)

        t = threading.Thread(target=reader, daemon=True)
        t.start()
        t.join(TIMEOUT_SECONDS)
        if t.is_alive():
            raise MCPError("TIMEOUT", "no reply after %ds" % TIMEOUT_SECONDS)
        if "msg" not in result_box:
            raise MCPError("STDIO_CRASH", "child exited before replying")
        return result_box["msg"]

    def _rpc(self, proc, method, params=None):
        want_id = self._id + 1
        self._send(proc, method, params)
        reply = self._read_reply(proc, want_id)
        if reply.get("error"):
            err = reply["error"]
            raise MCPError("MCP_ERROR", err.get("message", json.dumps(err)))
        return reply.get("result")

    def _handshake(self, proc):
        result = self._rpc(
            proc,
            "initialize",
            {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "minis-mcp-cli", "version": "1.0.0"},
            },
        )
        self._send(proc, "notifications/initialized", notify=True)
        return result

    def _session(self, fn):
        """Run fn(proc) inside one spawned child, with a single crash retry."""
        last_err = None
        for attempt in range(2):
            self._id = 0
            proc = self._spawn()
            try:
                self._handshake(proc)
                return fn(proc)
            except MCPError as exc:
                last_err = exc
                if exc.code != "STDIO_CRASH" or attempt == 1:
                    raise
                # else: retry once on a crash
            finally:
                try:
                    proc.terminate()
                except OSError:
                    pass
        if last_err:
            raise last_err

    def list_tools(self):
        return self._session(
            lambda proc: (self._rpc(proc, "tools/list") or {}).get("tools", [])
        )

    def call_tool(self, tool, arguments):
        return self._session(
            lambda proc: self._rpc(
                proc, "tools/call", {"name": tool, "arguments": arguments or {}}
            )
        )

    def ping(self):
        return self._session(lambda proc: True)
