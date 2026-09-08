package com.openminis.app.sandbox.offload

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.provider.ContactsContract
import androidx.core.content.ContextCompat
import com.openminis.app.logging.AppLogger
import com.openminis.app.offload.OffloadPermissionManager
import com.openminis.app.sandbox.NativeOffloadHandler
import com.openminis.app.sandbox.NativeOffloadRequest
import com.openminis.app.sandbox.NativeOffloadResult
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject

/**
 * Host-side implementation of `android-contacts` — reads + writes the device
 * contacts via the ContactsContract ContentProvider.
 *
 * Usage:
 *   android-contacts list [--max N]
 *   android-contacts search <query> [--max N]
 *   android-contacts get <id>
 *   android-contacts delete <id>
 *   android-contacts --help
 */
class ContactsOffloadHandler(private val context: Context) : NativeOffloadHandler {

    override fun handle(request: NativeOffloadRequest): NativeOffloadResult {
        val rawArgs = request.argv.drop(1)
        if (rawArgs.isEmpty() || rawArgs[0] == "-h" || rawArgs[0] == "--help") {
            return NativeOffloadResult(0, HELP_TEXT)
        }
        // T54: parse for shared --compact / -q / --quiet handling. Subcommand
        // dispatch still uses the raw `rawArgs` because Contacts encodes
        // positional args (id, query) in subcommand-specific positions and
        // OffloadArgs strips flag/positional ordering away.
        val parsedArgs = OffloadArgs(rawArgs)

        // T330: tri-state agent gate before any work or system permission ask.
        OffloadGate.enforce("contacts", "android-contacts", parsedArgs, request)?.let { return it }

        // delete needs WRITE_CONTACTS in addition to READ; the read-only path
        // is fine with READ_CONTACTS alone.
        val needsWrite = rawArgs[0] == "delete"
        ensurePermission(needsWrite = needsWrite, args = parsedArgs)?.let { return it }

        return try {
            when (val sub = rawArgs[0]) {
                "list" -> doList(rawArgs.drop(1), parsedArgs)
                "search" -> doSearch(rawArgs.drop(1), parsedArgs)
                "get" -> doGet(rawArgs.drop(1), parsedArgs)
                "delete" -> doDelete(rawArgs.drop(1), parsedArgs)
                else -> NativeOffloadResult(2, "android-contacts: unknown subcommand '$sub'\n$HELP_TEXT")
            }
        } catch (e: SecurityException) {
            AppLogger.warning(TAG, "SecurityException from ContactsProvider2: ${e.message}")
            val body = org.json.JSONObject()
                .put("error", "contacts_blocked_by_oem")
                .put("message", "READ_CONTACTS is granted but the contacts provider refused the query. On MIUI/HyperOS this usually means the user needs to enable Contacts access in the per-app 'Other Permissions' / 'Privacy' panel; on ColorOS/OxygenOS check Phone Manager → Privacy Permissions. Underlying: ${e.message}")
                .toString()
            NativeOffloadResult(77, OffloadOutput.formatBody(body, parsedArgs) + "\n")
        } catch (e: Throwable) {
            AppLogger.warning(TAG, "uncaught: ${e.message}")
            val body = org.json.JSONObject()
                .put("error", "contacts_provider_error")
                .put("message", e.message ?: "unknown contacts provider error")
                .toString()
            NativeOffloadResult(1, OffloadOutput.formatBody(body, parsedArgs) + "\n")
        }
    }

