package com.openminis.app.sandbox.offload

import android.Manifest
import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.core.content.ContextCompat
import androidx.exifinterface.media.ExifInterface
import com.openminis.app.logging.AppLogger
import com.openminis.app.offload.OffloadPermissionManager
import com.openminis.app.sandbox.NativeOffloadHandler
import com.openminis.app.sandbox.NativeOffloadRequest
import com.openminis.app.sandbox.NativeOffloadResult
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * android-photos — query and manage the device photo library via MediaStore.
 *
 * Mirrors apple-photos (NativeOffloads/PhotosOffload.m) — same subcommand
 * names and flag conventions so prompts and the agent loop are platform-
 * agnostic. Some iOS concepts have no native Android equivalent (smart
 * albums; stable per-asset string identifiers); these are documented at
 * each subcommand.
 *
 * Usage:
 *   android-photos list [--type photo|video|all] [--start ISO --end ISO | --days N]
 *                       [--limit N]
 *   android-photos stats
 *   android-photos near --lat L --lon N [--radius KM] [--limit N]
 *   android-photos albums [--type user|smart|all]
 *   android-photos album [--id <bucket_id> | --name <bucket_name>] [--limit N]
 *   android-photos export --id <id> [--size thumb|medium|original]
 *   android-photos import --path <file> [--album-name <name>]
 *   android-photos create-album --name <name>
 *   android-photos favorite --id <id>
 *   android-photos delete --ids <id1,id2,...> --confirm
 *
 * Backwards compatibility:
 *   - `near <lat> <lon>` legacy positional form still works.
 *   - `--max` is accepted as an alias for `--limit`.
 */
