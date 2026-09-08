import Foundation
import UIKit

/// The app's default outbound User-Agent for LLM provider requests.
///
/// Without an explicit header, URLSession sends `Minis/<CFBundleVersion>
/// CFNetwork/… Darwin/…` — i.e. the **build number** (e.g. `Minis/1`), not the
/// marketing version users recognize. This helper produces a stable, readable
/// default that carries the marketing version (CFBundleShortVersionString),
/// e.g. `Minis/1.10 (iOS 26.5; iPhone)`.
///
/// Scope: applied as the DEFAULT only where a request would otherwise fall back
/// to the system UA AND the endpoint does not require an identity-locked UA. A
/// user-set per-provider custom UA still overrides it, and OAuth/CLI-gated
/// flows (Codex `codex_cli_rs/…`, Claude Code `claude-cli/…`, Gemini/Antigravity
/// CLI UAs) keep their required UA untouched.
enum MinisUserAgent {
    /// Cached because the components are process-constant. `nonisolated(unsafe)`
    /// is safe: the value is computed once from immutable bundle/device info and
    /// only ever read thereafter.
    nonisolated(unsafe) private static var cached: String?

    static var `default`: String {
        if let cached { return cached }
        let version = (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "?"
        let device = UIDevice.current
        let osVersion = device.systemVersion          // e.g. "26.5"
        let model = device.model                        // "iPhone" / "iPad"
        let ua = "Minis/\(version) (iOS \(osVersion); \(model))"
        cached = ua
        return ua
    }
}
