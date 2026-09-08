package com.openminis.app.config.audit

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import com.openminis.app.logging.AppLogger
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.File
import java.util.concurrent.atomic.AtomicInteger

/**
 * SQLite-backed rolling log of config changes. Mirrors iOS
 * `ConfigAuditLog`.
 *
 * Storage: a dedicated `minis-config-audit.db` next to the chat db.
 * Keeping it separate means the audit table never gets caught in
 * sync-dirty queries and can be wiped independently if it ever
 * corrupts. Capacity: most-recent 1000 rows; older rows are pruned in
 * the same transaction as each insert.
 *
 * Threading: every method synchronizes on the helper, so multi-thread
 * inserts from the offload server worker pool are safe. Reads return
 * detached value objects.
 */
class ConfigAuditLog private constructor(context: Context) {

    private val helper = Helper(context.applicationContext)

    /** Bumped on every insert / mark / clear so UI observers refresh. */
    private val _revision = MutableStateFlow(0)
    val revision: StateFlow<Int> = _revision.asStateFlow()

    private val revCounter = AtomicInteger(0)

    private fun bumpRevision() {
        _revision.value = revCounter.incrementAndGet()
    }

    /** Insert a new audit entry. Caps the table at [MAX_ROWS] in the same tx. */
    @Synchronized
    fun append(entry: ConfigAuditEntry) {
        val db = helper.writableDatabase
        db.beginTransactionNonExclusive()
        try {
            val cv = ContentValues().apply {
                put(COL_ID, entry.id)
                put(COL_AT, entry.at)
                put(COL_ACTOR, entry.actor.raw)
                if (entry.sessionId != null) put(COL_SESSION_ID, entry.sessionId) else putNull(COL_SESSION_ID)
                put(COL_SCOPE, entry.scope)
                put(COL_KEY, entry.key)
                put(COL_OLD_VALUE, entry.oldValueJSON)
                put(COL_NEW_VALUE, entry.newValueJSON)
                if (entry.confirmedAt != null) put(COL_CONFIRMED_AT, entry.confirmedAt) else putNull(COL_CONFIRMED_AT)
                put(COL_STATUS, entry.status.raw)
                if (entry.revertOf != null) put(COL_REVERT_OF, entry.revertOf) else putNull(COL_REVERT_OF)
                if (!entry.caption.isNullOrEmpty()) put(COL_CAPTION, entry.caption) else putNull(COL_CAPTION)
            }
            db.insertWithOnConflict(TABLE, null, cv, SQLiteDatabase.CONFLICT_REPLACE)

            // Rolling cap — drop everything older than the 1000th row.
            db.execSQL(
                """
                DELETE FROM $TABLE WHERE $COL_ID NOT IN (
                  SELECT $COL_ID FROM $TABLE ORDER BY $COL_AT DESC LIMIT $MAX_ROWS
                )
                """.trimIndent()
            )
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
        bumpRevision()
    }

    /** Mark an entry as `reverted` (preserves history; no row deletion). */
    @Synchronized
    fun markReverted(id: String) {
        val db = helper.writableDatabase
        val cv = ContentValues().apply { put(COL_STATUS, ConfigAuditStatus.REVERTED.raw) }
        db.update(TABLE, cv, "$COL_ID = ?", arrayOf(id))
        bumpRevision()
    }

    /** Wipe all rows. Surfaced as a manual UI action; never via CLI. */
    @Synchronized
    fun clearAll() {
        val db = helper.writableDatabase
        db.delete(TABLE, null, null)
        bumpRevision()
    }

    /** Most-recent first. `limit` is clamped to [MAX_ROWS]. */
    @Synchronized
    fun recent(limit: Int = 200, scope: String? = null): List<ConfigAuditEntry> {
        val cap = limit.coerceIn(1, MAX_ROWS)
        val db = helper.readableDatabase
        val sql = buildString {
            append("SELECT $COLUMNS FROM $TABLE")
            if (scope != null) append(" WHERE $COL_SCOPE = ?")
            append(" ORDER BY $COL_AT DESC LIMIT ?")
        }
        val args: Array<String> = if (scope != null) arrayOf(scope, cap.toString()) else arrayOf(cap.toString())
        val out = ArrayList<ConfigAuditEntry>()
        db.rawQuery(sql, args).use { c ->
            while (c.moveToNext()) decode(c)?.let(out::add)
        }
        return out
    }

    @Synchronized
    fun get(id: String): ConfigAuditEntry? {
        val db = helper.readableDatabase
        db.rawQuery(
            "SELECT $COLUMNS FROM $TABLE WHERE $COL_ID = ?",
            arrayOf(id),
        ).use { c ->
            if (c.moveToNext()) return decode(c)
        }
        return null
    }

    /** Total row count + capacity. UI shows "X / 1000 used". */
    @Synchronized
    fun usage(): Usage {
        val db = helper.readableDatabase
        var count = 0
        db.rawQuery("SELECT COUNT(*) FROM $TABLE", null).use { c ->
            if (c.moveToNext()) count = c.getInt(0)
        }
        return Usage(count = count, capacity = MAX_ROWS)
    }

    data class Usage(val count: Int, val capacity: Int)

    private fun decode(c: android.database.Cursor): ConfigAuditEntry? {
        val statusRaw = c.getStringOrNull(COL_STATUS_IDX) ?: return null
        val status = ConfigAuditStatus.fromRaw(statusRaw) ?: return null
        return ConfigAuditEntry(
            id = c.getString(COL_ID_IDX),
            at = c.getLong(COL_AT_IDX),
            actor = ConfigAuditActor.fromRaw(c.getString(COL_ACTOR_IDX)),
            sessionId = c.getStringOrNull(COL_SESSION_ID_IDX),
            scope = c.getString(COL_SCOPE_IDX),
            key = c.getString(COL_KEY_IDX),
            oldValueJSON = c.getString(COL_OLD_VALUE_IDX),
            newValueJSON = c.getString(COL_NEW_VALUE_IDX),
            confirmedAt = if (c.isNull(COL_CONFIRMED_AT_IDX)) null else c.getLong(COL_CONFIRMED_AT_IDX),
            status = status,
            revertOf = c.getStringOrNull(COL_REVERT_OF_IDX),
            caption = c.getStringOrNull(COL_CAPTION_IDX),
        )
    }

    private fun android.database.Cursor.getStringOrNull(idx: Int): String? =
        if (isNull(idx)) null else getString(idx)

    private class Helper(context: Context) : SQLiteOpenHelper(
        context,
        File(context.applicationContext.filesDir, DB_NAME).absolutePath,
        null,
        DB_VERSION,
    ) {
        override fun onCreate(db: SQLiteDatabase) {
            db.execSQL(
                """
                CREATE TABLE $TABLE (
                    $COL_ID            TEXT PRIMARY KEY,
                    $COL_AT            INTEGER NOT NULL,
                    $COL_ACTOR         TEXT NOT NULL,
                    $COL_SESSION_ID    TEXT,
                    $COL_SCOPE         TEXT NOT NULL,
                    $COL_KEY           TEXT NOT NULL,
                    $COL_OLD_VALUE     TEXT NOT NULL,
                    $COL_NEW_VALUE     TEXT NOT NULL,
                    $COL_CONFIRMED_AT  INTEGER,
                    $COL_STATUS        TEXT NOT NULL,
                    $COL_REVERT_OF     TEXT,
                    $COL_CAPTION       TEXT
                )
                """.trimIndent()
            )
            db.execSQL("CREATE INDEX idx_audit_at ON $TABLE($COL_AT DESC)")
            db.execSQL("CREATE INDEX idx_audit_scope ON $TABLE($COL_SCOPE, $COL_AT DESC)")
            db.execSQL("CREATE INDEX idx_audit_revert_of ON $TABLE($COL_REVERT_OF)")
        }

        override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
            // No prior shipped versions on Android — first-time install
            // creates the table with `caption` already in place. Future
            // schema bumps land here.
        }
    }

