package com.openminis.app.sandbox.offload

import android.Manifest
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.provider.CalendarContract
import androidx.core.content.ContextCompat
import com.openminis.app.logging.AppLogger
import com.openminis.app.offload.OffloadPermissionManager
import com.openminis.app.sandbox.NativeOffloadHandler
import com.openminis.app.sandbox.NativeOffloadRequest
import com.openminis.app.sandbox.NativeOffloadResult
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone

/**
 * android-calendar — list, create, update, delete events; query free/busy.
 *
 * Mirrors apple-calendar (NativeOffloads/CalendarOffload.m) — same flag
 * names and subcommands so prompts and the agent loop are platform-
 * agnostic. Aliases are preserved for backwards compatibility with older
 * prompts (--max ↔ --limit, --description ↔ --notes).
 *
 * Usage:
 *   android-calendar list [--today | --days N | --start S --end E]
 *                          [--limit N] [--calendar NAME]
 *   android-calendar create --title T --start S [--end E]
 *                          [--notes N] [--location L] [--all-day]
 *                          [--alarm <minutes>] [--calendar NAME | --calendar-id ID]
 *   android-calendar update --id <event_id> [--title ...] [--start ...] [--end ...]
 *                          [--notes ...] [--location ...] [--alarm <minutes>]
 *                          [--calendar NAME | --calendar-id ID]
 *   android-calendar delete --id <event_id>
 *   android-calendar freebusy --start <ISO> --end <ISO>
 *   android-calendar calendars                List writable calendars
 */
class CalendarOffloadHandler(private val context: Context) : NativeOffloadHandler {
    override fun handle(request: NativeOffloadRequest): NativeOffloadResult {
        val args = OffloadArgs(request.argv.drop(1), booleanFlags = setOf("today", "all-day"))
        // [T-offload-defaults-batch-android] Help only on explicit
        // --help/-h; no subcommand defaults to `list` (resolveDateRange
        // already defaults to the last-24h..now window with no flags).
        if (args.hasFlag("h", "help")) {
            return NativeOffloadResult(0, HELP)
        }
        // T330: tri-state agent gate before any work.
        OffloadGate.enforce("calendar", "android-calendar", args, request)?.let { return it }

        return try {
            when (val sub = args.positional.firstOrNull() ?: "list") {
                "list" -> doList(args)
                "create" -> doCreate(args)
                "update" -> doUpdate(args)
                "delete" -> doDelete(args)
                "freebusy" -> doFreebusy(args)
                "calendars" -> doListCalendars(args)
                else -> NativeOffloadResult(2, "android-calendar: unknown subcommand '$sub'\n$HELP")
            }
        } catch (e: Throwable) {
            AppLogger.warning(TAG, "uncaught: ${e.message}")
            NativeOffloadResult(
                1,
                OffloadOutput.formatBody(JSONObject().put("error", "internal").put("message", e.message ?: "unknown").toString(), args) + "\n",
            )
        }
    }

