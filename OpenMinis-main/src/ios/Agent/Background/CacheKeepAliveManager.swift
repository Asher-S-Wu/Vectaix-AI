import Foundation
import os.log

private let logger = AppLogger(category: "CacheKeepAlive")

/// Sends lightweight warmup requests to keep Anthropic's prompt cache alive.
///
/// Anthropic's default cache TTL is 5 minutes. When the user pauses between
/// interactions, the cache expires and the next request re-processes the entire
/// context. This manager sends a `max_tokens:1` warmup request ~4 minutes after
/// the last API call to refresh the TTL. It fires at most 2 times per idle
/// period (total ~13 minutes of idle coverage). Skips when enhanced cache (1h
/// TTL) is enabled or the agent is currently processing.
@MainActor
final class CacheKeepAliveManager {
    static let shared = CacheKeepAliveManager()

    private struct SessionState {
        var lastRequestTime: Date
        var keepAliveCount: Int = 0
        var timer: Timer?
        weak var vm: AIChatViewModel?
    }

    private var sessions: [String: SessionState] = [:]
    private let maxKeepAlives = 2
    private let keepAliveDelay: TimeInterval = 4 * 60  // 4 minutes

    private init() {}

    // MARK: - Public API

    /// Called after every Anthropic API call completes to (re)schedule the keep-alive timer.
    func recordRequest(sessionId: String, vm: AIChatViewModel) {
        let previousCount = sessions[sessionId]?.keepAliveCount ?? 0
        let hadTimer = sessions[sessionId]?.timer != nil
        sessions[sessionId]?.timer?.invalidate()

        var state = SessionState(lastRequestTime: Date(), vm: vm)
        state.timer = scheduleTimer(sessionId: sessionId)
        sessions[sessionId] = state

        let fireDate = Date().addingTimeInterval(keepAliveDelay)
        let fireDateStr = ISO8601DateFormatter().string(from: fireDate)
        logger.info("🔥 cache keep-alive: recordRequest session=\(sessionId.prefix(8)) previousKeepAlives=\(previousCount) hadTimer=\(hadTimer) historyCount=\(vm.keepAliveHistory.count) toolCount=\(vm.keepAliveTools.count) nextFire=\(fireDateStr)")
    }

    /// Cancel keep-alive for a session (on teardown / navigation away).
    func cancelKeepAlive(sessionId: String) {
        let hadState = sessions[sessionId] != nil
        let count = sessions[sessionId]?.keepAliveCount ?? 0
        sessions[sessionId]?.timer?.invalidate()
        sessions.removeValue(forKey: sessionId)
        logger.info("🔥 cache keep-alive: cancelled session=\(sessionId.prefix(8)) hadState=\(hadState) keepAlivesUsed=\(count)")
    }

    // MARK: - Timer

    private func scheduleTimer(sessionId: String) -> Timer {
        Timer.scheduledTimer(withTimeInterval: keepAliveDelay, repeats: false) { [weak self] _ in
            Task { @MainActor in
                self?.fireKeepAlive(sessionId: sessionId)
            }
        }
    }

    private func fireKeepAlive(sessionId: String) {
        guard var state = sessions[sessionId] else {
            logger.warning("🔥 cache keep-alive: timer fired but no session state for \(sessionId.prefix(8))")
            return
        }

        let elapsed = Date().timeIntervalSince(state.lastRequestTime)
        let elapsedStr = String(format: "%.1fs", elapsed)

        guard state.keepAliveCount < maxKeepAlives else {
            logger.info("🔥 cache keep-alive: max count reached (\(state.keepAliveCount)/\(self.maxKeepAlives)) session=\(sessionId.prefix(8)) elapsed=\(elapsedStr) — no more warmups")
            return
        }
        guard let vm = state.vm else {
            logger.warning("🔥 cache keep-alive: vm deallocated session=\(sessionId.prefix(8)) elapsed=\(elapsedStr)")
            sessions.removeValue(forKey: sessionId)
            return
        }
        guard !vm.isProcessing else {
            logger.info("🔥 cache keep-alive: skipping (agent processing) session=\(sessionId.prefix(8)) elapsed=\(elapsedStr) — rescheduling")
            state.timer = scheduleTimer(sessionId: sessionId)
            sessions[sessionId] = state
            return
        }
        guard !vm.enhancedCacheEnabled else {
            logger.info("🔥 cache keep-alive: skipping (enhanced cache 1h TTL) session=\(sessionId.prefix(8)) elapsed=\(elapsedStr)")
            return
        }

        state.keepAliveCount += 1
        sessions[sessionId] = state

        logger.info("🔥 cache keep-alive: FIRING warmup #\(state.keepAliveCount)/\(self.maxKeepAlives) session=\(sessionId.prefix(8)) elapsed=\(elapsedStr) historyMsgs=\(vm.keepAliveHistory.count) tools=\(vm.keepAliveTools.count)")

        Task {
            await sendWarmup(sessionId: sessionId, vm: vm)
        }
    }

