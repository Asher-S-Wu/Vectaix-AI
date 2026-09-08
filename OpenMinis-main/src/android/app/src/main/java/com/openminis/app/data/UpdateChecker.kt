package com.openminis.app.data

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.openminis.app.BuildConfig
import com.openminis.app.logging.AppLogger
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.TimeUnit

/**
 * Checks GitHub releases for an APK newer than [BuildConfig.VERSION_NAME] and
 * coordinates download → install. iOS has no equivalent (sideloading is not
 * permitted) so this is Android-only.
 *
 * Comparison strategy: strip a leading `v` from `tag_name`, then split both
 * the tag and the local versionName on `.` and compare numerically component
 * by component. A tag like `v1.0.1` beats local `1.0.0`; `v1.0.0-rc1` beats
 * `1.0.0` because the suffix sorts higher under string fallback.
 */
object UpdateChecker {

    private const val TAG = "UpdateChecker"
    private const val OWNER = "OpenMinis"
    // T133: the public repo is OpenMinis/OpenMinis (org + repo share a name).
    // Previously pointed at OpenMinis/MinisApp, which is the private dev
    // mirror — every API call 404'd, which we mistranslated as "no release
    // published". The 0.1-preview release is published as a prerelease on
    // OpenMinis/OpenMinis with a MinisApp-*.apk asset attached.
    private const val REPO = "OpenMinis"
    private const val DOWNLOAD_FILENAME = "minis-update.apk"
    /**
     * Sub-directory of `filesDir` where we stage downloaded update APKs. We
     * moved off `cacheDir/shared/` (the original location) so the OS can't
     * evict a freshly-downloaded APK between the moment we hand the user off
     * to "install unknown apps" settings and the moment they return — the
     * eviction was a contributing factor to the "re-download after grant"
     * bug. See [PendingUpdateStore]. Exposed via `file_provider_paths.xml`
     * `<files-path name="updates" path="updates/" />`.
     */
    private const val UPDATES_DIR = "updates"

    sealed class CheckResult {
        data class UpdateAvailable(
            val tagName: String,
            val versionName: String,
            val releaseName: String,
            val changelog: String,
            val apkUrl: String,
            val apkSizeBytes: Long,
        ) : CheckResult()
        data object UpToDate : CheckResult()
        // The repo has zero non-draft releases (or 404'd entirely).
        data object NoReleaseAvailable : CheckResult()
        // A newer release exists but no .apk asset was attached. Distinct
        // from NoReleaseAvailable so the UI can say "newer release exists,
        // but it didn't ship an APK" instead of misleading "no release yet".
        data class NoApkAsset(val tagName: String) : CheckResult()
        data class Error(val message: String) : CheckResult()
        // GitHub returned 403 / 451 — usually a geo-block or rate-limit in CN
        // without a VPN. UI surfaces a hint with a clickable Releases link.
        data object Forbidden : CheckResult()
        // DNS / connect / read timeout — network unreachable. UI nudges the
        // user to check connectivity and retry.
        data object NetworkUnreachable : CheckResult()
    }

