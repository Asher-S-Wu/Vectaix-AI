package com.openminis.app.sandbox.offload

import android.content.Context
import android.os.Build

/**
 * Runtime OS-compatibility helpers shared by android-* offload handlers.
 *
 * Focused on detecting environments where an offload cannot work at all
 * so the handler can fail fast with a clear message instead of crashing.
 */
internal object OsCompat {

    /**
     * Detect HarmonyOS NEXT (aka HarmonyOS 5 / "Pure Blood Harmony").
     * NEXT drops the AOSP compatibility layer, so normal Android APIs
     * don't exist — but reflection-based SystemProperties lookup still
     * works from within the APK runtime shim on pre-5 devices.
     *
     * Heuristic: package manager reports Harmony features or the
     * ro.build.version.harmony / hw_sc.build.os.enable props look recent.
     * Conservative — we only return true when multiple signals align.
     */
    fun isHarmonyOsNext(context: Context): Boolean {
        return try {
            val pm = context.packageManager
            val hasHarmony = pm.hasSystemFeature("com.huawei.software.features.ohos") ||
                pm.hasSystemFeature("ohos.system.harmony")
            if (!hasHarmony) return false
            val harmonyVer = systemProp("hw_sc.build.os.enable")
                .ifEmpty { systemProp("ro.build.version.harmony") }
            // NEXT identifies as 5.x; EMUI/Harmony ≤4 still have AOSP.
            harmonyVer.startsWith("5") || harmonyVer.startsWith("6")
        } catch (_: Throwable) {
            false
        }
    }

    /**
     * Read an Android system property via reflection. Returns "" on any failure.
     */
    fun systemProp(key: String): String {
        return try {
            val cls = Class.forName("android.os.SystemProperties")
            val m = cls.getMethod("get", String::class.java)
            (m.invoke(null, key) as? String).orEmpty()
        } catch (_: Throwable) {
            ""
        }
    }

    /** Is this a Xiaomi MIUI / HyperOS device? */
    val isXiaomi: Boolean
        get() = Build.MANUFACTURER.equals("Xiaomi", ignoreCase = true) ||
            Build.MANUFACTURER.equals("Redmi", ignoreCase = true)

    /** Is this a Huawei / Honor device? */
    val isHuawei: Boolean
        get() = Build.MANUFACTURER.equals("HUAWEI", ignoreCase = true) ||
            Build.MANUFACTURER.equals("HONOR", ignoreCase = true)

    /** Build a short label like "Xiaomi MIUI" / "Samsung One UI" for error messages. */
    fun oemLabel(): String {
        val mfr = Build.MANUFACTURER.ifBlank { "Android" }
        return mfr.replaceFirstChar { it.titlecase() }
    }
}
