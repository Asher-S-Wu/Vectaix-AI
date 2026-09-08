package com.openminis.app.diagnostics

import android.os.Debug
import java.io.File

/**
 * [T-android-mem-probe-trust] Trustworthy process-memory readings.
 *
 * ## Why this exists
 *
 * The 2026-08-15 field log reported `nativeHeapMB=9744` — 9.7 GB — from
 * `Debug.getNativeHeapAllocatedSize()`, on a device with 6 GB of RAM and a
 * 512 MB heap ceiling. Both a 17-message session (23 KB of text) and a
 * 1528-message one produced multi-GB readings, so the number did not track
 * workload at all. That reading sent a whole investigation down the wrong
 * path: it was read as "native heap exploded → OOM kill", and a request-body
 * serialisation fix was scoped off the back of it.
 *
 * `Debug.getNativeHeapAllocatedSize()` delegates to the platform allocator and
 * some vendor ROMs (the field device was vivo — `/proc/vivo_rsc/…` appears in
 * its logcat tail) return an accumulated or address-space figure rather than
 * live bytes. A Pixel 4a under a deliberately larger workload reported 23 MB
 * from the same call, i.e. the API is not comparable across devices and must
 * not be the only number in the log.
 *
 * ## What this reports instead
 *
 * `/proc/self/status` is the kernel's own accounting and is consistent across
 * vendors: [rssKb] is resident memory and is the number to reason about when
 * asking "was this process big enough for the LMK to kill it". The Java heap
 * comes from `Runtime`, which is reliable everywhere. The legacy native figure
 * is still emitted, but explicitly labelled so nobody treats it as truth again.
 *
 * All reads are cheap: two `Runtime` calls plus one small proc file, no
 * allocation beyond the parsed longs. Safe to sample per timeline step.
 */
data class MemorySnapshot(
    /** Live Java heap in MB (`totalMemory - freeMemory`). Reliable. */
    val javaHeapMB: Long,
    /** Java heap ceiling in MB (`maxMemory`). The OOM line for Java allocations. */
    val javaHeapMaxMB: Long,
    /** Resident set size in MB from /proc/self/status. Kernel truth; -1 if unreadable. */
    val rssMB: Long,
    /** Peak RSS in MB (VmHWM) — survives a dip, so a spike is still visible. */
    val rssPeakMB: Long,
    /** Virtual size in MB (VmSize). Large values are normal, not a leak signal. */
    val vmSizeMB: Long,
    /** `Debug.getNativeHeapAllocatedSize()`. UNTRUSTED — see class docs. */
    val nativeHeapRawMB: Long,
) {
    /** Fraction of the Java heap ceiling in use, 0..1. The real OOM predictor. */
    val javaHeapUsedFraction: Double
        get() = if (javaHeapMaxMB > 0) javaHeapMB.toDouble() / javaHeapMaxMB else 0.0

    /**
     * Compact log form. `nativeHeapRawMB` is deliberately named `nativeRaw`
     * rather than `nativeHeapMB` so old greps do not silently pick it up and
     * repeat the original misreading.
     */
    fun toLogString(): String =
        "javaHeapMB=$javaHeapMB/$javaHeapMaxMB (${(javaHeapUsedFraction * 100).toInt()}%) " +
            "rssMB=$rssMB peakRssMB=$rssPeakMB vmSizeMB=$vmSizeMB nativeRawMB=$nativeHeapRawMB"

    companion object {
        /** True once the Java heap is close enough to its ceiling to matter. */
        const val HEAP_PRESSURE_FRACTION = 0.80

        fun capture(): MemorySnapshot {
            val rt = Runtime.getRuntime()
            val mb = 1024L * 1024L
            var rssKb = -1L
            var peakKb = -1L
            var vmKb = -1L
            try {
                // Single pass; stop as soon as all three are found. VmHWM and
                // VmRSS sit adjacent near the top of the file, so this reads
                // only a handful of lines in practice.
                File("/proc/self/status").useLines { lines ->
                    for (line in lines) {
                        when {
                            line.startsWith("VmRSS:") -> rssKb = parseKb(line)
                            line.startsWith("VmHWM:") -> peakKb = parseKb(line)
                            line.startsWith("VmSize:") -> vmKb = parseKb(line)
                        }
                        if (rssKb >= 0 && peakKb >= 0 && vmKb >= 0) break
                    }
                }
            } catch (_: Throwable) {
                // Some hardened ROMs restrict /proc/self. Fall through with -1
                // rather than losing the Java-heap numbers too.
            }
            return MemorySnapshot(
                javaHeapMB = (rt.totalMemory() - rt.freeMemory()) / mb,
                javaHeapMaxMB = rt.maxMemory() / mb,
                rssMB = if (rssKb >= 0) rssKb / 1024 else -1,
                rssPeakMB = if (peakKb >= 0) peakKb / 1024 else -1,
                vmSizeMB = if (vmKb >= 0) vmKb / 1024 else -1,
                nativeHeapRawMB = Debug.getNativeHeapAllocatedSize() / mb,
            )
        }

        /** "VmRSS:\t  123456 kB" → 123456. */
        private fun parseKb(line: String): Long {
            val digits = line.filter { it.isDigit() }
            return digits.toLongOrNull() ?: -1L
        }
    }
}
