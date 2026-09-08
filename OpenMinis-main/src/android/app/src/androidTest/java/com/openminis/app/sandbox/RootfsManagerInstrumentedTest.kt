package com.openminis.app.sandbox

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.zip.GZIPOutputStream

/**
 * On-device tests for RootfsManager.
 * Tests rootfs installation, directory creation, session dirs, and reset.
 *
 * Run on real device: ./gradlew connectedAndroidTest
 */
@RunWith(AndroidJUnit4::class)
class RootfsManagerInstrumentedTest {

    private lateinit var context: Context
    private lateinit var manager: RootfsManager

    @Before
    fun setUp() {
        context = InstrumentationRegistry.getInstrumentation().targetContext

        // Clear singleton for clean state
        resetSingleton()
        manager = RootfsManager.getInstance(context)

        // Clean up from previous test runs
        manager.rootfsDir.deleteRecursively()
        manager.prootBinary.parentFile?.deleteRecursively()
    }

    @After
    fun tearDown() {
        manager.rootfsDir.deleteRecursively()
        manager.prootBinary.parentFile?.deleteRecursively()
        resetSingleton()
    }

    // ==================== isInstalled ====================

    @Test
    fun isNotInstalledWhenDirDoesNotExist() {
        assertFalse(manager.isInstalled)
    }

    @Test
    fun isNotInstalledWhenArchFileMissing() {
        manager.rootfsDir.mkdirs()
        assertFalse(manager.isInstalled)
    }

    @Test
    fun isNotInstalledWhenArchMismatch() {
        manager.rootfsDir.mkdirs()
        File(manager.rootfsDir, ".arch").writeText("x86_64")
        assertFalse(manager.isInstalled)
    }

    @Test
    fun isInstalledWhenRootfsAndArchPresent() {
        manager.rootfsDir.mkdirs()
        File(manager.rootfsDir, ".arch").writeText("aarch64")
        assertTrue(manager.isInstalled)
    }

    // ==================== installIfNeeded ====================

    @Test
    fun installIfNeededExtractsRootfsFromAssets() = runBlocking {
        // This test requires alpine-minirootfs.tar.gz in assets.
        // Skip if not present (CI or pre-asset-download)
        if (!hasAsset("alpine-minirootfs.tar.gz")) {
            println("SKIP: alpine-minirootfs.tar.gz not in assets")
            return@runBlocking
        }

        manager.installIfNeeded()

        assertTrue("rootfsDir should exist", manager.rootfsDir.exists())
        assertTrue("Should be marked installed", manager.isInstalled)

        // Verify arch marker
        val archFile = File(manager.rootfsDir, ".arch")
        assertEquals("aarch64", archFile.readText().trim())

        // Verify /var/minis subdirs created
        val expectedDirs = listOf("attachments", "offloads", "workspace", "skills", "memory")
        for (subdir in expectedDirs) {
            val dir = File(manager.rootfsDir, "var/minis/$subdir")
            assertTrue("var/minis/$subdir should exist", dir.exists())
            assertTrue("var/minis/$subdir should be directory", dir.isDirectory)
        }

        // Verify resolv.conf
        val resolv = File(manager.rootfsDir, "etc/resolv.conf")
        assertTrue("resolv.conf should exist", resolv.exists())
        val content = resolv.readText()
        assertTrue("Should contain 8.8.8.8", content.contains("8.8.8.8"))
        assertTrue("Should contain 8.8.4.4", content.contains("8.8.4.4"))
    }

    @Test
    fun installIfNeededIsIdempotent() = runBlocking {
        if (!hasAsset("alpine-minirootfs.tar.gz")) {
            println("SKIP: alpine-minirootfs.tar.gz not in assets")
            return@runBlocking
        }

        manager.installIfNeeded()
        val firstModTime = File(manager.rootfsDir, ".arch").lastModified()

        // Small delay to detect any file modification
        Thread.sleep(50)

        manager.installIfNeeded()
        val secondModTime = File(manager.rootfsDir, ".arch").lastModified()

        assertEquals("Should not re-extract if already installed", firstModTime, secondModTime)
    }

