package com.openminis.app.data.db

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * [T-android-session-grouping] A session group. Code says "Folder", the UI says
 * "Group" — the same deliberate split iOS uses, because `ModelGroup` (LLM
 * fallback routing) already owns the word "Group" at symbol level.
 *
 * Mirrors the iOS `folders` table (ChatStore.swift:795) column-for-column so a
 * future sync layer can map the two without a translation step.
 *
 * ## Why `name` is NOT unique
 *
 * Two devices can each create "Work" offline; both are kept, as two rows with
 * different UUIDs. Keying on the name instead would turn a rename from a
 * one-field edit into an identity change — delete the old key, create a new
 * one, migrate every member — which tears across devices: A renames while B
 * files under the old name, and B's sessions end up pointing at a key that no
 * longer exists. A locally-generated UUID needs no cross-device coordination,
 * which is exactly the property offline creation requires.
 *
 * Consequence: every name-based lookup must tolerate multiple matches.
 */
@Entity(tableName = "folders")
data class FolderEntity(
    @PrimaryKey val id: String,
    val name: String,
    /** Optional icon token. Null = use the composed top-3-category glyphs. */
    val icon: String? = null,
    /** Optional theme color token. */
    val color: String? = null,
    /**
     * `"manual"` | `"ai"`. Provenance only — nothing branches on it. Kept so
     * an AI-suggested group stays distinguishable for future UI/telemetry.
     */
    val origin: String = ORIGIN_MANUAL,
    /**
     * Reserved for drag-reorder. Always 0 today; no code path writes it. Kept
     * as a column so the record shape matches iOS and a later reorder feature
     * needs no migration.
     */
    @ColumnInfo(name = "sort_index") val sortIndex: Int = 0,
    /** Non-null = this group floats above unpinned groups. Milliseconds. */
    @ColumnInfo(name = "pinned_at") val pinnedAt: Long? = null,
    /**
     * One-sentence description, capped at [DESC_MAX_CHARS]. Never rendered in
     * the session list — it is the group picker's row subtitle, and context for
     * future auto-grouping.
     */
    val description: String? = null,
    @ColumnInfo(name = "created_at") val createdAt: Long,
    /**
     * Tracks RECORD edits (rename / pin / icon) — NOT member activity. A
     * session moving in or out of the group must not touch it.
     */
    @ColumnInfo(name = "updated_at") val updatedAt: Long,
) {
    val isPinned: Boolean get() = pinnedAt != null

    companion object {
        const val ORIGIN_MANUAL = "manual"
        const val ORIGIN_AI = "ai"

        /** iOS caps the description at 100 chars; keep the two in step. */
        const val DESC_MAX_CHARS = 100
    }
}
