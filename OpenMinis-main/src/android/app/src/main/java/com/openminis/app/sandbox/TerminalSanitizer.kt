package com.openminis.app.sandbox

/**
 * Strips ANSI escape sequences and handles CR-based line overwrites
 * from terminal output. Corresponds to iOS AIChatViewModel.sanitizeTerminalOutput().
 */
object TerminalSanitizer {

    // Matches ANSI/VT escape sequences:
    //   ESC [ ... final_byte (CSI sequences)
    //   ESC ] ... ST (OSC sequences terminated by BEL or ESC\)
    //   ESC followed by single character (simple escapes)
    private val ANSI_REGEX = Regex(
        """\x1B(?:\[[0-9;]*[A-Za-z]|\][^\x07]*(?:\x07|\x1B\\)|\[[0-9;]*m|[()][0-2AB]|[A-Za-z])"""
    )

    /**
     * Sanitize terminal output in two passes:
     * 1. CR folding — simulate carriage return overwriting
     * 2. Strip remaining ANSI/VT escape sequences
     */
    fun sanitize(raw: String): String {
        if (raw.isEmpty()) return raw

        // Pass 1: CR folding
        val crFolded = foldCarriageReturns(raw)

        // Pass 2: Strip ANSI sequences
        val stripped = ANSI_REGEX.replace(crFolded, "")

        // Pass 3: Remove null bytes and non-printable control chars (except \n \t)
        val cleaned = stripped.filter { it == '\n' || it == '\t' || it.code >= 0x20 }

        // Pass 4: Remove "null" artifacts from PRoot/pipe issues
        // - Lines that are entirely "null"
        // - Runs of repeated "null" (e.g., "nullnullnull" → "")
        // - Lines that are just "null" appended to a prefix (e.g., "file:nullnullnull")
        val noNullLines = cleaned.lines()
            .filter { it.trim() != "null" }
            .joinToString("\n")
            .replace(Regex("(?:null){2,}"), "") // Remove runs of 2+ consecutive "null"

        // Pass 5: Collapse excessive blank lines (3+ consecutive → 2)
        return noNullLines.replace(Regex("\n{3,}"), "\n\n").trim()
    }

    /**
     * Truncate output if it exceeds maxChars, keeping head and tail.
     */
    fun truncateIfNeeded(output: String, maxChars: Int = 50_000): String {
        if (output.length <= maxChars) return output

        val keepEach = maxChars / 2
        val head = output.substring(0, keepEach)
        val tail = output.substring(output.length - keepEach)
        val omitted = output.length - maxChars
        return "$head\n\n[... $omitted characters omitted ...]\n\n$tail"
    }

    /**
     * Simulate CR (\r) behavior: when a line contains \r (without \n),
     * the text after \r overwrites from the beginning of the line.
     * Each \r resets the cursor to position 0, so only the last segment's
     * content (up to its length) is visible.
     */
    private fun foldCarriageReturns(text: String): String {
        val lines = text.split('\n')
        val result = StringBuilder()

        for ((index, line) in lines.withIndex()) {
            if (index > 0) result.append('\n')

            if ('\r' !in line) {
                result.append(line)
                continue
            }

            // Split on CR and simulate overwriting.
            // Each CR resets cursor to column 0. The last non-empty segment wins.
            val segments = line.split('\r')
            val lastNonEmpty = segments.lastOrNull { it.isNotEmpty() }
            if (lastNonEmpty != null) {
                result.append(lastNonEmpty)
            }
        }

        return result.toString()
    }
}
