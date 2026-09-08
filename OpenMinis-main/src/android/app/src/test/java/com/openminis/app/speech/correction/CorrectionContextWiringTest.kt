package com.openminis.app.speech.correction

import com.openminis.app.ui.chat.AssistantBlock
import com.openminis.app.ui.chat.ChatMessage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * [T-android-correction-context-wiring] Covers the pure UI-message → correction
 * source-message transform (`VoiceCorrection.toSourceMessages`) that feeds AI
 * voice correction its conversation context. Mirrors the filtering rules of iOS
 * `voiceCorrectionContext(from:)`:
 *  - only user / assistant turns survive (system dividers + notices dropped),
 *  - assistant prose is read from text blocks, not `content`,
 *  - attachment markup is stripped,
 *  - tool / thinking / info blocks contribute nothing.
 */
class CorrectionContextWiringTest {

    private fun msg(
        role: String,
        content: String = "",
        blocks: List<AssistantBlock> = emptyList(),
    ) = ChatMessage(id = "m", role = role, content = content, toolBlocks = blocks)

    private fun block(kind: String, content: String) =
        AssistantBlock(id = "b", kind = kind, content = content)

    @Test
    fun `system rows are dropped`() {
        val out = VoiceCorrection.toSourceMessages(
            listOf(
                msg("user", "带我去石塘"),
                msg("system", "Compacted 3 messages"),   // compact divider / notice
                msg("assistant", "好的"),
            ),
        )
        assertEquals(2, out.size)
        assertTrue(out.none { it.text.contains("Compacted") })
        assertEquals(CorrectionSourceMessage.Role.USER, out[0].role)
        assertEquals(CorrectionSourceMessage.Role.ASSISTANT, out[1].role)
    }

    @Test
    fun `assistant prose comes from text blocks, not the content fragment`() {
        // content holds a stale title fragment; the real reply lives in blocks.
        val out = VoiceCorrection.toSourceMessages(
            listOf(
                msg(
                    "assistant",
                    content = "关于食堂的对话",
                    blocks = listOf(
                        block("thinking", "让我想想…"),
                        block("text", "食堂在二号楼。"),
                        block("tool_use", "shell_execute ls"),
                    ),
                ),
            ),
        )
        assertEquals(1, out.size)
        assertEquals("食堂在二号楼。", out[0].text)
        // tool / thinking payloads must not leak in.
        assertTrue(!out[0].text.contains("让我想想"))
        assertTrue(!out[0].text.contains("shell_execute"))
    }

    @Test
    fun `assistant falls back to content when there are no text blocks`() {
        val out = VoiceCorrection.toSourceMessages(
            listOf(
                msg(
                    "assistant",
                    content = "直接回答",
                    blocks = listOf(block("tool_use", "curl x")),
                ),
            ),
        )
        assertEquals(1, out.size)
        assertEquals("直接回答", out[0].text)
    }

    @Test
    fun `user attachment markup is stripped`() {
        val out = VoiceCorrection.toSourceMessages(
            listOf(
                msg("user", "看这个 <user-attached-files>report.pdf</user-attached-files> 文件"),
            ),
        )
        assertEquals(1, out.size)
        assertTrue("got: ${out[0].text}", !out[0].text.contains("user-attached-files"))
        assertTrue(out[0].text.contains("看这个"))
        assertTrue(out[0].text.contains("文件"))
    }

    @Test
    fun `blank messages produce no source entry`() {
        val out = VoiceCorrection.toSourceMessages(
            listOf(
                msg("user", "   "),
                msg("assistant", content = "", blocks = listOf(block("text", "  "))),
            ),
        )
        assertTrue(out.isEmpty())
    }

    @Test
    fun `ordinary user and assistant text is preserved verbatim`() {
        val out = VoiceCorrection.toSourceMessages(
            listOf(msg("user", "明天中午在食堂吃饭")),
        )
        assertEquals(1, out.size)
        assertEquals("明天中午在食堂吃饭", out[0].text)
    }
}
