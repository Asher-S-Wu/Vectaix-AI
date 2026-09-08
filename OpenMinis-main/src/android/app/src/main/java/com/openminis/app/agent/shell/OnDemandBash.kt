package com.openminis.app.agent.shell

import android.content.Context
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL

/**
 * Confirms/installs bash on demand with the design-review guards
 * (T-bash-on-demand §2/§3, F2/M5). Isomorphic to iOS OnDemandBash.swift:
 *   - tri-state availability cache (unavailable has a 10-min TTL; available
 *     self-heals on a later 127),
 *   - host-side 5s network precheck before running apk (F2),
 *   - persistent failure backoff (24h / 3-strikes) via SharedPreferences (F2),
 *   - one install attempt per process launch.
 *
 * On Android PRoot runs `apk add` natively (~1-3s), so the wait is minor; the
 * guards still matter for the offline / broken-source case.
 */
object OnDemandBash {

    private const val TAG = "Bashism"
    private const val PREFS = "bash_install"
    private const val KEY_FAIL_COUNT = "failCount"
    private const val KEY_LAST_FAIL = "lastFailAt"
    private const val MAX_STRIKES = 3
    private const val BACKOFF_WINDOW_MS = 24L * 3600 * 1000
    private const val UNAVAILABLE_TTL_MS = 10L * 60 * 1000
    private const val INSTALL_BUDGET_MS = 60_000L
    private const val APK_PROBE_URL = "https://dl-cdn.alpinelinux.org/alpine/"

    private sealed class Availability {
        object Unknown : Availability()
        object Available : Availability()
        data class Unavailable(val until: Long) : Availability()
    }

    private val lock = Mutex()
    private var availability: Availability = Availability.Unknown
    private var attemptedInstallThisLaunch = false

    /** Runs a guest command, returns its exit code. */
    fun interface Executor {
        suspend fun run(command: String, timeoutMs: Long): Int
    }

    sealed class Outcome {
        object Available : Outcome()
        data class Unavailable(val reason: String) : Outcome()
    }

    suspend fun ensureBash(context: Context, executor: Executor): Outcome = lock.withLock {
        when (val a = availability) {
            is Availability.Available -> return Outcome.Available
            is Availability.Unavailable -> {
                if (System.currentTimeMillis() < a.until) return Outcome.Unavailable("bash not installed")
                availability = Availability.Unknown // TTL expired — re-probe
            }
            is Availability.Unknown -> {}
        }

        if (executor.run("command -v bash >/dev/null 2>&1", 15_000) == 0) {
            availability = Availability.Available
            return Outcome.Available
        }

        if (attemptedInstallThisLaunch) {
            markUnavailable()
            return Outcome.Unavailable("bash install already attempted this session")
        }
        backoffReason(context)?.let {
            markUnavailable()
            return Outcome.Unavailable(it)
        }
        attemptedInstallThisLaunch = true

        if (!networkReachable()) {
            recordFailure(context); markUnavailable()
            return Outcome.Unavailable("network/apk mirror unreachable")
        }

        Log.i(TAG, "installing bash (budget ${INSTALL_BUDGET_MS / 1000}s)…")
        val rc = executor.run("apk add bash", INSTALL_BUDGET_MS)
        val verified = rc == 0 && executor.run("command -v bash >/dev/null 2>&1", 15_000) == 0
        if (verified) {
            clearFailure(context)
            availability = Availability.Available
            // A SUCCESSFUL install re-arms the per-launch guard (M5 self-heal:
            // if the user later apk-del's bash this session, one fresh reinstall
            // is still allowed). The guard only blocks repeated FAILING installs.
            attemptedInstallThisLaunch = false
            Log.i(TAG, "bash installed OK")
            return Outcome.Available
        }
        recordFailure(context); markUnavailable()
        Log.e(TAG, "bash install failed (rc=$rc)")
        return Outcome.Unavailable("apk add bash failed (rc=$rc)")
    }

    /** Called when `bash <file>` itself returned 127 (user apk del'd) — M5. */
    suspend fun markDisappeared() = lock.withLock { availability = Availability.Unknown }

    private fun markUnavailable() {
        availability = Availability.Unavailable(System.currentTimeMillis() + UNAVAILABLE_TTL_MS)
    }

    private fun backoffReason(context: Context): String? {
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val count = p.getInt(KEY_FAIL_COUNT, 0)
        if (count >= MAX_STRIKES) return "bash install disabled after $MAX_STRIKES failures (retry manually: apk add bash)"
        val last = p.getLong(KEY_LAST_FAIL, 0)
        if (last > 0 && System.currentTimeMillis() - last < BACKOFF_WINDOW_MS) return "bash install backing off (recent failure)"
        return null
    }

    private fun recordFailure(context: Context) {
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        p.edit().putInt(KEY_FAIL_COUNT, p.getInt(KEY_FAIL_COUNT, 0) + 1)
            .putLong(KEY_LAST_FAIL, System.currentTimeMillis()).apply()
    }

    private fun clearFailure(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .remove(KEY_FAIL_COUNT).remove(KEY_LAST_FAIL).apply()
    }

    private suspend fun networkReachable(): Boolean = withContext(Dispatchers.IO) {
        try {
            val c = (URL(APK_PROBE_URL).openConnection() as HttpURLConnection).apply {
                requestMethod = "HEAD"; connectTimeout = 5000; readTimeout = 5000
            }
            val code = c.responseCode
            c.disconnect()
            code in 200..499
        } catch (_: Exception) {
            false
        }
    }
}
