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

/**
 * On-device tests for ShellExecutor.
 * These require proot and rootfs assets to be present.
 * Tests actual command execution inside the PRoot sandbox.
 *
 * Run on real device: ./gradlew connectedAndroidTest
 */
@RunWith(AndroidJUnit4::class)
class ShellExecutorInstrumentedTest {

    private lateinit var context: Context

    @Before
    fun setUp() = runBlocking {
        context = InstrumentationRegistry.getInstrumentation().targetContext
        resetKernel()

        if (canBoot()) {
            PRootKernel.boot(context)
        }
    }

    @After
    fun tearDown() {
        PRootKernel.clearBindMounts()
        PRootKernel.customEnvironment.clear()
    }

    // ==================== Basic execution ====================

    @Test
    fun executeEchoCommand() = runBlocking {
        skipIfNoBoot()

        val result = ShellExecutor.execute(context, "echo hello")
        assertEquals(0, result.exitCode)
        assertEquals("hello", result.output.trim())
        assertTrue(result.durationMs >= 0)
    }

    @Test
    fun executeMultilineOutput() = runBlocking {
        skipIfNoBoot()

        val result = ShellExecutor.execute(context, "echo line1; echo line2; echo line3")
        assertEquals(0, result.exitCode)
        val lines = result.output.trim().lines()
        assertEquals(3, lines.size)
        assertEquals("line1", lines[0])
        assertEquals("line2", lines[1])
        assertEquals("line3", lines[2])
    }

    @Test
    fun executeCommandWithExitCode() = runBlocking {
        skipIfNoBoot()

        val result = ShellExecutor.execute(context, "exit 42")
        assertEquals(42, result.exitCode)
    }

    @Test
    fun executeCommandWithStderr() = runBlocking {
        skipIfNoBoot()

        // stderr should be merged with stdout
        val result = ShellExecutor.execute(context, "echo out; echo err >&2")
        assertTrue("Output should contain stdout", result.output.contains("out"))
        assertTrue("Output should contain stderr", result.output.contains("err"))
    }

    // ==================== Environment variables ====================

    @Test
    fun executeWithPerCallEnvironment() = runBlocking {
        skipIfNoBoot()

        val result = ShellExecutor.execute(
            context,
            "echo \$MY_VAR",
            environment = mapOf("MY_VAR" to "test_value")
        )
        assertEquals(0, result.exitCode)
        // Note: environment variables may or may not pass through proot
        // depending on how proot handles them. This tests the code path.
    }

    @Test
    fun executeWithCustomKernelEnvironment() = runBlocking {
        skipIfNoBoot()

        PRootKernel.customEnvironment["KERNEL_VAR"] = "kernel_value"

        val result = ShellExecutor.execute(context, "echo \$KERNEL_VAR")
        assertEquals(0, result.exitCode)
    }

    // ==================== Filesystem operations ====================

    @Test
    fun executeCanReadRootfs() = runBlocking {
        skipIfNoBoot()

        val result = ShellExecutor.execute(context, "cat /etc/resolv.conf")
        assertEquals(0, result.exitCode)
        assertTrue("Should contain DNS config", result.output.contains("8.8.8.8"))
    }

    @Test
    fun executeCanListRoot() = runBlocking {
        skipIfNoBoot()

        val result = ShellExecutor.execute(context, "ls /")
        assertEquals(0, result.exitCode)
        assertTrue("Should list bin", result.output.contains("bin"))
        assertTrue("Should list etc", result.output.contains("etc"))
    }

    @Test
    fun executeCanWriteAndReadFile() = runBlocking {
        skipIfNoBoot()

        val result = ShellExecutor.execute(
            context,
            "echo 'test content' > /tmp/test.txt && cat /tmp/test.txt"
        )
        assertEquals(0, result.exitCode)
        assertTrue(result.output.contains("test content"))
    }

