package com.openminis.app.accessibility

import android.view.accessibility.AccessibilityNodeInfo
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

/**
 * Short-lived cache mapping opaque string IDs (e.g. "a3f2") to live
 * AccessibilityNodeInfo references. AccessibilityNodeInfo has no durable
 * identity across calls — `ui dump` allocates fresh objects every time
 * the framework re-enumerates the tree, but the AI agent expects to
 * reference a node by id seconds later in `tap node a3f2`.
 *
 * Entries expire after [TTL_MS] or when [clear] is called (e.g. on
 * service destroy).
 */
class NodeRegistry {
    private data class Entry(val node: AccessibilityNodeInfo, val createdAt: Long)

    private val map = ConcurrentHashMap<String, Entry>()
    private val seq = AtomicLong(0)

    fun put(node: AccessibilityNodeInfo): String {
        evictExpired()
        val id = nextId()
        map[id] = Entry(node, System.currentTimeMillis())
        return id
    }

    fun get(id: String): AccessibilityNodeInfo? {
        val e = map[id] ?: return null
        if (System.currentTimeMillis() - e.createdAt > TTL_MS) {
            map.remove(id)
            return null
        }
        return e.node
    }

    fun clear() { map.clear() }

    private fun evictExpired() {
        val now = System.currentTimeMillis()
        val it = map.entries.iterator()
        while (it.hasNext()) {
            val e = it.next()
            if (now - e.value.createdAt > TTL_MS) it.remove()
        }
    }

    private fun nextId(): String {
        return java.lang.Long.toString(seq.incrementAndGet() and 0xFFFFFL, 36).padStart(4, '0')
    }

    companion object {
        const val TTL_MS = 60_000L
    }
}
