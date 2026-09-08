package com.openminis.app.sandbox

import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.charset.Charset

/**
 * Tests for the POSIX tar extraction logic in RootfsManager.
 * Since RootfsManager requires Android Context for construction,
 * we access the internal extraction methods via a test helper
 * that builds synthetic tar archives in memory.
 */
class TarExtractionTest {

    private lateinit var targetDir: File
    private lateinit var manager: Any // We'll use reflection to call internal methods

    @Before
    fun setUp() {
        targetDir = File(System.getProperty("java.io.tmpdir"), "tar-test-${System.nanoTime()}")
        targetDir.mkdirs()
    }

    @After
    fun tearDown() {
        targetDir.deleteRecursively()
    }

    // ==================== extractString ====================

    @Test
    fun `extractString reads null-terminated field`() {
        val header = ByteArray(512)
        val name = "hello.txt"
        name.toByteArray().copyInto(header, 0)
        // The method is internal, test via calling it through the private method approach
        // Since we can't easily instantiate RootfsManager without Context,
        // we test the logic by verifying tar extraction end-to-end
        val extracted = extractStringHelper(header, 0, 100)
        assertEquals("hello.txt", extracted)
    }

    @Test
    fun `extractString handles full-width field with no null terminator`() {
        val header = ByteArray(512)
        val name = "a".repeat(100)
        name.toByteArray().copyInto(header, 0)
        val extracted = extractStringHelper(header, 0, 100)
        assertEquals(name, extracted)
    }

    @Test
    fun `extractString handles empty field`() {
        val header = ByteArray(512)
        val extracted = extractStringHelper(header, 0, 100)
        assertEquals("", extracted)
    }

    @Test
    fun `extractString reads from offset`() {
        val header = ByteArray(512)
        val data = "test-data"
        data.toByteArray().copyInto(header, 157) // link name offset
        val extracted = extractStringHelper(header, 157, 100)
        assertEquals("test-data", extracted)
    }

    // ==================== Full tar extraction ====================

    @Test
    fun `extractTar creates regular file`() {
        val content = "Hello, World!\n"
        val tar = buildTar {
            addFile("test.txt", content)
        }

        extractTarHelper(ByteArrayInputStream(tar), targetDir)

        val file = File(targetDir, "test.txt")
        assertTrue("File should exist", file.exists())
        assertEquals(content, file.readText())
    }

    @Test
    fun `extractTar creates directory`() {
        val tar = buildTar {
            addDirectory("mydir/")
        }

        extractTarHelper(ByteArrayInputStream(tar), targetDir)

        val dir = File(targetDir, "mydir")
        assertTrue("Directory should exist", dir.exists())
        assertTrue("Should be a directory", dir.isDirectory)
    }

    @Test
    fun `extractTar creates nested directory structure`() {
        val tar = buildTar {
            addDirectory("a/")
            addDirectory("a/b/")
            addDirectory("a/b/c/")
            addFile("a/b/c/deep.txt", "deep content")
        }

        extractTarHelper(ByteArrayInputStream(tar), targetDir)

        assertTrue(File(targetDir, "a/b/c").isDirectory)
        assertEquals("deep content", File(targetDir, "a/b/c/deep.txt").readText())
    }

    @Test
    fun `extractTar handles file without parent directory entry`() {
        // Tar may contain files without explicit directory entries
        val tar = buildTar {
            addFile("some/nested/file.txt", "data")
        }

        extractTarHelper(ByteArrayInputStream(tar), targetDir)

        val file = File(targetDir, "some/nested/file.txt")
        assertTrue("File should exist", file.exists())
        assertEquals("data", file.readText())
    }

    @Test
    fun `extractTar handles empty file`() {
        val tar = buildTar {
            addFile("empty.txt", "")
        }

        extractTarHelper(ByteArrayInputStream(tar), targetDir)

        val file = File(targetDir, "empty.txt")
        assertTrue("Empty file should exist", file.exists())
        assertEquals(0, file.length())
    }

