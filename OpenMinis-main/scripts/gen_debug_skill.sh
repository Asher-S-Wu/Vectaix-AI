#!/usr/bin/env bash
# Generate DebugSkillGenerated.swift — embeds the debug-server SKILL.md and the
# three reference clients as base64 so the DEBUG-only debug server can serve
# them unauthenticated (GET / and GET /skill). Run as an Xcode build phase.
#
# base64 is used so arbitrary markdown/code (quotes, backslashes, newlines,
# non-ASCII) survives verbatim into a Swift string literal with zero escaping.
#
# DO NOT EDIT / DO NOT COMMIT the output (Generated/ is gitignored).
set -eu

SRCROOT="${SRCROOT:-$(cd "$(dirname "$0")/../src/ios" && pwd)}"
REPO_ROOT="$(cd "$SRCROOT/../.." && pwd)"
SKILL_DIR="$REPO_ROOT/.claude/skills/debug-server"
OUT="$SRCROOT/Generated/DebugSkillGenerated.swift"
mkdir -p "$SRCROOT/Generated"

# base64 with no line wrapping (-i ignores garbage; -b0/-w0 differ by platform).
b64() { base64 -i "$1" 2>/dev/null | tr -d '\n'; }

emit_const() { # <swift-name> <file>
  local name="$1" file="$2" data=""
  [ -f "$file" ] && data="$(b64 "$file")"
  printf '    static let %s = "%s"\n' "$name" "$data"
}

TMP="$OUT.tmp"
{
  echo '// Generated at build time by scripts/gen_debug_skill.sh from'
  echo '// .claude/skills/debug-server/. DO NOT EDIT, DO NOT COMMIT.'
  echo '// Values are base64; decode at use site.'
  echo '#if DEBUG'
  echo 'import Foundation'
  echo ''
  echo 'enum DebugSkillGenerated {'
  emit_const "skillMarkdownB64"  "$SKILL_DIR/SKILL.md"
  emit_const "clientPythonB64"   "$SKILL_DIR/examples/minis_rpc.py"
  emit_const "clientNodeB64"     "$SKILL_DIR/examples/minis_rpc.mjs"
  emit_const "clientBashB64"     "$SKILL_DIR/examples/minis_rpc.sh"
  echo '}'
  echo '#endif'
} > "$TMP"

# Only replace when changed, to avoid needless recompiles.
if [ ! -f "$OUT" ] || ! cmp -s "$TMP" "$OUT"; then mv "$TMP" "$OUT"; else rm -f "$TMP"; fi
