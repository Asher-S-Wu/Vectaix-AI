package com.openminis.app.diagnostics

import com.openminis.app.logging.AppLogger
import java.util.concurrent.atomic.AtomicLong

/**
 * T-android-long-ctx-reentry-perf: dedicated breadcrumb stream for the
 * "tap session → ChatScreen first frame" reentry path. Distinct from the
 * existing `[T-HANG-DIAG]` markers so a single grep on
 * `[Perf][LongCtx]` returns just the reentry timeline.
 *
 * Each call emits a line like:
 *   [Perf][LongCtx] step=loadSession.enter session=abc elapsedMs=12 sinceClickMs=180 javaHeapMB=148 nativeHeapMB=64 extra=...
 *
 * - `elapsedMs` is measured from the most recent step on the same session.
 * - `sinceClickMs` is measured from `click()` on the same session, which
 *   is the user-perceived start of the reentry.
 * - Heap numbers are cheap O(1) reads and intentionally sampled at every
 *   step so a GC-storm regime is obvious in the trace without a separate
 *   tracer.
 *
 * Thread-safety: the click + last timestamps are kept in `AtomicLong`s
 * keyed by sessionId. Concurrent loadSession of *different* sessions
 * won't clobber each other; concurrent loadSession of the *same*
 * sessionId would race on `lastNs` but that is not a real scenario
 * (loadSession runs once on entry).
 */
object PerfLongCtx {

    private const val CATEGORY = "Perf"

    private val clickNsBySession = java.util.concurrent.ConcurrentHashMap<String, Long>()
    private val lastNsBySession = java.util.concurrent.ConcurrentHashMap<String, Long>()
    private val seq = AtomicLong(0)

    /**
     * Row-compose accumulator for the LazyColumn rentry path. Counts each
     * [FlatChatItem] that enters composition during a reentry; emits a
     * one-line summary when the 10th and 50th rows arrive so a dense
     * tool-use session shows up as a single "took 800 ms to compose
     * 50 rows" line instead of 50 individual log entries.
     *
     * The counter is keyed by sessionId, so a navigation away + back
     * within the same process accumulates new counts (the previous
     * milestones already fired, this just races to 10/50 again).
     */
    private val rowComposeCount = java.util.concurrent.ConcurrentHashMap<String, AtomicLong>()
    private val rowComposeStartNs = java.util.concurrent.ConcurrentHashMap<String, Long>()
    private val rowComposeTypes = java.util.concurrent.ConcurrentHashMap<String, java.util.concurrent.ConcurrentHashMap<String, AtomicLong>>()
    private val ROW_MILESTONES = longArrayOf(10, 50, 200)

    /**
     * User tapped the session card. Resets the per-session timeline.
     * Called from the row's gesture handler so we capture the very first
     * timestamp the user is waiting on.
     */
    fun click(sessionId: String) {
        val now = System.nanoTime()
        clickNsBySession[sessionId] = now
        lastNsBySession[sessionId] = now
        emit(sessionId, "click", elapsedMs = 0, extra = "seq=${seq.incrementAndGet()}")
    }

    /**
     * Generic timeline breadcrumb. `extra` is appended verbatim so
     * callsites can pass `count=405 totalChars=1234567` etc.
     */
    fun step(sessionId: String, name: String, extra: String = "") {
        val now = System.nanoTime()
        val last = lastNsBySession[sessionId] ?: clickNsBySession[sessionId] ?: now
        val elapsedMs = (now - last) / 1_000_000
        lastNsBySession[sessionId] = now
        emit(sessionId, name, elapsedMs, extra)
    }

    /**
     * End of the reentry timeline (typically the loadSession EXIT or
     * the last-message onPlaced). Leaves the click timestamp in place
     * so any late-arriving steps still report a sensible
     * `sinceClickMs`; subsequent click() calls reset normally.
     */
    fun end(sessionId: String, name: String = "end", extra: String = "") {
        step(sessionId, name, extra)
        lastNsBySession.remove(sessionId)
    }

    /**
     * Call from each LazyColumn item's compose lambda. Cheap O(1) — only
     * emits a log line at the 10th / 50th / 200th row per session.
     * Tracks per-class counts (e.g. `AssistantToolUse=18 UserBubble=4
     * AssistantText=8`) so a session blown out by tool cards is
     * immediately distinguishable from one blown out by markdown
     * chunks.
     */
    fun maybeReportRowComposed(sessionId: String, itemClassName: String) {
        val counter = rowComposeCount.computeIfAbsent(sessionId) { AtomicLong(0) }
        val types = rowComposeTypes.computeIfAbsent(sessionId) { java.util.concurrent.ConcurrentHashMap() }
        types.computeIfAbsent(itemClassName) { AtomicLong(0) }.incrementAndGet()
        val now = counter.incrementAndGet()
        if (now == 1L) {
            rowComposeStartNs[sessionId] = System.nanoTime()
            return
        }
        var isMilestone = false
        for (m in ROW_MILESTONES) {
            if (now == m) { isMilestone = true; break }
        }
        if (isMilestone) {
            val startNs = rowComposeStartNs[sessionId] ?: return
            val ms = (System.nanoTime() - startNs) / 1_000_000
            val byType = types.entries.joinToString(",") { "${it.key}=${it.value.get()}" }
            step(
                sessionId,
                "rowsCompose.milestone",
                "rows=$now sinceFirstRowMs=$ms byType=$byType",
            )
        }
    }

    private fun emit(sessionId: String, name: String, elapsedMs: Long, extra: String) {
        val clickNs = clickNsBySession[sessionId]
        val sinceClickMs = if (clickNs != null) {
            (System.nanoTime() - clickNs) / 1_000_000
        } else {
            -1L
        }
        // [T-android-mem-probe-trust] Was `javaHeapMB=… nativeHeapMB=…`, where
        // the native figure came straight from Debug.getNativeHeapAllocatedSize().
        // On the 2026-08-15 field device (vivo) that call reported 9744 MB on a
        // 6 GB phone, for a 17-message session — it tracked nothing, and it was
        // read as an OOM smoking gun. MemorySnapshot reports kernel RSS as the
        // primary number and keeps the legacy value under `nativeRawMB` so it
        // can still be compared across reports without being mistaken for truth.
        val mem = MemorySnapshot.capture()
        val extraPart = if (extra.isEmpty()) "" else " $extra"
        AppLogger.info(
            CATEGORY,
            "[Perf][LongCtx] step=$name session=$sessionId elapsedMs=$elapsedMs " +
                "sinceClickMs=$sinceClickMs ${mem.toLogString()}$extraPart",
        )
    }
}
