package com.openminis.app.sandbox

/**
 * [T-android-seccomp-selfheal / GH#186] Decide when a proot child's death looks
 * like the host kernel's seccomp fast path miscompiling our syscall filter,
 * and should be retried once with `PROOT_NO_SECCOMP=1`.
 *
 * ## Why this exists
 *
 * GH#186: on one reporter's ARM64 device, `/bin/true` and `uname` run fine
 * inside the Alpine rootfs but `apk --version` dies instantly with SIGBUS and
 * `apk update` with SIGSEGV. We could not reproduce it: on a Pixel 6 the very
 * same bytes (rootfs binaries verified byte-identical to the shipped tarball)
 * with the very same argv run `apk update` to completion. So the fault is not
 * in what we ship — it is in how the host kernel handles proot's
 * ptrace+seccomp interaction, which is exactly the class of bug proot itself
 * documents a workaround for: `PROOT_NO_SECCOMP=1` (see
 * deps/proot/src/tracee/event.c:97 and deps/proot/src/cli/cli.c:140, and
 * upstream's "Add PR_epoll_wait SIGSYS handler" for a kernel that mis-fires the
 * same way).
 *
 * The symptom distribution is the tell: `apk` is the **only dynamically linked
 * program** in the minirootfs — `/bin/true` and `uname` are busybox symlinks.
 * That points at the dynamic-loading/mmap path under ptrace, not at file
 * content, and it means any dynamically linked guest binary can be hit, not
 * just apk. Hence this is applied at the sandbox launch layer rather than
 * special-cased for apk.
 *
 * ## Why gate on "early" rather than retrying every signal death
 *
 * A retry is only safe when the crash cannot have had side effects the user
 * would not want repeated. A guest program that runs for a while and *then*
 * segfaults may already have written files, mutated the rootfs, or sent
 * network traffic; re-running it could double those effects, and its crash is
 * far more likely to be a genuine bug in that program than a host-kernel
 * quirk. The GH#186 signature is the opposite: death is effectively immediate,
 * during dynamic linking, before `main()` can do anything observable.
 *
 * So the trigger is deliberately narrow — **fatal signal AND died early AND
 * produced no output**. Normal non-zero exits (a failing build, `grep` finding
 * nothing, a user's own buggy program) never qualify, which is the safety
 * boundary the fix requires: this must not silently re-run arbitrary user
 * commands.
 */
object SeccompFallbackPolicy {

    /** Env var proot reads to skip installing its seccomp filter. */
    const val NO_SECCOMP_ENV = "PROOT_NO_SECCOMP"
    const val NO_SECCOMP_VALUE = "1"

    /**
     * Upper bound on "died during startup". Generous on purpose: a cold
     * dynamic link of apk pulling in libcrypto/libssl on a slow device is
     * still far under a second, while any program that ran long enough to do
     * real work is well past it. Raising this trades safety (re-running a
     * command that had side effects) for coverage, so it stays conservative.
     */
    const val EARLY_DEATH_MS = 1_500L

    /**
     * Shell/waitpid convention: a process killed by signal N reports 128+N.
     *
     * - 135 = 128+7  SIGBUS  — the reported `apk --version` failure
     * - 139 = 128+11 SIGSEGV — the reported `apk update` / `apk add` failure
     * - 132 = 128+4  SIGILL  — same family: a mis-mapped/mis-restarted text
     *   segment lands on garbage instructions just as easily as on a bad
     *   address, so it is treated identically.
     * - 159 = 128+31 SIGSYS  — the seccomp filter itself killing the child.
     *   This is the most direct evidence of the suspected cause.
     *
     * Deliberately NOT included: SIGKILL (137) and SIGTERM (143), which are
     * how *we* stop a shell (timeouts, cancellation, [ShellExecutor.destroyCurrent],
     * Android low-memory kills). Retrying those would fight the caller's own
     * cancellation and re-run work the user just aborted. SIGABRT (134) is also
     * excluded: that is a program calling abort() on itself — a real bug in the
     * guest program, not a syscall-translation failure.
     */
    val RETRYABLE_EXIT_CODES = setOf(132, 135, 139, 159)

    /**
     * True when [exitCode] indicates death by one of the [RETRYABLE_EXIT_CODES]
     * signals, the process lived less than [EARLY_DEATH_MS], and it emitted no
     * output.
     *
     * The no-output condition matters as much as the timing: a program that
     * already printed something has begun executing its own logic, so its
     * crash is attributable to the program rather than to the loader. It also
     * keeps the retry from duplicating any output the caller already surfaced.
     *
     * @param exitCode process exit status, or null if it could not be observed
     *   (never retryable — we cannot tell what happened).
     * @param durationMs wall-clock time from spawn to exit.
     * @param producedOutput whether the child wrote anything to stdout/stderr.
     * @param alreadyRetried set once a retry has been spent, so this can only
     *   fire once per command (no retry loops).
     */
    fun shouldRetryWithoutSeccomp(
        exitCode: Int?,
        durationMs: Long,
        producedOutput: Boolean,
        alreadyRetried: Boolean,
    ): Boolean {
        if (alreadyRetried) return false
        if (producedOutput) return false
        if (exitCode == null || exitCode !in RETRYABLE_EXIT_CODES) return false
        return durationMs < EARLY_DEATH_MS
    }

    /** Human-readable signal name for diagnostics; null when not a tracked code. */
    fun signalName(exitCode: Int?): String? = when (exitCode) {
        132 -> "SIGILL"
        135 -> "SIGBUS"
        139 -> "SIGSEGV"
        159 -> "SIGSYS"
        else -> null
    }

    /**
     * One-line diagnostic emitted when the fallback fires. Greppable on
     * purpose: when a GH#186 reporter sends a log back, the presence of
     * `[proot-retry]` is what confirms this path was taken, and the absence of
     * it rules the seccomp hypothesis out rather than leaving it open.
     */
    fun retryLogLine(exitCode: Int?, durationMs: Long, what: String): String {
        val sig = signalName(exitCode) ?: "signal"
        return "[proot-retry] detected early $sig (exit=$exitCode) after ${durationMs}ms " +
            "in $what — retrying once with $NO_SECCOMP_ENV=$NO_SECCOMP_VALUE (GH#186)"
    }
}
