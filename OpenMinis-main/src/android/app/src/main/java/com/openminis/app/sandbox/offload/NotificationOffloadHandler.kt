package com.openminis.app.sandbox.offload

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import android.service.notification.StatusBarNotification
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.openminis.app.R
import com.openminis.app.logging.AppLogger
import com.openminis.app.offload.MinisNotificationListenerService
import com.openminis.app.offload.OffloadPermissionManager
import com.openminis.app.offload.ScheduledNotificationReceiver
import com.openminis.app.offload.ScheduledNotificationStore
import com.openminis.app.sandbox.NativeOffloadHandler
import com.openminis.app.sandbox.NativeOffloadRequest
import com.openminis.app.sandbox.NativeOffloadResult
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

/**
 * android-notification — post, schedule, cancel, or read device notifications.
 *
 * Mirrors apple-notification (NativeOffloads/NotificationOffload.m): same
 * subcommands and same flag names so prompts and the agent loop are
 * platform-agnostic. Legacy aliases are preserved (`send` → `schedule`,
 * `list` for active notifications still works alongside `pending` for
 * not-yet-fired ones).
 *
 * Usage:
 *   android-notification schedule --title T --body B [--after SECS | --at ISO]
 *                                 (alias: send)
 *   android-notification list                  Active (already-delivered)
 *   android-notification pending               Scheduled but not yet fired
 *   android-notification cancel --id <id> | --all
 *   android-notification clear                 Clear all delivered (legacy)
 *   android-notification settings              Authorization status
 */
class NotificationOffloadHandler(private val context: Context) : NativeOffloadHandler {
    private val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    private val store = ScheduledNotificationStore(context)

    init { ensureChannel() }

