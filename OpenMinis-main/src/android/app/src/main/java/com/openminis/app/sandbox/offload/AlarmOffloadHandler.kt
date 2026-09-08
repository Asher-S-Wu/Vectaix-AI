package com.openminis.app.sandbox.offload

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.AlarmClock
import com.openminis.app.logging.AppLogger
import com.openminis.app.offload.RepeatMode
import com.openminis.app.sandbox.NativeOffloadHandler
import com.openminis.app.sandbox.NativeOffloadRequest
import com.openminis.app.sandbox.NativeOffloadResult
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * android-alarm — schedule alarms and timers, list, or cancel them.
 *
 * Mirrors apple-alarm (NativeOffloads/AlarmOffload.m) — same set/timer/
 * cancel CLI surface so prompts and the agent loop are platform-agnostic:
 *   android-alarm set --time HH:MM|ISO --label L [--repeat ONCE|DAILY|WEEKDAYS]
 *   android-alarm timer --duration <seconds|5m|1h> [--label L]
 *   android-alarm list
 *   android-alarm cancel --id <alarm_id>
 *   android-alarm cancel --all
 *
 * Legacy positional forms are kept as aliases so older prompts and
 * scripts continue to work without changes:
 *   android-alarm schedule <HH:MM> [...]
 *   android-alarm timer <seconds> [...]
 *   android-alarm cancel <alarm_id>
 */
class AlarmOffloadHandler(private val context: Context) : NativeOffloadHandler {
    // T268: AlarmOffloadManager dependency dropped — this handler is now a
    // pure intent-dispatch surface (system Clock's SET_ALARM / SET_TIMER /
    // SHOW_ALARMS). The manager + its SharedPreferences are still around so
    // the one-shot ghost migration in MinisApp.onCreate can flush any
    // pre-T266 entries; the manager will be deleted once that bake is over.

    override fun handle(request: NativeOffloadRequest): NativeOffloadResult {
        val args = OffloadArgs(request.argv.drop(1))
        if (args.hasFlag("h", "help") || args.positional.isEmpty()) {
            return NativeOffloadResult(if (args.positional.isEmpty()) 2 else 0, HELP)
        }

        return try {
            when (val sub = args.positional[0]) {
                "set", "schedule" -> handleSet(args)
                "timer" -> handleTimer(args)
                "open", "list", "cancel" -> handleOpen(args)
                else -> NativeOffloadResult(2, "android-alarm: unknown subcommand '$sub'\n$HELP")
            }
        } catch (e: SecurityException) {
            AppLogger.warning(TAG, "SecurityException: ${e.message}")
            val body = JSONObject().put("error", "exact_alarm_denied")
                .put("message", "Exact alarms are blocked. On Android 14+ the user must grant 'Alarms & reminders' in Settings; on Xiaomi/Huawei/Oppo/OnePlus/Vivo, also enable autostart and disable battery optimization for Minis. Underlying: ${e.message}")
                .toString()
            NativeOffloadResult(77, OffloadOutput.formatBody(body, args) + "\n")
        } catch (e: Throwable) {
            AppLogger.warning(TAG, "uncaught: ${e.message}")
            val body = JSONObject().put("error", "alarm_failed")
                .put("message", e.message ?: "unknown").toString()
            NativeOffloadResult(1, OffloadOutput.formatBody(body, args) + "\n")
        }
    }

    // ── Subcommand handlers ─────────────────────────────────────────────