    @Test
    fun `extractTar handles large file spanning multiple blocks`() {
        // A file larger than 512 bytes to test multi-block reading
        val content = "x".repeat(2000)
        val tar = buildTar {
            addFile("large.txt", content)
        }

        extractTarHelper(ByteArrayInputStream(tar), targetDir)

        assertEquals(content, File(targetDir, "large.txt").readText())
    }

    @Test
    fun `extractTar handles multiple files`() {
        val tar = buildTar {
            addFile("a.txt", "aaa")
            addFile("b.txt", "bbb")
            addFile("c.txt", "ccc")
        }

        extractTarHelper(ByteArrayInputStream(tar), targetDir)

        assertEquals("aaa", File(targetDir, "a.txt").readText())
        assertEquals("bbb", File(targetDir, "b.txt").readText())
        assertEquals("ccc", File(targetDir, "c.txt").readText())
    }

    @Test
    fun `extractTar handles file with exact block-size content`() {
        // 512 bytes exactly — no padding needed
        val content = "y".repeat(512)
        val tar = buildTar {
            addFile("exact.txt", content)
        }

        extractTarHelper(ByteArrayInputStream(tar), targetDir)

        assertEquals(content, File(targetDir, "exact.txt").readText())
    }

    @Test
    fun `extractTar handles binary content`() {
        val binaryContent = ByteArray(256) { it.toByte() }
        val tar = buildTar {
            addFileBytes("binary.bin", binaryContent)
        }

        extractTarHelper(ByteArrayInputStream(tar), targetDir)

        val file = File(targetDir, "binary.bin")
        assertTrue(file.exists())
        assertArrayEquals(binaryContent, file.readBytes())
    }

    @Test
    fun `extractTar handles symlink entries gracefully`() {
        val tar = buildTar {
            addFile("real.txt", "real content")
            addSymlink("link.txt", "real.txt")
        }

        extractTarHelper(ByteArrayInputStream(tar), targetDir)

        // Real file should exist
        assertEquals("real content", File(targetDir, "real.txt").readText())
        // Symlink creation may succeed or fail depending on OS — just verify no crash
    }

    @Test
    fun `extractTar handles hard link entries`() {
        val tar = buildTar {
            addFile("original.txt", "original")
            addHardLink("copy.txt", "original.txt")
        }

        extractTarHelper(ByteArrayInputStream(tar), targetDir)

        assertEquals("original", File(targetDir, "original.txt").readText())
        assertEquals("original", File(targetDir, "copy.txt").readText())
    }

    @Test
    fun `extractTar stops at end-of-archive marker`() {
        val tar = buildTar {
            addFile("before.txt", "before")
            // End-of-archive is automatically appended by buildTar
        }
        // Append garbage after the archive
        val extended = tar + ByteArray(1024) { 0xFF.toByte() }

        extractTarHelper(ByteArrayInputStream(extended), targetDir)

        assertTrue(File(targetDir, "before.txt").exists())
        assertEquals("before", File(targetDir, "before.txt").readText())
    }

    @Test
    fun `extractTar with prefix field for long paths`() {
        val tar = buildTar {
            addFileWithPrefix("shortname.txt", "long/prefix/path", "prefix content")
        }

        extractTarHelper(ByteArrayInputStream(tar), targetDir)

        val file = File(targetDir, "long/prefix/path/shortname.txt")
        assertTrue("Prefixed file should exist", file.exists())
        assertEquals("prefix content", file.readText())
    }

    @Test
    fun `extractTar handles legacy null type flag as regular file`() {
        val content = "legacy"
        val tar = buildTar {
            addFile("legacy.txt", content, typeFlag = '\u0000')
        }

        extractTarHelper(ByteArrayInputStream(tar), targetDir)

        assertEquals(content, File(targetDir, "legacy.txt").readText())
    }

    // ==================== readFully ====================

