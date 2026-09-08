package com.openminis.app.ui.chat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

/**
 * [T-android-fallback-entry-identity] Identity of a fallback target.
 *
 * Field report: with a `Default Model` group of
 *   [GPT-5.6 Terra(OpenAI2), GPT-5.6 Luna(OpenAI2), deepseek-v4-flash(DeekSeak), …]
 * a dead OpenAI2 key made group-fallback walk to `deepseek-v4-flash`, served by
 * the "DeekSeak" instance (api.deepseek.com). The UI then displayed the provider
 * as **"Bailian OpenAI"** (dashscope.aliyuncs.com).
 *
 * Cause: after switching, the code recovered the entry with
 *
 *     modelEntries.find { it.model.id == currentProvider.model.id }
 *
 * On that device TWO entries share the model id `deepseek-v4-flash` — one under
 * DeekSeak, one under Bailian OpenAI — so `find` returned whichever came first
 * in `modelEntries`, not the one that actually served the request. That wrong
 * entry then fed `_activeEntryId`, `_providerName` AND the persisted
 * `lastEntryId` binding, so re-entering the session resumed on the wrong
 * instance too.
 *
 * These tests pin the DISAMBIGUATION RULE rather than the ViewModel (which needs
 * an Android runtime): an entry must be identified by its own id, never by the
 * model id it happens to expose.
 */
class FallbackEntryIdentityTest {

    private data class Entry(val id: String, val modelId: String, val instanceLabel: String)

    /** The device's real shape: same modelId under two different instances. */
    private val entries = listOf(
        Entry("522ba52e/deepseek-v4-flash", "deepseek-v4-flash", "Bailian OpenAI"),
        Entry("58fe6f1f/deepseek-v4-flash", "deepseek-v4-flash", "DeekSeak"),
    )

    @Test
    fun `matching by model id is ambiguous and can pick the wrong instance`() {
        // The pre-fix lookup. The request ran on DeekSeak, but this returns
        // Bailian purely because it is earlier in the list.
        val servedBy = entries[1]                       // DeekSeak actually served it
        val recovered = entries.find { it.modelId == servedBy.modelId }

        assertEquals("Bailian OpenAI", recovered?.instanceLabel)
        assertNotEquals(
            "the model-id lookup must be shown to disagree with reality",
            servedBy.instanceLabel,
            recovered?.instanceLabel,
        )
    }

    @Test
    fun `matching by entry id resolves the instance that actually served`() {
        // The fix: the fallback candidate carries its own entry id.
        val servedBy = entries[1]
        val recovered = entries.find { it.id == servedBy.id }

        assertEquals("DeekSeak", recovered?.instanceLabel)
        assertEquals(servedBy.id, recovered?.id)
    }

    @Test
    fun `entry-id lookup is stable regardless of list order`() {
        // Ordering of modelEntries is not a contract (sync, edits and imports
        // reorder it), so the fix must not depend on it — the old one did.
        val servedBy = entries[1]
        for (list in listOf(entries, entries.reversed())) {
            assertEquals("DeekSeak", list.find { it.id == servedBy.id }?.instanceLabel)
        }
    }

    @Test
    fun `the persisted binding records the serving entry, not a same-model sibling`() {
        // lastEntryId is what re-entering the session restores from. Writing the
        // ambiguous match here is what made the wrong instance sticky.
        val servedBy = entries[1]
        val persisted = entries.find { it.id == servedBy.id }!!.id

        assertEquals("58fe6f1f/deepseek-v4-flash", persisted)
        assertNotEquals("522ba52e/deepseek-v4-flash", persisted)
    }
}
