#!/usr/bin/env python3
"""
Insert entries into src/ios/Localizable.xcstrings safely and incrementally.

Usage:
    # dry run first — shows exactly what would change, writes nothing
    scripts/add_localization.py new_strings.json --dry-run

    # apply
    scripts/add_localization.py new_strings.json

    # read from stdin
    echo '{"Add Rule": {"zh-Hans": "添加规则"}}' | scripts/add_localization.py -

Input is {key: {locale: translation}}:

    {
      "Thinking Rules":  {"zh-Hans": "思考规则"},
      "Copy of %@":      {"zh-Hans": "%@ 的副本", "ja": "%@ のコピー"}
    }

The English value defaults to the key itself (the catalog's source language is
`en`, and the key IS the English string), so `"en"` only needs to be given when
it should differ from the key. Locales you omit are left OUT of the entry rather
than filled with an English copy: a missing locale already falls back to the
source language at runtime, and leaving it absent keeps it visibly untranslated
for a future translator instead of masking it as done.

WHY THIS SCRIPT EXISTS
----------------------
Localizable.xcstrings is one ~80k-line JSON file holding every string in the
app. Rewriting it with `json.dump` reflows all of it, because Xcode writes
`"key" : {` (spaces around the colon) and json.dump writes `"key": {`. That
turns a 50-line addition into an 80,000-line diff, which buries the real change
and collides with any other session touching the file.

So this script never re-serialises the document. It renders each new entry in
Xcode's exact byte format and splices it in at the correct alphabetical
position, leaving every existing byte untouched. The result is a pure-insertion
diff.

SAFETY
------
After writing, the file is re-parsed and compared against a snapshot taken
before the edit. The script fails loudly (and restores the original bytes) if:
  * any pre-existing key disappeared,
  * any pre-existing entry's content changed,
  * a requested key is missing from the result,
  * the file no longer parses as JSON.
Re-running with keys that already exist is a no-op — the script is idempotent
and will never create a duplicate entry.
"""

import argparse
import json
import pathlib
import re
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
CATALOG = REPO / "src" / "ios" / "Localizable.xcstrings"

# Top-level entries are exactly four spaces in, then a quoted key, then ' : {'.
# Anchoring on the line start is what keeps nested "localizations"/locale keys
# (six spaces or deeper) from being mistaken for entry boundaries.
ENTRY_RE = re.compile(r'^    ("(?:[^"\\]|\\.)*") : \{$', re.M)


def esc(s: str) -> str:
    """JSON-escape a string, keeping non-ASCII literal (as Xcode does)."""
    return json.dumps(s, ensure_ascii=False)


def render_entry(key: str, locales: dict) -> str:
    """One catalog entry in Xcode's exact formatting."""
    body = [f'    {esc(key)} : {{', '      "extractionState" : "manual",',
            '      "localizations" : {']
    items = sorted(locales.items())
    for i, (loc, value) in enumerate(items):
        tail = "" if i == len(items) - 1 else ","
        body += [
            f'        {esc(loc)} : {{',
            '          "stringUnit" : {',
            '            "state" : "translated",',
            f'            "value" : {esc(value)}',
            '          }',
            f'        }}{tail}',
        ]
    body += ['      }', '    },']
    return "\n".join(body) + "\n"


def load_input(path: str) -> dict:
    raw = sys.stdin.read() if path == "-" else pathlib.Path(path).read_text()
    data = json.loads(raw)
    if not isinstance(data, dict):
        sys.exit("input must be a JSON object of {key: {locale: value}}")
    out = {}
    for key, locales in data.items():
        if isinstance(locales, str):
            # Convenience: {"key": "翻译"} is treated as zh-Hans.
            locales = {"zh-Hans": locales}
        if not isinstance(locales, dict):
            sys.exit(f"value for {key!r} must be an object or a string")
        locales = dict(locales)
        locales.setdefault("en", key)     # source language == the key itself
        out[key] = locales
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="Safely add entries to Localizable.xcstrings")
    ap.add_argument("input", help="JSON file of {key: {locale: value}}, or - for stdin")
    ap.add_argument("--dry-run", action="store_true", help="report changes, write nothing")
    ap.add_argument("--catalog", default=str(CATALOG), help="override catalog path")
    args = ap.parse_args()

    catalog = pathlib.Path(args.catalog)
    if not catalog.exists():
        sys.exit(f"catalog not found: {catalog}")

    wanted = load_input(args.input)
    original = catalog.read_text()
    before = json.loads(original)["strings"]

    new = [k for k in wanted if k not in before]
    dupes = [k for k in wanted if k in before]

    print(f"catalog : {catalog}")
    print(f"existing: {len(before)} keys")
    print(f"requested: {len(wanted)}  →  new: {len(new)}, already present: {len(dupes)}")
    for k in dupes:
        print(f"  = skip (exists): {k[:70]}")
    for k in new:
        locs = ",".join(sorted(wanted[k]))
        print(f"  + add [{locs}]: {k[:60]}")

    if not new:
        print("\nnothing to do — catalog already contains every requested key.")
        return 0
    if args.dry_run:
        print("\n--dry-run: no changes written.")
        return 0

    # Entry offsets, so each insertion lands in alphabetical order.
    starts = [(m.start(), json.loads(m.group(1))) for m in ENTRY_RE.finditer(original)]
    if not starts:
        sys.exit("could not locate any entry boundaries — catalog format unexpected?")

    # Everything after the last entry (the closing of "strings" + "version").
    tail_anchor = original.rindex('  },\n  "version"')

    inserts = []
    for key in new:
        pos = next((off for off, k in starts if k > key), tail_anchor)
        inserts.append((pos, render_entry(key, wanted[key])))

    text = original
    for off, chunk in sorted(inserts, key=lambda t: -t[0]):   # back-to-front
        text = text[:off] + chunk + text[off:]

    catalog.write_text(text)

    # ---- verify, and roll back on any surprise -------------------------------
    try:
        after = json.loads(catalog.read_text())["strings"]
    except Exception as e:
        catalog.write_text(original)
        sys.exit(f"FAILED: result is not valid JSON ({e}). Original restored.")

    lost = sorted(set(before) - set(after))
    modified = sorted(k for k in before if k in after and before[k] != after[k])
    missing = sorted(k for k in wanted if k not in after)
    added = sorted(set(after) - set(before))

    problems = []
    if lost:
        problems.append(f"{len(lost)} pre-existing key(s) LOST: {lost[:5]}")
    if modified:
        problems.append(f"{len(modified)} pre-existing entr(y/ies) MODIFIED: {modified[:5]}")
    if missing:
        problems.append(f"{len(missing)} requested key(s) MISSING: {missing[:5]}")
    if len(added) != len(new):
        problems.append(f"expected {len(new)} additions, found {len(added)}")

    if problems:
        catalog.write_text(original)
        print("\nFAILED — original restored:", file=sys.stderr)
        for p in problems:
            print("  ✗ " + p, file=sys.stderr)
        return 1

    print(f"\n✅ lost=0  modified=0  added={len(added)}  ({len(before)} → {len(after)} keys)")
    print("   diff is pure insertion; run `git diff --numstat` to confirm.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
