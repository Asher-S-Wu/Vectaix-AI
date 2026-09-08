package com.openminis.app.offload

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Lightweight SharedPreferences-backed registry of currently-scheduled
 * `android-notification schedule` notifications.
 *
 * Used so that:
 *   - `android-notification pending` can list what's still queued
 *   - `android-notification cancel --id` can remove a specific entry
 *   - the receiver can drop entries on fire so they don't linger
 *
 * The app already maintains a similar prefs registry for alarms in
 * AlarmOffloadManager; we deliberately keep this separate so the two
 * surfaces don't collide on key names or fire semantics.
 */
internal class ScheduledNotificationStore(context: Context) {

    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun add(entry: JSONObject) {
        val list = loadAll()
        list.put(entry)
        prefs.edit().putString(KEY, list.toString()).apply()
    }

    fun remove(id: String): Boolean {
        val list = loadAll()
        for (i in 0 until list.length()) {
            if (list.getJSONObject(i).optString("id") == id) {
                list.remove(i)
                prefs.edit().putString(KEY, list.toString()).apply()
                return true
            }
        }
        return false
    }

    fun clear() {
        prefs.edit().remove(KEY).apply()
    }

    fun get(id: String): JSONObject? {
        val list = loadAll()
        for (i in 0 until list.length()) {
            val o = list.getJSONObject(i)
            if (o.optString("id") == id) return o
        }
        return null
    }

    fun loadAll(): JSONArray {
        val raw = prefs.getString(KEY, null) ?: return JSONArray()
        return try { JSONArray(raw) } catch (_: Exception) { JSONArray() }
    }

    /**
     * Drop entries whose triggerAtMs has already passed. Receiver also
     * cleans up on fire, but if it was killed by the OS between schedule
     * and trigger the prefs entry would otherwise stick around.
     */
    fun sweepExpired() {
        val list = loadAll()
        val now = System.currentTimeMillis()
        val kept = JSONArray()
        var dropped = false
        for (i in 0 until list.length()) {
            val o = list.getJSONObject(i)
            if (o.optLong("trigger_at_ms", Long.MAX_VALUE) > now) {
                kept.put(o)
            } else {
                dropped = true
            }
        }
        if (dropped) prefs.edit().putString(KEY, kept.toString()).apply()
    }

    companion object {
        private const val PREFS = "minis_scheduled_notifications"
        private const val KEY = "scheduled"
    }
}
