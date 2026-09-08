"""Runtime dependency auto-resolution for STDIO MCP servers.

When a server's `command` is something like `npx`/`uvx` that isn't installed in
the minimal Alpine rootfs, resolve it silently (log only, never touch stdout)
so the agent's `minis-mcp-cli call` just works. Shared iOS/Android.
"""

import os
import shutil
import subprocess

LOG_PATH = "/var/minis/mcp-servers/mcp-cli.log"


def _log(msg):
    try:
        os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
        import time
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write("[%s] [deps] %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), msg))
    except OSError:
        pass


def _run(cmd):
    """Run a shell command, swallow output into the log. Returns exit code."""
    try:
        proc = subprocess.run(
            cmd, shell=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT
        )
        out = (proc.stdout or b"").decode("utf-8", "replace").strip()
        if out:
            _log("%s -> %s" % (cmd, out[:500]))
        return proc.returncode
    except Exception as exc:  # noqa: BLE001 - best-effort, log and move on
        _log("%s -> exception %s" % (cmd, exc))
        return 1


# command-name -> install command(s) to try in order.
_RESOLVERS = {
    "npx": ["apk add --quiet nodejs npm"],
    "node": ["apk add --quiet nodejs npm"],
    "npm": ["apk add --quiet nodejs npm"],
    "python3": ["apk add --quiet python3 py3-pip"],
    "pip": ["apk add --quiet python3 py3-pip"],
    "uvx": ["pip install --quiet uv", "pip install --quiet --break-system-packages uv"],
    "uv": ["pip install --quiet uv", "pip install --quiet --break-system-packages uv"],
}


def ensure_command(command):
    """Best-effort: make `command` runnable. No-op if already on PATH or if we
    have no resolver for it. Never raises."""
    if not command:
        return
    # Strip any path; we resolve by basename.
    base = os.path.basename(command)
    if shutil.which(base) is not None:
        return
    installers = _RESOLVERS.get(base)
    if not installers:
        _log("no resolver for command '%s' (leaving as-is)" % base)
        return
    _log("resolving missing command '%s'" % base)
    for installer in installers:
        if _run(installer) == 0 and shutil.which(base) is not None:
            _log("resolved '%s' via: %s" % (base, installer))
            return
    _log("could not resolve '%s' after trying %d installer(s)" % (base, len(installers)))
