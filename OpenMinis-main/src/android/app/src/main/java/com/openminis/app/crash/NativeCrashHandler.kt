package com.openminis.app.crash

import android.util.Log
import java.io.File

/**
 * T283: JNI bridge to the NDK signal handler. Loaded lazily on first
 * `install()` so callers that never enable native crash capture don't
 * pay the dlopen cost.
 *
 * The native side (cpp/crash_handler.cpp) registers sigaction handlers
 * for SIGSEGV/SIGABRT/SIGBUS/SIGFPE/SIGILL/SIGSYS. On a fatal signal it
 * writes a one-shot report to `<logsDir>/native-crash-<stamp>.log`
 * (same `.log` extension AppLogger.listLogFiles already filters for, so
 * reports show up in LogManagementScreen) and re-raises the signal so
 * the system tombstone is still produced.
 */
object NativeCrashHandler {

    private const val TAG = "NativeCrashHandler"
    @Volatile private var installed = false

    fun install(logsDir: File) {
        if (installed) return
        synchronized(this) {
            if (installed) return
            try {
                System.loadLibrary("minis_crash_handler")
            } catch (t: Throwable) {
                Log.w(TAG, "loadLibrary failed: ${t.message}")
                return
            }
            try {
                logsDir.mkdirs()
                nativeInstall(logsDir.absolutePath)
                installed = true
                Log.i(TAG, "installed; dir=${logsDir.absolutePath}")
            } catch (t: Throwable) {
                Log.w(TAG, "nativeInstall failed: ${t.message}")
            }
        }
    }

    private external fun nativeInstall(logDir: String)
}
