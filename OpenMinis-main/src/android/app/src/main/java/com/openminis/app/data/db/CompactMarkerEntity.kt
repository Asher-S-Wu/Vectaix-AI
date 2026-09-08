package com.openminis.app.data.db

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * Mirrors iOS compact_markers table.
 * Stores LLM-generated summaries of compacted message ranges.
 * Used for context window management (compact old messages into a summary).
 */
@Entity(
    tableName = "compact_markers",
    foreignKeys = [
        ForeignKey(
            entity = ChatSessionEntity::class,
            parentColumns = ["id"],
            childColumns = ["session_id"],
            onDelete = ForeignKey.CASCADE,
        )
    ],
    indices = [
        Index(value = ["session_id"]),
        Index(value = ["first_kept_message_id"]),
    ]
)
data class CompactMarkerEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "session_id") val sessionId: String,
    val summary: String,
    @ColumnInfo(name = "first_kept_sort_order") val firstKeptSortOrder: Int,
    @ColumnInfo(name = "compacted_count") val compactedCount: Int,
    @ColumnInfo(name = "created_at") val createdAt: Long,                     // milliseconds
    @ColumnInfo(name = "ui_boundary_sort_order") val uiBoundarySortOrder: Int? = null,
    @ColumnInfo(name = "boundary_message_id") val boundaryMessageId: String? = null,
    // Phase-A (iOS parity): id-first boundary fields. Preferred over sort_order
    // when present because iCloud-merged messages can produce duplicate
    // sort_order values — message ids stay stable. Sort-order fields above
    // are retained for legacy rows and fallback when ids are missing.
    @ColumnInfo(name = "first_kept_message_id") val firstKeptMessageId: String? = null,
    @ColumnInfo(name = "last_compacted_message_id") val lastCompactedMessageId: String? = null,
    /**
     * Marker schema version. 1 = legacy multi-field model (firstKept /
     * boundary / sortOrder fallback chain). 2 = simplified id-only model:
     * `lastCompactedMessageId` is the authoritative anchor — everything from
     * session start (or the previous marker's anchor + 1) up to and
     * including this id is folded into [summary]; everything after is the
     * active region. Older v1 markers keep working through the legacy
     * resolution path in ChatViewModel.effectiveAgentHistory().
     *
     * Defaults to 1 so rows from prior schema versions read as v1 without
     * any backfill — matches the SQL `DEFAULT 1` set by MIGRATION_7_8.
     */
    val version: Int = 1,
)
