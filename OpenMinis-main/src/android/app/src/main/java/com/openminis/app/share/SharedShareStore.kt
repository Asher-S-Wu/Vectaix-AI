package com.openminis.app.share

import android.content.Context
import com.openminis.app.logging.AppLogger
import org.json.JSONObject
import java.io.File

/**
 * Mirrors iOS Shared/SharedContainerStore.swift. SharedPreferences-backed
 * read/write of [PendingShare]; staged binary attachments live under
 * `filesDir/share_extension/` so the producer (ShareReceiverActivity)
 * can copy ContentResolver streams into a path the consumer can read
 * after the producer activity finishes.
 */
object SharedShareStore {
    private const val TAG = "SharedShareStore"
    private const val PREFS_NAME = "share_prefs"
    private const val KEY_PENDING_SHARE = "pending_share"
    private const val SHARE_DIR = "share_extension"

    /**
     * [T-android-share-buffer-merge] Window during which a newly saved share
     * merges into the existing unconsumed record rather than replacing it.
     * 300s matches iOS a51e7255 and ShareCoordinator's launch staleness cutoff.
     */
    private const val MERGE_MAX_AGE_MS = 300_000L

    /**
     * [T-android-share-buffer-merge] Upper bound on a merged item list. Merging
     * is unbounded by nature — a user (or a misbehaving sender) repeatedly
     * sharing inside the 300s window would otherwise grow one record without
     * limit and dump all of it into the composer at once. Keep the NEWEST
     * items on overflow: the most recent share is what the user is acting on.
     */
    private const val MERGE_MAX_ITEMS = 50

    fun sharedFileDirectory(context: Context): File =
        File(context.filesDir, SHARE_DIR).apply { mkdirs() }

    /**
     * [T-android-share-buffer-merge] Persist a share, MERGING with an
     * unconsumed record instead of replacing it.
     *
     * Mirrors iOS a51e7255. Previously this replaced the record wholesale:
     * sharing two screenshots before the main app ran processPendingShare
     * silently destroyed the first one. Attachment file names are
     * UUID-suffixed, so appending across shares is collision-free on disk.
     *
     * Only merges while the existing record is younger than
     * [MERGE_MAX_AGE_MS]; an older record is treated as abandoned and
     * replaced (its staged files are cleaned so they don't leak).
     */
    fun savePendingShare(context: Context, share: PendingShare) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val existing = loadPendingShare(context)
        val now = System.currentTimeMillis()
        val merged = if (existing != null && now - existing.timestampMs <= MERGE_MAX_AGE_MS) {
            // De-dupe by (kind, value) so a double-delivered intent doesn't
            // inject the same attachment twice.
            val seen = LinkedHashMap<Pair<PendingShare.Item.Kind, String>, PendingShare.Item>()
            for (item in existing.items + share.items) {
                seen[item.kind to item.value] = item
            }
            // Cap the list, keeping the NEWEST items (takeLast) — the incoming
            // share is what the user just acted on.
            val all = seen.values.toList()
            val capped = if (all.size > MERGE_MAX_ITEMS) all.takeLast(MERGE_MAX_ITEMS) else all
            AppLogger.info(
                TAG,
                "merging pending share: ${existing.items.size} + ${share.items.size} -> ${capped.size} item(s)" +
                    if (capped.size < all.size) " (capped from ${all.size})" else "",
            )
            // Renew the timestamp so the merged record gets a full window.
            PendingShare(capped, now)
        } else {
            share
        }
        prefs.edit().putString(KEY_PENDING_SHARE, merged.toJson().toString()).apply()
        AppLogger.info(TAG, "saved pending share with ${merged.items.size} item(s)")
    }

    fun loadPendingShare(context: Context): PendingShare? {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val raw = prefs.getString(KEY_PENDING_SHARE, null) ?: return null
        return try {
            PendingShare.fromJson(JSONObject(raw))
        } catch (e: Exception) {
            AppLogger.warning(TAG, "failed to decode pending share: ${e.message}")
            null
        }
    }

    fun clearPendingShare(context: Context) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit().remove(KEY_PENDING_SHARE).apply()
    }

    /**
     * Remove staged binary attachments. Call after consumption or on stale buffer.
     *
     * [keep] names any files that must survive — pass the item values of a share
     * that is still live in memory.
     *
     * [T-android-share-buffer-merge] Why `keep` exists: this used to wipe the
     * whole directory unconditionally. Raising the in-memory buffer TTL from
     * 30s to 300s widened a window where share A can still be buffered
     * (holding file references) while a NEWLY ARRIVING stale prefs record
     * takes the discard path and deletes A's files out from under it, leaving
     * broken attachments. Callers that know about a live buffer now exclude it.
     */
    fun cleanSharedFiles(context: Context, keep: Set<String> = emptySet()) {
        val dir = sharedFileDirectory(context)
        dir.listFiles()?.forEach { f ->
            if (f.name !in keep) runCatching { f.delete() }
        }
    }
}
