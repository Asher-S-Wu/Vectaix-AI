package com.openminis.app.scheduled

import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar
import java.util.UUID

/**
 * [T-android-scheduled-tasks-run-records] One recorded execution of a
 * scheduled task. The run-records screen lists these newest-first; a run with
 * a non-null [sessionId] is tappable → opens that chat.
 */
data class ScheduledRun(
    val firedAt: Long,
    val sessionId: String?,
    val preview: String?,
    val ok: Boolean,
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("firedAt", firedAt)
        if (sessionId != null) put("sessionId", sessionId)
        if (preview != null) put("preview", preview)
        put("ok", ok)
    }

    companion object {
        fun fromJson(o: JSONObject): ScheduledRun = ScheduledRun(
            firedAt = o.optLong("firedAt"),
            sessionId = if (o.has("sessionId")) o.optString("sessionId", null) else null,
            preview = if (o.has("preview")) o.optString("preview", null) else null,
            ok = o.optBoolean("ok", true),
        )
    }
}

/**
 * [T-android-scheduled-tasks-design / T-android-scheduled-tasks-full]
 * User-defined scheduled task that fires an AI action at a configured time.
 * Counterpart to the iOS Shortcuts surface (SendPrompt / FollowUpSession /
 * RetryRun App Intents) — on Android we own the scheduling layer ourselves
 * via AlarmManager, and the per-task [targetMode] mirrors the iOS intent set:
 *
 *   NEW_SESSION      ≈ SendPromptIntent with no session  → run prompt in a
 *                      fresh chat.
 *   APPEND_TO        ≈ FollowUpSessionIntent             → enqueue prompt into
 *                      an existing chat (follow-up).
 *   RERUN            ≈ RetryRunIntent                     → re-run an existing
 *                      chat from a chosen user message.
 *
 * Persistence: serialized to JSON via [toJson] / [fromJson] and stored in
 * [ScheduledTaskStore] (SharedPreferences). Schema lives here so the store
 * stays a thin layer over the JSON array.
 */
enum class ScheduledRepeatMode { ONCE, DAILY, WEEKDAYS, CUSTOM }

/**
 * What the task does when it fires. Mirrors the iOS App Intent set.
 *  - [NewSession]: run [ScheduledTask.prompt] in a brand-new chat.
 *  - [AppendToSession]: append the prompt to an existing chat (follow-up).
 *  - [RerunMessage]: re-run an existing chat from a specific user message
 *    (the prompt is ignored — the message itself is replayed).
 */
sealed class ScheduledTargetMode {
    object NewSession : ScheduledTargetMode()
    data class AppendToSession(val sessionId: String) : ScheduledTargetMode()
    data class RerunMessage(val sessionId: String, val messageId: String) : ScheduledTargetMode()

    fun encode(): String = when (this) {
        NewSession -> "NEW_SESSION"
        is AppendToSession -> "APPEND_TO:$sessionId"
        is RerunMessage -> "RERUN:$sessionId:$messageId"
    }

    /** Session this task targets, or null for NEW_SESSION. */
    val sessionIdOrNull: String?
        get() = when (this) {
            NewSession -> null
            is AppendToSession -> sessionId
            is RerunMessage -> sessionId
        }

    companion object {
        fun decode(raw: String?): ScheduledTargetMode {
            if (raw.isNullOrEmpty() || raw == "NEW_SESSION") return NewSession
            if (raw.startsWith("APPEND_TO:")) {
                return AppendToSession(raw.removePrefix("APPEND_TO:"))
            }
            if (raw.startsWith("RERUN:")) {
                // RERUN:<sessionId>:<messageId> — split on the FIRST colon only,
                // since ids are UUIDs (no embedded colons) but be defensive.
                val rest = raw.removePrefix("RERUN:")
                val idx = rest.indexOf(':')
                if (idx > 0) {
                    return RerunMessage(rest.substring(0, idx), rest.substring(idx + 1))
                }
            }
            return NewSession
        }
    }
}

