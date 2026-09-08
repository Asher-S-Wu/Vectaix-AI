import AppIntents
import Foundation

/// [T-ios-live-activity-audio-toggle] Shared constants for the Live Activity
/// audio play/pause control's cross-process handoff. Compiled into BOTH the main
/// app and the AgentWidget extension so the widget can request a toggle and the
/// app can service it.
///
/// The Live Activity button intent (`AudioTogglePlaybackIntent`) does NOT touch
/// the read-aloud engine directly — `VoiceOutputState` lives only in the main app
/// and is invisible to the widget compilation unit. Instead the intent posts a
/// Darwin notification (a lightweight, App-Group-scoped cross-process signal).
/// The main app observes it (in `VoiceOutputState`) and calls
/// `VoiceOutputState.shared.togglePause()`, which routes to the active System
/// TTS controller or the cloud VoiceOutputPlayer.
///
/// A `LiveActivityIntent`'s `perform()` runs in the app's process — iOS launches
/// the app in the background to service it when tapped from the Lock Screen /
/// Dynamic Island — so the Darwin notification is delivered to a live app process
/// and the toggle takes effect immediately without opening the app to foreground.
enum AudioTogglePlaybackBridge {
    /// Darwin notification name the widget posts and the app observes.
    static let darwinNotificationName = "com.openminis.app.liveActivity.audioToggle"
}

/// [T-ios-live-activity-audio-toggle] Live Activity button intent that toggles
/// play/pause on the app's global audio (TTS reply narration or attachment
/// playback) WITHOUT opening the app. Requires iOS 17+ (`Button(intent:)` in a
/// Live Activity). On iOS 16.x the widget shows status only and never references
/// this type, so gating it behind `@available(iOS 17.0, *)` keeps the 16 path
/// compiling.
@available(iOS 17.0, *)
struct AudioTogglePlaybackIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Play or Pause Narration"
    static var description = IntentDescription("Toggles play/pause on Minis audio narration from the Live Activity.")
    /// Never bring the app to the foreground — the whole point is to control
    /// playback from the Lock Screen / Dynamic Island in place.
    static var openAppWhenRun = false

    func perform() async throws -> some IntentResult {
        // Post an App-Group-scoped Darwin notification. The main app process
        // (kept alive by audio playback in the background) observes it and calls
        // VoiceOutputState.shared.togglePause(). We deliberately avoid referencing
        // main-app types here so this compiles inside the widget extension too.
        let center = CFNotificationCenterGetDarwinNotifyCenter()
        CFNotificationCenterPostNotification(
            center,
            CFNotificationName(AudioTogglePlaybackBridge.darwinNotificationName as CFString),
            nil, nil, true
        )
        return .result()
    }
}
