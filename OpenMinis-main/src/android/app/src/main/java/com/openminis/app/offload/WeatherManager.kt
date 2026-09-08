package com.openminis.app.offload

import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Fetches weather data from the Open-Meteo public API (no API key required).
 * Returns current conditions, 48-hour hourly forecast, and 10-day daily forecast
 * as a formatted human-readable string.
 */
object WeatherManager {

    private const val TAG = "WeatherManager"
    private const val BASE_URL = "https://api.open-meteo.com/v1/forecast"

    private val client = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(8, TimeUnit.SECONDS)
        .callTimeout(12, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .connectionPool(okhttp3.ConnectionPool(5, 30, TimeUnit.SECONDS))
        .build()

    /**
     * Fetch weather for the given coordinates.
     * Returns a formatted string with current, hourly, and daily weather.
     */
    fun fetchWeather(latitude: Double, longitude: Double): String {
        val json = fetchWeatherJson(latitude, longitude)
            ?: return "Error fetching weather: $lastError"
        return formatWeatherResponse(json, latitude, longitude)
    }

    /**
     * Fetch raw Open-Meteo JSON. Returns null on transport error and stores
     * a user-readable reason in [lastError] so the calling handler can
     * surface it via a structured envelope. T63 added — the
     * subcommand-based android-weather handler needs raw JSON to slice
     * into current/hourly/daily.
     */
    @Volatile var lastError: String = ""
        private set

    fun fetchWeatherJson(latitude: Double, longitude: Double): JSONObject? {
        val url = "$BASE_URL?" +
            "latitude=$latitude&longitude=$longitude" +
            "&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation," +
            "weather_code,wind_speed_10m,wind_direction_10m" +
            "&hourly=temperature_2m,precipitation_probability,weather_code,wind_speed_10m" +
            "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum," +
            "precipitation_probability_max,sunrise,sunset" +
            "&forecast_hours=48" +
            "&forecast_days=10" +
            "&timezone=auto"

        val request = Request.Builder().url(url).get().build()
        return try {
            val response = client.newCall(request).execute()
            val body = response.body?.string()
            if (!response.isSuccessful || body == null) {
                lastError = "Open-Meteo API returned ${response.code}: ${body ?: "no body"}"
                null
            } else {
                lastError = ""
                JSONObject(body)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Weather fetch failed", e)
            lastError = e.message ?: "unknown network error"
            null
        }
    }

    private fun formatWeatherResponse(json: JSONObject, lat: Double, lon: Double): String {
        val sb = StringBuilder()
        val timezone = json.optString("timezone", "unknown")

        sb.appendLine("=== Weather for ($lat, $lon) | Timezone: $timezone ===")
        sb.appendLine()

        // Current conditions
        val current = json.optJSONObject("current")
        if (current != null) {
            val units = json.optJSONObject("current_units")
            val tempUnit = units?.optString("temperature_2m", "°C") ?: "°C"
            val windUnit = units?.optString("wind_speed_10m", "km/h") ?: "km/h"

            sb.appendLine("── Current Conditions ──")
            sb.appendLine("  Temperature: ${current.optDouble("temperature_2m")}$tempUnit")
            sb.appendLine("  Feels like:  ${current.optDouble("apparent_temperature")}$tempUnit")
            sb.appendLine("  Humidity:    ${current.optInt("relative_humidity_2m")}%")
            sb.appendLine("  Precipitation: ${current.optDouble("precipitation")} mm")
            sb.appendLine("  Wind:        ${current.optDouble("wind_speed_10m")} $windUnit " +
                "from ${current.optInt("wind_direction_10m")}°")
            sb.appendLine("  Conditions:  ${weatherCodeToDescription(current.optInt("weather_code"))}")
            sb.appendLine()
        }

        // Hourly forecast (show every 3 hours to keep it readable)
        val hourly = json.optJSONObject("hourly")
        if (hourly != null) {
            val times = hourly.optJSONArray("time")
            val temps = hourly.optJSONArray("temperature_2m")
            val precips = hourly.optJSONArray("precipitation_probability")
            val codes = hourly.optJSONArray("weather_code")
            val winds = hourly.optJSONArray("wind_speed_10m")

            if (times != null && times.length() > 0) {
                sb.appendLine("── Hourly Forecast (every 3h) ──")
                for (i in 0 until times.length() step 3) {
                    val time = times.optString(i, "").replace("T", " ")
                    val temp = temps?.optDouble(i) ?: 0.0
                    val precip = precips?.optInt(i) ?: 0
                    val code = codes?.optInt(i) ?: 0
                    val wind = winds?.optDouble(i) ?: 0.0
                    sb.appendLine("  $time | ${temp}° | ${weatherCodeToDescription(code)} | " +
                        "rain ${precip}% | wind ${wind} km/h")
                }
                sb.appendLine()
            }
        }

        // Daily forecast
        val daily = json.optJSONObject("daily")
        if (daily != null) {
            val times = daily.optJSONArray("time")
            val maxTemps = daily.optJSONArray("temperature_2m_max")
            val minTemps = daily.optJSONArray("temperature_2m_min")
            val codes = daily.optJSONArray("weather_code")
            val precipSum = daily.optJSONArray("precipitation_sum")
            val precipProb = daily.optJSONArray("precipitation_probability_max")
            val sunrises = daily.optJSONArray("sunrise")
            val sunsets = daily.optJSONArray("sunset")

            if (times != null && times.length() > 0) {
                sb.appendLine("── 10-Day Forecast ──")
                for (i in 0 until times.length()) {
                    val date = times.optString(i, "")
                    val hi = maxTemps?.optDouble(i) ?: 0.0
                    val lo = minTemps?.optDouble(i) ?: 0.0
                    val code = codes?.optInt(i) ?: 0
                    val rain = precipSum?.optDouble(i) ?: 0.0
                    val rainProb = precipProb?.optInt(i) ?: 0
                    val sunrise = sunrises?.optString(i, "")?.substringAfter("T") ?: ""
                    val sunset = sunsets?.optString(i, "")?.substringAfter("T") ?: ""

                    sb.appendLine("  $date | ${lo}°–${hi}° | ${weatherCodeToDescription(code)} | " +
                        "rain ${rain}mm (${rainProb}%) | sunrise $sunrise sunset $sunset")
                }
            }
        }

        return sb.toString().trimEnd()
    }

    /**
     * WMO Weather interpretation codes to human-readable descriptions.
     * https://open-meteo.com/en/docs#weathervariables
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
}