    @Test
    fun installIfNeededCleansPartialInstall() = runBlocking {
        if (!hasAsset("alpine-minirootfs.tar.gz")) {
            println("SKIP: alpine-minirootfs.tar.gz not in assets")
            return@runBlocking
        }

        // Create a partial install (dir exists but no .arch)
        manager.rootfsDir.mkdirs()
        File(manager.rootfsDir, "stale-file.txt").writeText("stale")

        manager.installIfNeeded()

        assertTrue(manager.isInstalled)
        assertFalse("Stale file should be cleaned", File(manager.rootfsDir, "stale-file.txt").exists())
    }

    // ==================== installProotIfNeeded ====================

    @Test
    fun installProotIfNeededExtractsBinary() = runBlocking {
        if (!hasAsset("proot-aarch64")) {
            println("SKIP: proot-aarch64 not in assets")
            return@runBlocking
        }

        manager.installProotIfNeeded()

        assertTrue("PRoot binary should exist", manager.prootBinary.exists())
        assertTrue("PRoot binary should be executable", manager.prootBinary.canExecute())
        assertTrue("PRoot binary should not be empty", manager.prootBinary.length() > 0)
    }

    @Test
    fun installProotIfNeededIsIdempotent() = runBlocking {
        if (!hasAsset("proot-aarch64")) {
            println("SKIP: proot-aarch64 not in assets")
            return@runBlocking
        }

        manager.installProotIfNeeded()
        val firstSize = manager.prootBinary.length()

        manager.installProotIfNeeded()
        val secondSize = manager.prootBinary.length()

        assertEquals("Should not re-extract", firstSize, secondSize)
    }

    // ==================== ensureSessionDirs ====================

    @Test
    fun ensureSessionDirsCreatesAllSubdirs() {
        val sessionId = "test-session-${System.nanoTime()}"
        manager.ensureSessionDirs(sessionId)

        val sessionBase = File(context.filesDir, "minis-sessions/$sessionId")
        assertTrue(sessionBase.exists())

        val expectedSubdirs = listOf("attachments", "offloads", "workspace", "browser")
        for (subdir in expectedSubdirs) {
            val dir = File(sessionBase, subdir)
            assertTrue("$subdir should exist", dir.exists())
            assertTrue("$subdir should be directory", dir.isDirectory)
        }

        // Clean up
        sessionBase.deleteRecursively()
    }

    @Test
    fun ensureSessionDirsIsIdempotent() {
        val sessionId = "idempotent-session"
        manager.ensureSessionDirs(sessionId)
        manager.ensureSessionDirs(sessionId) // Should not throw

        val sessionBase = File(context.filesDir, "minis-sessions/$sessionId")
        assertTrue(sessionBase.exists())
        sessionBase.deleteRecursively()
    }

    // ==================== reset ====================

    @Test
    fun resetDeletesAndReinstalls() = runBlocking {
        if (!hasAsset("alpine-minirootfs.tar.gz")) {
            println("SKIP: alpine-minirootfs.tar.gz not in assets")
            return@runBlocking
        }

        manager.installIfNeeded()

        // Add a custom file
        File(manager.rootfsDir, "custom.txt").writeText("custom")
        assertTrue(File(manager.rootfsDir, "custom.txt").exists())

        manager.reset(keepUserData = false)

        assertTrue("Should be reinstalled", manager.isInstalled)
        assertFalse("Custom file should be gone", File(manager.rootfsDir, "custom.txt").exists())
    }

    @Test
    fun resetKeepsUserDataWhenRequested() = runBlocking {
        if (!hasAsset("alpine-minirootfs.tar.gz")) {
            println("SKIP: alpine-minirootfs.tar.gz not in assets")
            return@runBlocking
        }

        manager.installIfNeeded()

        // Create user data in /root
        val rootHome = File(manager.rootfsDir, "root")
        rootHome.mkdirs()
        File(rootHome, "userfile.txt").writeText("user data")

        manager.reset(keepUserData = true)

        assertTrue("Should be reinstalled", manager.isInstalled)
        val restored = File(manager.rootfsDir, "root/userfile.txt")
        assertTrue("User file should be restored", restored.exists())
        assertEquals("user data", restored.readText())
    }

    // ==================== tar extraction with real files ====================