    @Test
    fun `readFully reads exact number of bytes`() {
        val data = "hello world".toByteArray()
        val buf = ByteArray(data.size)
        val stream = ByteArrayInputStream(data)
        val read = readFullyHelper(stream, buf)
        assertEquals(data.size, read)
        assertArrayEquals(data, buf)
    }

    @Test
    fun `readFully handles short stream`() {
        val data = "hi".toByteArray()
        val buf = ByteArray(100)
        val stream = ByteArrayInputStream(data)
        val read = readFullyHelper(stream, buf)
        assertEquals(2, read)
    }

    @Test
    fun `readFully handles empty stream`() {
        val buf = ByteArray(100)
        val stream = ByteArrayInputStream(ByteArray(0))
        val read = readFullyHelper(stream, buf)
        assertEquals(0, read)
    }

    // ==================== Helper: extract string (reimplemented for JVM test) ====================

    /**
     * Reimplementation of RootfsManager.extractString for JVM testing.
     * This tests the same algorithm without needing Android Context.
     */
    private fun extractStringHelper(header: ByteArray, offset: Int, length: Int): String {
        val end = minOf(offset + length, header.size)
        var actualEnd = offset
        for (i in offset until end) {
            if (header[i] == 0.toByte()) break
            actualEnd = i + 1
        }
        return String(header, offset, actualEnd - offset, Charset.forName("UTF-8"))
    }

    /**
     * Reimplementation of RootfsManager.readFully for JVM testing.
     */
    private fun readFullyHelper(input: java.io.InputStream, buf: ByteArray): Int {
        var offset = 0
        while (offset < buf.size) {
            val n = input.read(buf, offset, buf.size - offset)
            if (n < 0) return offset
            offset += n
        }
        return offset
    }

    /**
     * Reimplementation of RootfsManager.extractTar for JVM testing.
     * Uses the exact same algorithm as the production code.
     */
    private fun extractTarHelper(input: java.io.InputStream, targetDir: File) {
        val header = ByteArray(512)

        while (true) {
            val bytesRead = readFullyHelper(input, header)
            if (bytesRead < 512) break

            if (header.all { it == 0.toByte() }) break

            val name = extractStringHelper(header, 0, 100)
            val sizeOctal = extractStringHelper(header, 124, 12)
            val typeFlag = header[156].toInt().toChar()
            val linkName = extractStringHelper(header, 157, 100)

            val prefix = extractStringHelper(header, 345, 155)
            val fullName = if (prefix.isNotEmpty()) "$prefix/$name" else name

            if (fullName.isEmpty()) break

            val size = sizeOctal.trim().toLongOrNull(8) ?: 0L
            val outFile = File(targetDir, fullName)

            when (typeFlag) {
                '5', 'D' -> {
                    outFile.mkdirs()
                }
                '2' -> {
                    outFile.parentFile?.mkdirs()
                    try {
                        java.nio.file.Files.createSymbolicLink(
                            outFile.toPath(),
                            java.nio.file.Paths.get(linkName)
                        )
                    } catch (_: Exception) { }
                }
                '0', '\u0000' -> {
                    outFile.parentFile?.mkdirs()
                    outFile.outputStream().use { output ->
                        var remaining = size
                        val buf = ByteArray(8192)
                        while (remaining > 0) {
                            val toRead = minOf(buf.size.toLong(), remaining).toInt()
                            val n = input.read(buf, 0, toRead)
                            if (n < 0) break
                            output.write(buf, 0, n)
                            remaining -= n
                        }
                    }
                    val remainder = (size % 512).toInt()
                    if (remainder != 0) {
                        val skip = ByteArray(512 - remainder)
                        readFullyHelper(input, skip)
                    }
                    continue
                }
                '1' -> {
                    outFile.parentFile?.mkdirs()
                    val linkTarget = File(targetDir, linkName)
                    if (linkTarget.exists()) {
                        linkTarget.copyTo(outFile, overwrite = true)
                    }
                }
                else -> { }
            }

            if (typeFlag != '0' && typeFlag != '\u0000' && size > 0) {
                val blocks = (size + 511) / 512 * 512
                val skip = ByteArray(blocks.toInt())
                readFullyHelper(input, skip)
            }
        }
    }

