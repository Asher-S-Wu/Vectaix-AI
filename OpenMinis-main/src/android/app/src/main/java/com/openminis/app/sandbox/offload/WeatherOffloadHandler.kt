package com.openminis.app.sandbox.offload

import android.content.Context
import android.telephony.TelephonyManager
import com.openminis.app.logging.AppLogger
import com.openminis.app.offload.WeatherManager
import com.openminis.app.sandbox.NativeOffloadHandler
import com.openminis.app.sandbox.NativeOffloadRequest
import com.openminis.app.sandbox.NativeOffloadResult
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

/**
 * android-weather — fetch weather from Open-Meteo (no API key needed).
 *
 * Mirrors apple-weather (NativeOffloads/WeatherOffload.m): same five
 * subcommands and same flag names so prompts and the agent loop are
 * platform-agnostic.
 *
 * Usage:
 *   android-weather current   --lat L --lon N
 *   android-weather hourly    --lat L --lon N [--hours N]
 *   android-weather daily     --lat L --lon N [--days N]
 *   android-weather alerts    --lat L --lon N
 *   android-weather report    --lat L --lon N [--hours N] [--days N]
 *
 * Backwards compatibility:
 *   - Legacy positional `android-weather <lat> <lon>` still works and
 *     emits the pre-T63 plain-text report.
 *   - `--lng` is accepted as an alias for `--lon` (apple-weather naming).
 *
 * Open-Meteo hosts in the EU — mainland-China users on China Mobile/
 * Telecom see higher latency and occasional timeouts. The handler returns
 * a structured error in that case so the model can explain the situation.
 */
class WeatherOffloadHandler(private val context: Context) : NativeOffloadHandler {
    override fun handle(request: NativeOffloadRequest): NativeOffloadResult {
        val args = OffloadArgs(request.argv.drop(1))
        if (args.hasFlag("h", "help")) return NativeOffloadResult(0, HELP)

        // Subcommand model (T63). When the first positional is one of the
        // five known subcommands, route through the typed JSON path.
        // Otherwise fall back to the legacy `<lat> <lon>` plain-text form.
        val sub = args.positional.firstOrNull()
        if (sub in SUBCOMMANDS) {
            return handleSubcommand(sub!!, args)
        }
        return handleLegacy(args)
    }

    // ── Subcommand path (T63) ────────────────────────────────────────────

    private fun handleSubcommand(sub: String, args: OffloadArgs): NativeOffloadResult {
        // Coordinates — flag form preferred; --lng accepted as iOS alias.
        val lat = args.getDouble("lat")
            ?: return NativeOffloadResult(2, "android-weather $sub: --lat <latitude> is required\n")
        val lon = args.getDouble("lon", "lng")
            ?: return NativeOffloadResult(2, "android-weather $sub: --lon <longitude> is required\n")
        if (lat !in -90.0..90.0) return NativeOffloadResult(2, "android-weather: latitude out of range\n")
        if (lon !in -180.0..180.0) return NativeOffloadResult(2, "android-weather: longitude out of range\n")

        val maxHours = (args.getInt("hours") ?: 24).coerceIn(1, 48)
        val maxDays = (args.getInt("days") ?: 7).coerceIn(1, 10)

        val json = try {
            WeatherManager.fetchWeatherJson(lat, lon)
        } catch (e: Throwable) {
            AppLogger.warning(TAG, "fetchWeatherJson uncaught: ${e.message}")
            null
        } ?: return NativeOffloadResult(1, augmentedError(WeatherManager.lastError, args))

        AppLogger.info(TAG, "$sub: lat=$lat lon=$lon hours=$maxHours days=$maxDays")
        val data: JSONObject = when (sub) {
            "current" -> currentBlock(json)
            "hourly"  -> hourlyBlock(json, maxHours)
            "daily"   -> dailyBlock(json, maxDays)
            "alerts"  -> alertsBlock()
            "report"  -> reportBlock(json, maxHours, maxDays, lat, lon)
            else -> JSONObject() // unreachable — guarded by SUBCOMMANDS
        }
        return NativeOffloadResult(0, OffloadOutput.formatBody(data.toString(2), args) + "\n")
    }

    /** Pluck `current` from Open-Meteo response, normalize numeric fields,
     *  and mirror apple-weather's per-field shape (temperature, feels_like,
     *  humidity, precipitation, wind, conditions). */
    private fun currentBlock(json: JSONObject): JSONObject {
        val current = json.optJSONObject("current") ?: return JSONObject()
        val units = json.optJSONObject("current_units")
        val tempUnit = units?.optString("temperature_2m", "°C") ?: "°C"
        val windUnit = units?.optString("wind_speed_10m", "km/h") ?: "km/h"
        return JSONObject()
            .put("time", current.optString("time", ""))
            .put("temperature", current.optDouble("temperature_2m"))
            .put("temperature_unit", tempUnit)
            .put("feels_like", current.optDouble("apparent_temperature"))
            .put("humidity", current.optInt("relative_humidity_2m"))
            .put("precipitation_mm", current.optDouble("precipitation"))
            .put("wind_speed", current.optDouble("wind_speed_10m"))
            .put("wind_speed_unit", windUnit)
            .put("wind_direction", current.optInt("wind_direction_10m"))
            .put("weather_code", current.optInt("weather_code"))
            .put("conditions", weatherCodeToDescription(current.optInt("weather_code")))
    }

