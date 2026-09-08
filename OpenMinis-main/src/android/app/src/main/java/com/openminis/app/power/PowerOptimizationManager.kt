package com.openminis.app.power

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import com.openminis.app.logging.AppLogger

/**
 * T50: helpers for two pieces of Android-only background-keep-alive
 * plumbing that have no iOS equivalent because iOS doesn't allow
 * arbitrary-duration background work in the first place.
 *
 * 1. **Battery optimisation (Doze) exemption**. By default Android puts
 *    the app's process into App Standby Bucket / Doze when backgrounded;
 *    a foreground service alone is not enough on stock Android 13+.
 *    `isIgnoringBatteryOptimizations` reports whether the user has
 *    already exempted the app via system settings.
 *
 * 2. **OEM autostart / background-run permissions**. Several Chinese
 *    OEM ROMs (MIUI, EMUI/HarmonyOS, ColorOS, OriginOS, OneUI) layer an
 *    additional "autostart" permission on top of stock Android — apps
 *    not whitelisted there are killed within minutes of going to
 *    background, foreground service or not. There's no public API to
 *    query the state, only known Activity entry-points to deep-link the
 *    user to the right settings panel. Each entry-point is OEM- and
 *    sometimes version-specific, so we try a list and fall back to the
 *    app's stock system-settings page.
 *
 * Returns intentionally weak: caller (settings UI) is responsible for
 * showing guidance to the user; this object only knows the mechanics.
 */
object PowerOptimizationManager {
    private const val TAG = "PowerOpt"

    /**
     * True iff the app has been added to the user's battery-optimisation
     * exemption list. Always false below Android M (the API didn't
     * exist) — but that's safe; the system also doesn't aggressively
     * Doze on those versions.
     */
    fun isIgnoringBatteryOptimizations(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true
        val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return false
        return pm.isIgnoringBatteryOptimizations(context.packageName)
    }

    /**
     * Open the system settings page where the user can grant a
     * battery-optimisation exemption. Uses
     * `ACTION_REQUEST_IGNORE_BATTERY_OPTIMISATIONS` (the direct dialog)
     * when the manifest declares the matching permission; otherwise
     * falls back to the broader
     * `ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS` list.
     *
     * Returns true if an Activity was launched, false if no settings
     * page was available on this device.
     */
    fun requestBatteryOptimizationExemption(activity: Activity): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return false

        val direct = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
            .setData(Uri.parse("package:${activity.packageName}"))
        if (tryStartActivity(activity, direct)) {
            AppLogger.info(TAG, "battery-opt direct dialog launched")
            return true
        }
        val list = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
        if (tryStartActivity(activity, list)) {
            AppLogger.info(TAG, "battery-opt list page launched (fallback)")
            return true
        }
        AppLogger.warning(TAG, "no battery-opt settings page available on this device")
        return false
    }

    /**
     * Manufacturer family inferred from [Build.MANUFACTURER]. Coarse
     * grouping is fine here — every member of a family runs the same
     * security-center package, even when individual ROMs (MIUI vs.
     * HyperOS, ColorOS vs. RealmeUI) differ in surface theming.
     */
    enum class Vendor(val displayName: String) {
        XIAOMI("Xiaomi / Redmi"),
        HUAWEI("Huawei / Honor"),
        OPPO("OPPO / OnePlus / Realme"),
        VIVO("Vivo / iQOO"),
        SAMSUNG("Samsung"),
        OTHER("Other"),
        ;

        companion object {
            fun current(): Vendor {
                val m = Build.MANUFACTURER.lowercase()
                val b = Build.BRAND.lowercase()
                return when {
                    m.contains("xiaomi") || m.contains("redmi") || b.contains("xiaomi") -> XIAOMI
                    m.contains("huawei") || m.contains("honor") || b.contains("huawei") -> HUAWEI
                    m.contains("oppo") || m.contains("oneplus") || m.contains("realme") -> OPPO
                    m.contains("vivo") || m.contains("iqoo") -> VIVO
                    m.contains("samsung") -> SAMSUNG
                    else -> OTHER
                }
            }
        }
    }

    /**
     * True when the device is from a vendor known to enforce
     * autostart-on-top-of-stock-Android — meaning the user almost
     * certainly needs to grant the OEM-specific permission for
     * Minis to keep running in the background. [Vendor.OTHER]
     * (Pixel, generic AOSP, etc.) returns false because stock
     * Android's own foreground-service guarantees suffice.
     */
    fun needsOemAutostartGuidance(): Boolean = Vendor.current() != Vendor.OTHER

    /**
     * Open the OEM-specific autostart / background-run permission
     * settings page. Each vendor exposes a different Activity (and
     * has changed the package over time across firmware versions),
     * so we try a list of known component names. Returns true if any
     * launched, false if every attempt threw [ActivityNotFoundException]
     * (in which case the caller should fall back to the stock app
     * details page via [openAppDetailsSettings]).
     */
    fun openOemAutostartSettings(activity: Activity): Boolean {
        val candidates: List<ComponentName> = when (Vendor.current()) {
            Vendor.XIAOMI -> listOf(
                // MIUI 12+
                ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"),
                // Older MIUI fallback
                ComponentName("com.miui.securitycenter", "com.miui.powercenter.PowerSettings"),
            )
            Vendor.HUAWEI -> listOf(
                // EMUI 9+ / HarmonyOS
                ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"),
                ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity"),
            )
            Vendor.OPPO -> listOf(
                // ColorOS 7+ / OxygenOS / RealmeUI
                ComponentName("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"),
                ComponentName("com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity"),
                ComponentName("com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity"),
            )
            Vendor.VIVO -> listOf(
                ComponentName("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity"),
                ComponentName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"),
            )
            Vendor.SAMSUNG -> listOf(
                // OneUI 5+
                ComponentName("com.samsung.android.lool", "com.samsung.android.sm.battery.ui.BatteryActivity"),
                ComponentName("com.samsung.android.lool", "com.samsung.android.sm.ui.battery.BatteryActivity"),
            )
            Vendor.OTHER -> emptyList()
        }
        for (component in candidates) {
            val intent = Intent().apply {
                this.component = component
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            if (tryStartActivity(activity, intent)) {
                AppLogger.info(TAG, "OEM autostart settings launched: ${component.flattenToShortString()}")
                return true
            }
        }
        AppLogger.warning(TAG, "no OEM autostart Activity matched on ${Build.MANUFACTURER}")
        return false
    }

    /** Stock app-details settings page — last-resort fallback. */
    fun openAppDetailsSettings(activity: Activity): Boolean {
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
            .setData(Uri.parse("package:${activity.packageName}"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return tryStartActivity(activity, intent)
    }

    private fun tryStartActivity(activity: Activity, intent: Intent): Boolean = try {
        activity.startActivity(intent)
        true
    } catch (_: ActivityNotFoundException) {
        false
    } catch (e: SecurityException) {
        AppLogger.warning(TAG, "startActivity SecurityException: ${e.message}")
        false
    }
}