    private fun handleSet(args: OffloadArgs): NativeOffloadResult {
        // Time can come from --time (preferred, apple-alarm parity) or as a
        // legacy positional second arg (`schedule HH:MM`).
        val timeStr = args.get("time") ?: args.positional.getOrNull(1)
            ?: return NativeOffloadResult(2, "android-alarm set: --time <HH:MM|ISO> is required\n")
        val (hour, minute) = parseTimeArg(timeStr)
            ?: return NativeOffloadResult(
                2,
                "android-alarm: invalid time '$timeStr' (expected HH:MM or ISO 8601)\n",
            )
        val label = args.get("label") ?: "Alarm"
        val repeat = args.get("repeat")?.uppercase() ?: "ONCE"
        val mode = runCatching { RepeatMode.valueOf(repeat) }.getOrNull()
            ?: return NativeOffloadResult(
                2,
                "android-alarm: invalid --repeat '$repeat' (use ONCE, DAILY, WEEKDAYS)\n",
            )
        // T266: single-source schedule via the system Clock app. The internal
        // AlarmOffloadManager.scheduleAlarm + SharedPreferences path is gone:
        // dual-writing produced ghost reminders that fired only inside Minis
        // and confused users who expected to manage everything in their phone
        // Clock UI. Any OEM that refuses ACTION_SET_ALARM (no Clock app, or a
        // permission-stripped fork) is now a hard error — no silent fallback.
        val systemErr = scheduleViaSystemClock(label, hour, minute, mode)
        if (systemErr != null) {
            val body = JSONObject().put("error", "system_clock_unavailable")
                .put("message", systemErr)
                .put("hint", "Re-enable or install a Clock app (e.g. Google Clock) and grant the SET_ALARM permission.")
                .toString()
            AppLogger.warning(TAG, "set: system Clock dispatch failed — $systemErr")
            return NativeOffloadResult(1, OffloadOutput.formatBody(body, args) + "\n")
        }
        val data = buildSetEnvelope(label, hour, minute, mode)
            .put("system_alarm", "ok")
        AppLogger.info(TAG, "set: time=$hour:$minute repeat=$mode label='$label' → system Clock")
        return emitEnvelope("set", data, args)
    }

