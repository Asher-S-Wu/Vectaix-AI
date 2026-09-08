import Combine
import Foundation
import SwiftUI
import UIKit

// MARK: - Models

/// Structured metadata for a user-attached file (image, document, etc.).
struct AttachmentMeta: Identifiable, Equatable {
    let id = UUID()
    /// Linux path, e.g. `/var/minis/attachments/uploads/photo.jpg`
    let path: String
    let size: Int
    let modified: Date

    /// Derive a `minis://` URL from the Linux path.
    var minisURL: String {
        guard path.hasPrefix("/var/minis/") else { return path }
        let rel = String(path.dropFirst("/var/minis/".count))
        return "minis://\(rel)"
    }

    var fileName: String {
        (path as NSString).lastPathComponent
    }

    var isImage: Bool {
        let ext = (path as NSString).pathExtension.lowercased()
        return ["jpg", "jpeg", "png", "gif", "webp", "heic"].contains(ext)
    }

    var isVideo: Bool {
        let ext = (path as NSString).pathExtension.lowercased()
        return ["mp4", "mov", "m4v", "avi", "mkv"].contains(ext)
    }
}

final class ChatMessage: Identifiable, ObservableObject {
    let id = UUID()
    let role: ChatMessageRole
    @Published var content: String
    /// For assistant turns: ordered list of content blocks (text + tool calls)
    @Published var blocks: [AssistantBlock] = []
    /// Error that terminated this assistant turn (nil = no error).
    @Published var error: String?
    /// Number of mid-stream auto-retries that completed successfully before this turn finished.
    /// Shown as a small badge in the UI. Reset to 0 when the user manually retries.
    @Published var streamInterruptCount: Int = 0
    /// Accumulated token usage for this assistant turn.
    @Published var usage: TokenUsage?
    /// Structured metadata for user-attached files (images & documents).
    @Published var attachments: [AttachmentMeta] = []
    /// Raw input attachments for preview before queue drain (cache URLs still valid).
    @Published var inputAttachments: [InputAttachment] = []
    /// True when all tool calls have completed and we're waiting for the model's next response.
    @Published var isAwaitingModelResponse = false
    /// True when this message is queued but not yet injected into the agent loop.
    @Published var isQueued = false
    /// True if this message is from the compacted history zone (read-only, no actions).
    @Published var isCompactedHistory = false
    /// True when this compact divider is still loading (LLM generating summary).
    @Published var isCompactLoading = false
    /// SF Symbol name for systemInfo rows (e.g. "brain.head.profile", "arrow.down.right.and.arrow.up.left").
    var systemIcon: String?
    /// LLM-generated compact summary (for display in info sheet on compact divider).
    var compactSummary: String?
    /// sort_order of the FIRST raw message that contributed to this UI message.
    /// Used by Phase 2.5 to locate the compact divider position on reload.
    var sourceSortOrder: Int?
    /// sort_order of the LAST raw message folded into this UI message. For an
    /// assistant turn that was streamed across multiple raw rows (continuation
    /// blocks appended via the `continuation` path in Phase 2), this differs
    /// from `sourceSortOrder`. compactMarker resolution uses the inclusive
    /// range [sourceSortOrder ... lastSourceSortOrder] when matching a raw
    /// row's sortOrder back to its UI message — without this, an anchor that
    /// landed on a continuation row would fail to resolve and the divider
    /// would slide to the top of the list.
    var lastSourceSortOrder: Int?
    /// Links back to the QueuedPrompt so we can withdraw it.
    var queuedPromptId: UUID?
    let timestamp = Date()

    init(role: ChatMessageRole, content: String, blocks: [AssistantBlock] = [], isQueued: Bool = false) {
        self.role = role
        self.content = content
        self.blocks = blocks
        self.isQueued = isQueued
    }

    /// [T-bridge-message-ui-leak] True when this UI message is the internal
    /// role-alternation bridge (#579) that must never render as a chat bubble.
    /// The bridge is filtered out of the DB-reload path (loadSession), but a
    /// leak through any OTHER path that pushes into `messages` (e.g. a rebuild
    /// that bypasses that loop) surfaced it in the chat. Filtering at the single
    /// UI collection sink (applySnapshot) using this property catches every
    /// path uniformly. Checks both `content` and a lone text block, since a
    /// leaked bridge may arrive in either shape. Uses the shared bridge-text
    /// set so old- and new-wording bridges are both caught.
    var isInternalBridge: Bool {
        guard role == .assistant else { return false }
        if RawMessage.isInternalBridgeText(content) { return true }
        // A bridge carried as a single text block with no other content.
        if content.isEmpty, blocks.count == 1,
           case .text = blocks[0].kind,
           RawMessage.isInternalBridgeText(blocks[0].content) {
            return true
        }
        return false
    }

