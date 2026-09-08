package com.openminis.app.sandbox.offload

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Geocoder
import android.location.LocationManager
import android.os.Build
import android.os.CancellationSignal
import android.os.Looper
import androidx.core.content.ContextCompat
import com.openminis.app.logging.AppLogger
import com.openminis.app.offload.OffloadPermissionManager
import com.openminis.app.sandbox.NativeOffloadHandler
import com.openminis.app.sandbox.NativeOffloadRequest
import com.openminis.app.sandbox.NativeOffloadResult
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * android-location — current location, reverse geocoding, forward geocoding.
 *
 * Mirrors apple-location (NativeOffloads/LocationOffload.m): same three
 * subcommands and same flag names so prompts and the agent loop are
 * platform-agnostic.
 *
 * The `current` subcommand layers three strategies because
 * `getLastKnownLocation` returns null far more often on Android
 * than on iOS (especially on MIUI/EMUI/ColorOS after background idle):
 *   1. Walk every enabled provider with getLastKnownLocation
 *   2. If all null, request a single fresh fix via
 *      getCurrentLocation (API 30+) or requestSingleUpdate (<30)
 *   3. On timeout, return a structured error naming the enabled
 *      providers so the caller can explain exactly what's wrong.
 *
 * Usage:
 *   android-location current [--timeout SEC]
 *   android-location geocode --lat <lat> --lon <lon>     (--lng alias accepted)
 *   android-location forward --address "<addr>"
 *   android-location geocode <lat> <lon>                 (legacy positional)
 */
class LocationOffloadHandler(private val context: Context) : NativeOffloadHandler {

    override fun handle(request: NativeOffloadRequest): NativeOffloadResult {
        val args = OffloadArgs(request.argv.drop(1))
        // [T-location-default-current-android] Help only on explicit
        // --help/-h. No subcommand defaults to `current` (mirrors iOS) —
        // `android-location` == `android-location current`, and flags pass
        // through: `android-location --compact` == `current --compact`.
        if (args.hasFlag("h", "help")) {
            return NativeOffloadResult(0, HELP)
        }
        // T330: tri-state agent gate before any work.
        OffloadGate.enforce("location", "android-location", args, request)?.let { return it }

        return try {
            when (val sub = args.positional.firstOrNull() ?: "current") {
                "current" -> current(args.getInt("timeout") ?: 8, args)
                "geocode" -> handleGeocode(args)
                "forward" -> handleForward(args)
                else -> NativeOffloadResult(2, "android-location: unknown subcommand '$sub'\n$HELP")
            }
        } catch (e: Throwable) {
            AppLogger.warning(TAG, "uncaught: ${e.message}")
            NativeOffloadResult(1, OffloadOutput.formatBody("android-location: ${e.message ?: "unknown error"}", args) + "\n")
        }
    }

    /**
     * Resolve --lat / --lon (with --lng alias for apple-location parity)
     * and fall back to legacy positional `<lat> <lon>`. Returns null if
     * neither form supplies a valid pair.
     */
    private fun handleGeocode(args: OffloadArgs): NativeOffloadResult {
        // Project convention is --lon (matches photos `near`); --lng is
        // accepted as an alias to keep prompts that came from apple-
        // location working unchanged.
        val lat = args.getDouble("lat")
            ?: args.positional.getOrNull(1)?.toDoubleOrNull()
        val lon = args.getDouble("lon", "lng")
            ?: args.positional.getOrNull(2)?.toDoubleOrNull()
        if (lat == null || lon == null) {
            return NativeOffloadResult(
                2,
                "android-location geocode: --lat <lat> --lon <lon> required (positional <lat> <lon> also accepted)\n",
            )
        }
        return geocode(lat, lon, args)
    }

    // ── Permission / provider helpers ────────────────────────────

