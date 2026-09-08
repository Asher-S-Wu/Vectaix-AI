# Minis URL Scheme Specification

**Status:** Draft
**Date:** 2026-02-16

## 1. Overview

`minis://` is a **session-scoped** unified resource locator for persistent, addressable resources within the Minis ecosystem. It bridges three layers — the AI agent, the iSH Linux shell, and the iOS host app — with a single URL that works in tool results, Markdown rendering, and inter-component references.

**`minis://` URLs are inherently session-bound.** Every resolution, read, write, and render operation is performed in the context of the current active session. There is no cross-session resource visibility — a `minis://attachments/photo.png` in Session A and the same URL in Session B refer to completely independent files. The agent, the shell, and the UI all see only the resources belonging to the active session.

### Design Principles

1. **Session-scoped**: All resource access is bound to the current session. `minis://` URLs are opaque identifiers — they carry no session ID, because they are always resolved against the active session's storage. Cross-session access is neither supported nor exposed.
2. **Agent-first**: Every persistent resource produced by a tool MUST be returned to the model as a `minis://` URL so the agent can reference it in subsequent turns.
3. **Render-ready**: The chat UI resolves `minis://` URLs inline — images, audio, video, and downloadable files render natively in Markdown.
4. **Bidirectional**: Files written by the shell or the host app are both addressable via the same URL scheme.
5. **Persistent within session**: Resources survive app restarts. Each session's files are isolated in persistent storage and mounted into `/var/minis/` on session load.

## 2. URL Format

```
minis://<namespace>/<path>
```

| Component     | Description |
|---------------|-------------|
| `minis://`    | Scheme. Always lowercase. |
| `<namespace>` | Top-level category (see §3). Mapped to URL host component. |
| `<path>`      | Relative path within the namespace. May include subdirectories. Mapped to URL path component. |

### Examples

```
minis://attachments/screenshot.png
minis://attachments/photos/vacation/img_001.jpg
minis://workspace/report.csv
minis://workspace/project/src/main.py
minis://offloads/shell_execute_1707000000_abc12345.txt
minis://browser/snapshot_1707000000.jpg
```

## 3. Session Model

`minis://` is a **session-relative** addressing scheme. The same URL string in different sessions resolves to different physical files.

### 3.1 Why No Session ID in the URL

The URL deliberately omits the session ID:
- The **agent** operates within a single session and has no concept of other sessions.
- The **shell** (`/var/minis/`) only ever sees one session's files at a time.
- The **chat UI** renders messages in the context of their owning session.
- Embedding session IDs would leak an implementation detail and create a temptation for cross-session references, which are not supported.

### 3.2 Resolution Context

Every `minis://` URL is resolved with an implicit session context:

| Layer | How session context is determined |
|-------|-----------------------------------|
| Agent (tool execution) | `AIChatViewModel.sessionId` — set when the session is loaded |
| Shell (iSH filesystem) | `/var/minis/` is mounted from the active session's persistent storage |
| Chat UI (Markdown render) | Messages belong to a session; the renderer resolves against the current session's files |
| Persistent storage | `Library/MinisChat/minis/<sessionId>/` — each session has its own directory tree |

### 3.3 Cross-Session Semantics

- **No cross-session reads:** An agent cannot access files from another session. There is no `minis://other-session/...` syntax.
- **No cross-session writes:** Writing to `/var/minis/` always targets the active session's storage.
- **Session deletion:** When a session is deleted, its entire `Library/MinisChat/minis/<sessionId>/` tree is removed. All `minis://` URLs from that session become permanently unresolvable.
- **History rendering:** When viewing chat history from a past session, `minis://` URLs resolve against that session's persisted files (loaded on session switch).

## 4. Namespaces

### 4.1 `attachments` — Media & Displayable Files

**Purpose:** Images, audio, video, and other media intended for inline display in chat.

