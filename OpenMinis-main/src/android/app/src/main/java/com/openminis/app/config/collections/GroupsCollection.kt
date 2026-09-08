package com.openminis.app.config.collections

import com.openminis.app.config.ConfigCollection
import com.openminis.app.config.ConfigError
import com.openminis.app.config.ConfigField
import com.openminis.app.config.ConfigRisk
import com.openminis.app.config.ConfigSchema
import com.openminis.app.config.ConfigValue
import com.openminis.app.config.fields.ClosureField
import com.openminis.app.data.model.FallbackStrategy
import com.openminis.app.data.model.ModelGroup
import com.openminis.app.data.model.RoutingStrategy
import com.openminis.app.data.model.ThinkingLevel
import com.openminis.app.data.repository.ProviderRepository

/**
 * Exposes ModelGroup fields under `groups.<id>.…`. Mirrors iOS
 * `GroupsCollection`. Add/remove fully supported — users frequently
 * want to spin up named bundles for fallback.
 */
class GroupsCollection(
    private val repo: ProviderRepository,
) : ConfigCollection {
    override val basePath: String get() = "groups"
    override val displayName: String get() = "Model groups"
    override val description: String get() =
        "Named bundles of models with fallback / load-balance routing."
    override val addable: Boolean get() = true
    override val removable: Boolean get() = true
    override val risk: ConfigRisk get() = ConfigRisk.SENSITIVE
    override val addPayloadSchema: ConfigSchema get() = ConfigSchema.Json

    override fun childIds(): List<String> = repo.config.value.modelGroups.map { it.id }

    override fun fields(forId: String): List<ConfigField> {
        if (group(forId) == null) return emptyList()
        return listOf(
            nameField(forId),
            strategyField(forId),
            fallbackStrategyField(forId),
            defaultThinkingLevelField(forId),
            contextLimitField(forId),
            entriesField(forId),
        )
    }

    override fun add(payload: ConfigValue): String {
        val obj = (payload as? ConfigValue.Obj)?.value
            ?: throw ConfigError.InvalidValue("Expected JSON object")
        val name = (obj["name"] as? ConfigValue.Str)?.value
            ?: throw ConfigError.InvalidValue("`name` required")
        if (name.isEmpty()) throw ConfigError.InvalidValue("`name` required")

        // Accept either `entries` (matches the group's display field + the
        // aggregate `groups` summary key) or the legacy `members` alias.
        val members = mutableListOf<String>()
        val entryArr = (obj["entries"] as? ConfigValue.Arr)?.value
            ?: (obj["members"] as? ConfigValue.Arr)?.value
        entryArr?.forEach { v ->
            val s = (v as? ConfigValue.Str)?.value
            if (!s.isNullOrEmpty()) members.add(s)
        }

        val strategy = (obj["strategy"] as? ConfigValue.Str)?.value?.let {
            runCatching { RoutingStrategy.valueOf(it) }.getOrNull()
        } ?: RoutingStrategy.fallback

        val fallback = (obj["fallback_strategy"] as? ConfigValue.Str)?.value?.let {
            runCatching { FallbackStrategy.valueOf(it) }.getOrNull()
        } ?: FallbackStrategy.default

        // Wire token is lowercase (`off`/`low`/…) to match iOS; empty / absent
        // means "no override" (null). An unrecognised token is ignored (null).
        val defaultThinking = (obj["default_thinking_level"] as? ConfigValue.Str)?.value
            ?.takeIf { it.isNotEmpty() }
            ?.let { thinkingLevelFromToken(it) }

        // 0 (or absent / non-positive) means "no limit" (null).
        val contextLimit = (obj["context_limit_tokens"] as? ConfigValue.Int)?.value
            ?.takeIf { it > 0 }

        val g = ModelGroup(
            name = name,
            memberEntryIds = members,
            strategy = strategy,
            fallbackStrategy = fallback,
            defaultThinkingLevel = defaultThinking,
            contextLimitTokens = contextLimit,
        )
        repo.addGroup(g)
        return g.id
    }

    override fun remove(id: String) {
        if (group(id) == null) throw ConfigError.UnknownPath("groups.$id")
        repo.removeGroup(id)
    }

    // -- Field factories --

    private fun group(id: String): ModelGroup? =
        repo.config.value.modelGroups.firstOrNull { it.id == id }

    private fun mutate(id: String, apply: (ModelGroup) -> Unit) {
        val published = group(id) ?: throw ConfigError.UnknownPath("groups.$id")
        // [T-android-provider-mutator-lock] Apply to a COPY, then hand that to
        // updateGroup. `group(id)` returns the live object out of the published
        // config, so mutating it in place — the `entries` field writer does
        // memberEntryIds.clear()/addAll — races Compose readers iterating the
        // same list, reachable from minis-config and the agent loop. The
        // deep-copied memberEntryIds is what makes the structural edits safe;
        // ProvidersCollection.mutate already uses this shape.
        val draft = published.copy(memberEntryIds = published.memberEntryIds.toMutableList())
        apply(draft)
        repo.updateGroup(draft)
    }

    private fun nameField(id: String): ConfigField =
        ClosureField(
            path = "groups.$id.name",
            displayName = "Name",
            description = "User-visible label.",
            valueSchema = ConfigSchema.Str(maxLength = 200),
            risk = ConfigRisk.NORMAL,
            revertable = true,
            reader = {
                val g = group(id) ?: return@ClosureField ConfigValue.Null
                ConfigValue.Str(g.name)
            },
            writer = { v ->
                val s = (v as? ConfigValue.Str)?.value ?: throw ConfigError.TypeMismatch("string")
                mutate(id) { it.name = s }
            },
        )

    private fun strategyField(id: String): ConfigField =
        ClosureField(
            path = "groups.$id.strategy",
            displayName = "Routing strategy",
            description = "fallback (try in order) / loadBalance (distribute).",
            valueSchema = ConfigSchema.StrEnum(listOf("fallback", "loadBalance")),
            risk = ConfigRisk.SENSITIVE,
            revertable = true,
            reader = {
                val g = group(id) ?: return@ClosureField ConfigValue.Null
                ConfigValue.Str(g.strategy.name)
            },
            writer = { v ->
                val s = (v as? ConfigValue.Str)?.value ?: throw ConfigError.TypeMismatch("string")
                val parsed = runCatching { RoutingStrategy.valueOf(s) }.getOrNull()
                    ?: throw ConfigError.InvalidValue("Unknown strategy")
                mutate(id) { it.strategy = parsed }
            },
        )

    private fun fallbackStrategyField(id: String): ConfigField =
        ClosureField(
            path = "groups.$id.fallbackStrategy",
            displayName = "Fallback policy",
            description = "default (only on rate limiting / 5xx) / always (also on transient errors).",
            valueSchema = ConfigSchema.StrEnum(listOf("default", "always")),
            risk = ConfigRisk.SENSITIVE,
            revertable = true,
            reader = {
                val g = group(id) ?: return@ClosureField ConfigValue.Null
                ConfigValue.Str(g.fallbackStrategy.name)
            },
            writer = { v ->
                val s = (v as? ConfigValue.Str)?.value ?: throw ConfigError.TypeMismatch("string")
                val parsed = runCatching { FallbackStrategy.valueOf(s) }.getOrNull()
                    ?: throw ConfigError.InvalidValue("Unknown fallback strategy")
                mutate(id) { it.fallbackStrategy = parsed }
            },
        )

    private fun defaultThinkingLevelField(id: String): ConfigField =
        ClosureField(
            path = "groups.$id.defaultThinkingLevel",
            displayName = "Default thinking level",
            description = "Applied to new sessions bound to this group. Empty = off.",
            valueSchema = ConfigSchema.StrEnum(listOf("", "off", "low", "medium", "high", "xhigh")),
            risk = ConfigRisk.NORMAL,
            revertable = true,
            reader = {
                val g = group(id) ?: return@ClosureField ConfigValue.Null
                // Wire token is lowercase to match iOS; null → empty string.
                ConfigValue.Str(g.defaultThinkingLevel?.let { thinkingLevelToToken(it) } ?: "")
            },
            writer = { v ->
                val s = (v as? ConfigValue.Str)?.value ?: throw ConfigError.TypeMismatch("string")
                mutate(id) {
                    it.defaultThinkingLevel = if (s.isEmpty()) null else thinkingLevelFromToken(s)
                }
            },
        )

    private fun contextLimitField(id: String): ConfigField =
        ClosureField(
            path = "groups.$id.contextLimitTokens",
            displayName = "Context limit (tokens)",
            description = "0 = no limit (use model's native context window).",
            valueSchema = ConfigSchema.Int(min = 0, max = 4_000_000),
            risk = ConfigRisk.SENSITIVE,
            revertable = true,
            reader = {
                val g = group(id) ?: return@ClosureField ConfigValue.Null
                ConfigValue.Int(g.contextLimitTokens ?: 0)
            },
            writer = { v ->
                val i = (v as? ConfigValue.Int)?.value ?: throw ConfigError.TypeMismatch("int")
                mutate(id) { it.contextLimitTokens = if (i == 0) null else i }
            },
        )

    /** iOS uses lowercase tokens (`off`/`low`/…); Android `ThinkingLevel.name`
     *  is uppercase. Round-trip identical strings to keep the CLI contract
     *  cross-platform. */
    private fun thinkingLevelToToken(level: ThinkingLevel): String = when (level) {
        ThinkingLevel.OFF -> "off"
        ThinkingLevel.LOW -> "low"
        ThinkingLevel.MEDIUM -> "medium"
        ThinkingLevel.HIGH -> "high"
        ThinkingLevel.XHIGH -> "xhigh"
        // [T-android-thinking-level-arch] GPT-5.6 higher tiers.
        ThinkingLevel.MAX -> "max"
        ThinkingLevel.ULTRA -> "ultra"
    }

    private fun thinkingLevelFromToken(token: String): ThinkingLevel? = when (token) {
        "off" -> ThinkingLevel.OFF
        "low" -> ThinkingLevel.LOW
        "medium" -> ThinkingLevel.MEDIUM
        "high" -> ThinkingLevel.HIGH
        "xhigh" -> ThinkingLevel.XHIGH
        "max" -> ThinkingLevel.MAX
        "ultra" -> ThinkingLevel.ULTRA
        else -> null
    }

    /**
     * Entries live as a JSON array of model entry UUIDs. Writing
     * replaces the whole list — the same path covers add / remove /
     * reorder in one operation. Use `groups.<id>.entries.append`
     * or `.remove` (handled by the bridge) for single-element ops.
     */
    private fun entriesField(id: String): ConfigField =
        ClosureField(
            path = "groups.$id.entries",
            displayName = "Entries",
            description = "Ordered list of model entry UUIDs.",
            valueSchema = ConfigSchema.Array(ConfigSchema.Str()),
            risk = ConfigRisk.SENSITIVE,
            revertable = true,
            reader = {
                val g = group(id) ?: return@ClosureField ConfigValue.Null
                ConfigValue.Arr(g.memberEntryIds.map { ConfigValue.Str(it) })
            },
            writer = { v ->
                val arr = (v as? ConfigValue.Arr)?.value ?: throw ConfigError.TypeMismatch("array")
                val ids = arr.mapNotNull { (it as? ConfigValue.Str)?.value }
                val valid = repo.config.value.modelEntries.map { it.id }.toSet()
                for (eid in ids) {
                    if (eid !in valid) throw ConfigError.InvalidValue("Unknown model entry uuid: $eid")
                }
                mutate(id) {
                    it.memberEntryIds.clear()
                    it.memberEntryIds.addAll(ids)
                }
            },
        )
}
