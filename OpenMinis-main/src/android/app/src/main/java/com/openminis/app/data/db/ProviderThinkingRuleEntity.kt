package com.openminis.app.data.db

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * [T-android-thinking-rules-phase2 / parity with iOS 4d7fb9b4] One user-authored
 * thinking rule, scoped to a single provider instance.
 *
 * Only CUSTOM rules are persisted — built-in vendor rules are compile-time constants
 * in [com.openminis.app.provider.thinking.ThinkingRuleResolver.builtInRules] and are
 * never stored (mirrors the iOS constraint). The resolver reads a provider's persisted
 * rows in [sortOrder] order and prepends them ABOVE the built-in list, so a custom rule
 * can override a vendor default by matching first, but can never remove a built-in.
 *
 * The polymorphic [ThinkingWireFormat] is serialized to [wireFormatJson] rather than
 * spread across typed columns: the format is a sealed hierarchy with per-case params
 * (offValue, path, budget floor, per-tier value maps), and a JSON blob keeps one
 * migration stable as new formats are added — the same tactic used by
 * [ProviderModelGroupEntity.memberEntryIdsJson].
 *
 * Lives in `provider.db` next to the instances the rules belong to (see
 * [ProviderDatabase]). Android provider config is local-only (no cloud sync), so a hard
 * delete of a row is final and cannot be resurrected — no tombstone is needed here (a
 * tombstone only earns its keep against a sync channel that could re-push a deleted row,
 * which Android does not have for provider config).
 */
@Entity(
    tableName = "provider_thinking_rules",
    indices = [Index("provider_instance_id")],
)
data class ProviderThinkingRuleEntity(
    /** Stable UUID assigned at creation; the drag-reorder target and minis-config handle. */
    @PrimaryKey val id: String,
    @ColumnInfo(name = "provider_instance_id") val providerInstanceId: String,
    /** Human-readable label, shown in the list and the resolution trace. */
    val label: String,
    /** "allModels" or "modelPattern". */
    @ColumnInfo(name = "scope_kind") val scopeKind: String,
    /** Glob pattern when [scopeKind] == "modelPattern"; null for allModels. */
    @ColumnInfo(name = "scope_pattern") val scopePattern: String? = null,
    /** Serialized [com.openminis.app.provider.thinking.ThinkingWireFormat]; null = "no opinion". */
    @ColumnInfo(name = "wire_format_json") val wireFormatJson: String? = null,
    /** Serialized ReasoningEchoPolicy (fieldName + timing); null = inherit. */
    @ColumnInfo(name = "reasoning_echo_json") val reasoningEchoJson: String? = null,
    /** List position (0 = highest priority). Drag-reorder rewrites these. */
    @ColumnInfo(name = "sort_order") val sortOrder: Int = 0,
)
