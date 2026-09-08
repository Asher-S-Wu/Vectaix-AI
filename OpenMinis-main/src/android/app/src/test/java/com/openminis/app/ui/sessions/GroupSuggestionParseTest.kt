package com.openminis.app.ui.sessions

import com.openminis.app.data.db.FolderEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * [T-android-group-ai-suggest] Unit tests for the "✨ AI Suggest" reply parser.
 *
 * This is the part of the feature that meets untrusted model output, and the
 * iOS original accumulated its rules from real failures (a "merge" naming a
 * folder that never existed, JSON wrapped in prose, duplicate folder names).
 * Each of those is pinned here so the Android port cannot regress past them.
 */
class GroupSuggestionParseTest {

    private fun folder(id: String, name: String, updatedAt: Long = 0L) = FolderEntity(
        id = id,
        name = name,
        createdAt = 0L,
        updatedAt = updatedAt,
    )

    private val folders = listOf(
        folder("f-work", "Work", updatedAt = 100L),
        folder("f-trip", "Trip Planning", updatedAt = 200L),
    )

    @Test
    fun `merge resolves the named folder to its id`() {
        val r = SessionListViewModel.parseGroupSuggestion(
            """{"decision": "merge", "folder": "Work"}""",
            folders,
        )
        assertEquals(SessionListViewModel.GroupSuggestion.Merge("f-work", "Work"), r)
    }

    @Test
    fun `merge matching is case and whitespace insensitive`() {
        val r = SessionListViewModel.parseGroupSuggestion(
            """{"decision": "merge", "folder": "  wORk "}""",
            folders,
        )
        assertEquals(SessionListViewModel.GroupSuggestion.Merge("f-work", "Work"), r)
    }

    @Test
    fun `duplicate folder names tie-break on most recently updated`() {
        // Two devices each created "Work" offline — both rows survive, so the
        // merge must land on a predictable one rather than list order.
        val dupes = listOf(
            folder("f-old", "Work", updatedAt = 10L),
            folder("f-new", "Work", updatedAt = 999L),
        )
        val r = SessionListViewModel.parseGroupSuggestion(
            """{"decision": "merge", "folder": "Work"}""",
            dupes,
        )
        assertEquals(SessionListViewModel.GroupSuggestion.Merge("f-new", "Work"), r)
    }

    @Test
    fun `merge naming a nonexistent folder degrades to create`() {
        // iOS behaviour: never invent a membership, but still hand the user a
        // one-tap path with the model's string prefilled.
        val r = SessionListViewModel.parseGroupSuggestion(
            """{"decision": "merge", "folder": "Nonexistent"}""",
            folders,
        )
        assertEquals(SessionListViewModel.GroupSuggestion.Create("Nonexistent", null), r)
    }

    @Test
    fun `create carries name and description`() {
        val r = SessionListViewModel.parseGroupSuggestion(
            """{"decision": "create", "name": "Travel", "description": "Flights and hotels"}""",
            folders,
        )
        assertEquals(
            SessionListViewModel.GroupSuggestion.Create("Travel", "Flights and hotels"),
            r,
        )
    }

    @Test
    fun `json wrapped in prose and a fence still parses`() {
        val raw = """
            Sure! Here is my suggestion:
            ```json
            {"decision": "create", "name": "阅读笔记", "description": "读书与文章摘录"}
            ```
            Hope that helps.
        """.trimIndent()
        val r = SessionListViewModel.parseGroupSuggestion(raw, folders)
        assertEquals(
            SessionListViewModel.GroupSuggestion.Create("阅读笔记", "读书与文章摘录"),
            r,
        )
    }

    @Test
    fun `description is capped at the storage limit`() {
        val long = "x".repeat(500)
        val r = SessionListViewModel.parseGroupSuggestion(
            """{"decision": "create", "name": "N", "description": "$long"}""",
            folders,
        )
        val create = r as SessionListViewModel.GroupSuggestion.Create
        assertEquals(FolderEntity.DESC_MAX_CHARS, create.description!!.length)
    }

    @Test
    fun `blank description collapses to null`() {
        val r = SessionListViewModel.parseGroupSuggestion(
            """{"decision": "create", "name": "N", "description": "   "}""",
            folders,
        )
        assertEquals(SessionListViewModel.GroupSuggestion.Create("N", null), r)
    }

    @Test
    fun `no name anywhere yields null rather than an empty group`() {
        val r = SessionListViewModel.parseGroupSuggestion(
            """{"decision": "create", "description": "no name here"}""",
            folders,
        )
        assertNull(r)
    }

    @Test
    fun `non json output yields null`() {
        assertNull(SessionListViewModel.parseGroupSuggestion("I could not decide.", folders))
        assertNull(SessionListViewModel.parseGroupSuggestion("", folders))
        assertNull(SessionListViewModel.parseGroupSuggestion("{ broken", folders))
    }

    @Test
    fun `truncated json yields null instead of throwing`() {
        // A reasoning model that burns its budget mid-emit produces exactly
        // this; it must degrade to "failed — try again", never crash.
        val r = SessionListViewModel.parseGroupSuggestion(
            """{"decision": "create", "name": "Tra""",
            folders,
        )
        assertNull(r)
    }

    @Test
    fun `bare folder key without decision is treated as a create name`() {
        val r = SessionListViewModel.parseGroupSuggestion(
            """{"folder": "Ideas"}""",
            folders,
        )
        assertTrue(r is SessionListViewModel.GroupSuggestion.Create)
        assertEquals("Ideas", (r as SessionListViewModel.GroupSuggestion.Create).name)
    }
}