| Property | Value |
|----------|-------|
| Linux path | `/var/minis/attachments/<path>` |
| Persistent storage | `Library/MinisChat/minis/<sessionId>/attachments/<path>` |
| Writable by | Agent (file_write, shell_execute), Host app (saveAttachment), User (input attachments) |
| Inline rendering | Yes — images, audio, video auto-render in Markdown |

**Supported inline media types:**
- Images: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.bmp`, `.tiff`, `.svg`
- Audio: `.mp3`, `.m4a`, `.wav`, `.aac`, `.ogg`, `.flac`
- Video: `.mp4`, `.mov`, `.m4v`, `.avi`, `.mkv`, `.webm`

**Markdown usage:**
```markdown
![description](minis://attachments/filename.png)
![audio](minis://attachments/recording.mp3)
![video](minis://attachments/demo.mp4)
```

### 4.2 `workspace` — General Working Files

**Purpose:** Scripts, data files, configuration, project files, and any non-media artifacts the agent creates or the user works with.

| Property | Value |
|----------|-------|
| Linux path | `/var/minis/workspace/<path>` |
| Persistent storage | `Library/MinisChat/minis/<sessionId>/workspace/<path>` |
| Writable by | Agent (file_write, shell_execute) |
| Inline rendering | No (text link only) |

**Markdown usage:**
```markdown
[report.csv](minis://workspace/report.csv)
```

### 4.3 `offloads` — Truncated Tool Outputs

**Purpose:** Automatically saved when a tool result exceeds `maxToolResultLength` (20,000 chars). The agent receives the truncated output plus a reference to the full file.

| Property | Value |
|----------|-------|
| Linux path | `/var/minis/offloads/<filename>` |
| Persistent storage | `Library/MinisChat/minis/<sessionId>/offloads/<filename>` |
| Writable by | Host app (automatic offload) |
| Inline rendering | No |
| Filename pattern | `<toolName>_<timestamp>_<toolIdPrefix>.txt` |

### 4.4 `browser` — Browser Snapshots (New)

**Purpose:** Screenshots and readable-text extracts from `browser_use` tool actions, addressable for the agent to reference later.

| Property | Value |
|----------|-------|
| Linux path | `/var/minis/browser/<filename>` |
| Persistent storage | `Library/MinisChat/minis/<sessionId>/browser/<filename>` |
| Writable by | Host app (after browser_use actions) |
| Inline rendering | Yes (images) |

## 5. Path Resolution

### 5.1 `minis://` → Linux Path

```
minis://<namespace>/<path>  →  /var/minis/<namespace>/<path>
```

Extract `host` as namespace, concatenate with `path`:
```swift
let linuxPath = "/var/minis/\(url.host!)\(url.path)"
```

### 5.2 Linux Path → Host Filesystem

```
/var/minis/<namespace>/<path>  →  <dataPath>/var/minis/<namespace>/<path>
```

Where `dataPath` = `~/Documents/alpine-rootfs/data/`.

```swift
func resolveHostPath(_ linuxPath: String) -> URL? {
    guard linuxPath.hasPrefix("/"), !linuxPath.contains("..") else { return nil }
    let relative = String(linuxPath.dropFirst())
    return RootfsManager.shared.dataPath.appendingPathComponent(relative)
}
```

### 5.3 Host Filesystem → Persistent Storage (Session Isolation)

```
<dataPath>/var/minis/<namespace>/<path>  →  Library/MinisChat/minis/<sessionId>/<namespace>/<path>
```

The iSH-visible directory (`/var/minis/`) is a **session-unaware working copy** — a transient mount point that always reflects exactly one session's files. The agent and the shell never see a session ID; they simply read and write `/var/minis/`. The host app is responsible for swapping the backing storage on session transitions.

**Session switch lifecycle:**
1. **Harvest** — copy any new/modified files from iSH data → outgoing session's persistent storage (captures shell-written files that haven't been persisted yet)
2. **Clear** — remove all files from the iSH-visible `/var/minis/` directory
3. **Mount** — copy all persistent files from the incoming session's storage → iSH-visible `/var/minis/`
4. **Register** — ensure all mounted files exist in meta.db so the iSH kernel can access them

**Isolation guarantee:** At no point during this lifecycle are files from two different sessions simultaneously visible under `/var/minis/`. The clear-then-mount sequence is atomic from the agent's perspective (it only runs within a session).

### 5.4 meta.db Registration

Every file written to the host filesystem (`dataPath/var/minis/...`) MUST be registered in iSH's `meta.db` for the Linux kernel to see it:

- `ensureFakefsMetadata(for: linuxPath, isDirectory: false)` — registers file inode
- `ensureParentDirsInMetaDB(for: linuxPath)` — ensures all ancestor directories exist

## 6. Tool Result Contract

**Core rule:** When a tool action produces or modifies a persistent, addressable resource, the tool result MUST include the `minis://` URL so the model can reference it.

### 6.1 `file_write` — Current Behavior & Enhancement

**Current** tool result:
```
Wrote to /var/minis/attachments/chart.png (1234 bytes)
```

**Enhanced** tool result for files under `/var/minis/`:
```
Wrote to /var/minis/attachments/chart.png (1234 bytes)
minis_url: minis://attachments/chart.png
```

The `minis_url` field is appended only when the written path falls under `/var/minis/`. This gives the model an explicit, copy-paste-ready URL to embed in Markdown responses.

**Implementation:** In `executeFileWrite`, after a successful write to any path under `/var/minis/`:
```swift
// After successful write
var result = "\(action) to \(path) (\(bytesWritten) bytes)"
if path.hasPrefix("/var/minis/") {
    let minisPath = String(path.dropFirst("/var/minis/".count))
    let namespace = minisPath.components(separatedBy: "/").first ?? ""
    let rest = String(minisPath.dropFirst(namespace.count))
    result += "\nminis_url: minis://\(namespace)\(rest)"
}
```

### 6.2 `shell_execute` — Post-Scan Enhancement

After a `shell_execute` completes, scan for new or modified files under `/var/minis/` and append their `minis://` URLs to the tool result.

**Enhanced** tool result:
```
<normal stdout/stderr output>

[minis] New files:
  minis://attachments/output.png
  minis://workspace/results.json
```

**Implementation:** Before and after execution, snapshot the set of files under each `/var/minis/` subdirectory. Diff to find new/modified files. Append their URLs.

### 6.3 `browser_use` — Screenshot URLs

When `browser_use` captures a screenshot, save it to `/var/minis/browser/` and include the URL in the tool result.

**Enhanced** tool result:
```
Screenshot captured (1280x720)
minis_url: minis://browser/screenshot_1707000000.jpg
```

### 6.4 Offload References

Already implemented. When tool output exceeds the limit:
```
<truncated output>

[OUTPUT TRUNCATED] Full output (50000 chars) saved to: /var/minis/offloads/shell_execute_1707000000_abc12345.txt
Use file_read tool to read the complete output.
```

**Enhancement:** Add `minis://` URL for consistency:
```
minis_url: minis://offloads/shell_execute_1707000000_abc12345.txt
```

### 6.5 User Attachment URLs

When the user attaches an image/file via the input bar and it's saved to `/var/minis/attachments/`, the `minis://` URL is included in the user message context so the agent knows the file path.

Already implemented via `saveAttachment()` → returns `minis://attachments/<filename>`.

## 7. System Prompt Update

The agent system prompt should be updated to document the URL scheme and the tool result contract:

```
Shared directory /var/minis/ (bidirectional read/write between shell and app):
  /var/minis/attachments/ — Media files (images, audio, video). Display inline with ![desc](minis://attachments/filename).
  /var/minis/workspace/   — Working files (scripts, data, configs). Link with [name](minis://workspace/filename).
  /var/minis/offloads/    — Auto-saved large outputs. Read with file_read.
  /var/minis/browser/     — Browser screenshots and extracts.

The minis:// URL scheme:
  minis://attachments/file.png  →  /var/minis/attachments/file.png
  minis://workspace/data.csv    →  /var/minis/workspace/data.csv

When you write files to /var/minis/, the tool result includes a minis_url you can embed directly in Markdown.
Supported inline types: images (.png/.jpg/.gif/.webp), audio (.mp3/.m4a/.wav), video (.mp4/.mov/.m4v).
For non-media files, use Markdown links: [filename](minis://workspace/filename).
```

## 8. Chat UI Rendering

### 8.1 MinisImageProvider (Existing)

The `MinisImageProvider` in `AIChatView.swift` handles all `minis://` URLs in Markdown image syntax (`![](minis://...)`). It dispatches based on file extension:

- **Image extensions** → `UIImage` with tap-to-fullscreen, retry-on-load (6 attempts, 500ms interval)
- **Audio extensions** → `MinisAudioPlayerView` with play/pause, seek, duration
- **Video extensions** → `MinisVideoPlayerView` with thumbnail + fullscreen player

### 8.2 Link Rendering (Enhancement)

Markdown links with `minis://` scheme (`[name](minis://...)`) should be rendered as tappable file chips that:
- Show the filename and a file-type icon
- On tap: open a preview (Quick Look) or share sheet for the file
- Non-media files (`.csv`, `.txt`, `.py`, `.json`, etc.) get a document icon + filename pill

### 8.3 Subdirectory Support

The current `resolveMinisFileURL` already supports arbitrary path depth:
```swift
// minis://attachments/photos/img.jpg → /var/minis/attachments/photos/img.jpg
let linuxPath = "/var/minis/\(host)\(url.path)"
```

No changes needed for resolution. The persistent storage and mount logic should be extended to handle nested subdirectories (currently only handles flat file lists in `mountMinisSubdir`).

## 9. Implementation Checklist

### Phase 1: Tool Result URLs
- [ ] `file_write`: Append `minis_url:` when path is under `/var/minis/`
- [ ] `shell_execute`: Scan for new/modified files under `/var/minis/` after execution, append URLs
- [ ] `offloadToolOutput`: Append `minis_url:` to truncation notice
- [ ] Update system prompt with full URL scheme documentation

### Phase 2: Browser Namespace
- [ ] Add `browser` namespace directories to session mount/persist logic
- [ ] Save browser screenshots to `/var/minis/browser/` with `minis://` URL in tool result
- [ ] Add `browser` directory to `mountMinisSubdir` calls

### Phase 3: Enhanced Rendering
- [ ] Implement tappable file chip for `minis://` links (non-image Markdown links)
- [ ] Quick Look / share sheet integration for non-media files
- [ ] Recursive subdirectory support in `mountMinisSubdir` (currently flat)

### Phase 4: Workspace Awareness
- [ ] `file_read`: When reading from `/var/minis/`, include `minis_url:` in result
- [ ] Consider `minis://` URL auto-complete or suggestion in agent context

## 10. Security Considerations

- **Session isolation**: The agent and shell MUST only access the active session's resources. The mount/unmount lifecycle (§5.3) enforces this at the filesystem level. No API or filesystem path exposes another session's data.
- **Path traversal**: `resolveHostPath` rejects paths containing `..`. Maintain this.
- **Namespace validation**: Only known namespaces (`attachments`, `workspace`, `offloads`, `browser`) should be accepted. Reject unknown namespaces.
- **No session ID in URLs**: Session IDs are never exposed in `minis://` URLs, tool results, or system prompts. This prevents the agent from attempting cross-session references.
- **File size limits**: Large files in `/var/minis/attachments/` could consume device storage. Consider per-session quotas (future).
- **meta.db integrity**: Always register files in meta.db atomically. Current implementation handles this correctly.
