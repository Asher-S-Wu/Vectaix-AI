package com.openminis.app.data

import com.openminis.app.data.repository.EnvVarRepository

/**
 * Masks env-var values that leaked into shell tool output before they
 * reach the model.
 *
 * Mask rule: `len < 8` → all `*`; `len >= 8` → first 2 + (len-4) `*` +
 * last 2 (e.g. `sk-1********ajhks`).
 *
 * Matching is plain `String.replace` — no regex — to avoid ReDoS on
 * attacker-influenced output. Values with length `<= 4` are skipped
 * to avoid mangling unrelated text — short common strings (e.g.
 * `"true"`, `"data"`, `"http"`) frequently collide with normal output,
 * and replacing every occurrence with `*` would be more disruptive
 * than leaving them visible.
 *
 * Mirrors iOS `EnvVarRedactor`.
 */
object EnvVarRedactor {
    const val MIN_MATCH_LEN = 5

    /**
     * English-only system reminder appended to a tool result when at
     * least one redaction occurred. Single string so it survives
     * downstream trimming/normalization, with explicit guidance to the
     * model on how to operate without echoing secrets.
     */
    const val SYSTEM_REMINDER = "<system-reminder>Privacy mode is ON: one or more environment variable values were detected in this output and have been masked. Prefer running commands that consume secrets via environment variable references (e.g. `curl -H \"Authorization: Bearer \$API_KEY\" ...`) rather than echoing them. If the user needs to inspect raw values, ask them to disable Privacy Mode at Settings → Environment Variables.</system-reminder>"

    /**
     * Static handoff so non-DI call sites (e.g. ShellExecutor on a
     * background coroutine) can reach the repository without plumbing
     * it through every layer. Set once from [com.openminis.app.MinisApp.onCreate].
     */
    @Volatile
    var envVarRepository: EnvVarRepository? = null

    fun mask(value: String): String {
        val n = value.length
        if (n < 8) return "*".repeat(n)
        return value.substring(0, 2) + "*".repeat(n - 4) + value.substring(n - 2, n)
    }

    /**
     * Redact [output] against the given env-var values. Returns the
     * rewritten string and the number of distinct values that produced
     * at least one replacement.
     *
     * Values are de-duplicated and processed longest-first so that
     * `BAR` appearing as a substring of a longer value `FOOBAR` does
     * not pre-empt the longer match.
     */
    fun redact(output: String, values: Collection<String>): Pair<String, Int> {
        val candidates = values
            .filter { it.length >= MIN_MATCH_LEN }
            .toSet()
            .sortedByDescending { it.length }
        if (candidates.isEmpty()) return output to 0

        var current = output
        var hits = 0
        for (v in candidates) {
            if (current.contains(v)) {
                current = current.replace(v, mask(v))
                hits++
            }
        }
        return current to hits
    }

    /**
     * Convenience wrapper — pulls values from the repository (if set)
     * and returns the possibly reminder-suffixed output plus the hit
     * count. No-op when Privacy Mode is disabled or the repository
     * isn't wired yet (e.g. very early in app boot).
     */
    fun redactIfEnabled(output: String): Pair<String, Int> {
        if (!EnvVarPrivacyStore.isEnabled) return output to 0
        val repo = envVarRepository ?: return output to 0
        val values = repo.allAsDict().values.filter { it.isNotEmpty() }
        if (values.isEmpty()) return output to 0
        val (masked, hits) = redact(output, values)
        if (hits == 0) return masked to 0
        return (masked + "\n\n" + SYSTEM_REMINDER) to hits
    }
}
