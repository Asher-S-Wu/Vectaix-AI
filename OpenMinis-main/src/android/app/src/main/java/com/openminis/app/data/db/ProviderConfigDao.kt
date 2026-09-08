package com.openminis.app.data.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction

@Dao
interface ProviderConfigDao {

    @Query("SELECT * FROM provider_instances ORDER BY sort_order ASC, created_at ASC")
    suspend fun loadInstances(): List<ProviderInstanceEntity>

    @Query("SELECT * FROM provider_model_entries ORDER BY provider_instance_id, sort_order ASC")
    suspend fun loadEntries(): List<ProviderModelEntryEntity>

    @Query("SELECT * FROM provider_model_groups ORDER BY sort_order ASC")
    suspend fun loadGroups(): List<ProviderModelGroupEntity>

    @Query("SELECT * FROM provider_agent_loop_ids ORDER BY kind, sort_order ASC")
    suspend fun loadAgentLoopIds(): List<ProviderAgentLoopIdEntity>

    @Query("SELECT * FROM provider_config_meta")
    suspend fun loadMeta(): List<ProviderConfigMetaEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertInstances(rows: List<ProviderInstanceEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertEntries(rows: List<ProviderModelEntryEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertGroups(rows: List<ProviderModelGroupEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAgentLoopIds(rows: List<ProviderAgentLoopIdEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertMeta(rows: List<ProviderConfigMetaEntity>)

    @Query("DELETE FROM provider_instances") suspend fun clearInstances()
    @Query("DELETE FROM provider_model_entries") suspend fun clearEntries()
    @Query("DELETE FROM provider_model_groups") suspend fun clearGroups()
    @Query("DELETE FROM provider_agent_loop_ids") suspend fun clearAgentLoopIds()
    @Query("DELETE FROM provider_config_meta") suspend fun clearMeta()

    /**
     * Atomic full replace. Entry FK CASCADE means clearing instances first
     * would wipe entries via cascade; we still clearEntries explicitly to
     * keep the order predictable and to defensively cover schema-without-FK
     * test paths.
     */
    @Transaction
    suspend fun replaceAll(
        instances: List<ProviderInstanceEntity>,
        entries: List<ProviderModelEntryEntity>,
        groups: List<ProviderModelGroupEntity>,
        loopIds: List<ProviderAgentLoopIdEntity>,
        meta: List<ProviderConfigMetaEntity>,
    ) {
        clearAgentLoopIds()
        clearGroups()
        clearEntries()
        clearInstances()
        clearMeta()
        upsertInstances(instances)
        upsertEntries(entries)
        upsertGroups(groups)
        upsertAgentLoopIds(loopIds)
        upsertMeta(meta)
    }

    @Query("SELECT COUNT(*) FROM provider_instances")
    suspend fun instanceCount(): Int

    // ---- [T-android-thinking-rules-phase2] Custom thinking rules ----
    //
    // Deliberately NOT touched by replaceAll(): thinking rules are per-instance user
    // data that is orthogonal to the config snapshot round-trip. They are cleaned up
    // only when their owning instance is deleted (see deleteThinkingRulesForInstance,
    // called from ProviderRepository.deleteInstance).

    @Query("SELECT * FROM provider_thinking_rules WHERE provider_instance_id = :instanceId ORDER BY sort_order ASC")
    suspend fun loadThinkingRules(instanceId: String): List<ProviderThinkingRuleEntity>

    @Query("SELECT * FROM provider_thinking_rules ORDER BY provider_instance_id, sort_order ASC")
    suspend fun loadAllThinkingRules(): List<ProviderThinkingRuleEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertThinkingRule(row: ProviderThinkingRuleEntity)

    @Query("DELETE FROM provider_thinking_rules WHERE id = :id")
    suspend fun deleteThinkingRule(id: String)

    @Query("DELETE FROM provider_thinking_rules WHERE provider_instance_id = :instanceId")
    suspend fun deleteThinkingRulesForInstance(instanceId: String)

    /** Atomic reorder/replace of an instance's whole rule set (drag-reorder + add/edit). */
    @Transaction
    suspend fun replaceThinkingRules(instanceId: String, rows: List<ProviderThinkingRuleEntity>) {
        deleteThinkingRulesForInstance(instanceId)
        for (r in rows) upsertThinkingRule(r)
    }
}