    private fun hasPermission(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    private fun hasFinePermission(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    private fun enabledProviders(lm: LocationManager): List<String> =
        try { lm.allProviders.filter { runCatching { lm.isProviderEnabled(it) }.getOrDefault(false) } }
        catch (_: Throwable) { emptyList() }

    // ── current ───────────────────────────────────────────────────

    private fun current(timeoutSec: Int, args: OffloadArgs): NativeOffloadResult {
        if (!hasPermission()) {
            AppLogger.warning(TAG, "ACCESS_FINE/COARSE_LOCATION not granted — routing through permission flow")
            val permissions = listOf(
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION,
            )
            val result = runBlocking {
                var r = OffloadPermissionManager.requestAndroidPermission(permissions)
                if (r == OffloadPermissionManager.AndroidPermissionResult.DENIED &&
                    OffloadPermissionManager.pollForPermissionGrant({ hasPermission() })
                ) {
                    AppLogger.info(TAG, "Location permission granted during post-DENY poll")
                    r = OffloadPermissionManager.AndroidPermissionResult.GRANTED
                }
                if (r == OffloadPermissionManager.AndroidPermissionResult.DENIED) {
                    r = OffloadPermissionManager.requestSettingsGate(
                        OffloadPermissionManager.SettingsGateRequest(
                            id = Manifest.permission.ACCESS_FINE_LOCATION,
                            title = "Location permission needed",
                            message = "Minis needs location permission to get your current location. Open Settings to allow it.",
                            settingsAction = android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                            requiresPackageUri = true,
                            positiveLabel = "Open Settings",
                        ),
                        check = { hasPermission() },
                    )
                }
                r
            }
            when (result) {
                OffloadPermissionManager.AndroidPermissionResult.GRANTED -> {} // fall through
                OffloadPermissionManager.AndroidPermissionResult.DENIED -> {
                    val body = JSONObject()
                        .put("error", "permission_denied")
                        .put("message", "The user declined the location permission.")
                        .toString()
                    return NativeOffloadResult(77, OffloadOutput.formatBody(body, args) + "\n")
                }
                OffloadPermissionManager.AndroidPermissionResult.TIMEOUT -> {
                    val body = JSONObject()
                        .put("error", "timeout")
                        .put("message", "Timed out waiting for the user to grant location permission.")
                        .toString()
                    return NativeOffloadResult(77, OffloadOutput.formatBody(body, args) + "\n")
                }
            }
        }

        val lm = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
            ?: return NativeOffloadResult(1, OffloadOutput.formatBody("""{"error":"service_unavailable","message":"LocationManager not available on this device"}""", args) + "\n")

        val enabled = enabledProviders(lm)
        val locationEnabled = try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) lm.isLocationEnabled
            else enabled.any { it == LocationManager.GPS_PROVIDER || it == LocationManager.NETWORK_PROVIDER }
        } catch (_: Throwable) { false }

        if (!locationEnabled || enabled.isEmpty()) {
            val body = JSONObject()
                .put("error", "location_services_disabled")
                .put("message", "Location services are off on this device. Ask the user to enable Location in system settings.")
                .put("enabled_providers", JSONArray(enabled))
                .toString()
            return NativeOffloadResult(1, OffloadOutput.formatBody(body, args) + "\n")
        }

        // Strategy 1: last-known across all providers
        val best = enabled
            .mapNotNull {
                runCatching {
                    @Suppress("MissingPermission")
                    lm.getLastKnownLocation(it)
                }.getOrNull()
            }
            .maxByOrNull { it.time }
        if (best != null) {
            AppLogger.debug(TAG, "last-known hit provider=${best.provider} age=${System.currentTimeMillis() - best.time}ms")
            return NativeOffloadResult(0, OffloadOutput.formatBody(buildLocationJson(best), args) + "\n")
        }

        // Strategy 2: request a single fresh fix with timeout
        AppLogger.debug(TAG, "no last-known, requesting fresh fix (enabled=$enabled)")
        val fresh = requestFreshLocation(lm, enabled, timeoutSec)
        if (fresh != null) {
            AppLogger.debug(TAG, "fresh fix provider=${fresh.provider} accuracy=${fresh.accuracy}m")
            return NativeOffloadResult(0, OffloadOutput.formatBody(buildLocationJson(fresh), args) + "\n")
        }

        // Strategy 3: give up with explicit diagnostics
        val oemHint = if (OsCompat.isXiaomi || OsCompat.isHuawei ||
            Build.MANUFACTURER.equals("OPPO", ignoreCase = true) ||
            Build.MANUFACTURER.equals("OnePlus", ignoreCase = true) ||
            Build.MANUFACTURER.equals("Vivo", ignoreCase = true)
        ) {
            " On ${OsCompat.oemLabel()} devices, disable battery optimization and enable autostart for Minis so background location stays active."
        } else ""
        val body = JSONObject()
            .put("error", "location_unavailable_stale")
            .put("message", "No location fix available after ${timeoutSec}s.$oemHint")
            .put("enabled_providers", JSONArray(enabled))
            .put("has_fine_permission", hasFinePermission())
            .toString()
        return NativeOffloadResult(1, OffloadOutput.formatBody(body, args) + "\n")
    }