    /// [T-ios-typing-indicator-scope] Whether the typing indicator should be
    /// drawn for this message, given it is the active (last, still-processing)
    /// one. The single source of truth — the footer's render branch, its
    /// `hasFooterContent` collapse test, the layout height seed, and the legacy
    /// list view must all ask THIS, or they drift apart and the footer reserves
    /// height for a row nobody draws (the "blank strip" bug).
    ///
    /// The indicator means "the request is out and nothing has come back yet".
    /// That is a per-ROUND question, not a per-message one: inside an agent
    /// loop, every tool round issues a fresh request, and the wait before its
    /// first token deserves the same feedback as the very first wait. So:
    ///
    ///   * `blocks.isEmpty` — the opening wait, before any content exists.
    ///   * `isAwaitingModelResponse && !hasRunningTool` — the wait between
    ///     rounds. The view model sets `isAwaitingModelResponse` after each
    ///     tool round completes and clears it on the next `contentBlockStart`
    ///     (AIChatViewModel+SSEStream), so it brackets exactly the dead air.
    ///
    /// The `!hasRunningTool` half is what keeps this from regressing to the
    /// original bug: while a tool is actually executing, its card is on screen
    /// animating its own running state, and stacking a second "thinking…" row
    /// under it was pure redundancy that reserved ~48pt of visually blank space.
    /// Earlier blocks from previous rounds deliberately do NOT suppress the
    /// indicator — content produced two rounds ago says nothing about whether
    /// THIS round has started producing.
    var shouldShowTypingIndicator: Bool {
        if blocks.isEmpty { return true }
        guard isAwaitingModelResponse else { return false }
        return !blocks.contains { block in
            switch block.toolStatus {
            case .streaming, .running: return true
            default: return false
            }
        }
    }
}

/// A user prompt queued while the agent is processing.
struct QueuedPrompt: Identifiable {
    let id = UUID()
    let text: String
    let attachments: [InputAttachment]
    let timestamp = Date()
}

/// Token usage for the current assistant turn.
/// `inputTokens` and `outputTokens` track the **peak** values seen across all
/// SSE chunks and API calls in the turn — using max() rather than summation so
/// that providers emitting cumulative usage on every chunk don't inflate the count.
/// Cache metrics and context size reflect only the **latest** API call, since
/// cumulative cache numbers are misleading in multi-call agent turns.
struct TokenUsage {
    var inputTokens: Int = 0
    var outputTokens: Int = 0
    var cacheCreationTokens: Int = 0
    var cacheReadTokens: Int = 0
    /// Context size of the latest API call (input + cache_read + cache_creation).
    var latestContextTokens: Int = 0

    mutating func add(_ u: LLMUsage) {
        // Use max() instead of += to handle providers that emit cumulative usage
        // on every SSE chunk (e.g. DeepSeek-V4-Flash). With += the final count
        // would be the sum of all intermediate values (0+1+2+...+N ≈ N²/2).
        // max() is correct for both cases:
        //   • Provider sends usage only on the last chunk → same as +=, one update
        //   • Provider sends incremental cumulative usage each chunk → last (max) value wins
        //   • Agent multi-turn (multiple API calls) → each call's input grows, max is correct
        inputTokens = max(inputTokens, u.inputTokens)
        outputTokens = max(outputTokens, u.outputTokens)
        cacheCreationTokens = (u.cacheCreationInputTokens ?? 0)
        cacheReadTokens = (u.cacheReadInputTokens ?? 0)
        latestContextTokens = u.inputTokens
            + (u.cacheReadInputTokens ?? 0)
            + (u.cacheCreationInputTokens ?? 0)
    }
}

enum ChatMessageRole {
    case user
    case assistant
    /// A visual separator showing where context was compacted.
    case compactDivider
    /// Ephemeral UI-only info message (not sent to LLM, not persisted).
    case systemInfo
}

/// Execution status of a tool block.
enum ToolBlockStatus: Equatable {
    case streaming(bytes: Int)
    case running
    case success
    case failed(message: String)
    case cancelled
}

/// A single block within an assistant turn.
final class AssistantBlock: Identifiable, ObservableObject {
    let id = UUID()
    @Published var kind: AssistantBlockKind
    @Published var content: String

    // MARK: Thinking block performance (T-thinking-render-perf-ios)

    /// O(1) change counter — incremented on every thinking delta. Deliberately
    /// NOT @Published [T-thinking-stream-jank]: as a published property every
    /// token fired objectWillChange, so an EXPANDED thinking block re-ran its
    /// SwiftUI body + animated scrollTo per delta (~60-105/s measured on
    /// iPhone 11) even though `content` only flushes every 0.3s. The view now
    /// keys its scroll/redraw off `content` (flush-paced); this counter stays
    /// as a cheap diagnostic sequence.
    var contentUpdateSeq: Int = 0