    sealed class DownloadResult {
        data class Success(val file: File) : DownloadResult()
        data class Error(val message: String) : DownloadResult()
    }

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    /**
     * Hit `repos/{owner}/{repo}/releases` (the list endpoint, NOT
     * `/releases/latest`), pick the highest-version non-draft release that
     * carries an APK asset, and decide whether the user should upgrade.
     *
     * T133: switched from `/releases/latest` to `/releases` because
     * `/releases/latest` excludes prereleases by GitHub design — our
     * `0.1 preview` release is flagged as a prerelease, so the old endpoint
     * 404'd and the UI falsely showed "No release published yet". The list
     * endpoint includes prereleases; we filter drafts client-side.
     *
     * All network work happens on [Dispatchers.IO]; safe to call from any
     * coroutine scope.
     */
    suspend fun check(): CheckResult = withContext(Dispatchers.IO) {
        val url = "https://api.github.com/repos/$OWNER/$REPO/releases?per_page=30"
        AppLogger.info(TAG, "GET $url (local=${BuildConfig.VERSION_NAME})")
        try {
            val req = Request.Builder()
                .url(url)
                .header("Accept", "application/vnd.github+json")
                .header("X-GitHub-Api-Version", "2022-11-28")
                .build()
            client.newCall(req).execute().use { resp ->
                AppLogger.info(TAG, "HTTP ${resp.code}")
                if (resp.code == 404) {
                    return@withContext CheckResult.NoReleaseAvailable
                }
                // 403 = rate-limit or geo-blocked. 451 = legal block. Both
                // map to the same "open Releases in browser" hint — there's
                // nothing the app can do client-side.
                if (resp.code == 403 || resp.code == 451) {
                    AppLogger.warning(TAG, "GitHub API ${resp.code} — geo-block or rate-limit")
                    return@withContext CheckResult.Forbidden
                }
                if (!resp.isSuccessful) {
                    val msg = "GitHub API ${resp.code}"
                    AppLogger.warning(TAG, msg)
                    return@withContext CheckResult.Error(msg)
                }
                val body = resp.body?.string() ?: return@withContext CheckResult.Error("empty body")
                val arr = runCatching { JSONArray(body) }.getOrNull()
                if (arr == null || arr.length() == 0) {
                    AppLogger.info(TAG, "releases list empty")
                    return@withContext CheckResult.NoReleaseAvailable
                }

                // Build a list of non-draft releases. GitHub already returns
                // them sorted by created_at desc, but we re-sort by parsed
                // version number to be robust against odd ordering.
                data class ReleaseInfo(
                    val tagName: String,
                    val versionName: String,
                    val releaseName: String,
                    val changelog: String,
                    val isPrerelease: Boolean,
                    val apkUrl: String?,
                    val apkSize: Long,
                )

                val candidates = mutableListOf<ReleaseInfo>()
                for (i in 0 until arr.length()) {
                    val r = arr.optJSONObject(i) ?: continue
                    if (r.optBoolean("draft", false)) continue
                    val tag = r.optString("tag_name")
                    if (tag.isEmpty()) continue
                    val (apkUrl, apkSize) = findApkAsset(r.optJSONArray("assets"))
                    candidates += ReleaseInfo(
                        tagName = tag,
                        versionName = normalizeTag(tag),
                        releaseName = r.optString("name").ifEmpty { tag },
                        changelog = r.optString("body", ""),
                        isPrerelease = r.optBoolean("prerelease", false),
                        apkUrl = apkUrl,
                        apkSize = apkSize,
                    )
                }
                AppLogger.info(
                    TAG,
                    "non-draft releases=${candidates.size} (apk-bearing=${candidates.count { it.apkUrl != null }})",
                )
                if (candidates.isEmpty()) {
                    return@withContext CheckResult.NoReleaseAvailable
                }

                // [T-android-updatechecker-localver-normalize] Normalize the
                // LOCAL version the same way remote tags are (normalizeTag),
                // otherwise the comparison is asymmetric: remote "v0.11-preview"
                // becomes "0.11" but local "0.11-preview" stays raw, and
                // compareVersions("0.11","0.11-preview") puts "" before
                // "preview" in the 3rd component → remote judged OLDER → the
                // user is told they're up to date when they're actually on the
                // matching version (and a real newer "0.12-preview" → "0.12"
                // still compares greater, so updates still surface).
                val localVer = normalizeTag(BuildConfig.VERSION_NAME)
                // Highest version we've seen at all (used for the "release
                // exists but is older or equal" → UpToDate decision and for
                // logging).
                val highest = candidates.maxWithOrNull(
                    compareBy { compareVersions(it.versionName, "0") },
                ) ?: candidates.first()
                AppLogger.info(
                    TAG,
                    "highest-published tag=${highest.tagName} parsed=${highest.versionName} prerelease=${highest.isPrerelease} apk=${highest.apkUrl != null}",
                )

                // First APK-bearing release with version > local. We pick the
                // highest such release so a stale older APK never shadows a
                // newer non-APK preview.
                val upgradeCandidate = candidates
                    .filter { it.apkUrl != null }
                    .filter { compareVersions(it.versionName, localVer) > 0 }
                    .maxWithOrNull(compareBy { compareVersions(it.versionName, "0") })

                if (upgradeCandidate != null) {
                    AppLogger.info(
                        TAG,
                        "Update available: $localVer → ${upgradeCandidate.versionName} (${upgradeCandidate.tagName})",
                    )
                    return@withContext CheckResult.UpdateAvailable(
                        tagName = upgradeCandidate.tagName,
                        versionName = upgradeCandidate.versionName,
                        releaseName = upgradeCandidate.releaseName,
                        changelog = upgradeCandidate.changelog,
                        apkUrl = upgradeCandidate.apkUrl!!,
                        apkSizeBytes = upgradeCandidate.apkSize,
                    )
                }

                // No newer-with-APK candidate exists. Decide between three
                // remaining states:
                //   1. Highest release ≤ local version → UpToDate.
                //   2. Highest release > local but no APK in the listing →
                //      NoApkAsset (mention the tag so the user can grab the
                //      release manually if they really want).
                //   3. Otherwise (all releases ≤ local) → UpToDate as well.
                val highestVsLocal = compareVersions(highest.versionName, localVer)
                if (highestVsLocal > 0 && highest.apkUrl == null) {
                    AppLogger.info(
                        TAG,
                        "Release ${highest.tagName} > local but no APK asset",
                    )
                    return@withContext CheckResult.NoApkAsset(highest.tagName)
                }

                AppLogger.info(TAG, "Up to date: local=$localVer highest=${highest.versionName}")
                CheckResult.UpToDate
            }
        } catch (e: UnknownHostException) {
            AppLogger.error(TAG, "check failed: UnknownHostException: ${e.message}")
            CheckResult.NetworkUnreachable
        } catch (e: ConnectException) {
            AppLogger.error(TAG, "check failed: ConnectException: ${e.message}")
            CheckResult.NetworkUnreachable
        } catch (e: SocketTimeoutException) {
            AppLogger.error(TAG, "check failed: SocketTimeoutException: ${e.message}")
            CheckResult.NetworkUnreachable
        } catch (e: IOException) {
            // Catch-all for okhttp connection plumbing (e.g.
            // "failed to connect", SSL handshake errors). Most of these in
            // the CN-no-VPN scenario are effectively "can't reach github".
            AppLogger.error(TAG, "check failed: ${e.javaClass.simpleName}: ${e.message}")
            CheckResult.NetworkUnreachable
        } catch (e: Exception) {
            AppLogger.error(TAG, "check failed: ${e.javaClass.simpleName}: ${e.message}")
            CheckResult.Error(e.message ?: e.javaClass.simpleName)
        }
    }

