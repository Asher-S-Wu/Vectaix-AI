package com.openminis.app.data

import android.content.Context
import android.content.SharedPreferences

/**
 * Global default for the memory feature, persisted in SharedPreferences.
 *
 * Two-layer model (mirrors iOS):
 *   - **Global** (this file): default for newly-created sessions.
 *     Toggled from Settings → Memory. Pref key
 *     `memory.global.enabled`, default `true`.
 *   - **Per-session** (`ChatSessionEntity.memory_enabled`): override
 *     for a specific chat, toggled via `/memory` or
 *     `SessionMemorySheet`. Once a session has a row, that row's
 *     value wins; changing the global never retroactively touches
 *     existing sessions.
 *
 * When a fresh draft VM is mounted before any DB row exists, we read
 * the global default and seed `_memoryEnabled` with it. When
 * `ensureSession` materialises the row, we pass the same value through
 * to `ChatRepository.createSession(memoryEnabled = …)` so the DB
 * snapshot matches the seed.
 */
object MemoryGlobalPrefs {
    private const val PREFS = "minis_memory_prefs"
    private const val KEY_GLOBAL_ENABLED = "memory.global.enabled"

    private fun prefs(context: Context): SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun isGlobalEnabled(context: Context): Boolean =
        prefs(context).getBoolean(KEY_GLOBAL_ENABLED, true)

    fun setGlobalEnabled(context: Context, enabled: Boolean) {
        prefs(context).edit().putBoolean(KEY_GLOBAL_ENABLED, enabled).apply()
    }
}