    /**
     * T266: single-source schedule via the system Clock app
     * ([AlarmClock.ACTION_SET_ALARM] + `EXTRA_SKIP_UI=true`). Returns null
     * on success, or a human-readable error string on failure.
     *
     * Pixel / AOSP Clock honors SKIP_UI and silently inserts the alarm;
     * OEM forks may force a confirmation dialog (see [emitEnvelope]
     * oem_hint). On Android 11+ resolveActivity returns non-null because
     * AndroidManifest declares <queries> for SET_ALARM; the
     * com.android.alarm.permission.SET_ALARM permission is required (T262-1).
     *
     * Was previously called trySystemSchedule and returned
     * "ok" | "fallback_internal_only" so the caller could degrade to a
     * Minis-internal AlarmManager copy. T266 retired that fallback —
     * dual-writing produced ghost alarms that fired only inside Minis
     * and confused users who managed everything in the phone Clock UI.
     */
    private fun scheduleViaSystemClock(
        label: String,
        hour: Int,
        minute: Int,
        mode: RepeatMode,
    ): String? {
        val intent = Intent(AlarmClock.ACTION_SET_ALARM).apply {
            putExtra(AlarmClock.EXTRA_HOUR, hour)
            putExtra(AlarmClock.EXTRA_MINUTES, minute)
            putExtra(AlarmClock.EXTRA_MESSAGE, label)
            putExtra(AlarmClock.EXTRA_SKIP_UI, true)
            // EXTRA_DAYS expects ArrayList<Int> of Calendar.SUNDAY..SATURDAY.
            // ONCE → omit; the system Clock interprets absence as a one-shot
            // alarm scheduled for the next matching HH:MM (today or tomorrow).
            when (mode) {
                RepeatMode.DAILY -> putExtra(
                    AlarmClock.EXTRA_DAYS,
                    arrayListOf(
                        Calendar.SUNDAY, Calendar.MONDAY, Calendar.TUESDAY,
                        Calendar.WEDNESDAY, Calendar.THURSDAY, Calendar.FRIDAY,
                        Calendar.SATURDAY,
                    ),
                )
                RepeatMode.WEEKDAYS -> putExtra(
                    AlarmClock.EXTRA_DAYS,
                    arrayListOf(
                        Calendar.MONDAY, Calendar.TUESDAY, Calendar.WEDNESDAY,
                        Calendar.THURSDAY, Calendar.FRIDAY,
                    ),
                )
                RepeatMode.ONCE -> Unit
            }
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        return try {
            context.startActivity(intent)
            null
        } catch (e: ActivityNotFoundException) {
            "No system Clock app handles ACTION_SET_ALARM. Install or re-enable a Clock app."
        } catch (e: SecurityException) {
            // T262-1: deskclock's HandleSetApiCalls is permission-protected
            // (com.android.alarm.permission.SET_ALARM, normal protection).
            // If this fires the manifest declaration regressed.
            "System Clock refused the alarm — SET_ALARM permission missing or revoked: ${e.message}"
        } catch (e: Throwable) {
            "System Clock dispatch failed: ${e.message ?: e.javaClass.simpleName}"
        }
    }

    private fun handleTimer(args: OffloadArgs): NativeOffloadResult {
        // Duration can come from --duration (apple-alarm parity, accepts
        // shorthand) or as a legacy positional second arg (`timer 300`).
        val durationStr = args.get("duration") ?: args.positional.getOrNull(1)
            ?: return NativeOffloadResult(
                2,
                "android-alarm timer: --duration <seconds|5m|1h> is required\n",
            )
        val secs = parseDuration(durationStr)
            ?: return NativeOffloadResult(
                2,
                "android-alarm: invalid duration '$durationStr' (use seconds or shorthand 30s, 5m, 1h, 2d)\n",
            )
        if (secs <= 0) return NativeOffloadResult(2, "android-alarm: duration must be positive\n")
        val label = args.get("label") ?: "Timer"
        // T266b: single-source timer via the system Clock app
        // (AlarmClock.ACTION_SET_TIMER, API 19+). Same rationale as T266 set:
        // the previous internal AlarmManager.setExactAndAllowWhileIdle path
        // produced timers that fired only inside Minis with no Clock UI to
        // pause/resume/dismiss. Pixel/Google Clock honors EXTRA_SKIP_UI for
        // SET_TIMER too — verified via pm resolve-activity returning
        // com.google.android.deskclock/.HandleSetApiCalls on Pixel 4a + 6.
        val systemErr = startSystemTimer(label, secs)
        if (systemErr != null) {
            val body = JSONObject().put("error", "system_clock_unavailable")
                .put("message", systemErr)
                .put("hint", "Re-enable or install a Clock app (e.g. Google Clock) and grant the SET_ALARM permission.")
                .toString()
            AppLogger.warning(TAG, "timer: system Clock dispatch failed — $systemErr")
            return NativeOffloadResult(1, OffloadOutput.formatBody(body, args) + "\n")
        }
        val data = buildTimerEnvelope(label, secs)
            .put("system_alarm", "ok")
        AppLogger.info(TAG, "timer: duration=${secs}s label='$label' → system Clock")
        return emitEnvelope("timer", data, args)
    }

    /**
     * T266b: dispatch [AlarmClock.ACTION_SET_TIMER] with EXTRA_LENGTH +
     * EXTRA_MESSAGE + EXTRA_SKIP_UI=true. Returns null on success, or a
     * human-readable error string on failure. Mirrors
     * [scheduleViaSystemClock] for alarms.
     */
    private fun startSystemTimer(label: String, durationSec: Int): String? {
        val intent = Intent(AlarmClock.ACTION_SET_TIMER).apply {
            putExtra(AlarmClock.EXTRA_LENGTH, durationSec)
            putExtra(AlarmClock.EXTRA_MESSAGE, label)
            putExtra(AlarmClock.EXTRA_SKIP_UI, true)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        return try {
            context.startActivity(intent)
            null
        } catch (e: ActivityNotFoundException) {
            "No system Clock app handles ACTION_SET_TIMER. Install or re-enable a Clock app."
        } catch (e: SecurityException) {
            "System Clock refused the timer — SET_ALARM permission missing or revoked: ${e.message}"
        } catch (e: Throwable) {
            "System Clock dispatch failed: ${e.message ?: e.javaClass.simpleName}"
        }
    }

    /**
     * T268: list / cancel / open all converge on the same action — launch
     * the system Clock app's alarm view via [AlarmClock.ACTION_SHOW_ALARMS].
     * The system Clock does not expose a stable query API for third-party
     * inspection (`AlarmClock.ACTION_DISMISS_ALARM` only targets the
     * currently-ringing alarm), so the agent cannot enumerate or
     * selectively cancel; the user manages everything from the Clock UI.
     * `list` and `cancel` are kept as aliases of `open` purely so older
     * prompts and shell scripts don't break — they print the same body.
     */
    private fun handleOpen(args: OffloadArgs): NativeOffloadResult {
        val intent = Intent(AlarmClock.ACTION_SHOW_ALARMS)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return try {
            context.startActivity(intent)
            AppLogger.info(TAG, "open: launched system Clock SHOW_ALARMS")
            val data = JSONObject()
                .put("opened", true)
                .put("hint", "System Clock launched. Tell the user to view, edit, or cancel alarms in the Clock app's Alarms tab (or Timers tab for timers). Minis cannot enumerate or cancel alarms programmatically — Android's Clock API is fire-and-forget.")
            emitEnvelope("open", data, args)
        } catch (e: ActivityNotFoundException) {
            val body = JSONObject().put("error", "no_clock_app")
                .put("message", "No Clock app handles ACTION_SHOW_ALARMS. Install or re-enable a Clock app to manage alarms.")
                .toString()
            NativeOffloadResult(1, OffloadOutput.formatBody(body, args) + "\n")
        } catch (e: Throwable) {
            val body = JSONObject().put("error", "open_failed")
                .put("message", e.message ?: e.javaClass.simpleName)
                .toString()
            NativeOffloadResult(1, OffloadOutput.formatBody(body, args) + "\n")
        }
    }

    private fun parseHHMM(s: String): Pair<Int, Int>? {
        val parts = s.split(":")
        if (parts.size != 2) return null
        val h = parts[0].toIntOrNull() ?: return null
        val m = parts[1].toIntOrNull() ?: return null
        if (h !in 0..23 || m !in 0..59) return null
        return h to m
    }

    /**
     * Accept HH:MM (parsed against today's calendar) or ISO 8601 like
     * "2026-02-25T14:00", "2026-02-25T14:00:00Z". Both forms collapse to the
     * (hour, minute) pair the manager expects — manager will roll forward to
     * the next day if HH:MM is already past. Mirrors apple-alarm parseTime.
     */
    private fun parseTimeArg(s: String): Pair<Int, Int>? {
        parseHHMM(s)?.let { return it }
        // Try a few common ISO 8601 forms.
        val patterns = listOf(
            "yyyy-MM-dd'T'HH:mm:ss'Z'",
            "yyyy-MM-dd'T'HH:mm:ssXXX",
            "yyyy-MM-dd'T'HH:mm:ss",
            "yyyy-MM-dd'T'HH:mm",
        )
        for (pat in patterns) {
            val date = runCatching {
                val sdf = SimpleDateFormat(pat, Locale.US)
                if (pat.endsWith("'Z'")) sdf.timeZone = TimeZone.getTimeZone("UTC")
                sdf.parse(s)
            }.getOrNull() ?: continue
            val cal = Calendar.getInstance().apply { time = date }
            return cal.get(Calendar.HOUR_OF_DAY) to cal.get(Calendar.MINUTE)
        }
        return null
    }

    /**
     * Mirror apple-alarm `parseDuration`: accept raw seconds or shorthand
     * 30s / 5m / 1h / 2d. Returns total seconds, or null on bad input.
     */
    private fun parseDuration(s: String): Int? {
        val trimmed = s.trim().lowercase()
        if (trimmed.isEmpty()) return null
        trimmed.toIntOrNull()?.let { return it }
        if (trimmed.length < 2) return null
        val unit = trimmed.last()
        val num = trimmed.dropLast(1).toIntOrNull() ?: return null
        return when (unit) {
            's' -> num
            'm' -> num * 60
            'h' -> num * 3600
            'd' -> num * 86400
            else -> null
        }
    }

    /**
     * Format a Date as ISO 8601 `yyyy-MM-dd'T'HH:mm:ssXXX` to match
     * apple-alarm `noff_format_date`. Stable across locales.
     */
    private fun formatIso(date: Date): String {
        val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.US)
        return sdf.format(date)
    }

    private fun buildSetEnvelope(
        label: String,
        hour: Int,
        minute: Int,
        mode: RepeatMode,
    ): JSONObject {
        // T266: id no longer threaded through — system Clock owns the
        // identity and there's no Minis-side equivalent to surface. Compute
        // the actual fire time (today vs tomorrow roll-forward) so the
        // model sees a real timestamp not just HH:MM.
        val cal = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, hour)
            set(Calendar.MINUTE, minute)
            set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
            if (before(Calendar.getInstance())) add(Calendar.DAY_OF_YEAR, 1)
        }
        return JSONObject().apply {
            put("label", label)
            put("time", formatIso(cal.time))
            put("hour", hour)
            put("minute", minute)
            put("repeat", mode.name)
            put("view_url", VIEW_URL)
            put("hint", "Alarm saved to the system Clock app. Open the Clock app, or $VIEW_URL inside Minis, to view or cancel.")
        }
    }

    private fun buildTimerEnvelope(label: String, durationSec: Int): JSONObject {
        // T266b: id no longer threaded through — system Clock owns the
        // identity. fires_at remains useful so the agent can describe
        // when the timer will go off.
        val firesAt = Date(System.currentTimeMillis() + durationSec * 1000L)
        return JSONObject().apply {
            put("label", label)
            put("duration_seconds", durationSec)
            put("fires_at", formatIso(firesAt))
            put("view_url", VIEW_URL)
            put("hint", "Timer started in the system Clock app. Open the Clock app's Timer tab, or $VIEW_URL inside Minis, to view or stop.")
        }
    }

    /**
     * Emit an apple-alarm-style envelope: `{ok:true, tool, action, data}`.
     * formatBody handles --compact / -q so nothing extra to do here.
     * OEM hint is appended as a note string on `data` so it survives quiet
     * extraction (which keeps only `data`).
     */
    private fun emitEnvelope(action: String, data: JSONObject, args: OffloadArgs): NativeOffloadResult {
        val needsHint = OsCompat.isXiaomi || OsCompat.isHuawei ||
            Build.MANUFACTURER.equals("OPPO", ignoreCase = true) ||
            Build.MANUFACTURER.equals("OnePlus", ignoreCase = true) ||
            Build.MANUFACTURER.equals("Vivo", ignoreCase = true)
        if (needsHint && (action == "set" || action == "timer")) {
            data.put(
                "oem_hint",
                "${OsCompat.oemLabel()} aggressively kills background alarms. Please enable Autostart and disable battery optimization for Minis in system settings to keep this alarm reliable.",
            )
        }
        val envelope = JSONObject()
            .put("ok", true)
            .put("tool", "android-alarm")
            .put("action", action)
            .put("data", data)
        return NativeOffloadResult(0, OffloadOutput.formatBody(envelope.toString(2), args) + "\n")
    }

    private fun wrap(text: String, args: OffloadArgs): NativeOffloadResult {
        val err = text.startsWith("Error")
        val formatted = OffloadOutput.formatBody(text.trimEnd('\n'), args)
        return NativeOffloadResult(if (err) 1 else 0, "$formatted\n")
    }

    companion object {
        private const val TAG = "AlarmOffload"
        private const val VIEW_URL = "minis://views/alarm"
        private const val HELP = """android-alarm — schedule alarms and timers (mirrors apple-alarm)

Usage:
  android-alarm set --time <HH:MM|ISO> [--label L] [--repeat ONCE|DAILY|WEEKDAYS]
  android-alarm timer --duration <seconds|5m|1h> [--label L]
  android-alarm open

T266+T268: alarms and timers are written into the user's Android
system Clock app (single source of truth). The agent cannot
enumerate or selectively cancel alarms because the system Clock
does not expose a query API — instruct the user to view/edit/cancel
in the Clock app's Alarms or Timers tab. `android-alarm open`
launches Clock to that screen; `list` and `cancel` remain as aliases
that do the same thing.

Legacy aliases:
  android-alarm schedule <HH:MM> [--label L] [--repeat ...]
  android-alarm timer <seconds> [--label L]
  android-alarm list             (alias of open)
  android-alarm cancel ...       (alias of open)

Examples:
  android-alarm set --time 07:30 --label "Wake up" --repeat DAILY
  android-alarm set --time 2026-02-25T14:00
  android-alarm timer --duration 5m --label "Tea"
  android-alarm open

set/timer return JSON with `view_url: minis://views/alarm` and
`system_alarm: "ok"` on success.
"""
    }
}
