package com.openminis.app.config

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Master switch controlling whether the agent can use the
 * `minis-config` CLI at all. Disabling short-circuits every CLI call
 * before any field lookup, ConfirmationGate enqueue, or audit write.
 *
 * The flag itself is intentionally not settable through minis-config:
 * the registry registers a hidden placeholder on the same path so any
 * agent attempt to flip the switch returns `permission_denied`.
 *
 * Mirrors iOS `MinisConfigPermissionStore`.
 */
object MinisConfigPermissionStore {
    private const val PREFS = "minis_config_permission"
    private const val KEY = "minis_config_enabled"

    /** Default: true (preserves existing behaviour for upgrade users). */
    private const val DEFAULT_ENABLED = true

    private var prefs: SharedPreferences? = null

    private val _enabled = MutableStateFlow(DEFAULT_ENABLED)
    val enabled: StateFlow<Boolean> = _enabled.asStateFlow()

    /** Hot-path read used by the offload bridge before any work. */
    val isEnabled: Boolean get() = _enabled.value

    /** Call once early — typically from MinisApp.onCreate. Idempotent. */
    fun init(context: Context) {
        if (prefs != null) return
        val p = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs = p
        _enabled.value = if (p.contains(KEY)) p.getBoolean(KEY, DEFAULT_ENABLED) else DEFAULT_ENABLED
    }

    /** UI toggle. Persists eagerly. */
    fun setEnabled(value: Boolean) {
        prefs?.edit()?.putBoolean(KEY, value)?.apply()
        _enabled.value = value
    }
}
