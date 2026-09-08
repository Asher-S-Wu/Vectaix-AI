package com.openminis.app.offload

import android.Manifest
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.provider.CalendarContract
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.util.TimeZone

/**
 * Calendar read/write bridge using CalendarProvider.
 * Requires READ_CALENDAR and WRITE_CALENDAR permissions.
 */
object CalendarManager {

    fun hasPermission(context: Context): Boolean {
        return ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CALENDAR) ==
            PackageManager.PERMISSION_GRANTED
    }

    fun hasWritePermission(context: Context): Boolean {
        return ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_CALENDAR) ==
            PackageManager.PERMISSION_GRANTED
    }

    /**
     * List upcoming events within the given time range (millis).
     */
    fun listEvents(context: Context, startMs: Long, endMs: Long, maxResults: Int = 50): String {
        if (!hasPermission(context)) return "Error: READ_CALENDAR permission not granted"

        val projection = arrayOf(
            CalendarContract.Events._ID,
            CalendarContract.Events.TITLE,
            CalendarContract.Events.DTSTART,
            CalendarContract.Events.DTEND,
            CalendarContract.Events.EVENT_LOCATION,
            CalendarContract.Events.DESCRIPTION,
            CalendarContract.Events.ALL_DAY,
        )

        val selection = "${CalendarContract.Events.DTSTART} >= ? AND ${CalendarContract.Events.DTSTART} <= ?"
        val selectionArgs = arrayOf(startMs.toString(), endMs.toString())
        val sortOrder = "${CalendarContract.Events.DTSTART} ASC"

        val cursor = context.contentResolver.query(
            CalendarContract.Events.CONTENT_URI,
            projection, selection, selectionArgs, sortOrder
        ) ?: return "Error: failed to query calendar"

        val events = JSONArray()
        cursor.use {
            var count = 0
            while (it.moveToNext() && count < maxResults) {
                val event = JSONObject()
                event.put("id", it.getLong(0))
                event.put("title", it.getString(1) ?: "")
                event.put("start_ms", it.getLong(2))
                event.put("end_ms", it.getLong(3))
                event.put("location", it.getString(4) ?: "")
                event.put("description", it.getString(5) ?: "")
                event.put("all_day", it.getInt(6) == 1)
                events.put(event)
                count++
            }
        }

        return if (events.length() == 0) "No events found in the given time range."
        else events.toString(2)
    }

    /**
     * Create a calendar event.
     */
    fun createEvent(
        context: Context,
        title: String,
        startMs: Long,
        endMs: Long,
        description: String? = null,
        location: String? = null,
        allDay: Boolean = false,
    ): String {
        if (!hasWritePermission(context)) return "Error: WRITE_CALENDAR permission not granted"

        // Get the primary calendar ID
        val calendarId = getPrimaryCalendarId(context)
            ?: return "Error: no calendar found on device"

        val values = ContentValues().apply {
            put(CalendarContract.Events.CALENDAR_ID, calendarId)
            put(CalendarContract.Events.TITLE, title)
            put(CalendarContract.Events.DTSTART, startMs)
            put(CalendarContract.Events.DTEND, endMs)
            put(CalendarContract.Events.EVENT_TIMEZONE, TimeZone.getDefault().id)
            if (description != null) put(CalendarContract.Events.DESCRIPTION, description)
            if (location != null) put(CalendarContract.Events.EVENT_LOCATION, location)
            if (allDay) put(CalendarContract.Events.ALL_DAY, 1)
        }

        return try {
            val uri = context.contentResolver.insert(CalendarContract.Events.CONTENT_URI, values)
            if (uri != null) "Created event '$title' (id: ${uri.lastPathSegment})"
            else "Error: failed to create event"
        } catch (e: Exception) {
            "Error: ${e.message}"
        }
    }

    private fun getPrimaryCalendarId(context: Context): Long? {
        val projection = arrayOf(CalendarContract.Calendars._ID)
        val selection = "${CalendarContract.Calendars.IS_PRIMARY} = 1"
        val cursor = context.contentResolver.query(
            CalendarContract.Calendars.CONTENT_URI,
            projection, selection, null, null
        )
        cursor?.use {
            if (it.moveToFirst()) return it.getLong(0)
        }
        // Fallback: first writable calendar
        val fallbackCursor = context.contentResolver.query(
            CalendarContract.Calendars.CONTENT_URI,
            projection, null, null, null
        )
        fallbackCursor?.use {
            if (it.moveToFirst()) return it.getLong(0)
        }
        return null
    }
}