    /** Slice the hourly arrays into a list of per-hour records, capped at
     *  [maxHours] (mirrors apple-weather hourly subarray capping). */
    private fun hourlyBlock(json: JSONObject, maxHours: Int): JSONObject {
        val hourly = json.optJSONObject("hourly") ?: return JSONObject().put("hourly", JSONArray()).put("count", 0)
        val times = hourly.optJSONArray("time")
        val temps = hourly.optJSONArray("temperature_2m")
        val precips = hourly.optJSONArray("precipitation_probability")
        val codes = hourly.optJSONArray("weather_code")
        val winds = hourly.optJSONArray("wind_speed_10m")
        val arr = JSONArray()
        val n = minOf(times?.length() ?: 0, maxHours)
        for (i in 0 until n) {
            val item = JSONObject()
                .put("time", times?.optString(i, "") ?: "")
                .put("temperature", temps?.optDouble(i, 0.0) ?: 0.0)
                .put("precipitation_probability", precips?.optInt(i, 0) ?: 0)
                .put("wind_speed", winds?.optDouble(i, 0.0) ?: 0.0)
                .put("weather_code", codes?.optInt(i, 0) ?: 0)
                .put("conditions", weatherCodeToDescription(codes?.optInt(i, 0) ?: 0))
            arr.put(item)
        }
        return JSONObject().put("hourly", arr).put("count", arr.length())
    }

    /** Slice daily arrays similarly. apple-weather caps to maxDays. */
    private fun dailyBlock(json: JSONObject, maxDays: Int): JSONObject {
        val daily = json.optJSONObject("daily") ?: return JSONObject().put("daily", JSONArray()).put("count", 0)
        val times = daily.optJSONArray("time")
        val highs = daily.optJSONArray("temperature_2m_max")
        val lows = daily.optJSONArray("temperature_2m_min")
        val codes = daily.optJSONArray("weather_code")
        val precSum = daily.optJSONArray("precipitation_sum")
        val precProb = daily.optJSONArray("precipitation_probability_max")
        val sunrises = daily.optJSONArray("sunrise")
        val sunsets = daily.optJSONArray("sunset")
        val arr = JSONArray()
        val n = minOf(times?.length() ?: 0, maxDays)
        for (i in 0 until n) {
            val item = JSONObject()
                .put("date", times?.optString(i, "") ?: "")
                .put("temperature_max", highs?.optDouble(i, 0.0) ?: 0.0)
                .put("temperature_min", lows?.optDouble(i, 0.0) ?: 0.0)
                .put("precipitation_sum_mm", precSum?.optDouble(i, 0.0) ?: 0.0)
                .put("precipitation_probability_max", precProb?.optInt(i, 0) ?: 0)
                .put("sunrise", sunrises?.optString(i, "") ?: "")
                .put("sunset", sunsets?.optString(i, "") ?: "")
                .put("weather_code", codes?.optInt(i, 0) ?: 0)
                .put("conditions", weatherCodeToDescription(codes?.optInt(i, 0) ?: 0))
            arr.put(item)
        }
        return JSONObject().put("daily", arr).put("count", arr.length())
    }

    /**
     * Open-Meteo doesn't expose government weather alerts (NWS-style).
     * Mirror apple-weather's empty-alerts shape and surface a structured
     * note so the model knows alerts aren't supported on this backend
     * rather than silently returning an empty list.
     */
    private fun alertsBlock(): JSONObject =
        JSONObject()
            .put("alerts", JSONArray())
            .put("count", 0)
            .put("note", "Open-Meteo does not provide weather alerts. For severe-weather alerts use a region-specific service (e.g. NWS in the US, JMA in Japan, NMC in China).")

    /** Combined dump matching apple-weather report (current + hourly +
     *  daily + alerts + location). Sliced sub-blocks share the same shape
     *  as the individual subcommands. */
    private fun reportBlock(json: JSONObject, maxHours: Int, maxDays: Int, lat: Double, lon: Double): JSONObject {
        val timezone = json.optString("timezone", "unknown")
        return JSONObject()
            .put("current", currentBlock(json))
            .put("hourly", hourlyBlock(json, maxHours).optJSONArray("hourly") ?: JSONArray())
            .put("daily", dailyBlock(json, maxDays).optJSONArray("daily") ?: JSONArray())
            .put("alerts", alertsBlock().optJSONArray("alerts") ?: JSONArray())
            .put("location", JSONObject().put("latitude", lat).put("longitude", lon).put("timezone", timezone))
    }

    // ── Legacy plain-text path (pre-T63) ─────────────────────────────────