    /** Public so UI can deep-link users to manual download when GitHub is blocked. */
    const val RELEASES_URL: String = "https://github.com/OpenMinis/OpenMinis/releases"

    /** Returns (downloadUrl, sizeBytes) for the first .apk asset, or (null, 0). */
    private fun findApkAsset(assets: JSONArray?): Pair<String?, Long> {
        if (assets == null) return null to 0L
        for (i in 0 until assets.length()) {
            val a = assets.optJSONObject(i) ?: continue
            val name = a.optString("name").lowercase()
            if (name.endsWith(".apk")) {
                val u = a.optString("browser_download_url").ifEmpty { null }
                if (u != null) return u to a.optLong("size", 0)
            }
        }
        return null to 0L
    }

    /**
     * Strip the leading `v` and any `-preview` / `-rc1` / etc. trailing
     * label so the numeric comparator keeps `0.1` and `0.1-preview`
     * treated as equivalent. Without this, "0.1 (local) vs 0.1-preview
     * (remote)" reported the remote as newer because the trailing token
     * fell into string comparison.
     */
    private fun normalizeTag(tag: String): String {
        val trimmed = tag.trim().removePrefix("v").removePrefix("V")
        // "0.1-preview" → "0.1"; "0.1.0" → "0.1.0"; "1.2.3-rc1" → "1.2.3"
        val dashIdx = trimmed.indexOf('-')
        return if (dashIdx > 0) trimmed.substring(0, dashIdx) else trimmed
    }