class PhotosOffloadHandler(private val context: Context) : NativeOffloadHandler {
    private val dateFormat = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US)

    override fun handle(request: NativeOffloadRequest): NativeOffloadResult {
        val args = OffloadArgs(request.argv.drop(1), booleanFlags = setOf("confirm"))
        if (args.hasFlag("h", "help") || args.positional.isEmpty()) {
            return NativeOffloadResult(if (args.positional.isEmpty()) 2 else 0, HELP)
        }
        // T330: tri-state agent gate before requesting media permissions.
        OffloadGate.enforce("photos", "android-photos", args, request)?.let { return it }

        ensureMediaPermission(args)?.let { return it }

        return try {
            when (val sub = args.positional[0]) {
                "list" -> handleList(args)
                "stats" -> NativeOffloadResult(0, OffloadOutput.formatBody(photoStats(), args) + "\n")
                "near" -> handleNear(args)
                "albums" -> handleAlbums(args)
                "album" -> handleAlbum(args)
                "export" -> handleExport(args, request.sessionId)
                "import", "save" -> handleImport(args)
                "create-album" -> handleCreateAlbum(args)
                "favorite" -> handleFavorite(args)
                "delete" -> handleDelete(args)
                else -> NativeOffloadResult(2, "android-photos: unknown subcommand '$sub'\n$HELP")
            }
        } catch (e: SecurityException) {
            AppLogger.warning(TAG, "SecurityException: ${e.message}")
            val body = JSONObject().put("error", "mediastore_blocked")
                .put("message", "Media access refused by the system. ${permissionHint()}. Underlying: ${e.message}")
                .toString()
            NativeOffloadResult(77, OffloadOutput.formatBody(body, args) + "\n")
        } catch (e: Throwable) {
            AppLogger.warning(TAG, "uncaught: ${e.message}")
            val body = JSONObject().put("error", "mediastore_error")
                .put("message", e.message ?: "MediaStore query failed")
                .toString()
            NativeOffloadResult(1, OffloadOutput.formatBody(body, args) + "\n")
        }
    }

    // ── list (T59: + --type, --start, --end, --days, --limit) ────────────

    private fun handleList(args: OffloadArgs): NativeOffloadResult {
        val limit = (args.getInt("limit") ?: args.getInt("max") ?: 20).coerceIn(1, 100)
        val type = (args.get("type") ?: "all").lowercase()
        if (type !in setOf("photo", "video", "all")) {
            return NativeOffloadResult(2, "android-photos list: --type must be photo|video|all\n")
        }
        val (startMs, endMs) = resolveDateRange(args)
        AppLogger.info(TAG, "list: type=$type limit=$limit range=${startMs?.let { formatIso(it) }}..${endMs?.let { formatIso(it) }}")
        val arr = JSONArray()
        if (type == "photo" || type == "all") queryMedia(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, "photo", startMs, endMs, limit - arr.length(), arr)
        if (type == "video" || type == "all") queryMedia(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, "video", startMs, endMs, limit - arr.length(), arr)
        val data = JSONObject()
            .put("media", arr)
            .put("count", arr.length())
            .put("type", type)
        if (startMs != null) data.put("range_start", formatIso(startMs))
        if (endMs != null) data.put("range_end", formatIso(endMs))
        return NativeOffloadResult(0, OffloadOutput.formatBody(data.toString(2), args) + "\n")
    }

    /**
     * MediaStore.Images and MediaStore.Video share the same column names for
     * the fields we care about, so one helper handles both. DATE_TAKEN is
     * milliseconds since epoch; we filter on it when --start/--end/--days
     * supply a window, and fall back to the (cheaper) implicit "all rows"
     * query when no range is set.
     */
    private fun queryMedia(uri: Uri, kind: String, startMs: Long?, endMs: Long?, max: Int, sink: JSONArray) {
        if (max <= 0) return
        val projection = arrayOf(
            MediaStore.Images.Media._ID,
            MediaStore.Images.Media.DISPLAY_NAME,
            MediaStore.Images.Media.DATE_TAKEN,
            MediaStore.Images.Media.WIDTH,
            MediaStore.Images.Media.HEIGHT,
            MediaStore.Images.Media.SIZE,
            MediaStore.Images.Media.MIME_TYPE,
            MediaStore.Images.Media.BUCKET_ID,
            MediaStore.Images.Media.BUCKET_DISPLAY_NAME,
        )
        val selectionParts = mutableListOf<String>()
        val selectionArgs = mutableListOf<String>()
        if (startMs != null) {
            selectionParts.add("${MediaStore.Images.Media.DATE_TAKEN} >= ?")
            selectionArgs.add(startMs.toString())
        }
        if (endMs != null) {
            selectionParts.add("${MediaStore.Images.Media.DATE_TAKEN} <= ?")
            selectionArgs.add(endMs.toString())
        }
        val selection = if (selectionParts.isEmpty()) null else selectionParts.joinToString(" AND ")
        val selArgs = if (selectionArgs.isEmpty()) null else selectionArgs.toTypedArray()
        context.contentResolver.query(uri, projection, selection, selArgs, "${MediaStore.Images.Media.DATE_TAKEN} DESC")?.use { c ->
            var n = 0
            while (c.moveToNext() && n < max) {
                val p = JSONObject()
                    .put("id", c.getLong(0))
                    .put("name", c.getString(1) ?: "")
                    .put("media_type", kind)
                val dt = c.getLong(2)
                if (dt > 0) p.put("date", dateFormat.format(Date(dt))).put("date_iso", formatIso(dt))
                p.put("width", c.getInt(3))
                    .put("height", c.getInt(4))
                    .put("size_bytes", c.getLong(5))
                    .put("mime_type", c.getString(6) ?: "")
                    .put("bucket_id", c.getLong(7))
                    .put("bucket_name", c.getString(8) ?: "")
                sink.put(p)
                n++
            }
        }
    }

    // ── near (T59: + --lat/--lon flags + --limit) ────────────────────────

    private fun handleNear(args: OffloadArgs): NativeOffloadResult {
        // Flag form (--lat/--lon, mirrors apple-photos near) preferred;
        // legacy positional <lat> <lon> kept as alias.
        val lat = args.getDouble("lat") ?: args.positional.getOrNull(1)?.toDoubleOrNull()
        val lon = args.getDouble("lon", "lng") ?: args.positional.getOrNull(2)?.toDoubleOrNull()
        if (lat == null || lon == null) {
            return NativeOffloadResult(
                2,
                "android-photos near: --lat <lat> --lon <lon> required (positional <lat> <lon> also accepted)\n",
            )
        }
        ensureMediaLocationPermission(args)?.let { return it }
        val radius = args.getDouble("radius") ?: 1.0
        val max = (args.getInt("limit") ?: args.getInt("max") ?: 20).coerceIn(1, 100)
        AppLogger.info(TAG, "near: lat=$lat lon=$lon radius=${radius}km max=$max")
        return NativeOffloadResult(0, OffloadOutput.formatBody(nearPhotos(lat, lon, radius, max), args) + "\n")
    }

    private fun hasMediaPermission(): Boolean {
        val perm = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            Manifest.permission.READ_MEDIA_IMAGES
        } else {
            Manifest.permission.READ_EXTERNAL_STORAGE
        }
        if (ContextCompat.checkSelfPermission(context, perm) == PackageManager.PERMISSION_GRANTED) return true
        // A14+ partial access counts
        if (Build.VERSION.SDK_INT >= 34) {
            val partial = "android.permission.READ_MEDIA_VISUAL_USER_SELECTED"
            if (ContextCompat.checkSelfPermission(context, partial) == PackageManager.PERMISSION_GRANTED) return true
        }
        return false
    }

    private fun permissionHint(): String {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            "READ_MEDIA_IMAGES (or partial READ_MEDIA_VISUAL_USER_SELECTED on A14+) not granted. Ask the user to grant Photos/Media permission in Android settings."
        } else {
            "READ_EXTERNAL_STORAGE not granted. Ask the user to grant Storage permission in Android settings."
        }
    }

    /**
     * Drive the system-dialog → settings-gate flow. On A13+ we ask for the
     * granular media permissions; A14+ treats visual-user-selected as partial
     * access, which [hasMediaPermission] already accepts.
     */
    private fun ensureMediaPermission(args: OffloadArgs): NativeOffloadResult? {
        if (hasMediaPermission()) return null
        AppLogger.warning(TAG, "media permission not granted — routing through permission flow")
        val requestList = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            buildList {
                add(Manifest.permission.READ_MEDIA_IMAGES)
                if (Build.VERSION.SDK_INT >= 34) add("android.permission.READ_MEDIA_VISUAL_USER_SELECTED")
            }
        } else {
            listOf(Manifest.permission.READ_EXTERNAL_STORAGE)
        }
        val result = runBlocking {
            var r = OffloadPermissionManager.requestAndroidPermission(requestList)
            if (r == OffloadPermissionManager.AndroidPermissionResult.DENIED &&
                OffloadPermissionManager.pollForPermissionGrant({ hasMediaPermission() })
            ) {
                AppLogger.info(TAG, "Photos permission granted during post-DENY poll")
                r = OffloadPermissionManager.AndroidPermissionResult.GRANTED
            }
            if (r == OffloadPermissionManager.AndroidPermissionResult.DENIED) {
                r = OffloadPermissionManager.requestSettingsGate(
                    OffloadPermissionManager.SettingsGateRequest(
                        id = "photos_media",
                        title = "Photos permission needed",
                        message = "Minis needs media permission to read your photo library. Open Settings to allow it.",
                        settingsAction = android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                        requiresPackageUri = true,
                        positiveLabel = "Open Settings",
                    ),
                    check = { hasMediaPermission() },
                )
            }
            r
        }
        return when (result) {
            OffloadPermissionManager.AndroidPermissionResult.GRANTED -> null
            OffloadPermissionManager.AndroidPermissionResult.DENIED -> NativeOffloadResult(
                77,
                OffloadOutput.formatBody(
                    JSONObject().put("error", "permission_denied")
                        .put("message", "The user declined the photos/media permission.")
                        .toString(),
                    args,
                ) + "\n",
            )
            OffloadPermissionManager.AndroidPermissionResult.TIMEOUT -> NativeOffloadResult(
                77,
                OffloadOutput.formatBody(
                    JSONObject().put("error", "timeout")
                        .put("message", "Timed out waiting for the user to grant the photos/media permission.")
                        .toString(),
                    args,
                ) + "\n",
            )
        }
    }

    private fun hasMediaLocationPermission(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
            ContextCompat.checkSelfPermission(
                context, "android.permission.ACCESS_MEDIA_LOCATION",
            ) == PackageManager.PERMISSION_GRANTED

    /**
     * `near` reads GPS EXIF; without ACCESS_MEDIA_LOCATION the MediaStore
     * strips it from the streams we open and the result set is always empty.
     * On A10+ it's a runtime permission — manifest entry alone is not enough.
     * Pre-Q the permission doesn't exist; treat it as granted.
     */
    private fun ensureMediaLocationPermission(args: OffloadArgs): NativeOffloadResult? {
        if (hasMediaLocationPermission()) return null
        AppLogger.warning(TAG, "ACCESS_MEDIA_LOCATION not granted — routing through permission flow")
        val result = runBlocking {
            var r = OffloadPermissionManager.requestAndroidPermission(
                listOf("android.permission.ACCESS_MEDIA_LOCATION"),
            )
            if (r == OffloadPermissionManager.AndroidPermissionResult.DENIED &&
                OffloadPermissionManager.pollForPermissionGrant({ hasMediaLocationPermission() })
            ) {
                AppLogger.info(TAG, "Media location permission granted during post-DENY poll")
                r = OffloadPermissionManager.AndroidPermissionResult.GRANTED
            }
            if (r == OffloadPermissionManager.AndroidPermissionResult.DENIED) {
                r = OffloadPermissionManager.requestSettingsGate(
                    OffloadPermissionManager.SettingsGateRequest(
                        id = "ACCESS_MEDIA_LOCATION",
                        title = "Photo location needed",
                        message = "Minis needs photo-location permission to read GPS EXIF for the `near` query. Open Settings to allow it.",
                        settingsAction = android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                        requiresPackageUri = true,
                        positiveLabel = "Open Settings",
                    ),
                    check = { hasMediaLocationPermission() },
                )
            }
            r
        }
        return when (result) {
            OffloadPermissionManager.AndroidPermissionResult.GRANTED -> null
            OffloadPermissionManager.AndroidPermissionResult.DENIED -> NativeOffloadResult(
                77,
                OffloadOutput.formatBody(
                    JSONObject().put("error", "permission_denied")
                        .put("message", "The user declined the photo-location permission. Without it, GPS EXIF is redacted and `near` cannot match any photos.")
                        .toString(),
                    args,
                ) + "\n",
            )
            OffloadPermissionManager.AndroidPermissionResult.TIMEOUT -> NativeOffloadResult(
                77,
                OffloadOutput.formatBody(
                    JSONObject().put("error", "timeout")
                        .put("message", "Timed out waiting for the user to grant the photo-location permission.")
                        .toString(),
                    args,
                ) + "\n",
            )
        }
    }

    // ── albums (T64) ─────────────────────────────────────────────────────

    /**
     * List buckets (Android's equivalent of iOS PHAssetCollection — every
     * media row carries BUCKET_ID/BUCKET_DISPLAY_NAME). MediaStore has no
     * native "smart album" concept, so apple-photos's user/smart distinction
     * collapses on Android: --type smart returns an empty list with a
     * structured note; --type user and --type all are equivalent.
     */
    private fun handleAlbums(args: OffloadArgs): NativeOffloadResult {
        val type = (args.get("type") ?: "all").lowercase()
        if (type !in setOf("user", "smart", "all")) {
            return NativeOffloadResult(2, "android-photos albums: --type must be user|smart|all\n")
        }
        if (type == "smart") {
            val data = JSONObject()
                .put("albums", JSONArray())
                .put("count", 0)
                .put("note", "MediaStore has no smart-album concept on Android. Use --type user or --type all to list buckets.")
            return NativeOffloadResult(0, OffloadOutput.formatBody(data.toString(2), args) + "\n")
        }
        val items = JSONArray()
        // Aggregate over the IMAGES table; videos share the same bucket
        // namespace so we union by id afterwards.
        val seen = mutableSetOf<Long>()
        listOf(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, MediaStore.Video.Media.EXTERNAL_CONTENT_URI)
            .forEach { uri ->
                val proj = arrayOf(
                    MediaStore.Images.Media.BUCKET_ID,
                    MediaStore.Images.Media.BUCKET_DISPLAY_NAME,
                )
                context.contentResolver.query(uri, proj, null, null, null)?.use { c ->
                    while (c.moveToNext()) {
                        val bid = c.getLong(0)
                        if (bid == 0L || bid in seen) continue
                        seen.add(bid)
                        val name = c.getString(1) ?: ""
                        items.put(JSONObject().put("id", bid).put("name", name).put("type", "user"))
                    }
                }
            }
        AppLogger.info(TAG, "albums: type=$type count=${items.length()}")
        val data = JSONObject().put("albums", items).put("count", items.length())
        return NativeOffloadResult(0, OffloadOutput.formatBody(data.toString(2), args) + "\n")
    }

    /**
     * List media inside one bucket. --id (Long) wins; --name does
     * case-insensitive contains lookup, mirroring apple-photos. Returns
     * the same shape as `list` so downstream tooling can treat them the
     * same.
     */
    private fun handleAlbum(args: OffloadArgs): NativeOffloadResult {
        val bucketId = args.getLong("id")
        val bucketName = args.get("name")
        if (bucketId == null && bucketName == null) {
            return NativeOffloadResult(2, "android-photos album: --id <bucket_id> or --name <bucket_name> is required\n")
        }
        val limit = (args.getInt("limit") ?: args.getInt("max") ?: 50).coerceIn(1, 200)
        val arr = JSONArray()
        val selection: String
        val selArgs: Array<String>
        if (bucketId != null) {
            selection = "${MediaStore.Images.Media.BUCKET_ID} = ?"
            selArgs = arrayOf(bucketId.toString())
        } else {
            selection = "${MediaStore.Images.Media.BUCKET_DISPLAY_NAME} LIKE ?"
            selArgs = arrayOf("%${bucketName!!}%")
        }
        // Inline the projection so we can pass selection — queryMedia hides
        // selection behind the start/end filters.
        listOf(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI to "photo",
            MediaStore.Video.Media.EXTERNAL_CONTENT_URI to "video",
        ).forEach { (uri, kind) ->
            if (arr.length() >= limit) return@forEach
            val proj = arrayOf(
                MediaStore.Images.Media._ID,
                MediaStore.Images.Media.DISPLAY_NAME,
                MediaStore.Images.Media.DATE_TAKEN,
                MediaStore.Images.Media.SIZE,
                MediaStore.Images.Media.MIME_TYPE,
                MediaStore.Images.Media.BUCKET_ID,
                MediaStore.Images.Media.BUCKET_DISPLAY_NAME,
            )
            context.contentResolver.query(uri, proj, selection, selArgs, "${MediaStore.Images.Media.DATE_TAKEN} DESC")?.use { c ->
                while (c.moveToNext() && arr.length() < limit) {
                    val p = JSONObject()
                        .put("id", c.getLong(0))
                        .put("name", c.getString(1) ?: "")
                        .put("media_type", kind)
                    val dt = c.getLong(2)
                    if (dt > 0) p.put("date", dateFormat.format(Date(dt))).put("date_iso", formatIso(dt))
                    p.put("size_bytes", c.getLong(3))
                        .put("mime_type", c.getString(4) ?: "")
                        .put("bucket_id", c.getLong(5))
                        .put("bucket_name", c.getString(6) ?: "")
                    arr.put(p)
                }
            }
        }
        AppLogger.info(TAG, "album: id=$bucketId name='$bucketName' count=${arr.length()}")
        val data = JSONObject()
            .put("media", arr)
            .put("count", arr.length())
            .put("album", JSONObject().apply {
                if (bucketId != null) put("id", bucketId)
                if (bucketName != null) put("name", bucketName)
            })
        return NativeOffloadResult(0, OffloadOutput.formatBody(data.toString(2), args) + "\n")
    }

    // ── export (T64) ─────────────────────────────────────────────────────

    /**
     * Copy the asset bytes into the CALLING SESSION's offloads dir
     * (`<filesDir>/minis-sessions/<sessionId>/offloads/`) and report the
     * sandbox-visible `/var/minis/offloads/<name>` path plus a `minis://`
     * URL, matching iOS `PhotosOffload.m` (which exports to
     * `/var/minis/offloads/` directly).
     *
     * [GH#139] This used to write to `<filesDir>/photos-export/` and return
     * only `host_path`. That path is inside no PRoot bind mount, so the
     * Linux sandbox cannot read it and `minis-open` rejects it (it accepts
     * only http/https/about/minis URLs) — the agent could list photo
     * metadata but never actually look at an exported photo. An older
     * comment here claimed the handler "doesn't see the session id"; that
     * stopped being true when T340 added `sessionId` to
     * [NativeOffloadRequest], so the export is now session-scoped the same
     * way `ModelUseOffloadHandler.sessionScopedHostFile` already does it.
     *
     * `sessionId` is null for offloads launched outside a chat (interactive
     * terminal). There is no session offloads dir to write into then, so we
     * keep the app-private fallback — but say plainly in the response that
     * the file is NOT reachable from Linux, instead of implying it is.
     *
     * --size thumb / medium re-encode to JPEG at 256px / 1024px max edge
     * via BitmapFactory; original copies the resource bytes as-is.
     */
    private fun handleExport(args: OffloadArgs, sessionId: String?): NativeOffloadResult {
        val id = args.getLong("id")
            ?: return NativeOffloadResult(2, "android-photos export: --id <asset_id> is required\n")
        val size = (args.get("size") ?: "original").lowercase()
        if (size !in setOf("thumb", "medium", "original")) {
            return NativeOffloadResult(2, "android-photos export: --size must be thumb|medium|original\n")
        }

        // Try Images first then Video.
        var srcUri: Uri? = null
        var mediaType = "photo"
        var mimeType = ""
        var displayName = "export"
        var width = 0
        var height = 0
        for ((uri, kind) in listOf(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI to "photo",
            MediaStore.Video.Media.EXTERNAL_CONTENT_URI to "video",
        )) {
            val proj = arrayOf(
                MediaStore.Images.Media.DISPLAY_NAME,
                MediaStore.Images.Media.MIME_TYPE,
                MediaStore.Images.Media.WIDTH,
                MediaStore.Images.Media.HEIGHT,
            )
            context.contentResolver.query(uri, proj, "${MediaStore.Images.Media._ID} = ?", arrayOf(id.toString()), null)?.use { c ->
                if (c.moveToFirst()) {
                    srcUri = ContentUris.withAppendedId(uri, id)
                    mediaType = kind
                    displayName = c.getString(0) ?: "export"
                    mimeType = c.getString(1) ?: ""
                    width = c.getInt(2); height = c.getInt(3)
                }
            }
            if (srcUri != null) break
        }
        val src = srcUri ?: return NativeOffloadResult(
            1,
            OffloadOutput.formatBody(
                JSONObject().put("error", "not_found").put("id", id)
                    .put("message", "No asset with id=$id (already deleted, or not visible to this app).")
                    .toString(),
                args,
            ) + "\n",
        )

        // [GH#139] Session-scoped when we know the caller's chat, so the export
        // lands in the dir PRoot bind-mounts at /var/minis/offloads for THIS
        // session. Mirrors ModelUseOffloadHandler.sessionScopedHostFile and
        // PRootKernel.resolveSessionHostPath, which use the same layout.
        val sandboxVisible = sessionId != null
        val outDir = if (sandboxVisible) {
            File(context.filesDir, "minis-sessions/$sessionId/offloads").also { it.mkdirs() }
        } else {
            File(context.filesDir, "photos-export").also { it.mkdirs() }
        }
        val safeName = displayName.replace(Regex("[^A-Za-z0-9._-]"), "_").take(64)
        val ext = displayName.substringAfterLast('.', "")
            .ifEmpty { if (mediaType == "video") "mp4" else "jpg" }
        val sizeSuffix = if (size == "original") "" else "_$size"
        val outFile = File(outDir, "${id}${sizeSuffix}_$safeName${if (size == "original") "" else ".jpg"}")
            .let { if (it.name.endsWith(".$ext", true) || size != "original") it else File(outDir, "${id}${sizeSuffix}_$safeName.$ext") }

        return try {
            val bytesWritten = if (size == "original" || mediaType == "video") {
                copyStream(src, outFile)
            } else {
                val maxEdge = if (size == "thumb") 256 else 1024
                copyResized(src, outFile, maxEdge)
            }
            AppLogger.info(TAG, "export: id=$id size=$size bytes=$bytesWritten path=${outFile.absolutePath}")
            val data = JSONObject()
                .put("id", id)
                .put("host_path", outFile.absolutePath)
                .put("size_bytes", bytesWritten)
                .put("media_type", mediaType)
                .put("format", if (size == "original") "original" else "jpeg")
                .put("export_size", size)
            // [GH#139] Hand back the paths the agent can actually USE: the
            // sandbox path for shell tools, and the minis:// URL that
            // `minis-open` accepts for in-chat preview / model rendering.
            if (sandboxVisible) {
                data.put("linux_path", "/var/minis/offloads/${outFile.name}")
                    .put("minis_url", "minis://offloads/${outFile.name}")
                    .put(
                        "note",
                        "Exported into this chat's offloads dir. Use `linux_path` from shell " +
                            "tools, or `minis_url` with minis-open to preview it in chat.",
                    )
            } else {
                data.put(
                    "note",
                    "No chat session for this offload (interactive terminal), so the export " +
                        "went to app-private storage: `host_path` is NOT reachable from the " +
                        "Linux sandbox and minis-open cannot open it. Run the export from a " +
                        "chat to get a /var/minis/offloads path.",
                )
            }
            if (width > 0) data.put("width", width)
            if (height > 0) data.put("height", height)
            NativeOffloadResult(0, OffloadOutput.formatBody(data.toString(2), args) + "\n")
        } catch (e: Throwable) {
            val body = JSONObject().put("error", "export_failed").put("id", id)
                .put("message", e.message ?: "Failed to copy asset bytes")
                .toString()
            NativeOffloadResult(1, OffloadOutput.formatBody(body, args) + "\n")
        }
    }

    private fun copyStream(src: Uri, dst: File): Long {
        var written = 0L
        context.contentResolver.openInputStream(src)?.use { input ->
            dst.outputStream().use { out ->
                val buf = ByteArray(64 * 1024)
                while (true) {
                    val n = input.read(buf); if (n <= 0) break
                    out.write(buf, 0, n); written += n
                }
            }
        } ?: throw java.io.IOException("Could not open source asset stream")
        return written
    }

    /** Re-encode an image asset to JPEG with max edge [maxEdge]. */
    private fun copyResized(src: Uri, dst: File, maxEdge: Int): Long {
        val bytes = context.contentResolver.openInputStream(src)?.use { it.readBytes() }
            ?: throw java.io.IOException("Could not read source bytes")
        val opts = android.graphics.BitmapFactory.Options()
        opts.inJustDecodeBounds = true
        android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts)
        val w = opts.outWidth; val h = opts.outHeight
        var sample = 1
        while (w / sample > maxEdge * 2 || h / sample > maxEdge * 2) sample *= 2
        val decodeOpts = android.graphics.BitmapFactory.Options().apply { inSampleSize = sample }
        val bmp = android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size, decodeOpts)
            ?: throw java.io.IOException("Failed to decode source image")
        val scale = minOf(maxEdge.toFloat() / bmp.width, maxEdge.toFloat() / bmp.height, 1f)
        val out = if (scale < 1f) {
            android.graphics.Bitmap.createScaledBitmap(bmp, (bmp.width * scale).toInt(), (bmp.height * scale).toInt(), true)
        } else bmp
        dst.outputStream().use { os ->
            out.compress(android.graphics.Bitmap.CompressFormat.JPEG, 85, os)
        }
        return dst.length()
    }

    // ── import (T64) ─────────────────────────────────────────────────────

    /**
     * Copy a host-filesystem file into MediaStore. Mirrors apple-photos
     * import. --album-name creates the bucket implicitly via RELATIVE_PATH
     * (Android API 29+) — there's no "create empty album" API.
     */
    private fun handleImport(args: OffloadArgs): NativeOffloadResult {
        // [T-photos-positional-path] Accept `import <file>` as well as
        // `import --path <file>`, matching apple-photos (iOS 048d2d9f). The
        // file is this subcommand's only natural argument, so the bare form is
        // what an LLM (or a human) reaches for first; requiring the flag turned
        // a correct-looking call into an argument error. positional[0] is the
        // subcommand itself, so the path is positional[1].
        val path = args.get("path") ?: args.positional.getOrNull(1)
            ?: return NativeOffloadResult(
                2,
                "android-photos import: a file path is required (positional or --path <file>)\n",
            )
        val src = File(path)
        if (!src.exists() || !src.isFile) {
            return NativeOffloadResult(
                1,
                OffloadOutput.formatBody(
                    JSONObject().put("error", "no_file").put("path", path)
                        .put("message", "Source file does not exist or is not a regular file.")
                        .toString(),
                    args,
                ) + "\n",
            )
        }
        val albumName = args.get("album-name")
        val ext = src.extension.lowercase()
        val isVideo = ext in setOf("mp4", "mov", "m4v", "3gp", "mkv", "webm")
        val mime = when (ext) {
            "jpg", "jpeg" -> "image/jpeg"
            "png" -> "image/png"
            "heic" -> "image/heic"
            "webp" -> "image/webp"
            "gif" -> "image/gif"
            "mp4" -> "video/mp4"
            "mov" -> "video/quicktime"
            "m4v" -> "video/mp4"
            "3gp" -> "video/3gpp"
            "mkv" -> "video/x-matroska"
            "webm" -> "video/webm"
            else -> if (isVideo) "video/*" else "image/*"
        }
        val collection = if (isVideo) MediaStore.Video.Media.EXTERNAL_CONTENT_URI
                         else MediaStore.Images.Media.EXTERNAL_CONTENT_URI
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, src.name)
            put(MediaStore.MediaColumns.MIME_TYPE, mime)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val rel = if (isVideo) Environment.DIRECTORY_MOVIES else Environment.DIRECTORY_PICTURES
                val path = if (albumName != null) "$rel/${albumName.replace('/', '_')}" else rel
                put(MediaStore.MediaColumns.RELATIVE_PATH, path)
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
        }
        return try {
            val uri = context.contentResolver.insert(collection, values)
                ?: return NativeOffloadResult(
                    1,
                    OffloadOutput.formatBody(
                        JSONObject().put("error", "insert_failed").put("message", "ContentResolver.insert returned null").toString(),
                        args,
                    ) + "\n",
                )
            val written = context.contentResolver.openOutputStream(uri)?.use { os ->
                FileInputStream(src).use { input ->
                    var n = 0L
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val r = input.read(buf); if (r <= 0) break
                        os.write(buf, 0, r); n += r
                    }
                    n
                }
            } ?: throw java.io.IOException("openOutputStream returned null")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val finishValues = ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }
                context.contentResolver.update(uri, finishValues, null, null)
            }
            val newId = ContentUris.parseId(uri)
            AppLogger.info(TAG, "import: path='${src.name}' id=$newId bytes=$written album='$albumName'")
            val data = JSONObject()
                .put("id", newId)
                .put("name", src.name)
                .put("media_type", if (isVideo) "video" else "photo")
                .put("size_bytes", written)
                .put("mime_type", mime)
            if (albumName != null) data.put("album", albumName)
            NativeOffloadResult(0, OffloadOutput.formatBody(data.toString(2), args) + "\n")
        } catch (e: Throwable) {
            val body = JSONObject().put("error", "import_failed").put("path", path)
                .put("message", e.message ?: "Failed to insert media")
                .toString()
            NativeOffloadResult(1, OffloadOutput.formatBody(body, args) + "\n")
        }
    }

    // ── create-album (T64) ───────────────────────────────────────────────

    /**
     * Android has no "create empty album" API — buckets are created
     * implicitly when files land in them. We return a structured note so
     * the model knows to use `import --album-name` instead of failing
     * silently. Mirrors apple-photos create-album shape (id/name/note).
     */
    private fun handleCreateAlbum(args: OffloadArgs): NativeOffloadResult {
        val name = args.get("name")
            ?: return NativeOffloadResult(2, "android-photos create-album: --name <name> is required\n")
        AppLogger.info(TAG, "create-album: name='$name' (Android implicit-create)")
        val data = JSONObject()
            .put("name", name)
            .put("created", false)
            .put("warning", "android_implicit_album")
            .put("message", "Android MediaStore creates album buckets implicitly on first file insert. Use `android-photos import --path <file> --album-name '$name'` to create '$name' as a side-effect of saving a file. The bucket id is assigned by the system at that point.")
        return NativeOffloadResult(0, OffloadOutput.formatBody(data.toString(2), args) + "\n")
    }

    // ── favorite (T64) ───────────────────────────────────────────────────

    /**
     * Toggle MediaStore.MediaColumns.IS_FAVORITE (Android 11+). Mirrors
     * apple-photos favorite — toggles the flag and returns the new state.
     * On API < 30 returns a structured error since the column doesn't
     * exist.
     */
    private fun handleFavorite(args: OffloadArgs): NativeOffloadResult {
        val id = args.getLong("id")
            ?: return NativeOffloadResult(2, "android-photos favorite: --id <asset_id> is required\n")
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            val body = JSONObject().put("error", "not_supported")
                .put("message", "Favorite flag requires Android 11 (API 30) or later. This device runs API ${Build.VERSION.SDK_INT}.")
                .toString()
            return NativeOffloadResult(1, OffloadOutput.formatBody(body, args) + "\n")
        }
        // Find the row in either Images or Video.
        var srcUri: Uri? = null
        var currentlyFavorite = false
        for (uri in listOf(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, MediaStore.Video.Media.EXTERNAL_CONTENT_URI)) {
            context.contentResolver.query(
                uri,
                arrayOf(MediaStore.MediaColumns.IS_FAVORITE),
                "${MediaStore.Images.Media._ID} = ?",
                arrayOf(id.toString()), null,
            )?.use { c ->
                if (c.moveToFirst()) {
                    srcUri = ContentUris.withAppendedId(uri, id)
                    currentlyFavorite = c.getInt(0) == 1
                }
            }
            if (srcUri != null) break
        }
        val target = srcUri ?: return NativeOffloadResult(
            1,
            OffloadOutput.formatBody(
                JSONObject().put("error", "not_found").put("id", id)
                    .put("message", "No asset with id=$id.").toString(),
                args,
            ) + "\n",
        )
        val newState = !currentlyFavorite
        return try {
            val values = ContentValues().apply { put(MediaStore.MediaColumns.IS_FAVORITE, if (newState) 1 else 0) }
            val rows = context.contentResolver.update(target, values, null, null)
            AppLogger.info(TAG, "favorite: id=$id was=$currentlyFavorite now=$newState rows=$rows")
            val data = JSONObject()
                .put("id", id)
                .put("favorite", newState)
                .put("rows_updated", rows)
            NativeOffloadResult(0, OffloadOutput.formatBody(data.toString(2), args) + "\n")
        } catch (e: SecurityException) {
            // RecoverableSecurityException on A11+ when the user hasn't
            // explicitly granted write access to this asset. We can't
            // launch the system dialog from a CLI sandbox.
            val body = JSONObject().put("error", "write_denied")
                .put("id", id)
                .put("message", "Android requires explicit user consent to modify another app's media. Open the asset in the system Photos app and toggle favorite there. Underlying: ${e.message}")
                .toString()
            NativeOffloadResult(77, OffloadOutput.formatBody(body, args) + "\n")
        }
    }

    // ── delete (T64) ─────────────────────────────────────────────────────

    /**
     * Delete one or more assets. --ids comma-separated, --confirm
     * required (mirrors apple-photos delete). On A11+ MediaStore raises
     * RecoverableSecurityException when the asset wasn't created by us;
     * we surface that as a structured error since the CLI sandbox can't
     * show the system consent dialog.
     */
    private fun handleDelete(args: OffloadArgs): NativeOffloadResult {
        val idsStr = args.get("ids")
            ?: return NativeOffloadResult(2, "android-photos delete: --ids <id1,id2,...> is required\n")
        if (!args.hasFlag("confirm")) {
            return NativeOffloadResult(2, "android-photos delete: --confirm flag is required to delete assets\n")
        }
        val ids = idsStr.split(",").mapNotNull { it.trim().toLongOrNull() }.filter { it > 0 }
        if (ids.isEmpty()) {
            return NativeOffloadResult(2, "android-photos delete: --ids must contain at least one numeric id\n")
        }
        val deletedIds = JSONArray()
        val failed = JSONArray()
        for (id in ids) {
            // Try Images then Video.
            var rows = 0
            for (uri in listOf(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, MediaStore.Video.Media.EXTERNAL_CONTENT_URI)) {
                try {
                    rows = context.contentResolver.delete(
                        uri,
                        "${MediaStore.Images.Media._ID} = ?",
                        arrayOf(id.toString()),
                    )
                    if (rows > 0) break
                } catch (e: SecurityException) {
                    failed.put(JSONObject().put("id", id).put("error", "write_denied").put("message", e.message ?: "RecoverableSecurityException"))
                    break
                } catch (e: Throwable) {
                    failed.put(JSONObject().put("id", id).put("error", "delete_failed").put("message", e.message ?: "unknown"))
                    break
                }
            }
            if (rows > 0) deletedIds.put(id)
            else if (failed.length() == 0 || failed.getJSONObject(failed.length() - 1).optLong("id") != id) {
                failed.put(JSONObject().put("id", id).put("error", "not_found").put("message", "No asset with this id"))
            }
        }
        AppLogger.info(TAG, "delete: requested=${ids.size} deleted=${deletedIds.length()} failed=${failed.length()}")
        val data = JSONObject()
            .put("deleted_ids", deletedIds)
            .put("deleted_count", deletedIds.length())
            .put("requested_count", ids.size)
        if (failed.length() > 0) data.put("failed", failed)
        return NativeOffloadResult(0, OffloadOutput.formatBody(data.toString(2), args) + "\n")
    }

    // ── helpers ──────────────────────────────────────────────────────────

    /**
     * Mirror apple-photos resolve_date_range: --days N (last N days
     * through now) wins over --start/--end. Returns (startMs?, endMs?)
     * as a Pair; either side may be null when no flag set.
     */
    private fun resolveDateRange(args: OffloadArgs): Pair<Long?, Long?> {
        args.getInt("days")?.let { days ->
            val n = if (days <= 0) 7 else days
            val cal = Calendar.getInstance().apply {
                timeInMillis = System.currentTimeMillis() - n * 24L * 60 * 60 * 1000
                set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0)
                set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
            }
            return cal.timeInMillis to System.currentTimeMillis()
        }
        val startMs = args.get("start")?.let { parseDate(it) }
        val endMs = args.get("end")?.let { parseDate(it) }
        return startMs to endMs
    }

    private fun parseDate(s: String): Long? {
        val patterns = listOf(
            "yyyy-MM-dd'T'HH:mm:ssXXX",
            "yyyy-MM-dd'T'HH:mm:ss'Z'",
            "yyyy-MM-dd'T'HH:mm:ss",
            "yyyy-MM-dd'T'HH:mm",
            "yyyy-MM-dd",
        )
        for (p in patterns) {
            try {
                val sdf = SimpleDateFormat(p, Locale.US).apply {
                    timeZone = if (p.endsWith("'Z'")) TimeZone.getTimeZone("UTC") else TimeZone.getDefault()
                }
                return sdf.parse(s)?.time
            } catch (_: Throwable) {}
        }
        return null
    }

    private fun formatIso(ms: Long): String {
        val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.US)
        return sdf.format(Date(ms))
    }

    private fun photoStats(): String {
        var count = 0L
        var earliest = Long.MAX_VALUE
        var latest = 0L
        var totalSize = 0L
        context.contentResolver.query(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            arrayOf(MediaStore.Images.Media.DATE_TAKEN, MediaStore.Images.Media.SIZE),
            null, null, null,
        )?.use { c ->
            while (c.moveToNext()) {
                count++
                val d = c.getLong(0)
                if (d > 0) {
                    if (d < earliest) earliest = d
                    if (d > latest) latest = d
                }
                totalSize += c.getLong(1)
            }
        }
        val json = JSONObject()
            .put("total_photos", count)
            .put("total_size_mb", String.format("%.1f", totalSize / 1e6))
        if (earliest < Long.MAX_VALUE) json.put("earliest", dateFormat.format(Date(earliest)))
        if (latest > 0) json.put("latest", dateFormat.format(Date(latest)))
        return json.toString(2)
    }

    /**
     * `near` reads EXIF from each candidate photo rather than relying on the
     * MediaStore LATITUDE/LONGITUDE columns — those were deprecated in API 29
     * and now return 0 on most OEM Gallery implementations. Requires
     * ACCESS_MEDIA_LOCATION on A10+ and setRequireOriginal() to retrieve
     * un-redacted EXIF.
     *
     * NOTE: this is O(N) disk reads; we scan at most the newest 500 photos
     * to keep runtime bounded. Photos in encrypted "Secure Folder" / MIUI
     * private album / Huawei vault are not exposed to MediaStore and will
     * be invisible — we note that in the response when zero results come back.
     */
    private fun nearPhotos(lat: Double, lon: Double, radiusKm: Double, max: Int): String {
        val photos = JSONArray()
        val scanLimit = 500
        // ensureMediaLocationPermission() already guaranteed this on the
        // happy path; if a caller bypasses the gate we still degrade safely.
        val hasMediaLoc = hasMediaLocationPermission()

        val projection = arrayOf(
            MediaStore.Images.Media._ID,
            MediaStore.Images.Media.DISPLAY_NAME,
            MediaStore.Images.Media.DATE_TAKEN,
        )
        var scanned = 0
        context.contentResolver.query(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI, projection, null, null,
            "${MediaStore.Images.Media.DATE_TAKEN} DESC",
        )?.use { c ->
            while (c.moveToNext() && photos.length() < max && scanned < scanLimit) {
                scanned++
                val id = c.getLong(0)
                val contentUri = ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id)
                val uriToRead = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && hasMediaLoc) {
                    runCatching { MediaStore.setRequireOriginal(contentUri) }.getOrDefault(contentUri)
                } else contentUri
                val coords = try {
                    context.contentResolver.openInputStream(uriToRead)?.use { input ->
                        val exif = ExifInterface(input)
                        val ll = FloatArray(2)
                        if (exif.getLatLong(ll)) doubleArrayOf(ll[0].toDouble(), ll[1].toDouble()) else null
                    }
                } catch (_: Throwable) { null } ?: continue

                val dist = haversine(lat, lon, coords[0], coords[1])
                if (dist <= radiusKm) {
                    val p = JSONObject()
                        .put("id", id)
                        .put("name", c.getString(1) ?: "")
                    val dt = c.getLong(2)
                    if (dt > 0) p.put("date", dateFormat.format(Date(dt)))
                    p.put("latitude", coords[0])
                        .put("longitude", coords[1])
                        .put("distance_km", String.format("%.2f", dist))
                    photos.put(p)
                }
            }
        }
        if (photos.length() == 0) {
            val hint = if (!hasMediaLoc && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                "  (GPS EXIF is redacted without the ACCESS_MEDIA_LOCATION permission; add it to AndroidManifest and request it from the user.)"
            } else if (scanned == scanLimit) {
                "  (scanned the newest $scanLimit photos; no matches in that window)"
            } else ""
            return "No photos found within ${radiusKm}km of ($lat, $lon).$hint"
        }
        return photos.toString(2)
    }

    private fun haversine(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val r = 6371.0
        val dLat = Math.toRadians(lat2 - lat1)
        val dLon = Math.toRadians(lon2 - lon1)
        val a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2)
        return r * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    }

    companion object {
        private const val TAG = "PhotosOffload"
        private const val HELP = """android-photos — query and manage device photos & videos
                              (mirrors apple-photos)

Usage:
  android-photos list [--type photo|video|all]
                      [--start ISO --end ISO | --days N] [--limit N]
  android-photos stats
  android-photos near --lat L --lon N [--radius KM] [--limit N]
                      (legacy: near <lat> <lon>)
  android-photos albums [--type user|smart|all]
  android-photos album --id <bucket_id> | --name <bucket_name> [--limit N]
  android-photos export --id <asset_id> [--size thumb|medium|original]
  android-photos import <file> [--album-name <name>]          (alias: save)
                       (--path <file> also accepted)
  android-photos create-album --name <name>
  android-photos favorite --id <asset_id>                     (Android 11+)
  android-photos delete --ids <id1,id2,...> --confirm

Aliases for backwards compatibility:
  --max ↔ --limit
  --lng ↔ --lon
  positional `near <lat> <lon>` (flag form preferred)

Android edge cases vs apple-photos:
  - No native smart-album concept. `albums --type smart` returns empty
    with a structured note. `--type user` and `--type all` are equivalent.
  - No "create empty album" API. `create-album` returns an instructional
    note pointing at `import --album-name <name>`.
  - On Android 11+ modifying or deleting another app's media triggers
    RecoverableSecurityException. Surfaced as `error: write_denied`
    since the CLI sandbox can't show the system consent dialog.
  - Export writes into the calling chat's offloads dir and returns
    `linux_path` (/var/minis/offloads/...) and `minis_url`
    (minis://offloads/...) alongside `host_path`, matching iOS. Outside a
    chat (interactive terminal) there is no session dir, so only
    `host_path` is returned and the note says it is not reachable from
    the Linux sandbox.

Errors return JSON: {"error":"...","message":"..."}.
"""
    }
}