    // MARK: - Warmup Request

    private func sendWarmup(sessionId: String, vm: AIChatViewModel) async {
        guard let provider = vm.makeAnthropicProviderForWarmup() else {
            logger.warning("🔥 cache keep-alive: failed to create Anthropic provider session=\(sessionId.prefix(8))")
            return
        }

        let startTime = CFAbsoluteTimeGetCurrent()
        logger.info("🔥 cache keep-alive: sending warmup request session=\(sessionId.prefix(8)) model=\(provider.model.id) messages=\(vm.keepAliveHistory.count) tools=\(vm.keepAliveTools.count) systemPromptLen=\(vm.keepAliveSystemPrompt?.count ?? 0)")

        do {
            let usage = try await provider.sendWarmupRequest(
                messages: vm.keepAliveHistory,
                systemPrompt: vm.keepAliveSystemPrompt,
                tools: vm.keepAliveTools
            )

            let durationMs = Int((CFAbsoluteTimeGetCurrent() - startTime) * 1000)
            let cacheRead = usage.cacheReadInputTokens ?? 0
            let cacheCreate = usage.cacheCreationInputTokens ?? 0
            let totalInput = usage.inputTokens + cacheRead + cacheCreate
            let cacheHitRate = totalInput > 0 ? Double(cacheRead) / Double(totalInput) * 100 : 0
            let cacheEffective = cacheRead > cacheCreate

            logger.info("🔥 cache keep-alive: warmup DONE session=\(sessionId.prefix(8)) duration=\(durationMs)ms input=\(usage.inputTokens) cache_read=\(cacheRead) cache_create=\(cacheCreate) output=\(usage.outputTokens) hit_rate=\(String(format: "%.1f", cacheHitRate))% effective=\(cacheEffective)")

            if !cacheEffective {
                logger.warning("🔥 cache keep-alive: LOW cache hit — cache_create(\(cacheCreate)) >= cache_read(\(cacheRead)). The prefix may have changed or cache already expired.")
            }

            // Reschedule if we haven't hit the max
            if var state = sessions[sessionId], state.keepAliveCount < maxKeepAlives {
                state.timer?.invalidate()
                let nextFireDate = Date().addingTimeInterval(keepAliveDelay)
                let nextFireStr = ISO8601DateFormatter().string(from: nextFireDate)
                state.timer = scheduleTimer(sessionId: sessionId)
                sessions[sessionId] = state
                logger.info("🔥 cache keep-alive: rescheduled warmup #\(state.keepAliveCount + 1)/\(self.maxKeepAlives) session=\(sessionId.prefix(8)) nextFire=\(nextFireStr)")
            } else {
                let count = sessions[sessionId]?.keepAliveCount ?? 0
                logger.info("🔥 cache keep-alive: NOT rescheduling session=\(sessionId.prefix(8)) keepAliveCount=\(count)/\(self.maxKeepAlives)")
            }
        } catch {
            let durationMs = Int((CFAbsoluteTimeGetCurrent() - startTime) * 1000)
            logger.error("🔥 cache keep-alive: warmup FAILED session=\(sessionId.prefix(8)) duration=\(durationMs)ms error=\(error.localizedDescription)")
        }
    }
}
