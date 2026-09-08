package com.openminis.app.data

import android.content.Context
import android.os.Build
import java.util.UUID

/**
 * Stable per-install device identity. Mirrors iOS `DeviceIdentity` minus the
 * cross-end iCloud Keychain sync (Android has no equivalent; spec §4.4 calls
 * this out). The uuid survives app kill but not uninstall — that's the most
 * privacy-friendly stable id Android offers without relying on
 * `Settings.Secure.ANDROID_ID` (which some OEMs reset and which Play policy
 * restricts).
 *
 * Usage patterns across the app:
 *   - `zoneName` — namespace any future multi-device sync records.
 *   - `deviceName` — friendly "Pixel 8 · A3F7"-style label for debug logs
 *     and the provider-account UI (future).
 *   - `deviceId` — opaque UUID for any "my-device" disambiguation.
 */
object DeviceIdentity {
    private const val PREFS_NAME = "minis_device_identity"
    private const val KEY_DEVICE_ID = "deviceId"

    @Volatile private var cached: String? = null

    fun deviceId(context: Context): String {
        cached?.let { return it }
        val prefs = encryptedPrefs(context)
        val existing = prefs.getString(KEY_DEVICE_ID, null)
        if (existing != null) {
            cached = existing
            return existing
        }
        val fresh = UUID.randomUUID().toString()
        prefs.edit().putString(KEY_DEVICE_ID, fresh).apply()
        cached = fresh
        return fresh
    }

    /** "Pixel 8 Pro · A3F7" — last four chars of [deviceId] uppercased. */
    fun deviceName(context: Context): String {
        val shortId = deviceId(context).takeLast(4).uppercase()
        val manufacturer = Build.MANUFACTURER.replaceFirstChar { it.titlecase() }
        val model = Build.MODEL
        val label = if (model.startsWith(manufacturer, ignoreCase = true)) model else "$manufacturer $model"
        return "$label · $shortId"
    }

    fun osVersion(): String = "Android ${Build.VERSION.RELEASE}"

    /** Stable sync-zone namespace — mirrors iOS `"device-\(deviceId)"`. */
    fun zoneName(context: Context): String = "device-${deviceId(context)}"

    // T-android-keystore-aead-fail: self-healing wrapper handles
    // master-key invalidation on Samsung One UI / Android 16.
    private fun encryptedPrefs(context: Context) =
        com.openminis.app.util.EncryptedPrefsFactory.safeCreate(context, PREFS_NAME)
}
