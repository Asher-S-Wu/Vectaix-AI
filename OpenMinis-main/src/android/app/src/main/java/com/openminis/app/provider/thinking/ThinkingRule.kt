package com.openminis.app.provider.thinking

/**
 * One entry in a provider's thinking-rules list. Mirrors iOS `ThinkingRule.swift`.
 *
 * PHASE 1: only built-in rules exist ([Kind.OFFICIAL_VENDOR] / [Kind.PROVIDER_TYPE_DEFAULT]).
 * User-authored rules, persistence, reordering and the Provider-detail UI are Phase 2 —
 * [Kind.CUSTOM] is declared so the ordering semantics are already correct when they
 * arrive, but nothing constructs it yet.
 */
data class ThinkingRule(
    val kind: Kind,
    val scope: Scope,
    /**
     * `null` means "this rule expresses no opinion on the wire shape" — resolution then
     * falls through to the next fallback layer (design §4.2 stage B).
     */
    val wireFormat: ThinkingWireFormat?,
    /** Phase 2. Declared so the shape is stable; the echo path still lives in the provider. */
    val reasoningEcho: ReasoningEchoPolicy? = null,
    /** Human-readable identifier, surfaced in the resolution trace. */
    val label: String,
    /**
     * [T-android-thinking-rules-phase2] Stable identity. Custom rules carry their
     * persisted UUID; built-ins get a deterministic id that INCLUDES THE SCOPE.
     *
     * Deriving a built-in id from the label alone is a real bug: the five OpenAI-native
     * rules (o1, o3, o4, gpt-5, gpt-4 patterns) deliberately share the label
     * "openai-native", so label-only ids collapse them to one — and Compose `items(key=)`
     * de-duplicates by key, rendering the first row five times (iOS hit this exact bug on
     * SwiftUI ForEach). Including the scope makes a collision impossible for rules that
     * differ in what they match. Not passed in for built-ins → derived below.
     */
    val id: String = "",
) {
    /** True when the user may edit/delete this rule. Built-ins are override-only. */
    val isEditable: Boolean get() = kind == Kind.CUSTOM

    /** Deterministic id for built-ins (scope-inclusive); custom rules keep their own. */
    val stableId: String
        get() {
            if (id.isNotEmpty()) return id
            val sk = if (scope is Scope.ModelPattern) "modelPattern" else "allModels"
            val sp = (scope as? Scope.ModelPattern)?.pattern ?: "*"
            return "builtin:$label:$sk:$sp"
        }

    enum class Kind {
        /** A user-authored rule. Phase 2. Always sorts ABOVE built-ins. */
        CUSTOM,

        /** A specific vendor's documented shape (DeepSeek official, Venice, Ark…). */
        OFFICIAL_VENDOR,

        /**
         * Fallback for a providerType when no vendor rule matched. Its scope is always
         * [Scope.AllModels], which guarantees resolution never falls through.
         */
        PROVIDER_TYPE_DEFAULT,
    }

    sealed interface Scope {
        data object AllModels : Scope

        /** Glob against the model id, `*` being the only wildcard. */
        data class ModelPattern(val pattern: String) : Scope

        fun matches(modelId: String): Boolean = when (this) {
            is AllModels -> true
            is ModelPattern -> glob(
                pattern.lowercase().replace('.', '-'),
                modelId.lowercase().replace('.', '-'),
            )
        }

        companion object {
            /**
             * Minimal glob: `*` matches any run of characters, everything else literal.
             * Hand-written rather than regex so the semantics match the Swift port
             * character for character.
             *
             * The `.`→`-` normalisation applied by [matches] is not cosmetic: the catalog
             * spells Claude ids with hyphens (`claude-opus-4-8`) while third-party proxies
             * return dots (`claude-opus-4.8`). A rule set written in one spelling matched
             * NOTHING until iOS 5aa9dc64 normalised it. MiMo has the same hazard in the
             * other direction — docs say `mimo-2.5`, the live API serves `mimo-v2.5`
             * (72968c4f).
             */
            fun glob(pattern: String, input: String): Boolean {
                val parts = pattern.split("*")
                if (parts.size == 1) return input == pattern

                var cursor = 0
                for ((i, part) in parts.withIndex()) {
                    if (part.isEmpty()) continue
                    if (i == 0) {
                        if (!input.startsWith(part)) return false
                        cursor = part.length
                        continue
                    }
                    if (i == parts.size - 1 && !pattern.endsWith("*")) {
                        if (!input.endsWith(part)) return false
                        if (input.length - cursor < part.length) return false
                        continue
                    }
                    val found = input.indexOf(part, cursor)
                    if (found < 0) return false
                    cursor = found + part.length
                }
                return true
            }
        }
    }
}

/**
 * How captured reasoning is echoed back on assistant history turns.
 *
 * PHASE 1: declared but not yet enforced through the resolver — the live behaviour still
 * lives in the provider's message flattening. Modelled here because the send-side and
 * echo-side are two halves of ONE vendor contract, and splitting them is exactly what let
 * GH OpenMinis#22 be fixed on the OpenAI path while #70 stayed broken on the Anthropic path.
 */
data class ReasoningEchoPolicy(
    /**
     * `reasoning_content` / `reasoning` / `reasoning_text` — the three spellings observed
     * in the wild, sometimes three different ones on one gateway (GH OpenMinis#171).
     */
    val fieldName: String,
    val timing: Timing,
) {
    enum class Timing {
        /** Some gateways validate unconditionally once thinking is active (nous). */
        EVERY_TURN,

        /** DeepSeek's documented requirement: only tool-call turns must echo. */
        AFTER_TOOL_USE_ONLY,

        /** Mistral: never, in any situation. */
        NEVER,
    }
}
