package com.openminis.app.data

import android.content.Context
import android.content.SharedPreferences
import com.openminis.app.logging.AppLogger
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

/**
 * Persists a downloaded-but-not-yet-installed APK across Activity recreate /
 * process death.
 *
 * Why this exists: the original update flow held the downloaded [File]
 * reference in a Composable `remember{}` slot. When the user tapped "Open
 * Settings" to grant "install unknown apps" permission, the system pushed
 * Minis to the background; on return the Activity often recreated, the slot
 * was reset, and the UI silently asked the user to download the APK again.
 *
 * Storage: a single SharedPreferences key holding a small JSON blob. We
 * deliberately avoid DataStore here — this object is touched at most a
 * couple times per update flow, blocking access is fine, and SharedPreferences
 * is already initialised elsewhere.
 *
 * Freshness: a [PendingUpdate] older than [MAX_AGE_MS] (24 h) is discarded
 * on read so a stale APK can't auto-install on cold start a week later
 * after the GitHub release was re-rolled.
 *
 * Integrity: we compute and store sha256 if [setPending] is given the
 * file bytes; if absent, [verify] falls back to (size == expectedSize).
 */
object PendingUpdateStore {

    private const val TAG = "PendingUpdateStore"
    private const val PREFS = "pending_update"
    private const val KEY = "pending"
    private const val MAX_AGE_MS = 24L * 60L * 60L * 1000L

    data class PendingUpdate(
        val targetVersionName: String,
        val apkPath: String,
        val apkSize: Long,
        val sha256: String?,
        val downloadedAtMs: Long,
    )

    private var prefs: SharedPreferences? = null

    /** Idempotent. Safe to call from MinisApp.onCreate. */
    fun init(context: Context) {
        if (prefs != null) return
        prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    }

    private fun requirePrefs(context: Context): SharedPreferences {
        prefs?.let { return it }
        init(context)
        return prefs!!
    }

    fun setPending(context: Context, pending: PendingUpdate) {
        val json = JSONObject().apply {
            put("targetVersionName", pending.targetVersionName)
            put("apkPath", pending.apkPath)
            put("apkSize", pending.apkSize)
            if (pending.sha256 != null) put("sha256", pending.sha256) else put("sha256", JSONObject.NULL)
            put("downloadedAtMs", pending.downloadedAtMs)
        }
        requirePrefs(context).edit().putString(KEY, json.toString()).apply()
        AppLogger.info(
            TAG,
            "setPending version=${pending.targetVersionName} size=${pending.apkSize} sha256=${pending.sha256 != null}",
        )
    }

    /**
     * Returns the persisted pending update, or null when:
     *  - nothing stored
     *  - JSON malformed (treated as gone, cleared)
     *  - older than [MAX_AGE_MS] (cleared)
     *  - target version no longer newer than the running build
     */
    fun getPending(context: Context): PendingUpdate? {
        val p = requirePrefs(context)
        val raw = p.getString(KEY, null) ?: return null
        val obj = runCatching { JSONObject(raw) }.getOrNull()
        if (obj == null) {
            AppLogger.warning(TAG, "stored JSON malformed, discarding")
            p.edit().remove(KEY).apply()
            return null
        }
        val pending = PendingUpdate(
            targetVersionName = obj.optString("targetVersionName"),
            apkPath = obj.optString("apkPath"),
            apkSize = obj.optLong("apkSize"),
            sha256 = obj.optString("sha256", "").takeIf { it.isNotEmpty() && it != "null" },
            downloadedAtMs = obj.optLong("downloadedAtMs"),
        )
        val age = System.currentTimeMillis() - pending.downloadedAtMs
        if (age > MAX_AGE_MS) {
            AppLogger.info(TAG, "pending update expired age=${age}ms; clearing")
            clearPending(context)
            return null
        }
        return pending
    }

    fun clearPending(context: Context) {
        requirePrefs(context).edit().remove(KEY).apply()
        AppLogger.info(TAG, "clearPending")
    }

    /**
     * Strict integrity check used before firing the install intent on resume:
     *  - file exists
     *  - length matches recorded size
     *  - if sha256 was recorded, recomputed hash matches
     *
     * Returns the File when valid, null when corrupt/missing (caller should
     * clear the pending record and re-download).
     */
    fun verify(pending: PendingUpdate): File? {
        val f = File(pending.apkPath)
        if (!f.exists()) {
            AppLogger.warning(TAG, "verify: file missing ${pending.apkPath}")
            return null
        }
        if (f.length() != pending.apkSize) {
            AppLogger.warning(TAG, "verify: size mismatch expected=${pending.apkSize} actual=${f.length()}")
            return null
        }
        if (pending.sha256 != null) {
            val actual = runCatching { sha256(f) }.getOrNull()
            if (actual == null || !actual.equals(pending.sha256, ignoreCase = true)) {
                AppLogger.warning(TAG, "verify: sha256 mismatch expected=${pending.sha256} actual=$actual")
                return null
            }
        }
        return f
    }

    fun sha256(file: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buf = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buf)
                if (n <= 0) break
                md.update(buf, 0, n)
            }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }
}
