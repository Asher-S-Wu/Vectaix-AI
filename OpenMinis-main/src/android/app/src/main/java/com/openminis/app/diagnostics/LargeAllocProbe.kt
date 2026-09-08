package com.openminis.app.diagnostics

import com.openminis.app.logging.AppLogger

/**
 * [T-android-mem-probe-trust] Records large, workload-driven allocations and
 * the heap headroom around them.
 *
 * ## Why this exists
 *
 * The 2026-08-15 field log recorded `bodyLen=2342987` for the request that
 * preceded a process death, but nothing about what that cost: no before/after
 * heap, no headroom, no indication of whether the allocation nearly failed.
 * So "did serialising this body kill the app?" was unanswerable from the log
 * and had to be guessed at.
 *
 * This probe brackets such an allocation and records what actually happened.
 * A near-miss (heap crossing the pressure line, or a big jump in peak RSS)
 * is then visible in the very same log the user attaches to a report.
 *
 * ## Recording, not preventing
 *
 * This deliberately does not truncate or reject anything — a probe that
 * changes behaviour makes the next field report describe the probe rather
 * than the bug. It only observes, and shouts when the numbers are alarming.
 */
object LargeAllocProbe {

    private const val TAG = "MemProbe"

    /** Bodies at or above this are worth a line on their own. */
    const val NOTABLE_BYTES = 512 * 1024

    /**
     * Bracket a large serialisation/allocation.
     *
     * @param label what is being built (e.g. "openai.requestBody").
     * @param sizeBytes the resulting payload size, if known up front.
     * @param detail caller context — model id, message count, session id.
     * @return whatever [block] returns; exceptions propagate untouched after
     *   being logged, so an OOM here is attributable instead of anonymous.
     */
    inline fun <T> around(
        label: String,
        sizeBytes: Long,
        detail: String = "",
        block: () -> T,
    ): T {
        if (sizeBytes < NOTABLE_BYTES) return block()

        val before = MemorySnapshot.capture()
        val startNs = System.nanoTime()
        try {
            val result = block()
            report(label, sizeBytes, detail, before, startNs, failure = null)
            return result
        } catch (t: Throwable) {
            // The case we most need in a field log: the allocation that died.
            report(label, sizeBytes, detail, before, startNs, failure = t)
            throw t
        }
    }

    /** Published for the inline function above; not part of the intended API. */
    fun report(
        label: String,
        sizeBytes: Long,
        detail: String,
        before: MemorySnapshot,
        startNs: Long,
        failure: Throwable?,
    ) {
        val after = MemorySnapshot.capture()
        val ms = (System.nanoTime() - startNs) / 1_000_000
        val deltaJava = after.javaHeapMB - before.javaHeapMB
        val deltaRss = if (before.rssMB >= 0 && after.rssMB >= 0) after.rssMB - before.rssMB else -1

        val head = "[MemProbe] $label sizeBytes=$sizeBytes (${sizeBytes / 1024}KB) " +
            "tookMs=$ms deltaJavaMB=$deltaJava deltaRssMB=$deltaRss " +
            "before[${before.toLogString()}] after[${after.toLogString()}]" +
            if (detail.isEmpty()) "" else " $detail"

        when {
            failure != null -> {
                AppLogger.error(TAG, "$head FAILED=${failure.javaClass.name}: ${failure.message}")
                // Full stack: for an OOM the frame that asked for the memory is
                // the whole answer, and it is exactly what the earlier
                // investigation lacked.
                AppLogger.error(TAG, "[MemProbe] $label stack:\n${stackOf(failure)}")
            }
            after.javaHeapUsedFraction >= MemorySnapshot.HEAP_PRESSURE_FRACTION ->
                AppLogger.warning(TAG, "$head HEAP_PRESSURE")
            else -> AppLogger.info(TAG, head)
        }
    }

    fun stackOf(t: Throwable): String {
        val sw = java.io.StringWriter()
        t.printStackTrace(java.io.PrintWriter(sw))
        // Cap: a deep Compose/coroutine stack can run to thousands of lines and
        // this is written into the user's log file.
        return sw.toString().lineSequence().take(60).joinToString("\n")
    }
}