    private fun hasPermission(needsWrite: Boolean = false): Boolean {
        val read = ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CONTACTS) ==
            PackageManager.PERMISSION_GRANTED
        if (!needsWrite) return read
        val write = ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_CONTACTS) ==
            PackageManager.PERMISSION_GRANTED
        return read && write
    }

    /**
     * Drive the same system-dialog → settings-gate flow as location/calendar.
     * Returns null if permission ends up granted, otherwise a ready-to-return
     * error result describing why we gave up. When [needsWrite] is true the
     * permission set additionally includes WRITE_CONTACTS — required by the
     * `delete` subcommand.
     */
    private fun ensurePermission(needsWrite: Boolean = false, args: OffloadArgs): NativeOffloadResult? {
        if (hasPermission(needsWrite)) return null
        val perms = if (needsWrite) {
            listOf(Manifest.permission.READ_CONTACTS, Manifest.permission.WRITE_CONTACTS)
        } else {
            listOf(Manifest.permission.READ_CONTACTS)
        }
        AppLogger.warning(TAG, "${perms.joinToString("+")} not granted — routing through permission flow")
        val result = runBlocking {
            var r = OffloadPermissionManager.requestAndroidPermission(perms)
            if (r == OffloadPermissionManager.AndroidPermissionResult.DENIED &&
                OffloadPermissionManager.pollForPermissionGrant({ hasPermission(needsWrite) })
            ) {
                AppLogger.info(TAG, "Contacts permission granted during post-DENY poll")
                r = OffloadPermissionManager.AndroidPermissionResult.GRANTED
            }
            if (r == OffloadPermissionManager.AndroidPermissionResult.DENIED) {
                r = OffloadPermissionManager.requestSettingsGate(
                    OffloadPermissionManager.SettingsGateRequest(
                        id = if (needsWrite) "CONTACTS_RW" else Manifest.permission.READ_CONTACTS,
                        title = "Contacts permission needed",
                        message = if (needsWrite) {
                            "Minis needs read + write contacts permission to delete entries. Open Settings to allow it."
                        } else {
                            "Minis needs contacts permission to read your address book. Open Settings to allow it."
                        },
                        settingsAction = android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                        requiresPackageUri = true,
                        positiveLabel = "Open Settings",
                    ),
                    check = { hasPermission(needsWrite) },
                )
            }
            r
        }
        return when (result) {
            OffloadPermissionManager.AndroidPermissionResult.GRANTED -> null
            OffloadPermissionManager.AndroidPermissionResult.DENIED -> NativeOffloadResult(
                77,
                OffloadOutput.formatBody(
                    JSONObject().put("error", "permission_denied")
                        .put("message", "The user declined the contacts permission.")
                        .toString(),
                    args,
                ) + "\n",
            )
            OffloadPermissionManager.AndroidPermissionResult.TIMEOUT -> NativeOffloadResult(
                77,
                OffloadOutput.formatBody(
                    JSONObject().put("error", "timeout")
                        .put("message", "Timed out waiting for the user to grant the contacts permission.")
                        .toString(),
                    args,
                ) + "\n",
            )
        }
    }

    private fun doList(args: List<String>, parsedArgs: OffloadArgs): NativeOffloadResult {
        val max = parseMax(args, default = 50)
        val projection = arrayOf(
            ContactsContract.Contacts._ID,
            ContactsContract.Contacts.DISPLAY_NAME_PRIMARY,
            ContactsContract.Contacts.HAS_PHONE_NUMBER,
        )
        val sort = "${ContactsContract.Contacts.DISPLAY_NAME_PRIMARY} ASC"
        val cursor = context.contentResolver.query(
            ContactsContract.Contacts.CONTENT_URI, projection, null, null, sort,
        ) ?: return NativeOffloadResult(1, OffloadOutput.formatBody("android-contacts: failed to query contacts", parsedArgs) + "\n")

        val arr = JSONArray()
        cursor.use {
            var n = 0
            while (it.moveToNext() && n < max) {
                arr.put(readContactRow(it))
                n++
            }
        }
        return NativeOffloadResult(0, OffloadOutput.formatBody(arr.toString(2), parsedArgs) + "\n")
    }

    private fun doSearch(args: List<String>, parsedArgs: OffloadArgs): NativeOffloadResult {
        val query = args.firstOrNull { !it.startsWith("-") }
            ?: return NativeOffloadResult(2, "android-contacts search: missing <query>\n")
        val max = parseMax(args, default = 20)

        val projection = arrayOf(
            ContactsContract.Contacts._ID,
            ContactsContract.Contacts.DISPLAY_NAME_PRIMARY,
            ContactsContract.Contacts.HAS_PHONE_NUMBER,
        )
        val selection = "${ContactsContract.Contacts.DISPLAY_NAME_PRIMARY} LIKE ?"
        val selectionArgs = arrayOf("%$query%")
        val sort = "${ContactsContract.Contacts.DISPLAY_NAME_PRIMARY} ASC"
        val cursor = context.contentResolver.query(
            ContactsContract.Contacts.CONTENT_URI, projection, selection, selectionArgs, sort,
        ) ?: return NativeOffloadResult(1, OffloadOutput.formatBody("android-contacts: failed to query contacts", parsedArgs) + "\n")

        val arr = JSONArray()
        cursor.use {
            var n = 0
            while (it.moveToNext() && n < max) {
                arr.put(readContactRow(it))
                n++
            }
        }
        if (arr.length() == 0) {
            return NativeOffloadResult(0, OffloadOutput.formatBody("No contacts found matching '$query'.", parsedArgs) + "\n")
        }
        return NativeOffloadResult(0, OffloadOutput.formatBody(arr.toString(2), parsedArgs) + "\n")
    }

    private fun doGet(args: List<String>, parsedArgs: OffloadArgs): NativeOffloadResult {
        val id = args.firstOrNull()?.toLongOrNull()
            ?: return NativeOffloadResult(2, "android-contacts get: missing or invalid <id>\n")

        val projection = arrayOf(
            ContactsContract.Contacts._ID,
            ContactsContract.Contacts.DISPLAY_NAME_PRIMARY,
            ContactsContract.Contacts.HAS_PHONE_NUMBER,
        )
        val cursor = context.contentResolver.query(
            ContactsContract.Contacts.CONTENT_URI,
            projection,
            "${ContactsContract.Contacts._ID} = ?",
            arrayOf(id.toString()),
            null,
        ) ?: return NativeOffloadResult(1, OffloadOutput.formatBody("android-contacts: failed to query contact", parsedArgs) + "\n")

        cursor.use {
            if (!it.moveToFirst()) {
                return NativeOffloadResult(1, OffloadOutput.formatBody("android-contacts: no contact with id=$id", parsedArgs) + "\n")
            }
            val obj = readContactRow(it)
            return NativeOffloadResult(0, OffloadOutput.formatBody(obj.toString(2), parsedArgs) + "\n")
        }
    }

    /**
     * Delete a single contact by aggregated `Contacts._ID`. We first try the
     * aggregated `Contacts.CONTENT_URI` path which cascades raw rows on most
     * accounts; when that returns 0 we fall back to deleting every
     * `RawContacts` row whose `CONTACT_ID` matches — this catches stub rows
     * that the aggregated URI silently refuses (commonly orphaned raw rows
     * left by sync adapters or test inserts).
     */
    private fun doDelete(args: List<String>, parsedArgs: OffloadArgs): NativeOffloadResult {
        val id = args.firstOrNull()?.toLongOrNull()
            ?: return NativeOffloadResult(2, "android-contacts delete: missing or invalid <id>\n")

        var deleted = context.contentResolver.delete(
            ContactsContract.Contacts.CONTENT_URI,
            "${ContactsContract.Contacts._ID} = ?",
            arrayOf(id.toString()),
        )
        if (deleted <= 0) {
            // Fallback: delete raw_contacts rows linked to this aggregated id.
            // We don't have the account credentials needed for the
            // CALLER_IS_SYNCADAPTER hard-delete dance, so this leaves a
            // tombstone that real sync adapters will eventually purge — fine
            // for our use case (the contact disappears from Contacts immediately).
            deleted = context.contentResolver.delete(
                ContactsContract.RawContacts.CONTENT_URI,
                "${ContactsContract.RawContacts.CONTACT_ID} = ?",
                arrayOf(id.toString()),
            )
        }
        if (deleted <= 0) {
            val body = JSONObject().put("error", "not_found")
                .put("id", id)
                .put("message", "No contact with id=$id (already deleted, or the OS hides it).")
                .toString()
            return NativeOffloadResult(1, OffloadOutput.formatBody(body, parsedArgs) + "\n")
        }
        val body = JSONObject().put("id", id).put("deleted", deleted).toString(2)
        return NativeOffloadResult(0, OffloadOutput.formatBody(body, parsedArgs) + "\n")
    }

    private fun readContactRow(c: android.database.Cursor): JSONObject {
        val id = c.getLong(0)
        val name = c.getString(1) ?: ""
        val hasPhone = c.getInt(2) > 0
        val obj = JSONObject()
        obj.put("id", id)
        obj.put("name", name)
        if (hasPhone) {
            val phones = readPhones(id)
            if (phones.length() > 0) obj.put("phones", phones)
        }
        val emails = readEmails(id)
        if (emails.length() > 0) obj.put("emails", emails)
        return obj
    }

    private fun readPhones(contactId: Long): JSONArray {
        val arr = JSONArray()
        context.contentResolver.query(
            ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
            arrayOf(ContactsContract.CommonDataKinds.Phone.NUMBER),
            "${ContactsContract.CommonDataKinds.Phone.CONTACT_ID} = ?",
            arrayOf(contactId.toString()),
            null,
        )?.use {
            while (it.moveToNext()) arr.put(it.getString(0) ?: "")
        }
        return arr
    }

    private fun readEmails(contactId: Long): JSONArray {
        val arr = JSONArray()
        context.contentResolver.query(
            ContactsContract.CommonDataKinds.Email.CONTENT_URI,
            arrayOf(ContactsContract.CommonDataKinds.Email.ADDRESS),
            "${ContactsContract.CommonDataKinds.Email.CONTACT_ID} = ?",
            arrayOf(contactId.toString()),
            null,
        )?.use {
            while (it.moveToNext()) arr.put(it.getString(0) ?: "")
        }
        return arr
    }

    private fun parseMax(args: List<String>, default: Int): Int {
        val i = args.indexOfFirst { it == "--max" || it == "-n" }
        if (i < 0 || i + 1 >= args.size) return default
        return args[i + 1].toIntOrNull() ?: default
    }

    companion object {
        private const val TAG = "ContactsOffload"
        private const val HELP_TEXT = """android-contacts — read + delete device contacts (requires READ_CONTACTS, plus WRITE_CONTACTS for delete)

Usage:
  android-contacts list [--max N]         List contacts (default 50)
  android-contacts search <query> [--max N]  Search by name (default 20)
  android-contacts get <id>               Get a single contact by id
  android-contacts delete <id>            Delete a contact by id (PERMANENT — cascades all raw rows)
  android-contacts --help                 Show this help

Output is JSON. Each contact has: id, name, phones[], emails[].
"""
    }
}