    /// Non-published buffer for thinking content. During streaming the SSE handler
    /// appends here; `@Published content` is only flushed periodically or when the
    /// user expands the block, so collapsed thinking blocks don't trigger per-token
    /// SwiftUI recomposition.
    var thinkingContentBuffer: String = ""

    // [T-thinkperf-release-displaylink] The ThinkPerf delta-rate instrumentation
    // that used to live here has been removed outright, in Debug as well as
    // Release. It ran on the hottest path in the app — `appendThinkingDelta`
    // fires once per streamed reasoning token, measured at 60-105/s — and paid
    // a `Date()` allocation plus two counter updates on every single one, to
    // emit one line per second.
    //
    // It was written to diagnose T-thinking-stream-jank; that investigation
    // concluded (see 7573e28b8: the per-delta body re-eval it was hunting was
    // found and fixed by moving the follow trigger to flush pace). Keeping a
    // permanent per-token probe to answer a question already answered is a
    // standing tax on the exact path we now want to be cheap.

    func appendThinkingDelta(_ delta: String) {
        thinkingContentBuffer += delta
        contentUpdateSeq += 1
    }

    // [T-thinking-stream-jank] Adaptive flush throttle for streaming thinking
    // content. Each flush costs a body re-eval + windowed Text re-layout + a
    // nested animated scrollTo in the EXPANDED view, and that cost grows with
    // rendered content while the user's need for per-word tracking shrinks —
    // past a few K they only care that it's visibly moving. So the flush
    // interval widens with the buffered length. Tiers are a table so they're
    // easy to retune; lengths are characters of thinkingContentBuffer.
    //   <1K  → 0.3s  (short content: responsiveness first, current behavior)
    //   1-3K → 0.6s
    //   ≥3K  → 1.0s  (cap: long content is about overall motion, not word
    //                 tracking, but 1.0s keeps the tail visibly alive)
    // Collapsed blocks are unaffected either way: deltas only append to the
    // non-published buffer, and the flush this paces merely updates the pill's
    // char counter when collapsed.
    static let thinkingFlushTiers: [(maxLength: Int, interval: TimeInterval)] = [
        (1_000, 0.3),
        (3_000, 0.6),
        (Int.max, 1.0),
    ]

    /// Flush interval for a thinking buffer of `length` chars (see tier table).
    static func thinkingFlushInterval(forLength length: Int) -> TimeInterval {
        for tier in thinkingFlushTiers where length < tier.maxLength {
            return tier.interval
        }
        return thinkingFlushTiers[thinkingFlushTiers.count - 1].interval
    }

    func flushThinkingBuffer() {
        guard kind == .thinking, thinkingContentBuffer.count > content.count else { return }
        // [T-thinkperf-release-displaylink] Timing removed with the rest of the
        // ThinkPerf probes. The comment it carried is worth keeping, because it
        // records what was learned: the assign below is a string copy, but the
        // real cost of a flush lands in the SwiftUI update it triggers, not
        // here — so timing this line measured the cheap half and logged a line
        // per flush to say so.
        content = thinkingContentBuffer
    }
    /// Status for tool blocks (nil for text blocks).
    @Published var toolStatus: ToolBlockStatus?
    /// Local file path for an image (e.g. browser screenshot).
    @Published var imageFilePath: String?
    /// URL associated with browser tool calls (for display in preview).
    @Published var browserURL: String?
    /// LLM-generated concise description of what this tool call does (5-10 words).
    @Published var toolSummary: String?
    /// Wall-clock execution duration (display only, not sent to model).
    @Published var toolDuration: TimeInterval?
    /// Timestamp when tool execution started (internal, for computing duration).
    var toolStartTime: Date?
    /// [T-tool-bg-suspended-hint] True when this tool block was force-finalized
    /// because the app was suspended in the background (the same condition that
    /// drives BackgroundInterruptionTracker's banner: a finite background task
    /// expired with no enhanced-background keep-alive). Distinguishes a genuine
    /// OS-suspension from a normal failure / user cancel so the chat capsule can
    /// surface the yellow ⓘ "enable enhanced background" hint only when relevant.
    @Published var wasBackgroundSuspended: Bool = false
    /// Cached parsed markdown for completed text blocks.
    @Published var cachedMarkdown: MarkdownContent?
    /// Cached rendered NSAttributedString for completed text blocks.
    /// Set once when cachedMarkdown is finalized; avoids re-running MarkdownNSRenderer
    /// on every SwiftUI updateUIView triggered by unrelated state changes.
    @Published var cachedAttributedString: NSAttributedString?
    /// The tool_use ID from the provider, used to match with snapshots.
    var toolUseId: String?
    /// Serialized JSON of the tool input arguments (for introspection in SessionMemoryView, etc.).
    var toolInputArgs: String?
    /// Streaming file content for file_write tool (live content as it arrives).
    @Published var streamingFileContent: String?
    /// Whether a thinking block is expanded (persisted across cell reuse).
    @Published var isThinkingExpanded: Bool = false
    /// True once the user has manually tapped this thinking block's header.
    /// While this is false the view is allowed to auto-expand on stream start
    /// and auto-collapse on stream end; once the user takes control we leave
    /// `isThinkingExpanded` alone so a tap on an earlier (frozen) block can't
    /// be silently undone by a streaming sibling's recomposition.
    @Published var thinkingUserToggled: Bool = false