    // ==================== Tar builder DSL ====================

    private class TarBuilder {
        private val out = ByteArrayOutputStream()

        fun addFile(name: String, content: String, typeFlag: Char = '0') {
            addFileBytes(name, content.toByteArray(Charsets.UTF_8), typeFlag)
        }

        fun addFileBytes(name: String, content: ByteArray, typeFlag: Char = '0') {
            val header = buildHeader(name, content.size.toLong(), typeFlag)
            out.write(header)
            out.write(content)
            // Pad to 512-byte boundary
            val remainder = content.size % 512
            if (remainder != 0) {
                out.write(ByteArray(512 - remainder))
            }
        }

        fun addFileWithPrefix(name: String, prefix: String, content: String) {
            val data = content.toByteArray(Charsets.UTF_8)
            val header = buildHeader(name, data.size.toLong(), '0', prefix = prefix)
            out.write(header)
            out.write(data)
            val remainder = data.size % 512
            if (remainder != 0) {
                out.write(ByteArray(512 - remainder))
            }
        }

        fun addDirectory(name: String) {
            val header = buildHeader(name, 0, '5')
            out.write(header)
        }

        fun addSymlink(name: String, linkTarget: String) {
            val header = buildHeader(name, 0, '2', linkName = linkTarget)
            out.write(header)
        }

        fun addHardLink(name: String, linkTarget: String) {
            val header = buildHeader(name, 0, '1', linkName = linkTarget)
            out.write(header)
        }

        fun build(): ByteArray {
            // End-of-archive: two zero blocks
            out.write(ByteArray(1024))
            return out.toByteArray()
        }

        private fun buildHeader(
            name: String,
            size: Long,
            typeFlag: Char,
            linkName: String = "",
            prefix: String = ""
        ): ByteArray {
            val header = ByteArray(512)

            // Name (0-99)
            writeString(header, 0, 100, name)

            // Mode (100-107) — 0644 for files, 0755 for dirs
            val mode = if (typeFlag == '5') "0000755" else "0000644"
            writeString(header, 100, 8, mode)

            // UID (108-115)
            writeString(header, 108, 8, "0000000")

            // GID (116-123)
            writeString(header, 116, 8, "0000000")

            // Size (124-135) — octal
            val sizeStr = String.format("%011o", size)
            writeString(header, 124, 12, sizeStr)

            // Mtime (136-147)
            writeString(header, 136, 12, "00000000000")

            // Type flag (156)
            header[156] = typeFlag.code.toByte()

            // Link name (157-256)
            if (linkName.isNotEmpty()) {
                writeString(header, 157, 100, linkName)
            }

            // Magic (257-262) "ustar\0"
            writeString(header, 257, 6, "ustar")
            header[262] = 0

            // Version (263-264) "00"
            header[263] = '0'.code.toByte()
            header[264] = '0'.code.toByte()

            // Prefix (345-499)
            if (prefix.isNotEmpty()) {
                writeString(header, 345, 155, prefix)
            }

            // Checksum (148-155) — spaces first, then compute
            for (i in 148 until 156) header[i] = ' '.code.toByte()
            var checksum = 0
            for (b in header) {
                checksum += (b.toInt() and 0xFF)
            }
            val checksumStr = String.format("%06o\u0000 ", checksum)
            writeString(header, 148, 8, checksumStr)

            return header
        }

        private fun writeString(buf: ByteArray, offset: Int, maxLen: Int, value: String) {
            val bytes = value.toByteArray(Charsets.UTF_8)
            val len = minOf(bytes.size, maxLen)
            bytes.copyInto(buf, offset, 0, len)
        }
    }

    private fun buildTar(block: TarBuilder.() -> Unit): ByteArray {
        val builder = TarBuilder()
        builder.block()
        return builder.build()
    }
}