    private fun requestFreshLocation(
        lm: LocationManager,
        enabled: List<String>,
        timeoutSec: Int,
    ): android.location.Location? {
        // Prefer NETWORK > FUSED > GPS for speed (GPS may take 30s+ cold).
        val ordered = listOf(
            LocationManager.NETWORK_PROVIDER,
            "fused",
            LocationManager.GPS_PROVIDER,
        ).filter { it in enabled }
        if (ordered.isEmpty()) return null

        val perProvTimeoutMs = (timeoutSec.coerceAtLeast(1) * 1000L / ordered.size)
            .coerceAtLeast(1500L)

        for (provider in ordered) {
            val latch = CountDownLatch(1)
            val holder = arrayOfNulls<android.location.Location>(1)
            val cancel = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) CancellationSignal() else null

            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    @Suppress("MissingPermission")
                    lm.getCurrentLocation(
                        provider,
                        cancel,
                        Executors.newSingleThreadExecutor(),
                    ) { loc ->
                        holder[0] = loc
                        latch.countDown()
                    }
                } else {
                    val listener = object : android.location.LocationListener {
                        override fun onLocationChanged(location: android.location.Location) {
                            holder[0] = location
                            latch.countDown()
                        }
                        override fun onProviderDisabled(p: String) { latch.countDown() }
                        override fun onProviderEnabled(p: String) {}
                        @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
                        override fun onStatusChanged(p: String?, status: Int, extras: android.os.Bundle?) {}
                    }
                    @Suppress("MissingPermission", "DEPRECATION")
                    lm.requestSingleUpdate(provider, listener, Looper.getMainLooper())
                    // Clean up listener on timeout path below.
                    try {
                        latch.await(perProvTimeoutMs, TimeUnit.MILLISECONDS)
                    } finally {
                        try { @Suppress("DEPRECATION") lm.removeUpdates(listener) } catch (_: Throwable) {}
                    }
                    holder[0]?.let { return it }
                    continue
                }

