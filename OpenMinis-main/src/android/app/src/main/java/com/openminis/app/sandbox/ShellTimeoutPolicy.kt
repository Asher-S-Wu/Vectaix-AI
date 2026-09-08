package com.openminis.app.sandbox

/**
 * Choose a shell-execution timeout based on the **command prefix**, matching
 * the tiered strategy iOS uses in `ISHExecutionCoordinator`. Agent calls tend
 * to cluster around a few command families with wildly different expected
 * durations:
 *
 *   - quick shell utilities (`ls`, `cat`, `grep`, `sed`, `awk`) finish in
 *     under a second and should fail fast if they don't
 *   - package installs (`apk add`, `pip install`, `npm install`) legitimately
 *     take 2–5 minutes and should not hit a tight timeout
 *   - build / compile commands (`make`, `cargo build`, `go build`) can run 10+
 *     minutes on non-trivial projects
 *   - long-running services (daemons, watch mode) are either cancelled by the
 *     user or preempted by the coordinator's wait-queue
 *
 * **Not wired yet** — this file publishes the policy so the next pass can
 * adopt it at the call site without churning the dirty [ExecutionCoordinator]
 * further. Callers pick a timeout by running the raw command line through
 * [ShellTimeoutPolicy.forCommand] and passing the result down.
 */
object ShellTimeoutPolicy {
    /** Default (baseline) timeout matching the existing call-site default. */
    const val DEFAULT_TIMEOUT_MS = 600_000L      // 10 min

    /** Quick tier — shell builtins, pure text utilities, metadata queries. */
    const val QUICK_TIMEOUT_MS = 60_000L         // 1 min

    /** Interactive / networked queries (ping, dig, curl one-shots). */
    const val NETWORK_TIMEOUT_MS = 180_000L      // 3 min

    /** Package installs — apk / pip / npm / gem / cargo install. */
    const val INSTALL_TIMEOUT_MS = 600_000L      // 10 min

    /** Build / compile — make, cargo build, go build, gradle, ninja. */
    const val BUILD_TIMEOUT_MS = 1_200_000L      // 20 min

    /** Long-running services / daemons — always allowed the full budget. */
    const val LONG_RUNNING_TIMEOUT_MS = 1_800_000L // 30 min

    private val quickPrefixes = setOf(
        "ls", "cat", "head", "tail", "wc", "grep", "rg", "egrep", "fgrep",
        "sed", "awk", "tr", "cut", "sort", "uniq", "find",
        "echo", "printf", "pwd", "which", "whoami", "id", "env", "date",
        "basename", "dirname", "file", "stat", "du", "df",
        "mkdir", "rmdir", "touch", "chmod", "chown", "cp", "mv", "rm", "ln",
    )

    private val networkPrefixes = setOf(
        "ping", "dig", "nslookup", "host", "traceroute",
        "curl", "wget", "http",
        "ssh", "scp", "rsync",
    )

    /** Install commands — any of these (possibly with subcommand) triggers. */
    private val installTokens = setOf(
        "apk", "apt", "apt-get", "yum", "dnf", "pacman", "brew",
        "pip", "pip3", "pipx",
        "npm", "pnpm", "yarn", "bun",
        "gem", "bundle",
        "go get", "go install",
    )

    /** Build / compile drivers. */
    private val buildPrefixes = setOf(
        "make", "gmake", "ninja", "cmake",
        "cargo", "rustc",
        "go build", "go test",
        "gradle", "gradlew", "mvn",
        "webpack", "vite", "rollup", "esbuild",
        "tsc", "swc", "babel",
    )

    /** Long-running / daemon drivers. */
    private val longRunningPrefixes = setOf(
        "watch",
        "node --watch", "npm run dev", "npm run start", "npm start",
        "python -m http.server",
        "serve", "http-server",
    )

    /**
     * Return a recommended timeout (ms) for [command]. Takes the first
     * non-whitespace token and consults the classifier tables above. Unknown
     * commands fall through to [DEFAULT_TIMEOUT_MS] so behavior stays
     * conservative for anything unrecognized.
     */
    fun forCommand(command: String): Long {
        val trimmed = command.trim()
        if (trimmed.isEmpty()) return DEFAULT_TIMEOUT_MS
        val lower = trimmed.lowercase()

        // Pipelines / shell-chains — take the first sub-command for classification.
        val firstSegment = lower.substringBefore("&&").substringBefore("||").substringBefore(";").trim()
        val firstToken = firstSegment.substringBefore(' ')

        // Check longest-match phrases first (go build vs go).
        if (longRunningPrefixes.any { firstSegment.startsWith(it) }) return LONG_RUNNING_TIMEOUT_MS
        if (buildPrefixes.any { firstSegment.startsWith(it) }) return BUILD_TIMEOUT_MS
        if (installTokens.any { firstSegment.startsWith(it) && firstSegment.containsInstallSubcommand() }) {
            return INSTALL_TIMEOUT_MS
        }

        if (firstToken in networkPrefixes) return NETWORK_TIMEOUT_MS
        if (firstToken in quickPrefixes) return QUICK_TIMEOUT_MS

        return DEFAULT_TIMEOUT_MS
    }

    /** Heuristic: treat bare `apk`, `pip` etc. without an install subcommand as neutral. */
    private fun String.containsInstallSubcommand(): Boolean {
        val installVerbs = listOf("install", "add", "get", "update", "upgrade")
        return installVerbs.any { " $it" in this } || this.startsWith("apk ") || this.startsWith("pip install")
    }
}
