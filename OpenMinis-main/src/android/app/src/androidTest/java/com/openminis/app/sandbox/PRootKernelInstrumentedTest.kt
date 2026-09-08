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
import java.io.File

/**
 * On-device tests for PRootKernel.
 * Tests boot, command building, bind mount management, and path resolution.
 *
 * Run on real device: ./gradlew connectedAndroidTest
 */
@RunWith(AndroidJUnit4::class)
class PRootKernelInstrumentedTest {

    private lateinit var context: Context

    @Before
    fun setUp() {
        context = InstrumentationRegistry.getInstrumentation().targetContext
        // Reset PRootKernel state
        resetKernel()
    }

    @After
    fun tearDown() {
        PRootKernel.clearBindMounts()
        PRootKernel.customEnvironment.clear()
        resetKernel()
    }

    // ==================== boot ====================

    @Test
    fun notBootedInitially() {
        assertFalse(PRootKernel.isBooted)
    }

    @Test
    fun bootSetsIsBootedTrue() = runBlocking {
        if (!canBoot()) {
            println("SKIP: assets not available for boot")
            return@runBlocking
        }

        PRootKernel.boot(context)
        assertTrue(PRootKernel.isBooted)
    }

    @Test
    fun bootIsIdempotent() = runBlocking {
        if (!canBoot()) {
            println("SKIP: assets not available for boot")
            return@runBlocking
        }

        PRootKernel.boot(context)
        PRootKernel.boot(context) // Should not throw
        assertTrue(PRootKernel.isBooted)
    }

    // ==================== bind mounts ====================

    @Test
    fun addBindMountStoresMapping() {
        PRootKernel.addBindMount("/var/minis/workspace", "/data/host/workspace")
        assertEquals("/data/host/workspace", PRootKernel.bindMounts["/var/minis/workspace"])
    }

    @Test
    fun removeBindMountRemovesMapping() {
        PRootKernel.addBindMount("/var/minis/workspace", "/data/host/workspace")
        PRootKernel.removeBindMount("/var/minis/workspace")
        assertNull(PRootKernel.bindMounts["/var/minis/workspace"])
    }

    @Test
    fun clearBindMountsRemovesAll() {
        PRootKernel.addBindMount("/a", "/host/a")
        PRootKernel.addBindMount("/b", "/host/b")
        PRootKernel.clearBindMounts()
        assertTrue(PRootKernel.bindMounts.isEmpty())
    }

    @Test
    fun bindMountOverwritesPreviousValue() {
        PRootKernel.addBindMount("/mnt", "/host/old")
        PRootKernel.addBindMount("/mnt", "/host/new")
        assertEquals("/host/new", PRootKernel.bindMounts["/mnt"])
        assertEquals(1, PRootKernel.bindMounts.size)
    }

    // ==================== buildProotCommand ====================

    @Test
    fun buildProotCommandIncludesBasicFlags() = runBlocking {
        if (!canBoot()) {
            println("SKIP: assets not available for boot")
            return@runBlocking
        }
        PRootKernel.boot(context)

        val cmd = PRootKernel.buildProotCommand("echo hello")

        // Should contain proot binary path
        assertTrue("Should start with proot binary", cmd[0].endsWith("proot-aarch64"))

        // Should have -0 flag (fake root)
        assertTrue("Should contain -0 flag", cmd.contains("-0"))

        // Should have -r flag with rootfs
        val rIndex = cmd.indexOf("-r")
        assertTrue("Should contain -r flag", rIndex >= 0)
        assertTrue("Rootfs path should follow -r", cmd[rIndex + 1].contains("alpine-rootfs"))

        // Should bind /dev, /proc, /sys
        assertTrue("Should bind /dev", cmd.contains("/dev"))
        assertTrue("Should bind /proc", cmd.contains("/proc"))
        assertTrue("Should bind /sys", cmd.contains("/sys"))

        // Should have -w /root
        val wIndex = cmd.indexOf("-w")
        assertTrue("Should contain -w flag", wIndex >= 0)
        assertEquals("/root", cmd[wIndex + 1])

        // Should end with /bin/sh -c "echo hello"
        val lastThree = cmd.takeLast(3)
        assertEquals("/bin/sh", lastThree[0])
        assertEquals("-c", lastThree[1])
        assertEquals("echo hello", lastThree[2])
    }

    @Test
    fun buildProotCommandIncludesBindMounts() = runBlocking {
        if (!canBoot()) {
            println("SKIP: assets not available for boot")
            return@runBlocking
        }
        PRootKernel.boot(context)

        PRootKernel.addBindMount("/var/minis/workspace", "/data/user/0/com.openminis.app/workspace")

        val cmd = PRootKernel.buildProotCommand("ls /var/minis/workspace")

        // Should contain -b host:linux format
        val bindStr = "/data/user/0/com.openminis.app/workspace:/var/minis/workspace"
        assertTrue("Should contain bind mount arg", cmd.contains(bindStr))
    }

