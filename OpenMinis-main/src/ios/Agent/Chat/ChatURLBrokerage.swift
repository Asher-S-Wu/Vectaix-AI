import AVFoundation
import Foundation

private let logger = AppLogger(category: "AIChatVM")

// MARK: - Speech Finished Delegate

/// Restarts silent audio keep-alive after TTS finishes speaking,
/// so the background audio session stays active between utterances.
final class SpeechFinishedDelegate: NSObject, AVSpeechSynthesizerDelegate {
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in
            let mgr = BackgroundKeepAliveManager.shared
            if mgr.backgroundSpeakEnabled && mgr.isActive {
                mgr.evaluateSilentAudioFromDelegate()
            }
        }
    }
}

// MARK: - Minis URL Capture Broker

/// Shared broker for URLs captured from shell tool stdout via the OSC
/// MinisOpenURL marker (emitted by /usr/local/bin/minis-open). Both
/// `AIChatView` and `ToolLiveSheet` observe `pendingURL`; ToolLiveSheet
/// wins when presented (it's topmost), otherwise AIChatView wins. Whoever
/// handles it calls `consume()` which nils out `pendingURL` so the other
/// observer doesn't fire a second sheet.
@MainActor
final class MinisOpenURLBroker: ObservableObject {
    static let shared = MinisOpenURLBroker()
    @Published var pendingURL: URL?
    /// True while `ToolLiveSheet` is on-screen. When set, `AIChatView`
    /// skips auto-presenting *web* URLs so ToolLiveSheet can show the
    /// preview nested on top of itself instead. `minis://` resource
    /// previews are still dispatched by AIChatView because ToolLiveSheet
    /// cannot host image/markdown/QuickLook sheets.
    @Published var toolSheetVisible: Bool = false
    /// True while the full-screen interactive iSH terminal
    /// (`ISHTerminalView` under `.fullScreenCover`) is on-screen. AIChatView
    /// skips auto-presenting web URLs when this is set so its own
    /// `.sheet(item: $safariURL)` doesn't fight the fullScreenCover (which
    /// would dismiss the terminal before presenting). The terminal has its
    /// own `.sheet(item: $linkPreviewURL)` which takes responsibility.
    @Published var terminalVisible: Bool = false
    private init() {}

    func offer(_ url: URL) { pendingURL = url }
    func consume() { pendingURL = nil }

    /// Schemes that `minis-open` may emit and that the host knows how to
    /// route. `http`/`https`/`about` → WKWebView preview, `minis` → built-in
    /// file preview via `handleMinisURLTap`.
    nonisolated static func isSupportedScheme(_ scheme: String?) -> Bool {
        guard let s = scheme?.lowercased() else { return false }
        return s == "http" || s == "https" || s == "about" || s == "minis"
    }

    /// True for schemes that render as an in-chat WKWebView (safariURL /
    /// ToolLiveSheet.linkPreviewURL). `minis://` resources render as
    /// full-screen file previews instead and must be dispatched by
    /// AIChatView even when a tool sheet is on top.
    nonisolated static func isWebScheme(_ scheme: String?) -> Bool {
        guard let s = scheme?.lowercased() else { return false }
        return s == "http" || s == "https" || s == "about"
    }
}

// MARK: - Minis URL Marker Parser

/// Recognises the OSC 1337 `MinisOpenURL` escape sequence emitted by the
/// rootfs shim at `/usr/local/bin/minis-open` (see default_mount). The shim
/// replaces `xdg-open`, `sensible-browser`, etc. Whenever an in-sandbox
/// command tries to open a URL, it prints:
///
///     ESC ] 1337 ; MinisOpenURL = <url> BEL
///
/// which this parser strips from the displayed shell output and returns
/// as a list of URLs to present in the in-app WKWebView preview.
enum MinisURLMarker {
    /// ESC ] 1337 ; MinisOpenURL = ... BEL
    /// Also accepts ST (ESC \) as terminator for robustness.
    static let pattern = "\u{1B}\\]1337;MinisOpenURL=([^\u{07}\u{1B}]*)(?:\u{07}|\u{1B}\\\\)"

    /// Returns (cleaned text with markers removed, captured URL strings).
    static func extract(from text: String) -> (cleaned: String, urls: [String]) {
        guard text.contains("MinisOpenURL="),
              let regex = try? NSRegularExpression(pattern: pattern) else {
            return (text, [])
        }
        let ns = text as NSString
        let range = NSRange(location: 0, length: ns.length)
        let matches = regex.matches(in: text, range: range)
        guard !matches.isEmpty else { return (text, []) }

        var urls: [String] = []
        var cleaned = ""
        var cursor = 0
        for m in matches {
            if m.range.location > cursor {
                cleaned += ns.substring(with: NSRange(location: cursor, length: m.range.location - cursor))
            }
            if m.numberOfRanges >= 2 {
                let urlRange = m.range(at: 1)
                if urlRange.location != NSNotFound {
                    urls.append(ns.substring(with: urlRange))
                }
            }
            cursor = m.range.location + m.range.length
        }
        if cursor < ns.length {
            cleaned += ns.substring(with: NSRange(location: cursor, length: ns.length - cursor))
        }
        return (cleaned, urls)
    }
}