    init(kind: AssistantBlockKind, content: String, toolStatus: ToolBlockStatus? = nil, toolUseId: String? = nil) {
        self.kind = kind
        self.content = content
        self.toolStatus = toolStatus
        self.toolUseId = toolUseId
    }

    /// Concise one-line description for compact tool card display.
    var toolDescription: String {
        switch kind {
        case .text, .thinking:
            return ""
        case .shellTool(let command):
            if !command.isEmpty { return command }
            // Parse from content: "$ <command>\n..."
            if content.hasPrefix("$ ") {
                let firstLine = content.prefix(while: { $0 != "\n" })
                return String(firstLine.dropFirst(2))
            }
            return "Shell command"
        case .browserTool(let action):
            if !action.isEmpty { return action }
            if content.hasPrefix("Browser: ") {
                let firstLine = content.prefix(while: { $0 != "\n" })
                return String(firstLine.dropFirst(9))
            }
            return "Browser action"
        case .fileReadTool(let path):
            let name = (path as NSString).lastPathComponent
            return (!path.isEmpty && name != "/" && name.contains(".")) ? name : "Read file"
        case .fileWriteTool(let path):
            let name = (path as NSString).lastPathComponent
            return (!path.isEmpty && name != "/" && name.contains(".")) ? name : "Write file"
        case .fileEditTool(let path):
            let name = (path as NSString).lastPathComponent
            return (!path.isEmpty && name != "/" && name.contains(".")) ? name : "Edit file"
        case .readImageTool(let path):
            let name = (path as NSString).lastPathComponent
            return (!path.isEmpty && name != "/" && name.contains(".")) ? name : "Read image"
        case .memoryTool(let action):
            return action.isEmpty ? "Memory" : action
        case .info:
            return ""
        }
    }
}

enum AssistantBlockKind: Equatable {
    case text
    case thinking
    case shellTool(command: String)
    case fileReadTool(path: String)
    case fileWriteTool(path: String)
    case fileEditTool(path: String)
    case browserTool(action: String)
    case readImageTool(path: String)
    case memoryTool(action: String)
    case info
}

enum KernelStatus: Equatable {
    case notBooted
    case booting
    case booted
    case failed(String)
}

/// A tool snapshot item for UI display in the snapshot bar.
struct ToolSnapshotItem: Identifiable {
    let id: String          // toolUseId
    let toolName: String
    let snapshot: ToolSnapshot
    let mediaResolver: (MediaRef) -> URL
}

/// An attachment queued for the next message (stored in Caches).
struct InputAttachment: Identifiable {
    let id: UUID
    var fileName: String
    /// URL in the app's Caches directory. For a `.loading` placeholder this is a
    /// dummy URL with no file on disk yet; it's replaced when the load finishes.
    var cacheURL: URL
    var kind: Kind
    /// Load lifecycle. Photo-library picks insert `.loading` placeholders
    /// immediately, then flip to `.ready` (success) or `.failed` (error) as each
    /// concurrent `loadTransferable` completes. Non-picker attachments are
    /// `.ready` by default so all existing construction sites are unchanged.
    var loadState: LoadState

    enum Kind {
        case image      // JPEG/PNG/GIF/WebP
        case video      // MP4/MOV/etc.
        case document   // PDF or other file
    }

    enum LoadState: Equatable {
        case ready
        case loading
        case failed
    }

    init(id: UUID = UUID(), fileName: String, cacheURL: URL, kind: Kind, loadState: LoadState = .ready) {
        self.id = id
        self.fileName = fileName
        self.cacheURL = cacheURL
        self.kind = kind
        self.loadState = loadState
    }

    /// A loading placeholder shown the instant photos are picked, before bytes
    /// finish loading. `id` is supplied so the async load can find & replace it.
    static func loadingPlaceholder(id: UUID, kind: Kind) -> InputAttachment {
        InputAttachment(
            id: id,
            fileName: "",
            cacheURL: URL(fileURLWithPath: "/dev/null"),
            kind: kind,
            loadState: .loading
        )
    }
}

