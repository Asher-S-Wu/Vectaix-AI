package com.openminis.app.data.db

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * Per-row provider instance, mirroring iOS ProviderConfigDB. Maps
 * 1:1 to [com.openminis.app.data.model.ProviderInstance]; every
 * field that ProviderInstance carries locally MUST have a column
 * here (credentials excluded — those live in EncryptedSharedPreferences).
 */
@Entity(tableName = "provider_instances")
data class ProviderInstanceEntity(
    @PrimaryKey val id: String,
    val label: String,
    @ColumnInfo(name = "provider_type") val providerType: String,
    @ColumnInfo(name = "credential_type") val credentialType: String,
    @ColumnInfo(name = "custom_base_url") val customBaseURL: String? = null,
    @ColumnInfo(name = "append_v1_suffix") val appendV1Suffix: Int = 1,
    @ColumnInfo(name = "use_responses_api") val useResponsesAPI: Int = 0,
    // [T-android-azure-openai] 0/1 Azure OpenAI mode. NOT NULL DEFAULT 0 so
    // MIGRATION_1_2's ALTER TABLE backfills existing rows to off, matching the
    // entity default and the JSON model's `azureMode = false`.
    @ColumnInfo(name = "azure_mode") val azureMode: Int = 0,
    // [GH#68 T-android-image-endpoint-persist] Kotlin enum .name of
    // ImageEndpointMode ("auto"/"imagesGenerations"/"chatCompletions"). These
    // two were on the JSON model but never given Room columns, so every save
    // dropped the user's picker choice and every load reset it to auto —
    // "can't switch off Auto". Nullable TEXT; null → auto / no cached probe.
    @ColumnInfo(name = "image_endpoint_mode") val imageEndpointMode: String? = null,
    @ColumnInfo(name = "image_endpoint_resolved") val imageEndpointResolved: String? = null,
    @ColumnInfo(name = "custom_user_agent") val customUserAgent: String? = null,
    @ColumnInfo(name = "is_enabled") val isEnabled: Int = 1,
    @ColumnInfo(name = "sort_order") val sortOrder: Int = 0,
    @ColumnInfo(name = "created_at") val createdAt: Long,
)