    private fun ensureChannel() {
        if (channelCreated) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_DEFAULT)
            )
        }
        channelCreated = true
    }

    override fun handle(request: NativeOffloadRequest): NativeOffloadResult {
        val args = OffloadArgs(request.argv.drop(1), booleanFlags = setOf("all"))
        // [T-offload-defaults-batch-android] Help only on explicit
        // --help/-h; no subcommand defaults to `list`.
        if (args.hasFlag("h", "help")) {
            return NativeOffloadResult(0, HELP)
        }

        return try {
            when (val sub = args.positional.firstOrNull() ?: "list") {
                "send", "schedule" -> handleSend(args)
                "clear" -> {
                    nm.cancelAll()
                    NativeOffloadResult(0, OffloadOutput.formatBody("All notifications cleared.", args) + "\n")
                }
                "list" -> handleList(args)
                "pending" -> handlePending(args)
                "cancel" -> handleCancel(args)
                "settings" -> handleSettings(args)
                else -> NativeOffloadResult(2, "android-notification: unknown subcommand '$sub'\n$HELP")
            }
        } catch (e: SecurityException) {
            val body = JSONObject().put("error", "notification_denied")
                .put("message", "Notification post denied: ${e.message}")
                .toString()
            NativeOffloadResult(77, OffloadOutput.formatBody(body, args) + "\n")
        } catch (e: Throwable) {
            AppLogger.warning(TAG, "uncaught: ${e.message}")
            val body = JSONObject().put("error", "notification_failed")
                .put("message", e.message ?: "unknown").toString()
            NativeOffloadResult(1, OffloadOutput.formatBody(body, args) + "\n")
        }
    }

    // ── send ────────────────────────────────────────────────────────────────

    private fun handleSend(args: OffloadArgs): NativeOffloadResult {
        val title = args.get("title")
            ?: return NativeOffloadResult(2, "android-notification send: --title is required\n")

        // Android 13+: POST_NOTIFICATIONS is a runtime permission. First try
        // the system dialog; if the user has permanently denied it the dialog
        // won't re-appear, so fall back to an in-app "go to settings" gate
        // that polls for the grant.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            val result = runBlocking {
                var r = OffloadPermissionManager.requestAndroidPermission(
                    listOf(Manifest.permission.POST_NOTIFICATIONS)
                )
                val hasNotifPerm = {
                    ContextCompat.checkSelfPermission(
                        context, Manifest.permission.POST_NOTIFICATIONS
                    ) == PackageManager.PERMISSION_GRANTED
                }
                if (r == OffloadPermissionManager.AndroidPermissionResult.DENIED &&
                    OffloadPermissionManager.pollForPermissionGrant(hasNotifPerm)
                ) {
                    AppLogger.info(TAG, "Notification permission granted during post-DENY poll")
                    r = OffloadPermissionManager.AndroidPermissionResult.GRANTED
                }
                if (r == OffloadPermissionManager.AndroidPermissionResult.DENIED) {
                    // Dialog either won't re-appear or the user just tapped
                    // "Don't allow". Offer the in-app path to Settings.
                    r = OffloadPermissionManager.requestSettingsGate(
                        OffloadPermissionManager.SettingsGateRequest(
                            id = Manifest.permission.POST_NOTIFICATIONS,
                            title = "Notifications are off",
                            message = "Minis needs notification permission to send notifications. Open Settings to allow it.",
                            settingsAction = Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                            requiresPackageUri = true,
                            positiveLabel = "Open Settings",
                        ),
                        check = {
                            ContextCompat.checkSelfPermission(
                                context, Manifest.permission.POST_NOTIFICATIONS
                            ) == PackageManager.PERMISSION_GRANTED
                        },
                    )
                }
                r
            }
            when (result) {
                OffloadPermissionManager.AndroidPermissionResult.GRANTED -> {} // continue
                OffloadPermissionManager.AndroidPermissionResult.DENIED -> {
                    return NativeOffloadResult(
                        77,
                        OffloadOutput.formatBody(
                            JSONObject().put("error", "permission_denied")
                                .put("message", "The user declined the notification permission.")
                                .toString(),
                            args,
                        ) + "\n",
                    )
                }
                OffloadPermissionManager.AndroidPermissionResult.TIMEOUT -> {
                    return NativeOffloadResult(
                        77,
                        OffloadOutput.formatBody(
                            JSONObject().put("error", "timeout")
                                .put("message", "Timed out waiting for the user to respond to the notification permission prompt.")
                                .toString(),
                            args,
                        ) + "\n",
                    )
                }
            }
        }

        val body = args.get("body") ?: ""

        // Deferred path: --after <seconds> or --at <ISO> schedules the
        // notification via AlarmManager + ScheduledNotificationReceiver.
        // Mirrors apple-notification's UNTimeIntervalNotificationTrigger
        // (after) and UNCalendarNotificationTrigger (at) semantics.
        val afterSec = args.getInt("after")
        val atStr = args.get("at")
        if (afterSec != null || atStr != null) {
            return scheduleDeferred(title, body, afterSec, atStr, args)
        }

        // Immediate path (apple-notification has no equivalent — UN
        // schedules with trigger=nil deliver immediately, which is what
        // our pre-T58 `send` already does).
        val id = UUID.randomUUID().toString()
        val notifId = id.hashCode() and 0x7FFFFFFF
        val n = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            // [GH#116] Without this the notification is inert: tapping it did
            // nothing and setAutoCancel merely dismissed it. The deferred
            // (--after/--at) path has always set one; this immediate path
            // never did, so plain `send` — the most common invocation — was
            // the one broken shape. Same helper both sides, see its KDoc.
            .setContentIntent(ScheduledNotificationReceiver.contentIntentFor(context, notifId))
            .build()
        nm.notify(notifId, n)
        // The system fans the post to bound listeners on its own thread, so
        // an immediate follow-up `list` may miss this notification. Block
        // until our listener observes it (best-effort: 2s, only when the
        // listener is connected — otherwise `list` would have failed anyway).
        if (MinisNotificationListenerService.isEnabled(context) &&
            MinisNotificationListenerService.isConnected()
        ) {
            val seen = MinisNotificationListenerService.awaitPosted(context.packageName, notifId)
            if (!seen) {
                AppLogger.warning(TAG, "listener did not observe posted id=$notifId within timeout — list may not see it immediately")
            }
        }
        AppLogger.info(TAG, "send (immediate): id=$id title='$title'")
        val oemHint = if (OsCompat.isHuawei || OsCompat.isXiaomi) {
            "On ${OsCompat.oemLabel()}, banner notifications may be disabled by default — the user can enable them in Settings → Notifications for Minis."
        } else null
        val data = JSONObject()
            .put("id", id)
            .put("title", title)
            .put("body", body)
            .put("scheduled", "immediate")
        if (oemHint != null) data.put("oem_hint", oemHint)
        return NativeOffloadResult(0, OffloadOutput.formatBody(data.toString(2), args) + "\n")
    }

    // ── schedule (deferred) ─────────────────────────────────────────────

    /**
     * Schedule a notification to fire after [afterSec] seconds, or at
     * [atStr] (ISO 8601). Uses AlarmManager.setExactAndAllowWhileIdle so
     * the notification fires even in Doze; mirrors what AlarmOffloadManager
     * does for alarms. Persists the entry so `pending` and `cancel --id`
     * can find it.
     */
    private fun scheduleDeferred(
        title: String,
        body: String,
        afterSec: Int?,
        atStr: String?,
        args: OffloadArgs,
    ): NativeOffloadResult {
        val triggerAtMs: Long = when {
            afterSec != null -> {
                if (afterSec <= 0) return NativeOffloadResult(2, "android-notification: --after must be positive\n")
                System.currentTimeMillis() + afterSec * 1000L
            }
            atStr != null -> parseIso(atStr)
                ?: return NativeOffloadResult(2, "android-notification: invalid --at '$atStr' (use ISO 8601)\n")
            else -> return NativeOffloadResult(2, "android-notification: --after or --at is required\n")
        }
        if (triggerAtMs <= System.currentTimeMillis()) {
            return NativeOffloadResult(2, "android-notification: trigger time is in the past\n")
        }

        val id = args.get("id") ?: UUID.randomUUID().toString()
        val requestCode = id.hashCode() and 0x7FFFFFFF

        val intent = Intent(context, ScheduledNotificationReceiver::class.java).apply {
            putExtra(ScheduledNotificationReceiver.EXTRA_ID, id)
            putExtra(ScheduledNotificationReceiver.EXTRA_TITLE, title)
            putExtra(ScheduledNotificationReceiver.EXTRA_BODY, body)
        }
        val pi = PendingIntent.getBroadcast(
            context, requestCode, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        try {
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMs, pi)
        } catch (e: SecurityException) {
            val errBody = JSONObject().put("error", "exact_alarm_denied")
                .put("message", "Exact alarms blocked. On Android 14+ grant 'Alarms & reminders' in Settings; on Xiaomi/Huawei/Oppo/OnePlus/Vivo also enable autostart and disable battery optimization. Underlying: ${e.message}")
                .toString()
            return NativeOffloadResult(77, OffloadOutput.formatBody(errBody, args) + "\n")
        }

        val entry = JSONObject()
            .put("id", id)
            .put("title", title)
            .put("body", body)
            .put("trigger_at_ms", triggerAtMs)
            .put("trigger_at", formatIso(triggerAtMs))
            .put("request_code", requestCode)
        store.add(entry)

        AppLogger.info(TAG, "schedule: id=$id title='$title' trigger=${formatIso(triggerAtMs)}")
        val data = JSONObject()
            .put("id", id)
            .put("title", title)
            .put("body", body)
            .put("scheduled", formatIso(triggerAtMs))
        return NativeOffloadResult(0, OffloadOutput.formatBody(data.toString(2), args) + "\n")
    }

    // ── cancel ──────────────────────────────────────────────────────────

    /**
     * Cancel pending (scheduled-but-not-yet-fired) notifications. Mirrors
     * apple-notification cancel: --id removes one, --all removes all.
     * If the id matches an already-delivered notification (very common —
     * the model can't tell pending vs delivered), fall through to nm.cancel
     * on the integer hash so the user-visible notification disappears too.
     */
    private fun handleCancel(args: OffloadArgs): NativeOffloadResult {
        if (args.hasFlag("all")) {
            // Cancel pending: walk store, drop alarms, clear prefs.
            val all = store.loadAll()
            var n = 0
            for (i in 0 until all.length()) {
                val o = all.getJSONObject(i)
                cancelAlarmFor(o.optString("id"), o.optInt("request_code"))
                n++
            }
            store.clear()
            // Also clear delivered notifications (matches apple-notification
            // cancel --all semantics: nothing the user sees from us remains).
            nm.cancelAll()
            AppLogger.info(TAG, "cancel --all: pending=$n")
            val data = JSONObject().put("cancelled", "all").put("pending_cleared", n)
            return NativeOffloadResult(0, OffloadOutput.formatBody(data.toString(2), args) + "\n")
        }
        val id = args.get("id")
            ?: return NativeOffloadResult(2, "android-notification cancel: --id <id> or --all is required\n")

        val entry = store.get(id)
        if (entry != null) {
            cancelAlarmFor(id, entry.optInt("request_code"))
            store.remove(id)
        }
        // Also drop any delivered notification posted with the same id —
        // notifId = id.hashCode() & 0x7FFFFFFF, same convention as both
        // immediate-send and scheduled-fire.
        val notifId = id.hashCode() and 0x7FFFFFFF
        nm.cancel(notifId)

        AppLogger.info(TAG, "cancel: id=$id pending=${entry != null}")
        val data = JSONObject().put("cancelled", id).put("was_pending", entry != null)
        return NativeOffloadResult(0, OffloadOutput.formatBody(data.toString(2), args) + "\n")
    }

    private fun cancelAlarmFor(id: String, requestCode: Int) {
        val intent = Intent(context, ScheduledNotificationReceiver::class.java).apply {
            putExtra(ScheduledNotificationReceiver.EXTRA_ID, id)
        }
        val pi = PendingIntent.getBroadcast(
            context, requestCode, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        am.cancel(pi)
        pi.cancel()
    }

    // ── pending ─────────────────────────────────────────────────────────

    /** List scheduled-but-not-yet-fired notifications. iOS equivalent is
     *  UNUserNotificationCenter.getPendingNotificationRequests. */
    private fun handlePending(args: OffloadArgs): NativeOffloadResult {
        store.sweepExpired()
        val all = store.loadAll()
        val out = JSONObject()
            .put("notifications", all)
            .put("count", all.length())
        return NativeOffloadResult(0, OffloadOutput.formatBody(out.toString(2), args) + "\n")
    }

    // ── settings ────────────────────────────────────────────────────────

    /**
     * Return notification authorization + per-feature state. Mirrors
     * apple-notification settings — same field names where possible
     * (authorization_status, sound_enabled, badge_enabled, alert_enabled,
     * lock_screen_enabled). Android-only adds: can_post,
     * channel_importance, schedule_exact_allowed, listener_access.
     */
    private fun handleSettings(args: OffloadArgs): NativeOffloadResult {
        val canPost = NotificationManagerCompat.from(context).areNotificationsEnabled()
        // No iOS-style "ephemeral / provisional" on Android — collapse to
        // authorized vs denied, matching what users see in settings.
        val authStatus = if (canPost) "authorized" else "denied"
        val data = JSONObject()
            .put("authorization_status", authStatus)
            .put("can_post", canPost)
            .put("alert_enabled", canPost)
            .put("sound_enabled", canPost)
            .put("badge_enabled", canPost)
            .put("lock_screen_enabled", canPost)
            .put("notification_center_enabled", canPost)
            .put("critical_alert_enabled", false)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = nm.getNotificationChannel(CHANNEL_ID)
            data.put("channel_id", CHANNEL_ID)
            data.put("channel_importance", channel?.importance ?: -1)
            data.put("channel_enabled", channel != null && channel.importance != NotificationManager.IMPORTANCE_NONE)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val am = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
            val canSchedule = try { am?.canScheduleExactAlarms() == true } catch (_: Throwable) { false }
            data.put("schedule_exact_allowed", canSchedule)
        }
        data.put("listener_access", MinisNotificationListenerService.isEnabled(context))
        AppLogger.info(TAG, "settings: can_post=$canPost listener=${MinisNotificationListenerService.isEnabled(context)}")
        return NativeOffloadResult(0, OffloadOutput.formatBody(data.toString(2), args) + "\n")
    }

    // ── helpers ─────────────────────────────────────────────────────────

    /** ISO 8601 with offset, matches noff_format_date on iOS. */
    private fun formatIso(ms: Long): String {
        val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.US)
        return sdf.format(Date(ms))
    }

    /** Parse ISO 8601 into ms epoch. Accepts the same set of forms as the
     *  alarm and calendar handlers so prompts can use any convention. */
    private fun parseIso(s: String): Long? {
        val patterns = listOf(
            "yyyy-MM-dd'T'HH:mm:ssXXX",
            "yyyy-MM-dd'T'HH:mm:ss'Z'",
            "yyyy-MM-dd'T'HH:mm:ss",
            "yyyy-MM-dd'T'HH:mm",
        )
        for (pat in patterns) {
            try {
                val sdf = SimpleDateFormat(pat, Locale.US).apply {
                    timeZone = if (pat.endsWith("'Z'")) TimeZone.getTimeZone("UTC") else TimeZone.getDefault()
                }
                return sdf.parse(s)?.time
            } catch (_: Throwable) {}
        }
        return null
    }

    // ── list ────────────────────────────────────────────────────────────────

    private fun handleList(args: OffloadArgs): NativeOffloadResult {
        if (!MinisNotificationListenerService.isEnabled(context)) {
            // Notification Access can only be granted from the system settings
            // page — requestPermissions is not an option. Use the in-app
            // "settings gate" which shows a dialog, opens the settings page,
            // and polls for the user to complete the grant.
            val result = runBlocking {
                OffloadPermissionManager.requestSettingsGate(
                    OffloadPermissionManager.SettingsGateRequest(
                        id = "notification_access",
                        title = "Notification access needed",
                        message = "Minis needs Notification access to read the status-bar notifications. Open Settings and enable \"Minis\" under Notification access.",
                        settingsAction = MinisNotificationListenerService.SETTINGS_ACTION,
                        requiresPackageUri = false,
                        positiveLabel = "Open Settings",
                    ),
                    check = { MinisNotificationListenerService.isEnabled(context) },
                )
            }
            when (result) {
                OffloadPermissionManager.AndroidPermissionResult.GRANTED -> {} // continue
                OffloadPermissionManager.AndroidPermissionResult.DENIED -> {
                    return NativeOffloadResult(
                        77,
                        OffloadOutput.formatBody(
                            JSONObject()
                                .put("error", "notification_access_not_granted")
                                .put("message", "The user declined to grant Notification access.")
                                .toString(),
                            args,
                        ) + "\n",
                    )
                }
                OffloadPermissionManager.AndroidPermissionResult.TIMEOUT -> {
                    return NativeOffloadResult(
                        77,
                        OffloadOutput.formatBody(
                            JSONObject()
                                .put("error", "timeout")
                                .put("message", "Timed out waiting for the user to enable Notification access.")
                                .toString(),
                            args,
                        ) + "\n",
                    )
                }
            }
        }

        // `NotificationManager.activeNotifications` only exposes this app's
        // own notifications. The cross-app list comes from our bound
        // `NotificationListenerService`.
        val active: Array<StatusBarNotification> =
            MinisNotificationListenerService.getActiveNotifications()
                ?: return NativeOffloadResult(
                    77,
                    OffloadOutput.formatBody(
                        JSONObject()
                            .put("error", "listener_not_connected")
                            .put("message", "Notification listener is authorized but not yet connected. Please try again in a moment.")
                            .toString(),
                        args,
                    ) + "\n",
                )

        val max = args.get("max")?.toIntOrNull()?.coerceAtLeast(1) ?: 50
        val pm = context.packageManager
        val appNameCache = mutableMapOf<String, String>()

        val arr = JSONArray()
        var i = 0
        for (sbn in active.sortedByDescending { it.postTime }) {
            if (i >= max) break
            val extras = sbn.notification.extras
            val title = extras.getCharSequence("android.title")?.toString() ?: ""
            val text = extras.getCharSequence("android.text")?.toString()
                ?: extras.getCharSequence("android.bigText")?.toString()
                ?: ""
            val subText = extras.getCharSequence("android.subText")?.toString()
            val pkg = sbn.packageName ?: ""
            val appName = appNameCache.getOrPut(pkg) {
                try {
                    pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
                } catch (_: Throwable) { pkg }
            }
            val obj = JSONObject()
                .put("package", pkg)
                .put("app", appName)
                .put("title", title)
                .put("body", text)
                .put("post_time", sbn.postTime)
            if (!subText.isNullOrEmpty()) obj.put("subtitle", subText)
            if (sbn.isOngoing) obj.put("ongoing", true)
            arr.put(obj)
            i++
        }

        val out = JSONObject()
            .put("count", arr.length())
            .put("total_active", active.size)
            .put("notifications", arr)
            .toString(2)
        return NativeOffloadResult(0, OffloadOutput.formatBody(out, args) + "\n")
    }

    companion object {
        private const val TAG = "NotificationOffload"
        private const val CHANNEL_ID = "minis_agent_notifications"
        private const val CHANNEL_NAME = "Agent Notifications"
        private var channelCreated = false

        private const val HELP = """android-notification — send / schedule / list / cancel notifications
                              (mirrors apple-notification)

Usage:
  android-notification schedule --title T --body B [--after SECS | --at ISO]
                                       (alias: send — same flags)
  android-notification                  Same as `list` (default subcommand)
  android-notification list [--max N]   Active (already-delivered)
  android-notification pending          Scheduled but not yet fired
  android-notification cancel --id <id>
  android-notification cancel --all
  android-notification clear            Cancel all delivered (legacy)
  android-notification settings         Authorization + channel state

Examples:
  android-notification schedule --title "Reminder" --body "Standup" --after 300
  android-notification schedule --title "Meeting" --body "..." --at 2026-04-26T15:00:00
  android-notification cancel --id <id-from-pending>

Notes:
  - schedule/send triggers a system permission prompt on Android 13+
    if POST_NOTIFICATIONS has not been granted yet.
  - --after / --at use AlarmManager.setExactAndAllowWhileIdle so they
    fire reliably even in Doze. Requires SCHEDULE_EXACT_ALARM on
    Android 14+ (settings reports schedule_exact_allowed).
  - list needs Notification access (Settings → Apps → Special app
    access → Notification access → Minis). First list call opens it.
"""
    }
}
