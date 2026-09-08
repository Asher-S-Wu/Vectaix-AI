package com.openminis.app.data.db

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * Single-row-per-key meta store for provider config values that don't
 * belong to any of the per-row tables: defaultPrimaryGroupId,
 * defaultSubGroupId, and the json_sync_hash used to detect
 * downgrade-and-back-up scenarios where the legacy JSON mirror was
 * mutated by an older app build behind our back.
 *
 * Known keys (referenced from ProviderConfigDao / ProviderRepository):
 *  - "default_primary_group_id"
 *  - "default_sub_group_id"
 *  - "json_sync_hash" — hash of the legacy provider_config JSON the last
 *    time we wrote it. Mismatch on load means a v15-style downgrade ran
 *    a write through the JSON path that our DB never saw, so we
 *    re-import from JSON and resync.
 */
@Entity(tableName = "provider_config_meta")
data class ProviderConfigMetaEntity(
    @PrimaryKey val key: String,
    val value: String?,
)
