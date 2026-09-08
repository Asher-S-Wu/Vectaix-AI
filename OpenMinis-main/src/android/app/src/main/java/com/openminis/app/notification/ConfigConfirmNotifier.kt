package com.openminis.app.notification

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.openminis.app.MainActivity
import com.openminis.app.R
import com.openminis.app.config.confirm.PendingConfigChange
import com.openminis.app.data.repository.BackgroundSettingsRepository
import com.openminis.app.logging.AppLogger

/**
 * [T-android-config-confirm-timeout] Posts a local notification when a
 * minis-config change is waiting for user approval AND the app is backgrounded,
 * so the user knows to return before the (now 120s) timeout. Android port of
 * iOS `ConfigConfirmationGate.notifyIfBackgrounded` (T-config-confirm-timeout-bg).
 *
 * The confirm dialog is mounted at app root (ConfigConfirmDialogHost, bound to
 * ConfigConfirmationGate.pending), so tapping the notification only needs to
 * FOREGROUND the app — the still-pending dialog is then simply visible again.
 *
 * Gated by the same "Task Notifications" background setting the task-completion
 * notifier uses ([BackgroundSettingsRepository.taskNotificationsEnabled]) and
 * suppressed while the app is in foreground (the user can already see the
 * dialog). The gate itself guards against sending twice per change id.
 */
class ConfigConfirmNotifier(
    private val context: Context,
    private val backgroundSettings: BackgroundSettingsRepository,
    private val isAppForeground: () -> Boolean,
) {

    init {
        ensureChannel()
    }

    /**
     * Post the "awaiting approval" notification for [change] if — and only if —
     * the app is currently backgrounded and notifications are enabled. Safe to
     * call from any thread; a no-op when the guards fail. Returns true when a
     * notification was actually posted (so the caller's once-per-id bookkeeping
     * only marks ids we really notified).
     */
    fun notifyIfBackgrounded(change: PendingConfigChange): Boolean {
        if (isAppForeground()) return false
        if (!backgroundSettings.taskNotificationsEnabled.value) {
            AppLogger.info(TAG, "bg-notify skipped id=${change.id} — taskNotificationsEnabled=false")
            return false
        }

        val nm = NotificationManagerCompat.from(context)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !nm.areNotificationsEnabled()) {
            return false
        }

        // Show the caption (e.g. "Update multi-model writing workflow: …") so
        // the user gets the gist without opening the app; fall back to a
        // row-count summary when there's no caption. Mirrors iOS.
        val caption = change.caption?.trim().orEmpty()
        val body = when {
            caption.isNotEmpty() -> caption
            change.items.size > 1 ->
                context.getString(R.string.notif_config_confirm_body_multi, change.items.size)
            else -> context.getString(R.string.notif_config_confirm_body_single)
        }

        // Tapping just needs to bring MainActivity forward; the root-mounted
        // confirm dialog is still bound to the pending change. singleTask +
        // CLEAR_TOP reuses the existing instance rather than spawning a copy.
        val launchIntent = Intent(context, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        val pendingIntent = PendingIntent.getActivity(
            context,
            change.id.hashCode(),
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(context.getString(R.string.notif_config_confirm_title))
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setCategory(NotificationCompat.CATEGORY_RECOMMENDATION)
            .build()

        return try {
            nm.notify(NOTIFICATION_TAG, change.id.hashCode(), notification)
            AppLogger.info(TAG, "bg-notify post id=${change.id} bodyLen=${body.length}")
            true
        } catch (se: SecurityException) {
            AppLogger.info(TAG, "notify denied (POST_NOTIFICATIONS not granted)")
            false
        }
    }

    /** Cancel a pending-approval notification once its change resolves, so a
     *  stale "awaiting approval" entry never lingers after approve/reject/timeout. */
    fun cancel(changeId: String) {
        NotificationManagerCompat.from(context).cancel(NOTIFICATION_TAG, changeId.hashCode())
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = ContextCompat.getSystemService(context, NotificationManager::class.java)
            ?: return
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            context.getString(R.string.notif_config_confirm_channel_name),
            NotificationManager.IMPORTANCE_DEFAULT,
        ).apply {
            description = context.getString(R.string.notif_config_confirm_channel_description)
            setShowBadge(true)
        }
        manager.createNotificationChannel(channel)
    }

    companion object {
        private const val TAG = "ConfigConfirmNotifier"
        const val CHANNEL_ID = "minis_config_confirm"
        private const val NOTIFICATION_TAG = "config-confirm"
    }
}
