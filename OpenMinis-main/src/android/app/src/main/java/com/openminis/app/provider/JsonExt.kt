package com.openminis.app.provider

import org.json.JSONObject

/**
 * Safe optString that handles the Android JSONObject quirk where
 * optString("key", "") returns the literal string "null" when the key
 * exists but its value is JSON null.
 *
 * This function returns [fallback] in both cases:
 * - key does not exist
 * - key exists but value is JSONObject.NULL (JSON null)
 */
fun JSONObject.safeOptString(key: String, fallback: String = ""): String {
    if (!has(key) || isNull(key)) return fallback
    return optString(key, fallback)
}
