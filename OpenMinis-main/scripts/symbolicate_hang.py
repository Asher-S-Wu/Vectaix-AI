#!/usr/bin/env python3
"""
Symbolicate hang detector dumps from `debug.hangDetector.dump`.

Usage:
    # Live: pull from device debug server (5321), symbolicate, print.
    scripts/symbolicate_hang.py --live

    # From a saved JSON dump (the full RPC response or just the events array).
    scripts/symbolicate_hang.py path/to/dump.json

Resolves Minis frames to source-line via `atos` against the most recent
matching dSYM under ~/Library/Developer/Xcode/Archives. Other-image frames
(UIKitCore, SwiftUI, CoreFoundation, …) are passed through as-is — Apple
private framework symbols aren't usually present locally.

Designed to be invoked by either humans or AI: output is structured but
human-readable, with one frame per line preceded by image+offset, then
the resolved symbol on a continuation line.
"""

from __future__ import annotations

import argparse
import json
import os
import shlex
import subprocess
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any


ARCHIVES_ROOT = Path.home() / "Library/Developer/Xcode/Archives"
# Use a synthetic load address for atos. The dSYM is non-PIE (DWARF), so
# `-l <load> + actual_pc = pc_in_dwarf`. With load=0x100000000 we just feed
# load + image_offset as the PC and atos resolves it.
ATOS_LOAD_ADDR = 0x100000000


def _eprint(*args: Any, **kwargs: Any) -> None:
    print(*args, file=sys.stderr, **kwargs)


def _find_minis_dsym(prefer_archive_after: datetime | None = None) -> Path | None:
    """Return the most recent Minis.app.dSYM."""
    candidates: list[tuple[datetime, Path]] = []
    if not ARCHIVES_ROOT.exists():
        return None
    for date_dir in ARCHIVES_ROOT.iterdir():
        if not date_dir.is_dir():
            continue
        for archive in date_dir.glob("Minis*.xcarchive"):
            dsym = archive / "dSYMs" / "Minis.app.dSYM"
            if dsym.exists():
                mtime = datetime.fromtimestamp(archive.stat().st_mtime)
                candidates.append((mtime, dsym))
    if not candidates:
        return None
    candidates.sort(reverse=True)
    return candidates[0][1]


def _atos_batch(
    dsym: Path, addresses: list[int], load_addr: int = ATOS_LOAD_ADDR
) -> list[str]:
    """Resolve a batch of addresses (PC values) to symbol strings."""
    if not addresses:
        return []
    binary = dsym / "Contents/Resources/DWARF/Minis"
    if not binary.exists():
        return [f"<dSYM binary missing: {binary}>"] * len(addresses)
    cmd = [
        "atos",
        "-arch", "arm64",
        "-o", str(binary),
        "-l", hex(load_addr),
    ] + [hex(a) for a in addresses]
    try:
        out = subprocess.check_output(cmd, text=True, stderr=subprocess.DEVNULL)
    except Exception as exc:
        return [f"<atos failed: {exc}>"] * len(addresses)
    lines = out.rstrip("\n").splitlines()
    if len(lines) != len(addresses):
        # atos sometimes joins lines; pad defensively.
        while len(lines) < len(addresses):
            lines.append("<missing>")
    return lines


def _symbolicate_event(event: dict[str, Any], dsym: Path | None) -> str:
    ts = event.get("timestamp", 0)
    when = datetime.fromtimestamp(ts).isoformat(timespec="milliseconds") if ts else "?"
    duration = event.get("durationMs", 0)
    activity = event.get("runLoopActivity", 0)
    frames = event.get("frames", [])

    out = [f"=== Hang @ {when}  duration={duration:.0f}ms  activity=0x{activity:x}  depth={len(frames)} ==="]

    # Group Minis frames for batch atos call.
    minis_idx: list[int] = []
    minis_offsets: list[int] = []
    for i, frame in enumerate(frames):
        if frame.get("image") == "Minis":
            off_str = frame.get("offset", "0x0")
            try:
                off = int(off_str, 16)
            except (TypeError, ValueError):
                continue
            minis_idx.append(i)
            minis_offsets.append(ATOS_LOAD_ADDR + off)

    minis_resolved: dict[int, str] = {}
    if dsym is not None and minis_offsets:
        resolved = _atos_batch(dsym, minis_offsets)
        for idx, sym in zip(minis_idx, resolved):
            minis_resolved[idx] = sym

    for i, frame in enumerate(frames):
        image = frame.get("image", "?")
        offset = frame.get("offset", "0x0")
        addr = frame.get("address", "0x0")
        symbol = frame.get("symbol")
        line = f"  #{i:<2} {image} + {offset}"
        if image == "Minis" and i in minis_resolved:
            line += f"\n      {minis_resolved[i]}"
        elif symbol:
            line += f"\n      {symbol}  (raw addr {addr})"
        out.append(line)
    return "\n".join(out)


def _events_from_payload(payload: Any) -> list[dict[str, Any]]:
    """Accept either the full RPC envelope or just the events list."""
    if isinstance(payload, dict):
        if "result" in payload and isinstance(payload["result"], dict):
            payload = payload["result"]
        if isinstance(payload, dict) and "events" in payload:
            return payload["events"] or []
    if isinstance(payload, list):
        return payload
    return []


def _fetch_live(host: str, port: int, last: int) -> list[dict[str, Any]]:
    import urllib.request
    body = json.dumps({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "debug.hangDetector.dump",
        "params": {"last": last},
    }).encode()
    url = f"http://{host}:{port}/"
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read())
    return _events_from_payload(data)


def main() -> int:
    parser = argparse.ArgumentParser(description="Symbolicate hang detector dumps.")
    parser.add_argument("path", nargs="?", help="JSON file containing dump output")
    parser.add_argument("--live", action="store_true",
                        help="Pull live from debug server")
    parser.add_argument("--host", default="localhost")
    parser.add_argument("--port", type=int, default=5321)
    parser.add_argument("--last", type=int, default=20,
                        help="How many recent events to fetch in --live mode")
    parser.add_argument("--dsym", type=str, default=None,
                        help="Override dSYM path (default: auto-discover newest)")
    args = parser.parse_args()

    if not args.live and not args.path:
        parser.error("supply either --live or a path to a JSON dump")

    if args.live:
        try:
            events = _fetch_live(args.host, args.port, args.last)
        except Exception as exc:
            _eprint(f"live fetch failed: {exc}")
            return 1
    else:
        try:
            with open(args.path) as fh:
                payload = json.load(fh)
        except Exception as exc:
            _eprint(f"failed to read {args.path}: {exc}")
            return 1
        events = _events_from_payload(payload)

    if not events:
        print("(no hang events)")
        return 0

    dsym: Path | None
    if args.dsym:
        dsym = Path(args.dsym).expanduser()
        if not dsym.exists():
            _eprint(f"explicit --dsym does not exist: {dsym}")
            dsym = None
    else:
        dsym = _find_minis_dsym()
        if dsym is None:
            _eprint("WARN: no Minis.app.dSYM found under ~/Library/Developer/Xcode/Archives;")
            _eprint("      Minis frames will not be symbolicated.")

    if dsym:
        _eprint(f"using dSYM: {dsym}")

    for ev in events:
        print(_symbolicate_event(ev, dsym))
        print()

    return 0


if __name__ == "__main__":
    sys.exit(main())
