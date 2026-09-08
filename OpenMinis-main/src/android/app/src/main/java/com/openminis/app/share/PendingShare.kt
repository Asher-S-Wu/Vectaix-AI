package com.openminis.app.share

import org.json.JSONArray
import org.json.JSONObject

/**
 * Mirrors iOS Shared/PendingShare.swift wire format so Android and iOS
 * share extensions emit/consume the same on-disk JSON. Future-proofs a
 * cross-platform sync if it ever lands.
 *
 * Wire shape: `{items: [{kind, value}], timestamp}`
 *   - kind ∈ {"inlineText", "attachment"}
 *   - value: for inlineText = the text; for attachment = filename in
 *            the share staging dir (filesDir/share_extension/).
 */
data class PendingShare(val items: List<Item>, val timestampMs: Long) {
    data class Item(val kind: Kind, val value: String) {
        enum class Kind(val wire: String) {
            INLINE_TEXT("inlineText"),
            ATTACHMENT("attachment"),
        }
    }

    fun toJson(): JSONObject {
        val arr = JSONArray()
        for (item in items) {
            arr.put(JSONObject().put("kind", item.kind.wire).put("value", item.value))
        }
        return JSONObject().put("items", arr).put("timestamp", timestampMs)
    }

    companion object {
        fun fromJson(json: JSONObject): PendingShare? {
            val arr = json.optJSONArray("items") ?: return null
            val items = mutableListOf<Item>()
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                val kindStr = o.optString("kind", "")
                if (kindStr.isEmpty()) continue
                val kind = Item.Kind.entries.firstOrNull { it.wire == kindStr } ?: continue
                val value = o.optString("value", "")
                if (value.isEmpty()) continue
                items += Item(kind, value)
            }
            if (items.isEmpty()) return null
            return PendingShare(items, json.optLong("timestamp", System.currentTimeMillis()))
        }
    }
}
