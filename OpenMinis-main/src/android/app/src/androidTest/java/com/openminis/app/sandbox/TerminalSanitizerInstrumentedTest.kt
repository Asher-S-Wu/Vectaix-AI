package com.openminis.app.sandbox

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/**
 * On-device smoke test for TerminalSanitizer.
 * Verifies sanitization works correctly on Android runtime.
 *
 * Run on real device: ./gradlew connectedAndroidTest
 */
@RunWith(AndroidJUnit4::class)
class TerminalSanitizerInstrumentedTest {

    @Test
    fun sanitizeStripsAnsiFromRealTerminalOutput() {
        // Simulate typical Alpine apk output with colors
        val input = "\u001B[32m(1/3) Installing busybox\u001B[0m\n" +
                "\u001B[32m(2/3) Installing musl\u001B[0m\n" +
                "\u001B[32m(3/3) Installing alpine-base\u001B[0m"
        val result = TerminalSanitizer.sanitize(input)
        assertEquals(
            "(1/3) Installing busybox\n(2/3) Installing musl\n(3/3) Installing alpine-base",
            result
        )
    }

    @Test
    fun sanitizeHandlesWgetProgressBar() {
        // wget uses CR to overwrite progress
        val input = "Downloading...\r  50% [======>       ]\r 100% [=============]"
        val result = TerminalSanitizer.sanitize(input)
        assertTrue(result.contains("100%"))
        assertFalse("Should not show intermediate state", result.contains("50%"))
    }

    @Test
    fun sanitizeHandlesComplexSequences() {
        // Real-world: bold, color, cursor movement combined
        val input = "\u001B[1;34m==>\u001B[0m \u001B[1mBuilding project...\u001B[0m\n" +
                "\u001B[K\u001B[2A\u001B[1G\u001B[32m✓\u001B[0m Done"
        val result = TerminalSanitizer.sanitize(input)
        assertTrue(result.contains("==>"))
        assertTrue(result.contains("Building project..."))
        assertTrue(result.contains("Done"))
    }

    @Test
    fun truncateHandlesLargeOutput() {
        val large = "x".repeat(100_000)
        val result = TerminalSanitizer.truncateIfNeeded(large)
        assertTrue("Should be truncated", result.length < 100_000)
        assertTrue("Should have omission marker", result.contains("characters omitted"))
    }

    @Test
    fun sanitizePreservesUtf8OnDevice() {
        val input = "\u001B[33m日本語テスト\u001B[0m and \u001B[31m中文测试\u001B[0m"
        val result = TerminalSanitizer.sanitize(input)
        assertEquals("日本語テスト and 中文测试", result)
    }
}
