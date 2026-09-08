import ActivityKit
import Foundation

struct LiveSessionSnapshot: Codable, Hashable {
    var sessionId: String
    var title: String
    /// SF Symbol name for the current tool (e.g. "globe", "terminal", "doc.text").
    var toolIcon: String
    /// Human-readable tool status (e.g. "navigate...", "running...", "get_text...").
    var toolStatus: String
    var loopIteration: Int
    /// True once this session's task has finished. Drives the "completed" look
    /// (checkmark + last message) in the Live Activity. Defaulted so all
    /// existing snapshot construction sites compile unchanged.
    var isCompleted: Bool = false
    /// One-line summary of the final assistant reply, shown when `isCompleted`.
    var lastMessage: String = ""
}

@available(iOS 16.2, *)
struct AgentActivityAttributes: ActivityAttributes {
    var startDate: Date

    public struct ContentState: Codable, Hashable {
        var activeSessionCount: Int
        var sessions: [LiveSessionSnapshot]
        /// Index into `sessions` for the currently displayed session (rotates each update).
        var carouselIndex: Int
        var soulName: String
        /// SF Symbol for the most-recently-invoked tool across all sessions.
        /// The Dynamic Island minimal icon alternates between this tool icon
        /// and the session-count icon on each refresh. Empty when no tool is
        /// active yet. Defaulted so existing ContentState construction sites
        /// (end / cleanup states with no sessions) compile unchanged.
        var latestToolIcon: String = ""
        /// Drives the minimal-icon alternation: when true the minimal Dynamic
        /// Island shows `latestToolIcon`, otherwise the session-count badge.
        /// Flipped by the manager on every refresh so it alternates even with a
        /// single session (where `carouselIndex` would stay 0).
        var minimalShowsTool: Bool = false
        /// True when ALL tasks have finished and the Live Activity is in its
        /// "completed" resting state: it stops the carousel, shows a checkmark +
        /// each session's last message, and lingers (instead of ending instantly)
        /// until the user taps it and Minis decides whether to dismiss it.
        /// [T-ios-live-activity-soft-finish]
        var allCompleted: Bool = false
        /// [T-ios-live-activity-audio-toggle] True while the global TTS/audio
        /// player (`GlobalAudioPlayer`) is actively playing a reply-narration or
        /// attachment audio. Drives the play/pause control shown beside the Agent
        /// identity capsule in the Dynamic Island expanded view. Defaulted so old
        /// encoded ContentStates (written before this field existed) still decode.
        var isAudioPlaying: Bool = false
        /// [T-ios-live-activity-audio-toggle] True whenever the audio player has a
        /// file loaded (playing OR paused). Distinguishes "audio present, show the
        /// control" from "no audio at all, hide it". When true but `isAudioPlaying`
        /// is false, the control shows a play (resume) glyph. Defaulted for
        /// backward-compatible decoding.
        var isAudioLoaded: Bool = false
        /// [T-ios-live-activity-audio-toggle] Short title of the current audio
        /// (the player's `fileName`), for optional display. Defaulted for decoding.
        var audioTitle: String = ""
        /// [T-ios-live-activity-privacy-duration] Wall-clock moment the LAST
        /// task finished, set only on the soft-finish (allCompleted) push. The
        /// widget renders `finishedAt − attributes.startDate` as a static
        /// "total run time" capsule in the completed resting state — the live
        /// `.timer` stops there, and Privacy Mode's redacted rows otherwise
        /// carry no informative content at all. Optional + defaulted so
        /// ContentStates encoded before this field existed still decode.
        var finishedAt: Date? = nil
        /// [T-ios-live-activity-privacy-mode] True when the user has turned on
        /// Privacy Mode. The manager already redacts the sensitive fields
        /// (session title / tool status / tool icon / last message / soul name)
        /// before pushing, so the widget mostly renders correctly without
        /// checking this. It is carried anyway so the view can suppress the few
        /// things data-redaction alone can't (e.g. forcing the neutral minimal
        /// icon). Defaulted so ContentStates encoded before this field existed
        /// still decode.
        var privacyMode: Bool = false
    }
}
