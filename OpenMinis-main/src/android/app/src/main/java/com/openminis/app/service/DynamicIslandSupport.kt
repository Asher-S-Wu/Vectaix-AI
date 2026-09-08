package com.openminis.app.service

import android.app.NotificationManager
import android.content.Context
import android.os.Build
import android.util.Log

/**
 * [T-android-dynamic-island] Capability probe for Android 16 (Baklava, API 36)
 * "Live Updates" — the promoted-ongoing-notification surface users perceive as
 * the "dynamic island" / always-visible status chip.
 *
 * A device "supports the dynamic island" only when BOTH hold:
 *   1. It runs Android 16+ (`Build.VERSION.SDK_INT >= 36`), so the
 *      `Notification.ProgressStyle` + `FLAG_PROMOTED_ONGOING` +
 *      `NotificationManager.canPostPromotedNotifications()` APIs exist, AND
 *   2. `NotificationManager.canPostPromotedNotifications()` returns true — this
 *      reflects the *system + per-app user grant* (the user can disable Live
 *      Updates for this app from system settings), so it can flip at runtime.
 *
 * The probe is intentionally NOT cached: callers re-query it each time the app
 * becomes foreground-visible (spec §3) so a permission the user toggled off in
 * system settings is picked up without needing a process restart. It's a cheap
 * synchronous call.
 *
 * As of 2026-07 this only actually returns true on Pixel 6+ hardware running
 * the Android 16 QPR that shipped Live Updates; on every other device the guard
 * short-circuits at the SDK_INT check (pre-16) or `canPostPromotedNotifications`
 * (16 without the feature), so all the mutual-exclusion logic degrades cleanly
 * to the existing overlay + plain-notification behavior.
 */
object DynamicIslandSupport {

    private const val TAG = "DynamicIslandSupport"

    /**
     * True when this device can post promoted ("dynamic island") notifications
     * right now. Runtime-safe on all API levels — returns false pre-36 without
     * touching any 36-only symbol.
     */
    fun isDynamicIslandCapable(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.BAKLAVA) return false
        return try {
            val nm = context.getSystemService(NotificationManager::class.java)
            nm?.canPostPromotedNotifications() == true
        } catch (t: Throwable) {
            // Defensive: some early/partial Baklava builds may throw if the
            // feature isn't fully wired. Treat any failure as "not capable"
            // so we fall back to the overlay + plain-notification path.
            Log.w(TAG, "canPostPromotedNotifications() failed: ${t.message}")
            false
        }
    }

    /**
     * True when the Live Updates / dynamic-island experience should be the
     * ACTIVE status surface: the device is capable AND the user enabled the
     * toggle. This is the single predicate that (a) selects the promoted
     * ProgressStyle notification branch and (b) short-circuits the floating
     * overlay so the two never render at once.
     */
    fun isDynamicIslandActive(context: Context, userEnabled: Boolean): Boolean =
        userEnabled && isDynamicIslandCapable(context)
}
