package com.openminis.app.ui.chat

import com.openminis.app.data.model.AgentToolDefinition
import com.openminis.app.data.model.AgentToolParam
import org.json.JSONObject
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * [T-preflight-empty-string-allowed] Tests for `preflightValidateToolCall`.
 *
 * Mirrors iOS MinisTests/ToolPreflightTests.swift. The function is pure and
 * lives in ChatViewModel's companion precisely so these can run without
 * constructing a ChatViewModel.
 */
class ToolPreflightTest {

    private fun param(desc: String) = AgentToolParam(type = "string", description = desc)

    private val fileEdit = AgentToolDefinition(
        name = "file_edit",
        description = "Edit a file",
        parameters = mapOf(
            "path" to param("File path"),
            "old_string" to param("Text to replace"),
            "new_string" to param("The replacement text. Use empty string to delete old_string."),
        ),
        required = listOf("path", "old_string", "new_string"),
    )

    private val shellExecute = AgentToolDefinition(
        name = "shell_execute",
        description = "Run a shell command",
        parameters = mapOf("command" to param("Command")),
        required = listOf("command"),
    )

    private val withToolTitle = AgentToolDefinition(
        name = "titled_tool",
        description = "Tool whose only required field is non-blocking",
        parameters = mapOf("tool_title" to param("Title")),
        required = listOf("tool_title"),
    )

    private val tools = listOf(fileEdit, shellExecute, withToolTitle)

    private fun validate(name: String, json: String): String? =
        ChatViewModel.preflightValidateToolCallImpl(name, JSONObject(json), tools)

    // ── The reported bug: empty new_string is the documented delete form ──

    @Test
    fun `file_edit with empty new_string is allowed`() {
        assertNull(
            validate("file_edit", """{"path":"/a.txt","old_string":"gone","new_string":""}"""),
        )
    }

    @Test
    fun `file_edit with whitespace-only new_string is allowed`() {
        // Replacing a block with a newline or spaces is a valid edit, not
        // stream corruption. The old .trim().isEmpty() rejected both.
        assertNull(
            validate("file_edit", """{"path":"/a.txt","old_string":"x","new_string":"\n"}"""),
        )
        assertNull(
            validate("file_edit", """{"path":"/a.txt","old_string":"x","new_string":"  "}"""),
        )
        assertNull(
            validate("file_edit", """{"path":"/a.txt","old_string":"x","new_string":"\t"}"""),
        )
    }

    @Test
    fun `file_edit with whitespace-only old_string is allowed`() {
        // old_string:"  " matches consecutive spaces — also a legitimate edit,
        // and it is NOT on the empty-string whitelist, proving the trim removal
        // is what permits it rather than the whitelist.
        assertNull(
            validate("file_edit", """{"path":"/a.txt","old_string":"  ","new_string":"y"}"""),
        )
    }

    @Test
    fun `file_edit missing new_string entirely is still blocked`() {
        val err = validate("file_edit", """{"path":"/a.txt","old_string":"x"}""")
        assertNotNull(err)
        assertTrue("got: $err", err!!.contains("new_string"))
    }

    // ── The whitelist is per-(tool, field), not blanket ──

    @Test
    fun `file_edit with empty old_string is still blocked`() {
        // Only new_string is whitelisted; an empty old_string matches nothing
        // and is a real error.
        val err = validate("file_edit", """{"path":"/a.txt","old_string":"","new_string":"y"}""")
        assertNotNull(err)
        assertTrue("got: $err", err!!.contains("old_string"))
    }

    @Test
    fun `file_edit with empty path is still blocked`() {
        val err = validate("file_edit", """{"path":"","old_string":"x","new_string":"y"}""")
        assertNotNull(err)
        assertTrue("got: $err", err!!.contains("path"))
    }

    @Test
    fun `shell_execute with empty command is still blocked`() {
        val err = validate("shell_execute", """{"command":""}""")
        assertNotNull(err)
        assertTrue("got: $err", err!!.contains("command"))
    }

    @Test
    fun `the whitelist helper is scoped to the exact tool and field`() {
        assertTrue(ChatViewModel.preflightEmptyStringAllowed("file_edit", "new_string"))
        assertTrue(!ChatViewModel.preflightEmptyStringAllowed("file_edit", "old_string"))
        // Another tool must not inherit file_edit's allowance.
        assertTrue(!ChatViewModel.preflightEmptyStringAllowed("file_write", "new_string"))
        assertTrue(!ChatViewModel.preflightEmptyStringAllowed("shell_execute", "command"))
    }

    // ── JSON null counts as missing ──

    @Test
    fun `an explicit JSON null is treated as missing`() {
        // org.json reports has()==true for {"x":null} and opt() returns
        // JSONObject.NULL — not a String — so a null used to slip through both
        // checks and reach the tool as a non-String value.
        val err = validate("file_edit", """{"path":"/a.txt","old_string":"x","new_string":null}""")
        assertNotNull(err)
        assertTrue("got: $err", err!!.contains("new_string"))
    }

    @Test
    fun `a JSON null is missing even for a whitelisted field`() {
        // The whitelist permits "" as CONTENT; it does not make the field
        // optional.
        val err = validate("shell_execute", """{"command":null}""")
        assertNotNull(err)
        assertTrue("got: $err", err!!.contains("command"))
    }

    // ── Unchanged behaviour ──

    @Test
    fun `a well-formed call passes`() {
        assertNull(
            validate("file_edit", """{"path":"/a.txt","old_string":"x","new_string":"y"}"""),
        )
        assertNull(validate("shell_execute", """{"command":"ls"}"""))
    }

    @Test
    fun `empty args on a tool that requires fields is blocked`() {
        val err = validate("shell_execute", "{}")
        assertNotNull(err)
        assertTrue("got: $err", err!!.contains("empty arguments"))
    }

    @Test
    fun `empty args are fine when every required field is non-blocking`() {
        // tool_title is skipped entirely, so nothing is actually enforced.
        assertNull(validate("titled_tool", "{}"))
    }

    @Test
    fun `a missing tool_title never blocks`() {
        assertNull(validate("titled_tool", """{"other":"value"}"""))
    }

    @Test
    fun `an unknown tool stays silent`() {
        // Dispatch already returns "Unknown tool: …"; preflight must not
        // double-fail.
        assertNull(validate("not_a_real_tool", "{}"))
        assertNull(validate("not_a_real_tool", """{"anything":""}"""))
    }

    @Test
    fun `multiple missing fields are all reported`() {
        val err = validate("file_edit", """{"path":"/a.txt"}""")
        assertNotNull(err)
        assertTrue("got: $err", err!!.contains("old_string"))
        assertTrue("got: $err", err.contains("new_string"))
    }

    @Test
    fun `non-string values are not subjected to the emptiness check`() {
        val numeric = AgentToolDefinition(
            name = "numeric_tool",
            description = "Takes a number",
            parameters = mapOf("count" to AgentToolParam("integer", "How many")),
            required = listOf("count"),
        )
        assertNull(
            ChatViewModel.preflightValidateToolCallImpl(
                "numeric_tool", JSONObject("""{"count":0}"""), listOf(numeric),
            ),
        )
    }
}
