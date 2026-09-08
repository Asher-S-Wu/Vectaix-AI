package com.openminis.app.sandbox.offload

import com.openminis.app.logging.AppLogger
import org.json.JSONArray
import org.json.JSONObject

/**
 * Centralized output filter for `android-*` offload commands.
 *
 * Mirrors iOS `noff_emit_json` (NativeOffloadUtils.m:159) — the same
 * `--compact` / `-q` / `--quiet` flags work uniformly across every
 * command, so an agent loop can rely on consistent shaping no matter
 * which tool it invoked.
 *
 * Behavior contract:
 *   - Default (no flags): pass [body] through unchanged. Existing agent
 *     flows that scrape free-form output keep working.
 *   - `--compact`: if [body] parses as JSON (object or array), re-emit
 *     it as a single line with no indent. Plain-text bodies pass
 *     through.
 *   - `-q` / `--quiet`: if [body] parses as a JSONObject with the iOS
 *     envelope shape `{ok, data, error, ...}`, return only the `data`
 *     field (success) or the `error` field (failure). For raw JSON
 *     without an envelope, or plain-text bodies, pass through.
 *   - Both flags compose: extract the data/error field first, then
 *     compact-serialize the result.
 *
 * Handlers feed `body` without a trailing newline; the formatter never
 * adds one — the caller appends `"\n"` when wrapping in
 * [com.openminis.app.sandbox.NativeOffloadResult], matching the
 * existing pattern.
 */
internal object OffloadOutput {
    private const val TAG = "OffloadOutput"

    /**
     * Boolean-flag names recognized by every android-* command. [OffloadArgs]
     * always merges this set into its [booleanFlags] argument so e.g.
     * `--compact list` parses as flag + positional rather than swallowing
     * `list` as the value of `--compact`.
     */
    val OUTPUT_FLAGS: Set<String> = setOf("compact", "quiet", "q")

    /**
     * Apply the active output flags to a finished body. Caller passes the
     * full string it would otherwise emit (sans trailing newline); the
     * return is the string to emit instead.
     */
    fun formatBody(body: String, args: OffloadArgs): String {
        val compact = args.hasFlag("compact")
        val quiet = args.hasFlag("q", "quiet")
        if (!compact && !quiet) return body
        val trimmed = body.trimEnd('\n')

        // Try JSONObject first, then JSONArray. Plain text falls through.
        val obj = parseObjectOrNull(trimmed)
        if (obj != null) {
            val payload: Any = if (quiet) extractEnvelopeField(obj) ?: obj else obj
            return serialize(payload, compact)
        }
        val arr = parseArrayOrNull(trimmed)
        if (arr != null) {
            // Quiet on an array is a no-op (no envelope to strip).
            return serialize(arr, compact)
        }
        // Plain text — neither flag applies.
        return body
    }

    /** iOS envelope: `{ok:true, data: ...}` or `{ok:false, error: ...}`.
     *  We accept either field independently — older / partial envelopes
     *  may carry just `data` or just `error`. */
    private fun extractEnvelopeField(obj: JSONObject): Any? {
        if (obj.has("error")) return obj.opt("error")
        if (obj.has("data")) return obj.opt("data")
        return null
    }

    private fun parseObjectOrNull(s: String): JSONObject? {
        val first = s.firstOrNull { !it.isWhitespace() } ?: return null
        if (first != '{') return null
        return try { JSONObject(s) } catch (_: Exception) { null }
    }

    private fun parseArrayOrNull(s: String): JSONArray? {
        val first = s.firstOrNull { !it.isWhitespace() } ?: return null
        if (first != '[') return null
        return try { JSONArray(s) } catch (_: Exception) { null }
    }

    private fun serialize(payload: Any, compact: Boolean): String = try {
        when (payload) {
            is JSONObject -> if (compact) payload.toString() else payload.toString(2)
            is JSONArray  -> if (compact) payload.toString() else payload.toString(2)
            is String     -> payload
            else          -> payload.toString()
        }
    } catch (e: Exception) {
        AppLogger.warning(TAG, "serialize failed: ${e.message}")
        payload.toString()
    }
}
