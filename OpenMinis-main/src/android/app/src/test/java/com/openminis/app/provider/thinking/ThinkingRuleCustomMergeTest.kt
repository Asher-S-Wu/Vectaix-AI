package com.openminis.app.provider.thinking

import com.openminis.app.data.model.ThinkingLevel
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * [T-android-thinking-rules-phase2] Custom-rule merge behaviour.
 *
 * The load-bearing safety invariant: an EMPTY custom-rule list must resolve
 * byte-identically to the built-in-only Phase 1 path. The golden-snapshot tests already
 * pin the built-in output; this file pins (a) empty = unchanged and (b) a custom rule
 * actually overrides.
 */
class ThinkingRuleCustomMergeTest {

    @After
    fun tearDown() {
        // Never leak cache state into other tests in the same JVM.
        ThinkingRuleResolver.setAllCustomRules(emptyMap())
    }

    private fun ctx(modelId: String, instanceId: String?) = ThinkingResolveContext(
        modelId = modelId,
        instanceId = instanceId,
        supportsReasoning = true,
        declaredEffortValues = null,
        level = ThinkingLevel.HIGH,
        maxTokens = 4096,
        isOpenRouter = false,
        usesUnifiedReasoningEffort = false,
        isMistral = false,
        isDashScope = false,
        offEffort = null,
    )

    @Test
    fun `empty custom rules leave the openai-compatible default untouched`() {
        ThinkingRuleResolver.setAllCustomRules(emptyMap())
        val body = JSONObject()
        val trace = ThinkingRuleResolver.apply(body, ctx("some-model", "inst-A"))
        // Default openai-compatible path: root reasoning_effort at HIGH.
        assertEquals("high", body.optString("reasoning_effort"))
        assertEquals("openai-compatible-default", trace.matchedRuleLabel)
        assertEquals(ThinkingRule.Kind.PROVIDER_TYPE_DEFAULT, trace.matchedRuleKind)
    }

    @Test
    fun `a custom OmitEverything rule wins over the built-in default`() {
        ThinkingRuleResolver.setCustomRules(
            "inst-A",
            listOf(
                ThinkingRule(
                    kind = ThinkingRule.Kind.CUSTOM,
                    scope = ThinkingRule.Scope.AllModels,
                    wireFormat = ThinkingWireFormat.OmitEverything,
                    label = "my-omit",
                ),
            ),
        )
        val body = JSONObject()
        val trace = ThinkingRuleResolver.apply(body, ctx("some-model", "inst-A"))
        // OmitEverything ⇒ NO thinking key at all.
        assertFalse(body.has("reasoning_effort"))
        assertFalse(body.has("thinking"))
        assertEquals("my-omit", trace.matchedRuleLabel)
        assertEquals(ThinkingRule.Kind.CUSTOM, trace.matchedRuleKind)
    }

    @Test
    fun `a custom rule scoped to a pattern only fires for matching models`() {
        ThinkingRuleResolver.setCustomRules(
            "inst-A",
            listOf(
                ThinkingRule(
                    kind = ThinkingRule.Kind.CUSTOM,
                    scope = ThinkingRule.Scope.ModelPattern("deepseek-v4*"),
                    wireFormat = ThinkingWireFormat.OmitEverything,
                    label = "ds-omit",
                ),
            ),
        )
        // Matching model → custom rule wins.
        val hit = JSONObject()
        assertEquals("ds-omit", ThinkingRuleResolver.apply(hit, ctx("deepseek-v4-chat", "inst-A")).matchedRuleLabel)
        assertFalse(hit.has("reasoning_effort"))
        // Non-matching model → falls through to the built-in default.
        val miss = JSONObject()
        val missTrace = ThinkingRuleResolver.apply(miss, ctx("gpt-4o", "inst-A"))
        assertEquals("high", miss.optString("reasoning_effort"))
        assertTrue(missTrace.matchedRuleLabel != "ds-omit")
    }

    @Test
    fun `custom rules on one instance do not leak to another`() {
        ThinkingRuleResolver.setCustomRules(
            "inst-A",
            listOf(
                ThinkingRule(
                    kind = ThinkingRule.Kind.CUSTOM,
                    scope = ThinkingRule.Scope.AllModels,
                    wireFormat = ThinkingWireFormat.OmitEverything,
                    label = "a-only",
                ),
            ),
        )
        val bodyB = JSONObject()
        val traceB = ThinkingRuleResolver.apply(bodyB, ctx("some-model", "inst-B"))
        assertEquals("high", bodyB.optString("reasoning_effort"))
        assertTrue(traceB.matchedRuleLabel != "a-only")
    }
}