    companion object {
        private const val TAG = "ConfigAuditLog"
        private const val DB_NAME = "minis-config-audit.db"
        private const val DB_VERSION = 1
        private const val MAX_ROWS = 1000

        private const val TABLE = "config_audit"
        private const val COL_ID = "id"
        private const val COL_AT = "at"
        private const val COL_ACTOR = "actor"
        private const val COL_SESSION_ID = "session_id"
        private const val COL_SCOPE = "scope"
        private const val COL_KEY = "key"
        private const val COL_OLD_VALUE = "old_value"
        private const val COL_NEW_VALUE = "new_value"
        private const val COL_CONFIRMED_AT = "confirmed_at"
        private const val COL_STATUS = "status"
        private const val COL_REVERT_OF = "revert_of"
        private const val COL_CAPTION = "caption"

        // Cursor column indexes match the SELECT order below.
        private const val COLUMNS =
            "$COL_ID, $COL_AT, $COL_ACTOR, $COL_SESSION_ID, $COL_SCOPE, $COL_KEY, " +
                "$COL_OLD_VALUE, $COL_NEW_VALUE, $COL_CONFIRMED_AT, $COL_STATUS, " +
                "$COL_REVERT_OF, $COL_CAPTION"
        private const val COL_ID_IDX = 0
        private const val COL_AT_IDX = 1
        private const val COL_ACTOR_IDX = 2
        private const val COL_SESSION_ID_IDX = 3
        private const val COL_SCOPE_IDX = 4
        private const val COL_KEY_IDX = 5
        private const val COL_OLD_VALUE_IDX = 6
        private const val COL_NEW_VALUE_IDX = 7
        private const val COL_CONFIRMED_AT_IDX = 8
        private const val COL_STATUS_IDX = 9
        private const val COL_REVERT_OF_IDX = 10
        private const val COL_CAPTION_IDX = 11

        @Volatile private var INSTANCE: ConfigAuditLog? = null

        fun init(context: Context): ConfigAuditLog {
            INSTANCE?.let { return it }
            synchronized(this) {
                INSTANCE?.let { return it }
                val l = ConfigAuditLog(context)
                INSTANCE = l
                AppLogger.info(TAG, "audit log opened (cap=$MAX_ROWS)")
                return l
            }
        }

        fun get(): ConfigAuditLog =
            INSTANCE ?: error("ConfigAuditLog not initialized; call init() from Application.onCreate")
    }
}