    private fun hasRead() = ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CALENDAR) ==
        PackageManager.PERMISSION_GRANTED
    private fun hasWrite() = ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_CALENDAR) ==
        PackageManager.PERMISSION_GRANTED

    /**
     * Request one or more calendar permissions if not yet granted, blocking
     * the tool invocation until the user responds (or permanently denies).
     * Mirrors the location handler's pattern: system dialog → settings gate.
     * Returns null if permission ends up granted; otherwise a ready-to-return
     * error [NativeOffloadResult] describing why we gave up.
     */
    private fun ensurePermission(
        permissions: List<String>,
        satisfied: () -> Boolean,
        humanLabel: String,
        settingsId: String,
        args: OffloadArgs,
    ): NativeOffloadResult? {
        if (satisfied()) return null
        AppLogger.warning(TAG, "$humanLabel not granted — routing through permission flow")
        val result = runBlocking {
            var r = OffloadPermissionManager.requestAndroidPermission(permissions)
            if (r == OffloadPermissionManager.AndroidPermissionResult.DENIED &&
                OffloadPermissionManager.pollForPermissionGrant(satisfied)
            ) {
                AppLogger.info(TAG, "Calendar $humanLabel permission granted during post-DENY poll")
                r = OffloadPermissionManager.AndroidPermissionResult.GRANTED
            }
            if (r == OffloadPermissionManager.AndroidPermissionResult.DENIED) {
                r = OffloadPermissionManager.requestSettingsGate(
                    OffloadPermissionManager.SettingsGateRequest(
                        id = settingsId,
                        title = "Calendar permission needed",
                        message = "Minis needs $humanLabel permission to $humanLabel your calendar. Open Settings to allow it.",
                        settingsAction = android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                        requiresPackageUri = true,
                        positiveLabel = "Open Settings",
                    ),
                    check = { satisfied() },
                )
            }
            r
        }
        return when (result) {
            OffloadPermissionManager.AndroidPermissionResult.GRANTED -> null
            OffloadPermissionManager.AndroidPermissionResult.DENIED -> NativeOffloadResult(
                77,
                OffloadOutput.formatBody(
                    JSONObject()
                        .put("error", "permission_denied")
                        .put("message", "The user declined the $humanLabel permission.")
                        .toString(),
                    args,
                ) + "\n",
            )
            OffloadPermissionManager.AndroidPermissionResult.TIMEOUT -> NativeOffloadResult(
                77,
                OffloadOutput.formatBody(
                    JSONObject()
                        .put("error", "timeout")
                        .put("message", "Timed out waiting for the user to grant the $humanLabel permission.")
                        .toString(),
                    args,
                ) + "\n",
            )
        }
    }

    private fun doList(args: OffloadArgs): NativeOffloadResult {
        ensurePermission(
            permissions = listOf(Manifest.permission.READ_CALENDAR),
            satisfied = { hasRead() },
            humanLabel = "read",
            settingsId = Manifest.permission.READ_CALENDAR,
            args = args,
        )?.let { return it }

        val (startMs, endMs) = resolveDateRange(args)
            ?: return NativeOffloadResult(
                2,
                "android-calendar list: invalid or missing date range. Use --today, --days N, or --start/--end (ISO 8601 or YYYY-MM-DD).\n",
            )
        // --limit is the apple-calendar name; --max kept as alias.
        val limit = args.getInt("limit") ?: args.getInt("max") ?: DEFAULT_LIMIT
        val calFilter = args.get("calendar")

        val projection = arrayOf(
            CalendarContract.Events._ID,
            CalendarContract.Events.TITLE,
            CalendarContract.Events.DTSTART,
            CalendarContract.Events.DTEND,
            CalendarContract.Events.EVENT_LOCATION,
            CalendarContract.Events.DESCRIPTION,
            CalendarContract.Events.ALL_DAY,
            CalendarContract.Events.CALENDAR_ID,
            CalendarContract.Events.CALENDAR_DISPLAY_NAME,
        )
        val selection = "${CalendarContract.Events.DTSTART} >= ? AND ${CalendarContract.Events.DTSTART} <= ?"
        val selArgs = arrayOf(startMs.toString(), endMs.toString())
        val sort = "${CalendarContract.Events.DTSTART} ASC"

        val cursor = try {
            context.contentResolver.query(
                CalendarContract.Events.CONTENT_URI, projection, selection, selArgs, sort,
            )
        } catch (e: SecurityException) {
            return NativeOffloadResult(77, providerBlockedJson("READ_CALENDAR", e, args))
        } catch (e: Throwable) {
            return NativeOffloadResult(1, providerErrorJson(e, args))
        } ?: return NativeOffloadResult(1, providerErrorJson(null, args))

        // Two-pass: gather all matches (so we can compute total_available
        // before truncating to --limit, matching apple-calendar's
        // _warning + total_available shape).
        val matches = JSONArray()
        cursor.use {
            while (it.moveToNext()) {
                val calName = it.getString(8) ?: ""
                if (calFilter != null && !calName.contains(calFilter, ignoreCase = true)) continue
                matches.put(
                    JSONObject()
                        .put("id", it.getLong(0))
                        .put("title", it.getString(1) ?: "")
                        .put("start", formatIso(it.getLong(2)))
                        .put("start_ms", it.getLong(2))
                        .put("end", formatIso(it.getLong(3)))
                        .put("end_ms", it.getLong(3))
                        .put("location", it.getString(4) ?: "")
                        .put("notes", it.getString(5) ?: "")
                        .put("description", it.getString(5) ?: "")
                        .put("all_day", it.getInt(6) == 1)
                        .put("calendar_id", it.getLong(7))
                        .put("calendar", calName),
                )
            }
        }

        val total = matches.length()
        val truncated = total > limit
        val events = JSONArray()
        for (i in 0 until minOf(total, limit)) events.put(matches.getJSONObject(i))

        if (events.length() == 0) {
            // Check whether the user actually has any writable calendar account —
            // if not, the "no events" answer is misleading. Report the real reason.
            val accounts = listWritableCalendars()
            if (accounts.length() == 0) {
                return NativeOffloadResult(
                    0,
                    OffloadOutput.formatBody(
                        JSONObject()
                            .put("events", JSONArray())
                            .put("warning", "calendar_no_account")
                            .put("message", "No calendar account is configured on this device. Ask the user to add a Google or Exchange account in system Settings → Accounts.")
                            .toString(),
                        args,
                    ) + "\n",
                )
            }
        }
        val data = JSONObject()
            .put("events", events)
            .put("range", JSONObject().put("start", formatIso(startMs)).put("end", formatIso(endMs)))
            .put("count", events.length())
        if (truncated) {
            data.put("_warning", "Results truncated by --limit. Returned $limit of $total total records. Use a larger --limit to retrieve more data.")
            data.put("total_available", total)
        }
        return NativeOffloadResult(0, OffloadOutput.formatBody(data.toString(2), args) + "\n")
    }

    private fun doCreate(args: OffloadArgs): NativeOffloadResult {
        ensurePermission(
            permissions = listOf(Manifest.permission.WRITE_CALENDAR, Manifest.permission.READ_CALENDAR),
            satisfied = { hasWrite() },
            humanLabel = "write",
            settingsId = Manifest.permission.WRITE_CALENDAR,
            args = args,
        )?.let { return it }

        val title = args.get("title")
            ?: return NativeOffloadResult(2, "android-calendar create: --title is required\n")
        val startStr = args.get("start")
            ?: return NativeOffloadResult(2, "android-calendar create: --start is required\n")
        val startMs = parseDate(startStr)
            ?: return NativeOffloadResult(2, "android-calendar: invalid --start '$startStr'\n")
        val endMs = args.get("end")?.let { parseDate(it) } ?: (startMs + 60 * 60 * 1000L)
        // Notes — apple-calendar uses --notes; --description kept as alias.
        val notes = args.get("notes") ?: args.get("description")
        val alarmMinutes = args.getInt("alarm")

        val calendarId = resolveCalendarId(args) ?: return missingCalendarError(args)

        val values = ContentValues().apply {
            put(CalendarContract.Events.CALENDAR_ID, calendarId)
            put(CalendarContract.Events.TITLE, title)
            put(CalendarContract.Events.DTSTART, startMs)
            put(CalendarContract.Events.DTEND, endMs)
            put(CalendarContract.Events.EVENT_TIMEZONE, TimeZone.getDefault().id)
            notes?.let { put(CalendarContract.Events.DESCRIPTION, it) }
            args.get("location")?.let { put(CalendarContract.Events.EVENT_LOCATION, it) }
            if (args.hasFlag("all-day")) put(CalendarContract.Events.ALL_DAY, 1)
            // ALL_DAY events must have UTC midnight + EVENT_TIMEZONE = "UTC"
            // per CalendarContract docs, otherwise Google Calendar rejects.
            if (args.hasFlag("all-day")) put(CalendarContract.Events.EVENT_TIMEZONE, "UTC")
        }

        return try {
            val uri = context.contentResolver.insert(CalendarContract.Events.CONTENT_URI, values)
            if (uri == null) {
                NativeOffloadResult(1, OffloadOutput.formatBody(JSONObject().put("error", "insert_failed").put("message", "ContentResolver.insert returned null").toString(), args) + "\n")
            } else {
                val eventId = uri.lastPathSegment?.toLongOrNull()
                if (eventId != null && alarmMinutes != null && alarmMinutes >= 0) {
                    insertReminder(eventId, alarmMinutes)
                }
                AppLogger.info(TAG, "create: id=$eventId title='$title' alarm=$alarmMinutes")
                val data = JSONObject()
                    .put("id", eventId ?: -1L)
                    .put("title", title)
                    .put("start", formatIso(startMs))
                    .put("end", formatIso(endMs))
                    .put("calendar_id", calendarId)
                if (notes != null) data.put("notes", notes)
                if (alarmMinutes != null && alarmMinutes >= 0) data.put("alarm_minutes_before", alarmMinutes)
                NativeOffloadResult(0, OffloadOutput.formatBody(data.toString(2), args) + "\n")
            }
        } catch (e: SecurityException) {
            NativeOffloadResult(77, providerBlockedJson("WRITE_CALENDAR", e, args))
        } catch (e: Throwable) {
            NativeOffloadResult(1, providerErrorJson(e, args))
        }
    }

    // ── update ──────────────────────────────────────────────────────────

    private fun doUpdate(args: OffloadArgs): NativeOffloadResult {
        ensurePermission(
            permissions = listOf(Manifest.permission.WRITE_CALENDAR, Manifest.permission.READ_CALENDAR),
            satisfied = { hasWrite() },
            humanLabel = "write",
            settingsId = Manifest.permission.WRITE_CALENDAR,
            args = args,
        )?.let { return it }

        val id = args.getLong("id")
            ?: return NativeOffloadResult(2, "android-calendar update: --id <event_id> is required\n")

        // Build a sparse ContentValues with only the fields the caller supplied.
        val values = ContentValues()
        args.get("title")?.let { values.put(CalendarContract.Events.TITLE, it) }
        args.get("start")?.let { s ->
            val ms = parseDate(s) ?: return NativeOffloadResult(2, "android-calendar update: invalid --start '$s'\n")
            values.put(CalendarContract.Events.DTSTART, ms)
        }
        args.get("end")?.let { e ->
            val ms = parseDate(e) ?: return NativeOffloadResult(2, "android-calendar update: invalid --end '$e'\n")
            values.put(CalendarContract.Events.DTEND, ms)
        }
        args.get("location")?.let { values.put(CalendarContract.Events.EVENT_LOCATION, it) }
        (args.get("notes") ?: args.get("description"))?.let {
            values.put(CalendarContract.Events.DESCRIPTION, it)
        }
        // --calendar / --calendar-id: move event to a different calendar.
        // resolveCalendarIdOptional lets either flag be absent without falling
        // back to pickWritableCalendar (which would mean "always move" — not
        // what update should do).
        resolveCalendarIdOptional(args)?.let { values.put(CalendarContract.Events.CALENDAR_ID, it) }
        val alarmMinutes = args.getInt("alarm")

        if (values.size() == 0 && alarmMinutes == null) {
            return NativeOffloadResult(2, "android-calendar update: nothing to update — supply at least one field flag\n")
        }

        return try {
            val updated = if (values.size() > 0) {
                val uri = CalendarContract.Events.CONTENT_URI.buildUpon()
                    .appendPath(id.toString()).build()
                context.contentResolver.update(uri, values, null, null)
            } else 0
            if (alarmMinutes != null && alarmMinutes >= 0) {
                replaceReminder(id, alarmMinutes)
            }
            AppLogger.info(TAG, "update: id=$id rows=$updated alarm=$alarmMinutes")
            val data = JSONObject()
                .put("id", id)
                .put("updated", updated > 0 || alarmMinutes != null)
                .put("rows", updated)
            if (alarmMinutes != null && alarmMinutes >= 0) data.put("alarm_minutes_before", alarmMinutes)
            NativeOffloadResult(0, OffloadOutput.formatBody(data.toString(2), args) + "\n")
        } catch (e: SecurityException) {
            NativeOffloadResult(77, providerBlockedJson("WRITE_CALENDAR", e, args))
        } catch (e: Throwable) {
            NativeOffloadResult(1, providerErrorJson(e, args))
        }
    }

    // ── delete ──────────────────────────────────────────────────────────

    private fun doDelete(args: OffloadArgs): NativeOffloadResult {
        ensurePermission(
            permissions = listOf(Manifest.permission.WRITE_CALENDAR),
            satisfied = { hasWrite() },
            humanLabel = "write",
            settingsId = Manifest.permission.WRITE_CALENDAR,
            args = args,
        )?.let { return it }

        val id = args.getLong("id")
            ?: return NativeOffloadResult(2, "android-calendar delete: --id <event_id> is required\n")

        return try {
            val uri = CalendarContract.Events.CONTENT_URI.buildUpon()
                .appendPath(id.toString()).build()
            val rows = context.contentResolver.delete(uri, null, null)
            if (rows <= 0) {
                val body = JSONObject().put("error", "not_found")
                    .put("id", id)
                    .put("message", "No event with id=$id (already deleted, or not visible to this app).")
                    .toString()
                return NativeOffloadResult(1, OffloadOutput.formatBody(body, args) + "\n")
            }
            AppLogger.info(TAG, "delete: id=$id rows=$rows")
            val data = JSONObject().put("id", id).put("deleted", true).put("rows", rows)
            NativeOffloadResult(0, OffloadOutput.formatBody(data.toString(2), args) + "\n")
        } catch (e: SecurityException) {
            NativeOffloadResult(77, providerBlockedJson("WRITE_CALENDAR", e, args))
        } catch (e: Throwable) {
            NativeOffloadResult(1, providerErrorJson(e, args))
        }
    }

    // ── freebusy ────────────────────────────────────────────────────────

    private fun doFreebusy(args: OffloadArgs): NativeOffloadResult {
        ensurePermission(
            permissions = listOf(Manifest.permission.READ_CALENDAR),
            satisfied = { hasRead() },
            humanLabel = "read",
            settingsId = Manifest.permission.READ_CALENDAR,
            args = args,
        )?.let { return it }

        val startStr = args.get("start") ?: return NativeOffloadResult(2, "android-calendar freebusy: --start is required\n")
        val endStr = args.get("end") ?: return NativeOffloadResult(2, "android-calendar freebusy: --end is required\n")
        val startMs = parseDate(startStr) ?: return NativeOffloadResult(2, "android-calendar: invalid --start '$startStr'\n")
        val endMs = parseDate(endStr) ?: return NativeOffloadResult(2, "android-calendar: invalid --end '$endStr'\n")
        if (endMs <= startMs) {
            return NativeOffloadResult(2, "android-calendar freebusy: --end must be after --start\n")
        }

        val projection = arrayOf(
            CalendarContract.Events.TITLE,
            CalendarContract.Events.DTSTART,
            CalendarContract.Events.DTEND,
            CalendarContract.Events.ALL_DAY,
        )
        val selection = "${CalendarContract.Events.DTSTART} < ? AND ${CalendarContract.Events.DTEND} > ?"
        val selArgs = arrayOf(endMs.toString(), startMs.toString())
        val sort = "${CalendarContract.Events.DTSTART} ASC"

        val cursor = try {
            context.contentResolver.query(CalendarContract.Events.CONTENT_URI, projection, selection, selArgs, sort)
        } catch (e: SecurityException) {
            return NativeOffloadResult(77, providerBlockedJson("READ_CALENDAR", e, args))
        } catch (e: Throwable) {
            return NativeOffloadResult(1, providerErrorJson(e, args))
        } ?: return NativeOffloadResult(1, providerErrorJson(null, args))

        val busy = JSONArray()
        cursor.use {
            while (it.moveToNext()) {
                val isAllDay = it.getInt(3) == 1
                if (isAllDay) continue // skip all-day per apple-calendar
                busy.put(
                    JSONObject()
                        .put("title", it.getString(0) ?: "")
                        .put("start", formatIso(it.getLong(1)))
                        .put("end", formatIso(it.getLong(2))),
                )
            }
        }

        // Compute free slots in [startMs, endMs] from the busy list.
        // The busy list is already sorted by start; we still cap each busy
        // segment to the query window so an event that straddles the window
        // doesn't poison the cursor walk.
        val free = JSONArray()
        var cursorMs = startMs
        for (i in 0 until busy.length()) {
            val b = busy.getJSONObject(i)
            val bStart = parseDate(b.getString("start")) ?: continue
            val bEnd = parseDate(b.getString("end")) ?: continue
            val segStart = maxOf(bStart, startMs)
            val segEnd = minOf(bEnd, endMs)
            if (cursorMs < segStart) {
                free.put(JSONObject().put("start", formatIso(cursorMs)).put("end", formatIso(segStart)))
            }
            if (segEnd > cursorMs) cursorMs = segEnd
        }
        if (cursorMs < endMs) {
            free.put(JSONObject().put("start", formatIso(cursorMs)).put("end", formatIso(endMs)))
        }

        AppLogger.info(TAG, "freebusy: busy=${busy.length()} free=${free.length()}")
        val data = JSONObject().put("busy", busy).put("free", free)
        return NativeOffloadResult(0, OffloadOutput.formatBody(data.toString(2), args) + "\n")
    }

    // ── Reminders helpers (calendar alarms) ─────────────────────────────

    /**
     * Insert a single reminder row for [eventId] at [minutesBefore]. Mirrors
     * iOS EKAlarm.alarmWithRelativeOffset(-N * 60). Reminders.METHOD_ALERT
     * is the standard reminder type; ContentResolver.insert returns null on
     * provider failure, which we silently swallow — the event itself is
     * already created/updated.
     */
    private fun insertReminder(eventId: Long, minutesBefore: Int) {
        val values = ContentValues().apply {
            put(CalendarContract.Reminders.EVENT_ID, eventId)
            put(CalendarContract.Reminders.MINUTES, minutesBefore)
            put(CalendarContract.Reminders.METHOD, CalendarContract.Reminders.METHOD_ALERT)
        }
        try {
            context.contentResolver.insert(CalendarContract.Reminders.CONTENT_URI, values)
        } catch (e: Throwable) {
            AppLogger.warning(TAG, "insertReminder failed for event=$eventId: ${e.message}")
        }
    }

    /** Remove existing reminders for [eventId] then insert one at [minutesBefore]. */
    private fun replaceReminder(eventId: Long, minutesBefore: Int) {
        try {
            context.contentResolver.delete(
                CalendarContract.Reminders.CONTENT_URI,
                "${CalendarContract.Reminders.EVENT_ID} = ?",
                arrayOf(eventId.toString()),
            )
        } catch (e: Throwable) {
            AppLogger.warning(TAG, "replaceReminder delete failed for event=$eventId: ${e.message}")
        }
        insertReminder(eventId, minutesBefore)
    }

    private fun doListCalendars(args: OffloadArgs): NativeOffloadResult {
        ensurePermission(
            permissions = listOf(Manifest.permission.READ_CALENDAR),
            satisfied = { hasRead() },
            humanLabel = "read",
            settingsId = Manifest.permission.READ_CALENDAR,
            args = args,
        )?.let { return it }
        val arr = listWritableCalendars()
        return NativeOffloadResult(0, OffloadOutput.formatBody(arr.toString(2), args) + "\n")
    }

    // ── Range / calendar resolution ─────────────────────────────────────

    /**
     * Mirror apple-calendar resolve_date_range: --today (today only, [00:00,
     * +24h)) → --days N (last N days through now, with start at 00:00) →
     * --start/--end (explicit, defaults to last 24h on either side). Returns
     * null only when --start/--end are supplied but unparseable.
     */
    private fun resolveDateRange(args: OffloadArgs): Pair<Long, Long>? {
        val now = System.currentTimeMillis()
        if (args.hasFlag("today")) {
            val cal = Calendar.getInstance().apply {
                set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0)
                set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
            }
            val s = cal.timeInMillis
            return s to (s + 24 * 60 * 60 * 1000L)
        }
        args.getInt("days")?.let { days ->
            val n = if (days <= 0) 7 else days
            val cal = Calendar.getInstance().apply {
                timeInMillis = now - n * 24 * 60 * 60 * 1000L
                set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0)
                set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
            }
            return cal.timeInMillis to now
        }
        val startStr = args.get("start")
        val endStr = args.get("end")
        val startMs = if (startStr != null) parseDate(startStr) ?: return null
                      else now - 24 * 60 * 60 * 1000L
        val endMs = if (endStr != null) parseDate(endStr) ?: return null
                    else now
        // EventStore predicates don't tolerate start > end on iOS; mirror that.
        return if (startMs > endMs) endMs to startMs else startMs to endMs
    }

    /**
     * Resolve the target calendar for create: --calendar-id wins, then a
     * --calendar name lookup (case-insensitive contains, mirrors iOS), then
     * the auto-pick heuristic. Returns null only when none of these apply
     * (no writable calendar at all).
     */
    private fun resolveCalendarId(args: OffloadArgs): Long? {
        args.getLong("calendar-id")?.let { return it }
        args.get("calendar")?.let { name ->
            val cals = listWritableCalendars()
            for (i in 0 until cals.length()) {
                val c = cals.getJSONObject(i)
                if (c.optString("display_name").contains(name, ignoreCase = true)) {
                    return c.optLong("id", -1L).takeIf { it > 0 }
                }
            }
            // Named calendar not found → fall through to auto-pick rather than fail
            // hard, matching apple-calendar's silent fallback.
            AppLogger.warning(TAG, "--calendar '$name' not matched; falling back to auto-pick")
        }
        return pickWritableCalendar()
    }

    /** Like [resolveCalendarId] but returns null when no flag was supplied
     *  at all (used by update so absence of the flag doesn't trigger a move). */
    private fun resolveCalendarIdOptional(args: OffloadArgs): Long? {
        if (args.get("calendar-id") == null && args.get("calendar") == null) return null
        return resolveCalendarId(args)
    }

    private fun missingCalendarError(args: OffloadArgs): NativeOffloadResult =
        NativeOffloadResult(
            1,
            OffloadOutput.formatBody(
                JSONObject()
                    .put("error", "calendar_no_account")
                    .put("message", "No writable calendar found. Ask the user to add a Google, Exchange, or local calendar account, or pass --calendar <name> / --calendar-id <id>. Run `android-calendar calendars` to list available calendars.")
                    .toString(),
                args,
            ) + "\n",
        )

    /** ISO 8601 with offset (e.g. 2026-04-26T13:51:00+08:00). Matches
     *  apple-calendar noff_format_date so cross-platform consumers see
     *  identical strings. */
    private fun formatIso(ms: Long): String {
        val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.US)
        return sdf.format(java.util.Date(ms))
    }

    // ── Calendar account selection ───────────────────────────────────────

    /**
     * Enumerate writable calendars (CALENDAR_ACCESS_LEVEL >= 500 = OWNER/CONTRIBUTOR).
     * Used by `create` for pick-best and by `calendars` subcommand for debugging.
     */
    private fun listWritableCalendars(): JSONArray {
        val projection = arrayOf(
            CalendarContract.Calendars._ID,
            CalendarContract.Calendars.CALENDAR_DISPLAY_NAME,
            CalendarContract.Calendars.ACCOUNT_NAME,
            CalendarContract.Calendars.ACCOUNT_TYPE,
            CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL,
            CalendarContract.Calendars.IS_PRIMARY,
        )
        val arr = JSONArray()
        try {
            context.contentResolver.query(
                CalendarContract.Calendars.CONTENT_URI,
                projection,
                "${CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL} >= ?",
                arrayOf(CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR.toString()),
                null,
            )?.use { c ->
                while (c.moveToNext()) {
                    arr.put(
                        JSONObject()
                            .put("id", c.getLong(0))
                            .put("display_name", c.getString(1) ?: "")
                            .put("account_name", c.getString(2) ?: "")
                            .put("account_type", c.getString(3) ?: "")
                            .put("access_level", c.getInt(4))
                            .put("is_primary", c.getInt(5) == 1),
                    )
                }
            }
        } catch (e: Throwable) {
            AppLogger.warning(TAG, "listWritableCalendars: ${e.message}")
        }
        return arr
    }

    /**
     * Pick the best calendar for new events:
     *   1. IS_PRIMARY=1 on a com.google account (avoids Samsung-Calendar-only inserts on One UI)
     *   2. Any com.google account
     *   3. Any IS_PRIMARY=1
     *   4. First writable calendar
     */
    private fun pickWritableCalendar(): Long? {
        val cals = listWritableCalendars()
        if (cals.length() == 0) return null
        fun score(obj: JSONObject): Int {
            var s = 0
            if (obj.optString("account_type") == "com.google") s += 100
            if (obj.optBoolean("is_primary")) s += 50
            // Prefer owner over contributor
            if (obj.optInt("access_level") >= CalendarContract.Calendars.CAL_ACCESS_OWNER) s += 10
            return s
        }
        var bestIdx = 0
        var bestScore = Int.MIN_VALUE
        for (i in 0 until cals.length()) {
            val s = score(cals.getJSONObject(i))
            if (s > bestScore) { bestScore = s; bestIdx = i }
        }
        return cals.getJSONObject(bestIdx).optLong("id", -1L).takeIf { it > 0 }
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    private fun providerBlockedJson(perm: String, e: SecurityException, args: OffloadArgs): String {
        val body = JSONObject().put("error", "provider_blocked")
            .put("message", "$perm is granted but the calendar provider refused the query (likely an OEM privacy layer like MIUI 'Other Permissions'). Ask the user to open app info and allow calendar access there. Underlying: ${e.message}")
            .toString()
        return OffloadOutput.formatBody(body, args) + "\n"
    }

    private fun providerErrorJson(e: Throwable?, args: OffloadArgs): String {
        val body = JSONObject().put("error", "provider_error")
            .put("message", e?.message ?: "Calendar provider failed or missing on this device.")
            .toString()
        return OffloadOutput.formatBody(body, args) + "\n"
    }

    private fun parseDate(s: String): Long? {
        // Relative offsets (apple-calendar parity): "-7d", "-2h", "+30m".
        val rel = Regex("""^([+-]?)(\d+)([dhm])$""").matchEntire(s.trim())
        if (rel != null) {
            val sign = if (rel.groupValues[1] == "-") -1L else 1L
            val n = rel.groupValues[2].toLong()
            val unitMs = when (rel.groupValues[3]) {
                "d" -> 24 * 60 * 60 * 1000L
                "h" -> 60 * 60 * 1000L
                "m" -> 60 * 1000L
                else -> return null
            }
            return System.currentTimeMillis() + sign * n * unitMs
        }
        val formats = listOf(
            "yyyy-MM-dd'T'HH:mm:ssXXX",
            "yyyy-MM-dd'T'HH:mm:ss'Z'",
            "yyyy-MM-dd'T'HH:mm:ss",
            "yyyy-MM-dd'T'HH:mm",
            "yyyy-MM-dd",
        )
        for (f in formats) {
            try {
                val sdf = SimpleDateFormat(f, Locale.US).apply {
                    timeZone = if (f.endsWith("'Z'")) TimeZone.getTimeZone("UTC") else TimeZone.getDefault()
                }
                return sdf.parse(s)?.time
            } catch (_: Throwable) {}
        }
        return null
    }

    companion object {
        private const val TAG = "CalendarOffload"
        private const val DEFAULT_LIMIT = 50
        private const val HELP = """android-calendar — list, create, update, delete events; query free/busy
                                    (mirrors apple-calendar)

Usage:
  android-calendar                  Same as `list` (default subcommand)
  android-calendar list [--today | --days N | --start S --end E]
                        [--limit N] [--calendar NAME]
  android-calendar create --title T --start S [--end E]
                         [--notes N] [--location L] [--all-day]
                         [--alarm <minutes>] [--calendar NAME | --calendar-id ID]
  android-calendar update --id <event_id> [--title ...] [--start ...] [--end ...]
                         [--notes ...] [--location ...] [--alarm <minutes>]
                         [--calendar NAME | --calendar-id ID]
  android-calendar delete --id <event_id>
  android-calendar freebusy --start <ISO> --end <ISO>
  android-calendar calendars             List writable calendars (debugging)

Dates accept ISO 8601 (YYYY-MM-DDThh:mm[:ss][Z|±HH:MM]) or relative
shorthand (-7d, -2h, +30m). YYYY-MM-DD is treated as midnight local.

Aliases for backwards compatibility:
  --max ↔ --limit
  --description ↔ --notes

Errors return JSON: {"error":"...","message":"..."}.
"""
    }
}
