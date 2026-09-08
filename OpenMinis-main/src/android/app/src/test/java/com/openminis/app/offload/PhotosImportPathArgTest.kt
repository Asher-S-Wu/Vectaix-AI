package com.openminis.app.offload

import com.openminis.app.sandbox.offload.OffloadArgs
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * [T-photos-positional-path] `android-photos import` must accept the file path
 * positionally (`import <file>`) as well as via `--path <file>`, matching
 * apple-photos on iOS.
 *
 * The path is resolved with `args.get("path") ?: args.positional.getOrNull(1)`
 * — index 1 because positional[0] is the subcommand itself. These cases pin the
 * interaction with OffloadArgs' real parsing rules, which are non-obvious:
 * `--compact` is a declared boolean flag (so it must NOT swallow the following
 * path), while an undeclared flag like `--album-name` consumes its next token.
 */
class PhotosImportPathArgTest {

    /** Mirrors the resolution expression in PhotosOffloadHandler.handleImport. */
    private fun resolvePath(argv: List<String>): String? {
        val args = OffloadArgs(argv)
        return args.get("path") ?: args.positional.getOrNull(1)
    }

    @Test
    fun `positional path is accepted`() {
        assertEquals("/var/minis/offloads/p.jpg", resolvePath(listOf("import", "/var/minis/offloads/p.jpg")))
    }

    @Test
    fun `path flag still works`() {
        assertEquals("/var/minis/offloads/p.jpg", resolvePath(listOf("import", "--path", "/var/minis/offloads/p.jpg")))
    }

    @Test
    fun `save alias accepts positional`() {
        assertEquals("/x/y.png", resolvePath(listOf("save", "/x/y.png")))
    }

    @Test
    fun `equals form of path flag works`() {
        assertEquals("/eq/v.jpg", resolvePath(listOf("import", "--path=/eq/v.jpg")))
    }

    @Test
    fun `boolean output flag does not swallow the positional path`() {
        // --compact is declared boolean at parser level; without that, it would
        // greedily consume the path as its value.
        assertEquals("/c/p.jpg", resolvePath(listOf("import", "--compact", "/c/p.jpg")))
    }

    @Test
    fun `positional path coexists with album-name flag`() {
        assertEquals("/p.jpg", resolvePath(listOf("import", "/p.jpg", "--album-name", "Trip")))
        assertEquals("/p.jpg", resolvePath(listOf("import", "--album-name", "Trip", "/p.jpg")))
    }

    @Test
    fun `explicit flag wins over a stray positional`() {
        assertEquals("/flag.jpg", resolvePath(listOf("import", "--path", "/flag.jpg", "/pos.jpg")))
    }

    @Test
    fun `missing path resolves to null so the handler can error`() {
        assertNull(resolvePath(listOf("import")))
    }
}