    @Test
    fun buildProotCommandWithMultipleBindMounts() = runBlocking {
        if (!canBoot()) {
            println("SKIP: assets not available for boot")
            return@runBlocking
        }
        PRootKernel.boot(context)

        PRootKernel.addBindMount("/mnt/a", "/host/a")
        PRootKernel.addBindMount("/mnt/b", "/host/b")

        val cmd = PRootKernel.buildProotCommand("ls")

        assertTrue(cmd.contains("/host/a:/mnt/a"))
        assertTrue(cmd.contains("/host/b:/mnt/b"))
    }

    @Test(expected = IllegalStateException::class)
    fun buildProotCommandThrowsWhenNotBooted() {
        PRootKernel.buildProotCommand("echo test")
    }

    // ==================== resolveHostPath ====================

    @Test
    fun resolveHostPathMatchesExactMount() {
        PRootKernel.addBindMount("/var/minis/workspace", "/host/workspace")

        val result = PRootKernel.resolveHostPath("/var/minis/workspace")
        assertNotNull(result)
        assertEquals("/host/workspace", result!!.path)
    }

    @Test
    fun resolveHostPathMatchesSubpath() {
        PRootKernel.addBindMount("/var/minis/workspace", "/host/workspace")

        val result = PRootKernel.resolveHostPath("/var/minis/workspace/file.txt")
        assertNotNull(result)
        assertEquals("/host/workspace/file.txt", result!!.path)
    }

    @Test
    fun resolveHostPathUsesLongestPrefixMatch() {
        PRootKernel.addBindMount("/var", "/host/var")
        PRootKernel.addBindMount("/var/minis/workspace", "/host/workspace")

        val result = PRootKernel.resolveHostPath("/var/minis/workspace/deep/file.txt")
        assertNotNull(result)
        assertEquals("/host/workspace/deep/file.txt", result!!.path)
    }

    @Test
    fun resolveHostPathDoesNotMatchPartialPrefix() {
        PRootKernel.addBindMount("/var/minis/work", "/host/work")

        // "/var/minis/workspace" should NOT match "/var/minis/work" (no / after "work")
        val result = PRootKernel.resolveHostPath("/var/minis/workspace/file.txt")
        // Should fallback to rootfs or null, not match /var/minis/work
        assertNotEquals("/host/work/space/file.txt", result?.path ?: "")
    }

    @Test
    fun resolveHostPathReturnsNullWhenNoMountsAndNotBooted() {
        // No mounts, not booted → rootfsManager not initialized
        val result = PRootKernel.resolveHostPath("/some/path")
        assertNull(result)
    }

    @Test
    fun resolveHostPathFallsBackToRootfs() = runBlocking {
        if (!canBoot()) {
            println("SKIP: assets not available for boot")
            return@runBlocking
        }
        PRootKernel.boot(context)

        // No bind mounts → should resolve relative to rootfsDir
        val result = PRootKernel.resolveHostPath("/etc/resolv.conf")
        assertNotNull(result)
        assertTrue("Should resolve inside rootfs", result!!.path.contains("alpine-rootfs"))
        assertTrue("Should end with etc/resolv.conf", result.path.endsWith("etc/resolv.conf"))
    }

    // ==================== customEnvironment ====================

    @Test
    fun customEnvironmentIsInitiallyEmpty() {
        assertTrue(PRootKernel.customEnvironment.isEmpty())
    }

    @Test
    fun customEnvironmentCanBeModified() {
        PRootKernel.customEnvironment["MY_VAR"] = "my_value"
        assertEquals("my_value", PRootKernel.customEnvironment["MY_VAR"])
    }

    // ==================== getProotTmpDir ====================

    @Test
    fun getProotTmpDirCreatesDirectory() {
        val tmpDir = PRootKernel.getProotTmpDir(context)
        assertTrue(tmpDir.exists())
        assertTrue(tmpDir.isDirectory)
        assertTrue(tmpDir.path.endsWith("proot-tmp"))
    }

    // ==================== Helpers ====================

    private fun canBoot(): Boolean {
        return try {
            context.assets.open("alpine-minirootfs.tar.gz").use { }
            context.assets.open("proot-aarch64").use { }
            true
        } catch (_: Exception) {
            false
        }
    }

    private fun resetKernel() {
        try {
            val field = PRootKernel::class.java.getDeclaredField("isBooted")
            field.isAccessible = true
            field.set(PRootKernel, false)
        } catch (_: Exception) { }
        PRootKernel.clearBindMounts()
        PRootKernel.customEnvironment.clear()
    }
}
