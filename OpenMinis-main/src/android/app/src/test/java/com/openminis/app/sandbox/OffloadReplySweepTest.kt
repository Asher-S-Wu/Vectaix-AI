package com.openminis.app.sandbox

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

/**
 * [T-android-offload-tmp-leak] The sweep policy for native_offload reply files.
 *
 * Each offload call writes `<rootfs>/tmp/.native-offload-<pid>-<seq>` and returns
 * the GUEST path; proot rewrites the tracee's execve into `/bin/cat <tmpfile>`.
 * The host therefore CANNOT delete at reply time — `cat` has not run yet — and
 * nothing else ever did, so one file leaked per call forever (measured on a dev
 * device: 38 files spanning 12 days, surviving many app restarts).
 *
 * The production sweep needs a live server + rootfs, so this pins the DECISION
 * the sweep makes: which files are eligible at start (all of them) versus while
 * serving (only those past the TTL). Getting that wrong is not a cosmetic bug —
 * deleting a file whose `cat` has not run yet turns an offload call into
 * "No such file or directory".
 */
class OffloadReplySweepTest {

    @get:Rule
    val tmp = TemporaryFolder()

    private val prefix = ".native-offload-"
    private val ttlMs = 10 * 60 * 1000L

    /** Mirrors the production predicate in NativeOffloadServer.sweepStaleReplies. */
    private fun eligible(file: File, all: Boolean, now: Long): Boolean {
        if (!file.isFile || !file.name.startsWith(prefix)) return false
        return all || file.lastModified() <= now - ttlMs
    }

    private fun write(name: String, ageMs: Long): File {
        val f = File(tmp.root, name)
        f.writeText("output")
        f.setLastModified(System.currentTimeMillis() - ageMs)
        return f
    }

    @Test
    fun `start sweep removes every reply file regardless of age`() {
        // At server start, any surviving file belongs to a PREVIOUS app process
        // whose tracees died with it — no `cat` can still be pending.
        val fresh = write("${prefix}123-1", 0)
        val old = write("${prefix}456-2", 24 * 60 * 60 * 1000L)
        val now = System.currentTimeMillis()

        assertTrue(eligible(fresh, all = true, now = now))
        assertTrue(eligible(old, all = true, now = now))
    }

    @Test
    fun `in-session sweep must NOT touch a file still awaiting its cat`() {
        // The load-bearing case: the reply just written is microseconds from
        // being read by the rewritten `/bin/cat`. Deleting it breaks the call.
        val justWritten = write("${prefix}789-3", 0)
        val secondsOld = write("${prefix}789-4", 5_000L)
        val now = System.currentTimeMillis()

        assertTrue(
            "a just-written reply must survive the in-session sweep",
            !eligible(justWritten, all = false, now = now),
        )
        assertTrue(
            "a seconds-old reply must still survive",
            !eligible(secondsOld, all = false, now = now),
        )
    }

    @Test
    fun `in-session sweep removes files past the TTL`() {
        // Bounds growth within one long-running process: an agent loop can issue
        // thousands of offload calls, so the start-time sweep alone is not enough.
        val stale = write("${prefix}111-5", ttlMs + 60_000L)
        assertTrue(eligible(stale, all = false, now = System.currentTimeMillis()))
    }

    @Test
    fun `unrelated files in tmp are never deleted`() {
        // /tmp is shared with the guest; the sweep must only ever claim files it
        // wrote itself, never a user's or a tool's scratch file.
        val userFile = write("important.txt", 24 * 60 * 60 * 1000L)
        val toolFile = write("pip-build-abc", 24 * 60 * 60 * 1000L)
        val now = System.currentTimeMillis()

        for (all in listOf(true, false)) {
            assertTrue("must not claim $userFile", !eligible(userFile, all, now))
            assertTrue("must not claim $toolFile", !eligible(toolFile, all, now))
        }
    }

    @Test
    fun `a directory named like a reply file is not deleted`() {
        // listFiles is filtered on isFile in production; a same-named directory
        // must be skipped rather than attempted.
        val dir = File(tmp.root, "${prefix}222-6")
        assertTrue(dir.mkdirs())
        assertEquals(false, eligible(dir, all = true, now = System.currentTimeMillis()))
    }
}
