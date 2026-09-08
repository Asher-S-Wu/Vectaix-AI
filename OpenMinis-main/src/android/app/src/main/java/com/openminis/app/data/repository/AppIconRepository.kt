package com.openminis.app.data.repository

import android.content.ComponentName
import android.content.Context
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.util.Log

/**
 * T-android-dynamic-app-icon: Manage the launcher-icon alias the system
 * resolves for MAIN/LAUNCHER. Mirrors iOS
 * `UIApplication.setAlternateIconName` — the user picks an icon variant
 * in Settings → Appearance → App Icon, and we toggle the corresponding
 * `<activity-alias>` enabled/disabled via PackageManager.
 *
 * Wire:
 *   - All three aliases target MainActivity (declared in AndroidManifest).
 *   - At any time exactly ONE alias is enabled. Selecting a new variant
 *     enables that alias and disables the others.
 *   - DONT_KILL_APP keeps the current Activity alive across the toggle;
 *     the launcher may still take a few seconds to refresh its icon
 *     cache (this is a launcher-side caching detail we don't control).
 *
 * The current selection is also persisted to SharedPreferences so the
 * Appearance screen can render the correct checkmark before reading
 * back the PackageManager state (which can lag right after a toggle).
 */
object AppIconRepository {
    private const val TAG = "AppIconRepository"
    private const val PREFS = "app_icon_prefs"
    private const val KEY_SELECTED_ID = "selected_icon_id"
    private const val PACKAGE_NAME = "com.openminis.app"

    enum class Variant(val id: String, val aliasClass: String) {
        Auto("auto", "$PACKAGE_NAME.MainActivityIconAuto"),
        ClassicLight("classic_light", "$PACKAGE_NAME.MainActivityIconLight"),
        ClassicDark("classic_dark", "$PACKAGE_NAME.MainActivityIconDark"),
        ;

        companion object {
            fun fromId(id: String?): Variant = entries.firstOrNull { it.id == id } ?: Auto
        }
    }

    private fun prefs(context: Context): SharedPreferences =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun current(context: Context): Variant =
        Variant.fromId(prefs(context).getString(KEY_SELECTED_ID, Variant.Auto.id))

    /**
     * Apply [target] as the active launcher icon. Disables every other
     * alias in one PackageManager pass + persists the selection.
     * No-op when [target] is already current — the PackageManager call
     * is mildly expensive (writes to package state) and the launcher
     * doesn't appreciate repeated unchanged toggles.
     */
    fun apply(context: Context, target: Variant): Boolean {
        val ctx = context.applicationContext
        val current = current(ctx)
        if (current == target) return false
        val pm = ctx.packageManager
        try {
            for (variant in Variant.entries) {
                val component = ComponentName(ctx, variant.aliasClass)
                val desiredState = if (variant == target) {
                    PackageManager.COMPONENT_ENABLED_STATE_ENABLED
                } else {
                    PackageManager.COMPONENT_ENABLED_STATE_DISABLED
                }
                pm.setComponentEnabledSetting(
                    component,
                    desiredState,
                    PackageManager.DONT_KILL_APP,
                )
            }
            prefs(ctx).edit().putString(KEY_SELECTED_ID, target.id).apply()
            Log.i(TAG, "icon switched ${current.id} → ${target.id}")
            return true
        } catch (t: Throwable) {
            Log.w(TAG, "icon switch failed: ${t.message}", t)
            return false
        }
    }
}
