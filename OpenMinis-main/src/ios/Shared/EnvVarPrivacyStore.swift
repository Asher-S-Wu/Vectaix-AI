import Foundation
import SwiftUI

/// Persists the user's "Privacy Mode" preference for shell-execute output.
///
/// When enabled, `EnvVarRedactor` masks any environment variable value that
/// appears verbatim in a shell tool's stdout/stderr before that text is fed
/// back to the model. The user still sees the unmasked output in the UI;
/// only the bytes flowing into the agent's context are rewritten.
///
/// Default OFF — opt-in to avoid surprising users who rely on echoing values
/// back during debugging.
@MainActor
final class EnvVarPrivacyStore: ObservableObject {
    static let shared = EnvVarPrivacyStore()

    nonisolated static let userDefaultsKey = "envvar.privacy_mode_enabled"
    /// Default ON — secrets stay out of the model's context unless the
    /// user explicitly opts out. Stored separately from the bool itself
    /// so first-launch returns this default while later toggles persist.
    nonisolated static let defaultEnabled = true

    @Published var enabled: Bool {
        didSet {
            UserDefaults.standard.set(enabled, forKey: Self.userDefaultsKey)
        }
    }

    init() {
        let d = UserDefaults.standard
        self.enabled = d.object(forKey: Self.userDefaultsKey) == nil
            ? Self.defaultEnabled
            : d.bool(forKey: Self.userDefaultsKey)
    }

    /// Non-isolated read for use from background threads (e.g. the shell
    /// pipeline) without bouncing to the main actor on every command.
    nonisolated static func isEnabled() -> Bool {
        let d = UserDefaults.standard
        return d.object(forKey: userDefaultsKey) == nil
            ? defaultEnabled
            : d.bool(forKey: userDefaultsKey)
    }
}