data class ScheduledTask(
    val id: String = UUID.randomUUID().toString(),
    val label: String,
    val timeOfDayHour: Int,                  // 0-23
    val timeOfDayMinute: Int,                // 0-59
    val repeatMode: ScheduledRepeatMode,
    val customDays: Set<Int> = emptySet(),   // Calendar.DAY_OF_WEEK values when repeatMode=CUSTOM
    val prompt: String,
    val targetMode: ScheduledTargetMode = ScheduledTargetMode.NewSession,
    val modelId: String? = null,             // null → use app default (or fall back from modelBinding's resolved entry)
    // [T-android-scheduled-task-model-binding] Mirrors ChatSessionEntity.modelBinding.
    // JSON: `{"type":"group","groupId":"..."}` or `{"type":"entry","entryId":"..."}`
    // null → "use app default" (ScheduledAgentRunner resolves to defaultPrimaryGroupId).
    // When non-null, ScheduledAgentRunner writes it onto the new session row so the
    // chat picks up the same group/entry the user chose for the task.
    val modelBinding: String? = null,
    val enabled: Boolean = true,
    val createdAt: Long = System.currentTimeMillis(),
    // [T-android-scheduled-tasks-full] Optional active window. The task only
    // fires on/after startDateMs and on/before endDateMs (both = start-of-day
    // local epoch ms, inclusive). null = unbounded on that side. A ONCE task
    // with a startDate fires on the first matching day at/after the start;
    // repeating tasks skip days outside the window and auto-disable once the
    // end date has fully passed.
    val startDateMs: Long? = null,
    val endDateMs: Long? = null,
    val lastFiredAt: Long? = null,
    val lastResultPreview: String? = null,
    val lastResultSessionId: String? = null,
    // [T-android-scheduled-tasks-run-records] Newest-first execution log. The
    // list screen no longer shows a result preview; instead the long-press
    // "Run records" menu opens a screen backed by this. Capped at
    // MAX_RUN_HISTORY by the manager when appending.
    val runHistory: List<ScheduledRun> = emptyList(),
) {

    /**
     * Wall-clock ms of the next firing time for this task, taking
     * [repeatMode] / [customDays] / [startDateMs] / [endDateMs] / current time
     * into account. Returns `null` when [enabled] is false, the task has no
     * valid next slot (CUSTOM with an empty day set), or the next slot would
     * fall after [endDateMs].
     *
     * Uses [Calendar.getInstance] so the local time zone is respected — users
     * schedule "09:00 every day" in their wall-clock sense, not UTC.
     */
    fun nextTriggerMs(now: Long = System.currentTimeMillis()): Long? {
        if (!enabled) return null

        // Earliest instant we may fire: max(now, start-of-startDate). This lets
        // a task created today with a future startDate wait until that day.
        val floor = maxOf(now, startDateMs ?: Long.MIN_VALUE)

        val cal = Calendar.getInstance().apply {
            timeInMillis = floor
            set(Calendar.HOUR_OF_DAY, timeOfDayHour)
            set(Calendar.MINUTE, timeOfDayMinute)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }

        val candidate: Long = when (repeatMode) {
            ScheduledRepeatMode.ONCE, ScheduledRepeatMode.DAILY -> {
                if (cal.timeInMillis < floor) cal.add(Calendar.DAY_OF_YEAR, 1)
                cal.timeInMillis
            }
            ScheduledRepeatMode.WEEKDAYS -> {
                if (cal.timeInMillis < floor) cal.add(Calendar.DAY_OF_YEAR, 1)
                var safety = 8
                while (safety-- > 0 && cal.get(Calendar.DAY_OF_WEEK).let {
                        it == Calendar.SATURDAY || it == Calendar.SUNDAY
                    }) {
                    cal.add(Calendar.DAY_OF_YEAR, 1)
                }
                cal.timeInMillis
            }
            ScheduledRepeatMode.CUSTOM -> {
                if (customDays.isEmpty()) return null
                if (cal.timeInMillis < floor) cal.add(Calendar.DAY_OF_YEAR, 1)
                var safety = 8
                while (safety-- > 0 && cal.get(Calendar.DAY_OF_WEEK) !in customDays) {
                    cal.add(Calendar.DAY_OF_YEAR, 1)
                }
                if (safety < 0) return null
                cal.timeInMillis
            }
        }

        // Respect the end-of-window: endDateMs is the start-of-day of the last
        // allowed day, so the task may fire any time up to end-of-that-day.
        val end = endDateMs
        if (end != null) {
            val endOfDay = Calendar.getInstance().apply {
                timeInMillis = end
                set(Calendar.HOUR_OF_DAY, 23)
                set(Calendar.MINUTE, 59)
                set(Calendar.SECOND, 59)
                set(Calendar.MILLISECOND, 999)
            }.timeInMillis
            if (candidate > endOfDay) return null
        }
        return candidate
    }

    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("label", label)
        put("hour", timeOfDayHour)
        put("minute", timeOfDayMinute)
        put("repeatMode", repeatMode.name)
        put("customDays", customDays.joinToString(","))
        put("prompt", prompt)
        put("targetMode", targetMode.encode())
        if (modelId != null) put("modelId", modelId)
        if (modelBinding != null) put("modelBinding", modelBinding)
        put("enabled", enabled)
        put("createdAt", createdAt)
        if (startDateMs != null) put("startDateMs", startDateMs)
        if (endDateMs != null) put("endDateMs", endDateMs)
        if (lastFiredAt != null) put("lastFiredAt", lastFiredAt)
        if (lastResultPreview != null) put("lastResultPreview", lastResultPreview)
        if (lastResultSessionId != null) put("lastResultSessionId", lastResultSessionId)
        if (runHistory.isNotEmpty()) {
            put("runHistory", JSONArray().apply { runHistory.forEach { put(it.toJson()) } })
        }
    }

    companion object {
        /** Max recorded executions kept per task. */
        const val MAX_RUN_HISTORY = 50

        fun fromJson(o: JSONObject): ScheduledTask = ScheduledTask(
            id = o.getString("id"),
            label = o.optString("label", ""),
            timeOfDayHour = o.optInt("hour", 9),
            timeOfDayMinute = o.optInt("minute", 0),
            repeatMode = runCatching {
                ScheduledRepeatMode.valueOf(o.optString("repeatMode", "ONCE"))
            }.getOrDefault(ScheduledRepeatMode.ONCE),
            customDays = o.optString("customDays", "")
                .split(',').mapNotNull { it.trim().toIntOrNull() }.toSet(),
            prompt = o.optString("prompt", ""),
            targetMode = ScheduledTargetMode.decode(o.optString("targetMode", null)),
            modelId = if (o.has("modelId")) o.optString("modelId", null) else null,
            modelBinding = if (o.has("modelBinding")) o.optString("modelBinding", null) else null,
            enabled = o.optBoolean("enabled", true),
            createdAt = o.optLong("createdAt", System.currentTimeMillis()),
            startDateMs = if (o.has("startDateMs")) o.optLong("startDateMs") else null,
            endDateMs = if (o.has("endDateMs")) o.optLong("endDateMs") else null,
            lastFiredAt = if (o.has("lastFiredAt")) o.optLong("lastFiredAt") else null,
            lastResultPreview = if (o.has("lastResultPreview"))
                o.optString("lastResultPreview", null) else null,
            lastResultSessionId = if (o.has("lastResultSessionId"))
                o.optString("lastResultSessionId", null) else null,
            runHistory = o.optJSONArray("runHistory")?.let { arr ->
                buildList {
                    for (i in 0 until arr.length()) {
                        arr.optJSONObject(i)?.let { add(ScheduledRun.fromJson(it)) }
                    }
                }
            } ?: emptyList(),
        )
    }
}
