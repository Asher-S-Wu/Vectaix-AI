package com.openminis.app.browser

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.URI
import java.util.UUID

/**
 * Tracks browser history with 7-day retention, mirroring iOS BrowserHistoryStore.
 */
class BrowserHistoryStore private constructor(private val context: Context) {

    companion object {
        private const val TAG = "BrowserHistory"
        private const val MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000L // 7 days
        private const val FILENAME = "browser_history.json"

        @Volatile
        private var instance: BrowserHistoryStore? = null

        fun getInstance(context: Context): BrowserHistoryStore {
            return instance ?: synchronized(this) {
                instance ?: BrowserHistoryStore(context.applicationContext).also { instance = it }
            }
        }
    }

    data class Entry(
        val id: String = UUID.randomUUID().toString(),
        val url: String,
        val title: String,
        val timestamp: Long = System.currentTimeMillis(),
        val domain: String = extractDomain(url),
    )

    private val entries = mutableListOf<Entry>()

    init {
        load()
    }

    fun record(url: String, title: String) {
        if (url.isEmpty()) return
        // Deduplicate consecutive visits to same URL
        if (entries.lastOrNull()?.url == url) return

        entries.add(Entry(url = url, title = title))
        pruneOld()
        save()
    }

    fun getEntries(): List<Entry> = entries.sortedByDescending { it.timestamp }

    fun search(query: String): List<Entry> {
        if (query.isBlank()) return getEntries()
        val q = query.lowercase()
        return entries.filter {
            it.title.lowercase().contains(q) || it.url.lowercase().contains(q)
        }.sortedByDescending { it.timestamp }
    }

    fun groupedByDay(): Map<String, List<Entry>> {
        val cal = java.util.Calendar.getInstance()
        val today = java.util.Calendar.getInstance()
        val yesterday = java.util.Calendar.getInstance().apply { add(java.util.Calendar.DAY_OF_YEAR, -1) }

        return getEntries().groupBy { entry ->
            cal.timeInMillis = entry.timestamp
            when {
                cal.get(java.util.Calendar.YEAR) == today.get(java.util.Calendar.YEAR) &&
                    cal.get(java.util.Calendar.DAY_OF_YEAR) == today.get(java.util.Calendar.DAY_OF_YEAR) -> "Today"
                cal.get(java.util.Calendar.YEAR) == yesterday.get(java.util.Calendar.YEAR) &&
                    cal.get(java.util.Calendar.DAY_OF_YEAR) == yesterday.get(java.util.Calendar.DAY_OF_YEAR) -> "Yesterday"
                else -> {
                    val month = cal.get(java.util.Calendar.MONTH) + 1
                    val day = cal.get(java.util.Calendar.DAY_OF_MONTH)
                    "$month/${day}"
                }
            }
        }
    }

    /** Get unique domains from history (for cookie domain listing). */
    fun uniqueDomains(): List<String> {
        return entries.map { it.domain }.filter { it.isNotEmpty() }.distinct().sorted()
    }

    fun clear() {
        entries.clear()
        save()
    }

    private fun pruneOld() {
        val cutoff = System.currentTimeMillis() - MAX_AGE_MS
        entries.removeAll { it.timestamp < cutoff }
    }

    private fun save() {
        try {
            val file = File(context.filesDir, FILENAME)
            val array = JSONArray()
            for (entry in entries) {
                val obj = JSONObject()
                obj.put("id", entry.id)
                obj.put("url", entry.url)
                obj.put("title", entry.title)
                obj.put("timestamp", entry.timestamp)
                obj.put("domain", entry.domain)
                array.put(obj)
            }
            file.writeText(array.toString())
        } catch (e: Exception) {
            Log.w(TAG, "Failed to save history: ${e.message}")
        }
    }

    private fun load() {
        try {
            val file = File(context.filesDir, FILENAME)
            if (!file.exists()) return
            val array = JSONArray(file.readText())
            for (i in 0 until array.length()) {
                val obj = array.getJSONObject(i)
                entries.add(Entry(
                    id = obj.optString("id", UUID.randomUUID().toString()),
                    url = obj.optString("url", ""),
                    title = obj.optString("title", ""),
                    timestamp = obj.optLong("timestamp", 0),
                    domain = obj.optString("domain", ""),
                ))
            }
            pruneOld()
        } catch (e: Exception) {
            Log.w(TAG, "Failed to load history: ${e.message}")
        }
    }
}

private fun extractDomain(url: String): String {
    return try {
        URI(url).host ?: ""
    } catch (_: Exception) {
        ""
    }
}
