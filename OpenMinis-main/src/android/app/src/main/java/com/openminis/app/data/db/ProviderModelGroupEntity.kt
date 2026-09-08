package com.openminis.app.data.db

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * Per-row model group. memberEntryIds is stored as a serialized JSON
 * array string to preserve order (which is load-bearing for fallback
 * routing). After the legacy JSON→DB migration, every id in
 * member_entry_ids_json is the composite "{instanceId}/{modelId}"
 * shape — never the legacy random UUID.
 */
@Entity(tableName = "provider_model_groups")
data class ProviderModelGroupEntity(
    @PrimaryKey val id: String,
    val name: String,
    val strategy: String,
    @ColumnInfo(name = "fallback_strategy") val fallbackStrategy: String,
    @ColumnInfo(name = "default_thinking_level") val defaultThinkingLevel: String? = null,
    @ColumnInfo(name = "context_limit_tokens") val contextLimitTokens: Int? = null,
    @ColumnInfo(name = "last_context_limit_tokens") val lastContextLimitTokens: Int? = null,
    @ColumnInfo(name = "member_entry_ids_json") val memberEntryIdsJson: String,
    @ColumnInfo(name = "sort_order") val sortOrder: Int = 0,
)
