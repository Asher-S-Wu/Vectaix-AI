package com.openminis.app.data.db

import androidx.room.ColumnInfo
import androidx.room.Entity

/**
 * Persisted ordered union of agent-loop-visible entry ids and group ids.
 * Mirrors iOS ProviderConfigDB row-per-id shape so order is preserved
 * across writes. kind = "entry" | "group"; target_id is the entry's
 * composite key or the group id.
 */
@Entity(tableName = "provider_agent_loop_ids", primaryKeys = ["kind", "target_id"])
data class ProviderAgentLoopIdEntity(
    val kind: String,
    @ColumnInfo(name = "target_id") val targetId: String,
    @ColumnInfo(name = "sort_order") val sortOrder: Int,
)