    private fun handleLegacy(args: OffloadArgs): NativeOffloadResult {
        if (args.positional.size < 2) {
            return NativeOffloadResult(2, HELP)
        }
        val lat = args.positional[0].toDoubleOrNull()
        val lon = args.positional[1].toDoubleOrNull()
        if (lat == null || lon == null) {
            return NativeOffloadResult(2, "android-weather: <latitude> and <longitude> must be numeric\n")
        }
        if (lat !in -90.0..90.0) return NativeOffloadResult(2, "android-weather: latitude out of range\n")
        if (lon !in -180.0..180.0) return NativeOffloadResult(2, "android-weather: longitude out of range\n")
        return try {
            val text = WeatherManager.fetchWeather(lat, lon)
            val err = text.startsWith("Error")
            if (err) {
                NativeOffloadResult(1, augmentedError(text, args))
            } else {
                NativeOffloadResult(0, OffloadOutput.formatBody(text.trimEnd('\n'), args) + "\n")
            }
        } catch (e: Throwable) {
            NativeOffloadResult(1, augmentedError("Error: ${e.message}", args))
        }
    }

    // ── Errors / helpers ─────────────────────────────────────────────────

    /**
     * When Open-Meteo fails, add a CN-specific hint so users on Chinese
     * networks understand why the EU-hosted endpoint might be slow.
     */
    private fun augmentedError(text: String, args: OffloadArgs): String {
        val msg = text.trimEnd().removePrefix("Error:").trim().ifEmpty { "unknown network error" }
        val inChina = looksChina()
        val obj = JSONObject()
            .put("error", "weather_fetch_failed")
            .put("message", msg)
            .put("endpoint", "api.open-meteo.com")
        if (inChina) {
            obj.put(
                "hint",
                "api.open-meteo.com is hosted in Europe and may time out from Chinese mobile networks. Ask the user to retry on Wi-Fi, or use a CN-resident weather service (e.g. QWeather / 和风天气) when available.",
            )
        }
        return OffloadOutput.formatBody(obj.toString(), args) + "\n"
    }

    private fun looksChina(): Boolean {
        if (Locale.getDefault().country.equals("CN", ignoreCase = true)) return true
        return try {
            val tm = context.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
            val mcc = tm?.simOperator?.take(3) ?: tm?.networkOperator?.take(3)
            mcc == "460"
        } catch (_: Throwable) { false }
    }

    /**
     * WMO Weather interpretation codes to human-readable descriptions.
     * Duplicated from WeatherManager so the JSON path doesn't need to
     * round-trip through plain-text formatting just to get descriptions.
     */
    private fun weatherCodeToDescription(code: Int): String = when (code) {
        0 -> "Clear sky"
        1 -> "Mainly clear"
        2 -> "Partly cloudy"
        3 -> "Overcast"
        45 -> "Foggy"
        48 -> "Depositing rime fog"
        51 -> "Light drizzle"
        53 -> "Moderate drizzle"
        55 -> "Dense drizzle"
        56 -> "Light freezing drizzle"
        57 -> "Dense freezing drizzle"
        61 -> "Slight rain"
        63 -> "Moderate rain"
        65 -> "Heavy rain"
        66 -> "Light freezing rain"
        67 -> "Heavy freezing rain"
        71 -> "Slight snow"
        73 -> "Moderate snow"
        75 -> "Heavy snow"
        77 -> "Snow grains"
        80 -> "Slight rain showers"
        81 -> "Moderate rain showers"
        82 -> "Violent rain showers"
        85 -> "Slight snow showers"
        86 -> "Heavy snow showers"
        95 -> "Thunderstorm"
        96 -> "Thunderstorm with slight hail"
        99 -> "Thunderstorm with heavy hail"
        else -> "Unknown (code $code)"
    }

    companion object {
        private const val TAG = "WeatherOffload"
        private val SUBCOMMANDS = setOf("current", "hourly", "daily", "alerts", "report")
        private const val HELP = """android-weather — current, hourly, daily forecast, alerts, combined report
                              (mirrors apple-weather, Open-Meteo backend, no API key)

Usage:
  android-weather current   --lat L --lon N
  android-weather hourly    --lat L --lon N [--hours N (default 24, max 48)]
  android-weather daily     --lat L --lon N [--days N (default 7, max 10)]
  android-weather alerts    --lat L --lon N
  android-weather report    --lat L --lon N [--hours N] [--days N]

Legacy form (kept for backwards compatibility):
  android-weather <lat> <lon>           Plain-text combined report

Aliases:
  --lng                                 Apple-weather naming alias for --lon

Notes:
  - Coordinates are decimal degrees (latitude -90..90, longitude -180..180).
  - alerts always returns an empty list — Open-Meteo doesn't expose
    government weather alerts. The structured note in `data` points the
    model at region-specific services for severe-weather alerts.
  - On mainland-China cellular networks api.open-meteo.com may time out;
    the error envelope adds a CN-specific hint when the SIM/locale matches.

Errors return JSON: {"error":"weather_fetch_failed","message":"...","endpoint":"..."}.
"""
    }
}
