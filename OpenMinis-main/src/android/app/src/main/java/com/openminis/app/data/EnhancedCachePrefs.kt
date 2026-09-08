package com.openminis.app.data

import android.content.Context
import android.content.SharedPreferences

/**
 * [T-android-enhanced-cache] Persists whether the user has acknowledged the
 * one-time Enhanced Cache confirmation dialog.
 *
 * The Enhanced Cache *toggle state* itself is per-ViewModel memory only (not
 * persisted — mirrors iOS `AIChatViewModel.enhancedCacheEnabled`). Only the
 * "user has seen and accepted the extra-billing warning" flag is durable, so
 * the confirmation AlertDialog appears exactly once per install. Mirrors iOS
 * UserDefaults key `enhancedCacheConfirmed`.
 */
object EnhancedCachePrefs {
    private const val PREFS = "minis_enhanced_cache_prefs"
    private const val KEY_CONFIRMED = "enhancedCacheConfirmed"

    private fun prefs(context: Context): SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun isConfirmed(context: Context): Boolean =
        prefs(context).getBoolean(KEY_CONFIRMED, false)

    fun setConfirmed(context: Context) {
        prefs(context).edit().putBoolean(KEY_CONFIRMED, true).apply()
    }
}
