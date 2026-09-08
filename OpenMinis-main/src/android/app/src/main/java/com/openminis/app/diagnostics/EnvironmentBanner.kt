package com.openminis.app.diagnostics

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import com.openminis.app.logging.AppLogger

/**
 * [T-android-mem-probe-trust] One-line device/environment banner, emitted once
 * per logging session.
 *
 * ## Why this exists
 *
 * The 2026-08-15 field log contained no device identity at all. The only clue
 * to which hardware produced it was an incidental logcat line mentioning
 * `/proc/vivo_rsc/…`. Without a banner, a triage session mistakenly compared
 * that log against a Pixel 4a reproduction and drew conclusions from the
 * mismatch — the vendor ROM was the single most load-bearing variable and it
 * was invisible.
 *
 * Every field report should answer, from the log alone: which device, which
 * ROM, how much RAM, what heap ceiling, and is the device already under
 * memory pressure. Those decide whether a repro on other hardware means
 * anything.
 *
 * Deliberately no IMEI/serial/account data — model and ROM identity only.
 */
object EnvironmentBanner {

    private const val TAG = "Env"

    fun log(context: Context) {
        try {
            val rt = Runtime.getRuntime()
            val mb = 1024L * 1024L

            val am = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
            val mi = ActivityManager.MemoryInfo().also { am?.getMemoryInfo(it) }

            // memoryClass = heap ceiling WITHOUT largeHeap;
            // largeMemoryClass = ceiling WITH android:largeHeap="true".
            // We ship largeHeap=true, so largeMemoryClass is the real limit —
            // and it varies per vendor, which is exactly what we need to know.
            val memClass = am?.memoryClass ?: -1
            val largeMemClass = am?.largeMemoryClass ?: -1

            AppLogger.info(
                TAG,
                "[Env] device=${Build.MANUFACTURER}/${Build.BRAND}/${Build.MODEL} " +
                    "device_codename=${Build.DEVICE} product=${Build.PRODUCT} " +
                    "android=${Build.VERSION.RELEASE} sdk=${Build.VERSION.SDK_INT} " +
                    "rom=${Build.DISPLAY} " +
                    "abi=${Build.SUPPORTED_ABIS.joinToString("|")}",
            )
            AppLogger.info(
                TAG,
                "[Env] heapCeilingMB=${rt.maxMemory() / mb} " +
                    "memoryClassMB=$memClass largeMemoryClassMB=$largeMemClass " +
                    "deviceTotalRamMB=${mi.totalMem / mb} deviceAvailRamMB=${mi.availMem / mb} " +
                    "lowMemThresholdMB=${mi.threshold / mb} deviceLowMemory=${mi.lowMemory} " +
                    "cpuCores=${rt.availableProcessors()}",
            )
            AppLogger.info(TAG, "[Env] memory ${MemorySnapshot.capture().toLogString()}")
        } catch (t: Throwable) {
            // Diagnostics must never take down a launch.
            AppLogger.warning(TAG, "[Env] banner failed: ${t.javaClass.simpleName}: ${t.message}")
        }
    }
}