    /**
     * Stream the APK from [url] into `${cacheDir}/shared/minis-update.apk`,
     * surfacing progress (0..1) through [onProgress] roughly every 64 KiB.
     * Returns the on-disk [File] on success so the caller can hand it to
     * [installApk]. The path is intentionally inside `shared/` because that's
     * the only sub-directory of cacheDir already exposed by FileProvider in
     * `file_provider_paths.xml`.
     */
    suspend fun download(
        context: Context,
        url: String,
        versionName: String? = null,
        onProgress: (Float) -> Unit = {},
    ): DownloadResult = withContext(Dispatchers.IO) {
        try {
            // Stage under filesDir (NOT cacheDir) so the OS doesn't evict
            // the APK mid-flow while the user is in system Settings granting
            // install permission — that eviction caused the "re-download
            // after grant" regression (T-android-update-resume-33637).
            val outDir = File(context.filesDir, UPDATES_DIR).apply { mkdirs() }
            // Filename keyed by version so a partial old-version download
            // can't accidentally satisfy a check for a newer version.
            val safeName = versionName
                ?.replace(Regex("[^A-Za-z0-9._-]"), "_")
                ?.takeIf { it.isNotEmpty() }
                ?.let { "minis-$it.apk" }
                ?: DOWNLOAD_FILENAME
            val outFile = File(outDir, safeName)
            // A previous, possibly-aborted download could leave a stale APK
            // behind that the installer would happily try to consume. Wipe it.
            if (outFile.exists()) outFile.delete()

            val req = Request.Builder().url(url).build()
            client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) {
                    return@withContext DownloadResult.Error("HTTP ${resp.code}")
                }
                val body = resp.body ?: return@withContext DownloadResult.Error("empty body")
                val total = body.contentLength().takeIf { it > 0 } ?: -1L
                body.byteStream().use { input ->
                    outFile.outputStream().use { output ->
                        val buf = ByteArray(64 * 1024)
                        var read: Int
                        var totalRead = 0L
                        var lastReported = -1
                        while (input.read(buf).also { read = it } != -1) {
                            output.write(buf, 0, read)
                            totalRead += read
                            if (total > 0) {
                                val pct = ((totalRead * 100) / total).toInt()
                                if (pct != lastReported) {
                                    lastReported = pct
                                    onProgress(pct / 100f)
                                }
                            }
                        }
                    }
                }
            }
            AppLogger.info(TAG, "Downloaded ${outFile.length()} bytes to ${outFile.absolutePath}")
            // Persist so a subsequent Activity recreate (e.g. after the user
            // returns from "install unknown apps" settings) can resume the
            // install without re-downloading. sha256 computed best-effort;
            // verify() falls back to size-only when null.
            val sha = runCatching { PendingUpdateStore.sha256(outFile) }
                .onFailure { AppLogger.warning(TAG, "sha256 compute failed: ${it.message}") }
                .getOrNull()
            if (versionName != null) {
                PendingUpdateStore.setPending(
                    context,
                    PendingUpdateStore.PendingUpdate(
                        targetVersionName = versionName,
                        apkPath = outFile.absolutePath,
                        apkSize = outFile.length(),
                        sha256 = sha,
                        downloadedAtMs = System.currentTimeMillis(),
                    ),
                )
            }
            DownloadResult.Success(outFile)
        } catch (e: Exception) {
            AppLogger.error(TAG, "download failed: ${e.javaClass.simpleName}: ${e.message}")
            DownloadResult.Error(e.message ?: e.javaClass.simpleName)
        }
    }

    /**
     * Whether the OS will allow this app to launch a package-installer
     * intent. On Android 8+ the user must grant "install unknown apps" per
     * source-app; older releases inherit the system-wide setting.
     */
    fun canInstall(context: Context): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.packageManager.canRequestPackageInstalls()
        } else {
            true
        }
    }

    /**
     * Send the user to the system "install unknown apps" preferences page
     * for this package. Caller should re-check [canInstall] after the user
     * returns.
     */
    fun openInstallPermissionSettings(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
            data = Uri.parse("package:${context.packageName}")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
    }

    /**
     * Hand [apk] to the system package installer via FileProvider.
     * Caller must ensure [canInstall] before calling, otherwise the system
     * silently bounces back to the launcher. Returns false on any
     * launch failure so callers can surface an error instead of closing
     * the dialog with no visible feedback.
     */
    /**
     * If a pending APK from a previous download is still on disk and intact,
     * returns the [File]. The caller is responsible for checking
     * [canInstall] and firing [installApk]. Returns null when nothing pending
     * or when the cached file failed integrity checks — in the latter case
     * the pending record is cleared so the UI falls through to a fresh
     * download.
     */
    fun resumablePendingFile(context: Context): File? {
        val pending = PendingUpdateStore.getPending(context) ?: return null
        // Only resume if the persisted target is still newer than the running
        // build — protects against the case where the user updated by some
        // other means since the download.
        // [T-android-updatechecker-localver-normalize] targetVersionName is a
        // normalized version (set from upgradeCandidate.versionName), so the
        // local side must be normalized too — same asymmetry fix as check().
        if (compareVersions(pending.targetVersionName, normalizeTag(BuildConfig.VERSION_NAME)) <= 0) {
            AppLogger.info(TAG, "pending target ${pending.targetVersionName} <= local; clearing")
            PendingUpdateStore.clearPending(context)
            return null
        }
        val file = PendingUpdateStore.verify(pending)
        if (file == null) {
            AppLogger.info(TAG, "pending APK failed integrity; clearing")
            PendingUpdateStore.clearPending(context)
            return null
        }
        return file
    }

    fun installApk(context: Context, apk: File): Boolean {
        return try {
            val authority = "${context.packageName}.fileprovider"
            val uri = FileProvider.getUriForFile(context, authority, apk)
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
            AppLogger.info(TAG, "installApk launched apk=${apk.absolutePath} size=${apk.length()}")
            // Once the installer is in flight we don't want a subsequent
            // resume to re-fire the intent (would double-prompt). Clear the
            // pending record now; if the user backs out, the next "Check for
            // Updates" tap will re-discover and re-download.
            PendingUpdateStore.clearPending(context)
            true
        } catch (e: Exception) {
            AppLogger.error(TAG, "installApk failed: ${e.javaClass.simpleName}: ${e.message}")
            false
        }
    }

    /**
     * Numeric-aware version comparator. `1.0.10` beats `1.0.9`. Non-numeric
     * components fall back to lexicographic compare so a `1.0.0-rc1` build is
     * treated as "newer than 1.0.0" — acceptable noise for our use case.
     */
    private fun compareVersions(a: String, b: String): Int {
        val ap = a.split('.', '-')
        val bp = b.split('.', '-')
        val n = maxOf(ap.size, bp.size)
        for (i in 0 until n) {
            val x = ap.getOrNull(i) ?: ""
            val y = bp.getOrNull(i) ?: ""
            val xi = x.toIntOrNull()
            val yi = y.toIntOrNull()
            val c = if (xi != null && yi != null) xi.compareTo(yi) else x.compareTo(y)
            if (c != 0) return c
        }
        return 0
    }
}