                if (latch.await(perProvTimeoutMs, TimeUnit.MILLISECONDS)) {
                    holder[0]?.let { return it }
                } else {
                    cancel?.cancel()
                }
            } catch (e: Throwable) {
                AppLogger.debug(TAG, "fresh fix via '$provider' failed: ${e.message}")
            }
        }
        return null
    }

    private fun buildLocationJson(loc: android.location.Location): String {
        val json = JSONObject()
            .put("latitude", loc.latitude)
            .put("longitude", loc.longitude)
            .put("accuracy_meters", loc.accuracy)
            .put("altitude_meters", loc.altitude)
            .put("provider", loc.provider ?: "unknown")
            .put("timestamp_ms", loc.time)

        try {
            val geocoder = Geocoder(context, Locale.getDefault())
            @Suppress("DEPRECATION")
            val addrs = geocoder.getFromLocation(loc.latitude, loc.longitude, 1)
            val addr = addrs?.firstOrNull()
            if (addr != null) {
                val parts = mutableListOf<String>()
                addr.thoroughfare?.takeIf { it.isNotBlank() }?.let { parts.add(it) }
                addr.subLocality?.takeIf { it.isNotBlank() }?.let { parts.add(it) }
                addr.locality?.takeIf { it.isNotBlank() }?.let { parts.add(it) }
                addr.adminArea?.takeIf { it.isNotBlank() }?.let { parts.add(it) }
                addr.countryName?.takeIf { it.isNotBlank() }?.let { parts.add(it) }
                if (parts.isNotEmpty()) json.put("address", parts.joinToString(", "))
            }
        } catch (_: Throwable) {
            // Geocoder service missing or offline — ok to omit address.
        }
        return json.toString(2)
    }

    private fun geocode(lat: Double, lon: Double, args: OffloadArgs): NativeOffloadResult {
        return try {
            val geocoder = Geocoder(context, Locale.getDefault())
            @Suppress("DEPRECATION")
            val addrs = geocoder.getFromLocation(lat, lon, 1)
            val addr = addrs?.firstOrNull()
                ?: return NativeOffloadResult(0, OffloadOutput.formatBody("No address found for ($lat, $lon).", args) + "\n")
            val lines = (0..addr.maxAddressLineIndex).map { addr.getAddressLine(it) }
            NativeOffloadResult(0, OffloadOutput.formatBody(lines.joinToString("\n"), args) + "\n")
        } catch (e: Throwable) {
            val body = """{"error":"geocoder_unavailable","message":"Reverse geocoding failed: ${e.message}. This device may lack a geocoder backend."}"""
            NativeOffloadResult(1, OffloadOutput.formatBody(body, args) + "\n")
        }
    }

    // ── forward geocoding ────────────────────────────────────────────────

    /**
     * Forward-geocode an address string to lat/lon + a structured placemark.
     * Mirrors apple-location `forward --address "<addr>"`. Geocoder.getFromLocationName
     * returns a list of candidates; we take the first since iOS does the same.
     * On devices without a geocoder backend (Huawei HMS-only, some stripped
     * China ROMs) Geocoder.isPresent() returns false — return a structured
     * error so the model can explain instead of silently failing.
     */
    private fun handleForward(args: OffloadArgs): NativeOffloadResult {
        val address = args.get("address")
        if (address.isNullOrBlank()) {
            return NativeOffloadResult(2, "android-location forward: --address <addr> is required\n")
        }
        if (!Geocoder.isPresent()) {
            val body = JSONObject()
                .put("error", "geocoder_unavailable")
                .put("message", "No geocoder backend is registered on this device. Common on Huawei HMS-only devices and some stripped China ROMs. Forward geocoding requires Google Play Services or an OEM-equivalent provider.")
                .toString()
            return NativeOffloadResult(1, OffloadOutput.formatBody(body, args) + "\n")
        }
        return try {
            // [T-android-location-cjk-geocode] C6: with a non-Chinese system
            // locale the geocoder often returns empty for CJK queries
            // (e.g. Beijing/Shanghai written in Chinese characters). Detect
            // CJK and retry once with Locale.CHINA before giving up.
            val containsCjk = CJK_REGEX.containsMatchIn(address)
            val geocoder = Geocoder(context, Locale.getDefault())
            @Suppress("DEPRECATION")
            var addrs = geocoder.getFromLocationName(address, 1)
            if (addrs.isNullOrEmpty() && containsCjk) {
                AppLogger.warning(
                    TAG,
                    "forward: empty result for CJK address '$address' with locale ${Locale.getDefault()} — retrying with Locale.CHINA",
                )
                addrs = try {
                    @Suppress("DEPRECATION")
                    Geocoder(context, Locale.CHINA).getFromLocationName(address, 1)
                } catch (e: Throwable) {
                    AppLogger.warning(TAG, "forward: Locale.CHINA retry threw: ${e.message}")
                    null
                }
            }
            val addr = addrs?.firstOrNull()
            if (addr == null) {
                AppLogger.warning(
                    TAG,
                    "forward: no_match for '$address' (locale=${Locale.getDefault()}, cjkRetry=$containsCjk)",
                )
                // On GMS-less Chinese ROMs Geocoder.isPresent() can be true
                // while every query returns empty — the hint below is the
                // best we can do without a second backend.
                val hint = if (containsCjk) {
                    "The system geocoder may lack Chinese place-name coverage on this device (common without Google Play Services). Try the address in pinyin/English, pass coordinates directly (--lat/--lon via geocode), or check the spelling."
                } else {
                    "Check the address spelling, or pass coordinates directly (--lat/--lon via geocode)."
                }
                val body = JSONObject()
                    .put("error", "no_match")
                    .put("message", "No coordinates found for address '$address'. $hint")
                    .put("address", address)
                    .toString()
                return NativeOffloadResult(1, OffloadOutput.formatBody(body, args) + "\n")
            }
            AppLogger.info(TAG, "forward: '$address' → ${addr.latitude},${addr.longitude}")
            val lines = (0..addr.maxAddressLineIndex).map { addr.getAddressLine(it) }
            val data = JSONObject()
                .put("latitude", addr.latitude)
                .put("longitude", addr.longitude)
                .put("address", lines.joinToString(", "))
                .put("query", address)
            addr.locality?.takeIf { it.isNotBlank() }?.let { data.put("locality", it) }
            addr.adminArea?.takeIf { it.isNotBlank() }?.let { data.put("admin_area", it) }
            addr.countryName?.takeIf { it.isNotBlank() }?.let { data.put("country", it) }
            addr.postalCode?.takeIf { it.isNotBlank() }?.let { data.put("postal_code", it) }
            NativeOffloadResult(0, OffloadOutput.formatBody(data.toString(2), args) + "\n")
        } catch (e: Throwable) {
            val body = JSONObject()
                .put("error", "geocoder_failed")
                .put("message", "Forward geocoding failed: ${e.message}")
                .put("address", address)
                .toString()
            NativeOffloadResult(1, OffloadOutput.formatBody(body, args) + "\n")
        }
    }

    companion object {
        private const val TAG = "LocationOffload"

        // [T-android-location-cjk-geocode] CJK Unified Ideographs (+ Ext A,
        // compatibility block) — enough to detect Chinese place names.
        private val CJK_REGEX = Regex("[\\u4E00-\\u9FFF\\u3400-\\u4DBF\\uF900-\\uFAFF]")
        private const val HELP = """android-location — current location, reverse + forward geocoding (mirrors apple-location)

Usage:
  android-location                  Same as `current` (default subcommand)
  android-location current [--timeout SEC]
                                    Last-known or fresh fix + address
  android-location geocode --lat <lat> --lon <lon>
                                    Reverse-geocode to an address
  android-location forward --address "<addr>"
                                    Forward-geocode address to lat/lon

Aliases:
  geocode <lat> <lon>     Legacy positional form (kept for backwards compat)
  --lng                   Alias for --lon (apple-location naming)

Requires ACCESS_FINE_LOCATION or ACCESS_COARSE_LOCATION. Default current
timeout 8s. Forward / reverse geocoding requires a geocoder backend
(Google Play Services or OEM equivalent).
Errors return JSON: {"error":"...","message":"...","enabled_providers":[...]}.
"""
    }
}