    @Test
    fun extractTarHandlesSyntheticTarGz() = runBlocking {
        // Build a small tar.gz in memory and extract it
        val tarBytes = buildSimpleTar(
            "hello.txt" to "Hello from tar!",
            "subdir/" to null, // directory
            "subdir/nested.txt" to "Nested content"
        )
        val gzBytes = gzip(tarBytes)

        val testDir = File(context.cacheDir, "tar-extract-test-${System.nanoTime()}")
        try {
            testDir.mkdirs()
            java.util.zip.GZIPInputStream(ByteArrayInputStream(gzBytes)).use { gzStream ->
                manager.extractTar(gzStream, testDir)
            }

            assertTrue(File(testDir, "hello.txt").exists())
            assertEquals("Hello from tar!", File(testDir, "hello.txt").readText())
            assertTrue(File(testDir, "subdir").isDirectory)
            assertEquals("Nested content", File(testDir, "subdir/nested.txt").readText())
        } finally {
            testDir.deleteRecursively()
        }
    }

    @Test
    fun extractTarHandlesEmptyArchive() {
        val emptyTar = ByteArray(1024) // Two zero blocks = end of archive
        val testDir = File(context.cacheDir, "empty-tar-test-${System.nanoTime()}")
        try {
            testDir.mkdirs()
            manager.extractTar(ByteArrayInputStream(emptyTar), testDir)

            // Should create no files (only the dir itself)
            assertEquals(0, testDir.listFiles()?.size ?: 0)
        } finally {
            testDir.deleteRecursively()
        }
    }

    @Test
    fun extractTarHandlesLargeFileContent() {
        // 10KB file to test multi-block reading
        val largeContent = "A".repeat(10_000)
        val tarBytes = buildSimpleTar("large.txt" to largeContent)

        val testDir = File(context.cacheDir, "large-tar-test-${System.nanoTime()}")
        try {
            testDir.mkdirs()
            manager.extractTar(ByteArrayInputStream(tarBytes), testDir)

            assertEquals(largeContent, File(testDir, "large.txt").readText())
        } finally {
            testDir.deleteRecursively()
        }
    }

    // ==================== Singleton ====================

    @Test
    fun singletonReturnsSameInstance() {
        val a = RootfsManager.getInstance(context)
        val b = RootfsManager.getInstance(context)
        assertSame(a, b)
    }

    // ==================== Helpers ====================

    private fun hasAsset(name: String): Boolean {
        return try {
            context.assets.open(name).use { true }
        } catch (_: Exception) {
            false
        }
    }

    private fun resetSingleton() {
        try {
            val field = RootfsManager::class.java.getDeclaredField("instance")
            field.isAccessible = true
            field.set(null, null)
        } catch (_: Exception) { }
    }

    /**
     * Build a minimal POSIX tar archive from name→content pairs.
     * A null content value creates a directory.
     */
    private fun buildSimpleTar(vararg entries: Pair<String, String?>): ByteArray {
        val out = ByteArrayOutputStream()
        for ((name, content) in entries) {
            val isDir = content == null
            val data = content?.toByteArray(Charsets.UTF_8) ?: ByteArray(0)
            val header = ByteArray(512)

            // Name
            name.toByteArray().copyInto(header, 0, 0, minOf(name.length, 100))

            // Mode
            val mode = if (isDir) "0000755" else "0000644"
            mode.toByteArray().copyInto(header, 100)

            // UID, GID
            "0000000".toByteArray().copyInto(header, 108)
            "0000000".toByteArray().copyInto(header, 116)

            // Size
            String.format("%011o", data.size.toLong()).toByteArray().copyInto(header, 124)

            // Mtime
            "00000000000".toByteArray().copyInto(header, 136)

            // Type flag
            header[156] = if (isDir) '5'.code.toByte() else '0'.code.toByte()

            // Magic
            "ustar".toByteArray().copyInto(header, 257)
            header[263] = '0'.code.toByte()
            header[264] = '0'.code.toByte()

            // Checksum
            for (i in 148 until 156) header[i] = ' '.code.toByte()
            var checksum = 0
            for (b in header) checksum += (b.toInt() and 0xFF)
            String.format("%06o\u0000 ", checksum).toByteArray().copyInto(header, 148)

            out.write(header)
            if (data.isNotEmpty()) {
                out.write(data)
                val rem = data.size % 512
                if (rem != 0) out.write(ByteArray(512 - rem))
            }
        }
        // End-of-archive
        out.write(ByteArray(1024))
        return out.toByteArray()
    }

    private fun gzip(data: ByteArray): ByteArray {
        val bos = ByteArrayOutputStream()
        GZIPOutputStream(bos).use { it.write(data) }
        return bos.toByteArray()
    }
}