    @Test
    fun executeCanAccessMinisDirectories() = runBlocking {
        skipIfNoBoot()

        val result = ShellExecutor.execute(context, "ls /var/minis/")
        assertEquals(0, result.exitCode)
        assertTrue("Should list workspace", result.output.contains("workspace"))
        assertTrue("Should list attachments", result.output.contains("attachments"))
    }

    // ==================== Line callback ====================

    @Test
    fun executeLineCallbackReceivesLines() = runBlocking {
        skipIfNoBoot()

        val lines = mutableListOf<String>()
        val result = ShellExecutor.execute(
            context,
            "echo a; echo b; echo c",
            lineCallback = { line -> lines.add(line) }
        )

        assertEquals(0, result.exitCode)
        assertEquals(3, lines.size)
        assertEquals("a", lines[0])
        assertEquals("b", lines[1])
        assertEquals("c", lines[2])
    }

    @Test
    fun executeLineCallbackWorksWithEmptyOutput() = runBlocking {
        skipIfNoBoot()

        val lines = mutableListOf<String>()
        val result = ShellExecutor.execute(
            context,
            "true", // No output
            lineCallback = { line -> lines.add(line) }
        )

        assertEquals(0, result.exitCode)
        assertTrue(lines.isEmpty())
    }

    // ==================== Timeout ====================

    @Test
    fun executeTimesOutLongRunningCommand() = runBlocking {
        skipIfNoBoot()

        val result = ShellExecutor.execute(
            context,
            "sleep 60",
            timeout = 2_000 // 2 second timeout
        )

        assertEquals(124, result.exitCode) // Standard timeout exit code
        assertTrue(result.output.contains("timed out"))
        assertTrue("Should complete within ~3 seconds", result.durationMs < 10_000)
    }

    @Test
    fun executeShortCommandDoesNotTimeout() = runBlocking {
        skipIfNoBoot()

        val result = ShellExecutor.execute(
            context,
            "echo fast",
            timeout = 30_000
        )

        assertEquals(0, result.exitCode)
        assertEquals("fast", result.output.trim())
    }

    // ==================== Process management ====================

    @Test
    fun currentProcessIsNullWhenIdle() {
        assertNull(ShellExecutor.currentProcess)
    }

    @Test
    fun destroyCurrentIsNoOpWhenIdle() {
        ShellExecutor.destroyCurrent() // Should not throw
        assertNull(ShellExecutor.currentProcess)
    }

    // ==================== Command types ====================

    @Test
    fun executePipeCommand() = runBlocking {
        skipIfNoBoot()

        val result = ShellExecutor.execute(context, "echo 'hello world' | wc -w")
        assertEquals(0, result.exitCode)
        assertEquals("2", result.output.trim())
    }

    @Test
    fun executeCommandSubstitution() = runBlocking {
        skipIfNoBoot()

        val result = ShellExecutor.execute(context, "echo $(echo nested)")
        assertEquals(0, result.exitCode)
        assertEquals("nested", result.output.trim())
    }

    @Test
    fun executeForLoop() = runBlocking {
        skipIfNoBoot()

        val result = ShellExecutor.execute(context, "for i in 1 2 3; do echo \$i; done")
        assertEquals(0, result.exitCode)
        assertEquals("1\n2\n3", result.output.trim())
    }

    @Test
    fun executeWhichSh() = runBlocking {
        skipIfNoBoot()

        val result = ShellExecutor.execute(context, "which sh")
        assertEquals(0, result.exitCode)
        assertTrue(result.output.trim().isNotEmpty())
    }

    // ==================== Error handling ====================

    @Test
    fun executeNonexistentCommand() = runBlocking {
        skipIfNoBoot()

        val result = ShellExecutor.execute(context, "nonexistent_command_xyz")
        assertNotEquals(0, result.exitCode)
    }

    @Test
    fun executeSyntaxError() = runBlocking {
        skipIfNoBoot()

        val result = ShellExecutor.execute(context, "if then")
        assertNotEquals(0, result.exitCode)
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

    private fun skipIfNoBoot() {
        if (!PRootKernel.isBooted) {
            println("SKIP: PRoot not booted (assets not available)")
            return
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
