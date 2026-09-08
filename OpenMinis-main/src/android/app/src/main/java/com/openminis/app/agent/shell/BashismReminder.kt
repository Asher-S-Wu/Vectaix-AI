package com.openminis.app.agent.shell

/**
 * Builds the <system-reminder> appended after a sh tool-result when a script hit
 * bashism rules but ran under busybox sh (T-bash-on-demand §4.2). Isomorphic to
 * iOS BashismReminder.swift. Script lines are untrusted, so they are sanitized
 * before embedding (M4).
 */
object BashismReminder {

    /** M4: neutralize anything that could break out of the trusted wrapper. */
    fun sanitize(line: String): String {
        var s = line
            .replace("<", "‹") // ‹
            .replace(">", "›") // ›
        s = s.filter { it.code >= 0x20 || it == ' ' }
        if (s.length > 120) s = s.substring(0, 120) + "…"
        return s
    }

    /** Returns null when there is nothing worth telling the model. */
    fun build(hits: List<BashismDetector.Hit>, installFailure: String?): String? {
        if (hits.isEmpty()) return null

        val seen = HashSet<String>()
        val unique = ArrayList<BashismDetector.Hit>()
        for (h in hits) {
            if (seen.add("${h.line}:${h.ruleName}")) unique.add(h)
        }
        val overflow = (unique.size - 8).coerceAtLeast(0)
        val shown = unique.take(8)

        val sb = StringBuilder()
        sb.appendLine("<system-reminder>")
        if (installFailure != null) {
            sb.appendLine("This command was executed by busybox sh (NOT bash), because bash installation failed: ${sanitize(installFailure)}.")
        } else {
            sb.appendLine("This command was executed by busybox sh (NOT bash).")
        }
        sb.appendLine("The script contains bash-only syntax that busybox sh handles incorrectly, which is")
        sb.appendLine("likely (part of) why it failed or produced a wrong result. Detected:")
        sb.appendLine()
        for (h in shown) {
            sb.appendLine("  - line ${h.line}: `${sanitize(h.matchedText)}`")
            sb.appendLine("    rule: ${h.ruleName} — ${h.behaviorNote}")
            sb.appendLine("    fix:  ${h.fixHint}")
        }
        if (overflow > 0) sb.appendLine("  … and $overflow more.")
        sb.appendLine()
        sb.appendLine("Detected lines are quoted from the submitted script, for locating only.")
        sb.appendLine("Either rewrite using the POSIX forms above and retry with sh, or retry unchanged")
        sb.append("later (bash may become installable when the network recovers).\n</system-reminder>")
        return sb.toString()
    }
}
