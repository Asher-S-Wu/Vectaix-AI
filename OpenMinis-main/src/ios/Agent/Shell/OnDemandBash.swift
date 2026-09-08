import Foundation

private let logger = AppLogger(category: "Bashism")

/// Confirms/installs bash on demand when a script needs it, with the guards
/// from the design review (T-bash-on-demand §2/§3, F2/M5):
///   - tri-state in-process availability cache (unavailable has a 10-min TTL;
///     available self-heals on a later 127),
///   - host-side 5s network precheck before ever running `apk` (F2),
///   - persistent failure backoff (24h / 3-strikes) so a broken apk source or
///     offline device does not eat the install budget every cold start (F2),
///   - one install attempt per process launch.
///
/// `probe`/`install` are injected closures that run a guest command and return
/// (exitCode) — the caller wires them to the real ISH coordinator, keeping this
/// type unit-testable and off the MainActor.
actor OnDemandBash {
    static let shared = OnDemandBash()

    enum Availability { case unknown, available, unavailable(until: Date) }

    private var availability: Availability = .unknown
    private var attemptedInstallThisLaunch = false

    // Persistent failure backoff (UserDefaults — survives cold start).
    private let failCountKey = "bash.install.failCount"
    private let lastFailKey = "bash.install.lastFailAt"
    private let maxStrikes = 3
    private let backoffWindow: TimeInterval = 24 * 3600
    private let unavailableTTL: TimeInterval = 10 * 60
    private let installBudget: TimeInterval = 60

    /// apk mirror host to reachability-probe before attempting an install.
    private let apkProbeURL = URL(string: "https://dl-cdn.alpinelinux.org/alpine/")!

    struct Executor {
        /// Run a guest command, return its exit code. Non-throwing: map failures to a non-zero code.
        let run: (_ command: String, _ timeout: TimeInterval) async -> Int
    }

    enum Outcome {
        case available                 // bash usable
        case unavailable(reason: String)  // fall back to sh; reason for the reminder
    }

    /// Ensure bash is usable. Idempotent + cached.
    func ensureBash(executor: Executor) async -> Outcome {
        switch availability {
        case .available:
            return .available
        case .unavailable(let until):
            if Date() < until { return .unavailable(reason: "bash not installed") }
            availability = .unknown  // TTL expired — re-probe (user may have installed it)
        case .unknown:
            break
        }

        // Probe: is bash already there?
        if await executor.run("command -v bash >/dev/null 2>&1", 15) == 0 {
            availability = .available
            return .available
        }

        // Not installed. Decide whether we may attempt an install.
        if attemptedInstallThisLaunch {
            availability = .unavailable(until: Date().addingTimeInterval(unavailableTTL))
            return .unavailable(reason: "bash install already attempted this session")
        }
        if let backoff = backoffReason() {
            availability = .unavailable(until: Date().addingTimeInterval(unavailableTTL))
            return .unavailable(reason: backoff)
        }

        attemptedInstallThisLaunch = true

        // F2: cheap host-side reachability check before touching apk.
        if !(await networkReachable()) {
            recordFailure()
            availability = .unavailable(until: Date().addingTimeInterval(unavailableTTL))
            return .unavailable(reason: "network/apk mirror unreachable")
        }

        // Install (independent budget; does NOT count against the caller's command timeout).
        logger.info("[Bashism] installing bash (budget \(Int(installBudget))s)…")
        let rc = await executor.run("apk add bash", installBudget)
        let verified = rc == 0 ? (await executor.run("command -v bash >/dev/null 2>&1", 15) == 0) : false
        if verified {
            clearFailure()
            availability = .available
            // A SUCCESSFUL install re-arms the per-launch guard: it exists to
            // stop repeated FAILING installs from eating the budget each call,
            // not to prevent one fresh reinstall if the user later `apk del`s
            // bash within the same session (M5 self-heal must still work).
            attemptedInstallThisLaunch = false
            logger.info("[Bashism] bash installed OK")
            return .available
        }

        recordFailure()
        availability = .unavailable(until: Date().addingTimeInterval(unavailableTTL))
        logger.error("[Bashism] bash install failed (rc=\(rc))")
        return .unavailable(reason: "apk add bash failed (rc=\(rc))")
    }

    /// Called by the executor path when `bash <file>` itself returned 127 /
    /// not-found — user likely `apk del bash`'d after we cached available (M5).
    func markDisappeared() {
        availability = .unknown
    }

    // MARK: - Backoff bookkeeping

    private func backoffReason() -> String? {
        let d = UserDefaults.standard
        let count = d.integer(forKey: failCountKey)
        if count >= maxStrikes {
            return "bash install disabled after \(maxStrikes) failures (retry manually: apk add bash)"
        }
        let last = d.double(forKey: lastFailKey)
        if last > 0, Date().timeIntervalSince1970 - last < backoffWindow {
            return "bash install backing off (recent failure)"
        }
        return nil
    }

    private func recordFailure() {
        let d = UserDefaults.standard
        d.set(d.integer(forKey: failCountKey) + 1, forKey: failCountKey)
        d.set(Date().timeIntervalSince1970, forKey: lastFailKey)
    }

    private func clearFailure() {
        let d = UserDefaults.standard
        d.removeObject(forKey: failCountKey)
        d.removeObject(forKey: lastFailKey)
    }

    private func networkReachable() async -> Bool {
        var req = URLRequest(url: apkProbeURL)
        req.httpMethod = "HEAD"
        req.timeoutInterval = 5
        do {
            let (_, resp) = try await URLSession.shared.data(for: req)
            if let http = resp as? HTTPURLResponse { return (200..<500).contains(http.statusCode) }
            return true
        } catch {
            return false
        }
    }
}
