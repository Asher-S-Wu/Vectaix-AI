package com.openminis.app.sandbox

import android.net.LocalServerSocket
import android.net.LocalSocket
import android.util.Log
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong
import kotlin.concurrent.thread

/**
 * Host-side endpoint of the proot `native_offload` extension.
 *
 * The guest issues `execve("<handler-name>", argv, envp)`; the proot
 * extension sends argv/env/cwd over an abstract unix socket to this
 * server. The server dispatches to the registered [NativeOffloadHandler],
 * writes the handler's combined output into a tmpfile inside the guest's
 * /tmp, and replies with `(exit_code, guest_tmpfile_path)`. The extension
 * then rewrites the execve into `/bin/cat <tmpfile>` so the guest sees
 * the handler output as plain stdout.
 *
 * Mirrors iOS `native_offload_add_handler` + `native_offload_exec`.
 */
data class NativeOffloadRequest(
    val pid: Int,
    val argv: List<String>,
    val env: Map<String, String>,
    val cwd: String,
    /**
     * T340: chat session id forwarded by the agent shell via the
     * `MINIS_CHAT_SESSION_ID` env var. Lets [OffloadPermissionManager]
     * scope ASK_ONCE grants/denials per-chat-session instead of using
     * a single process-wide bucket. Null when the offload originates
     * outside a chat (e.g. interactive terminal) — handlers fall back
     * to `OFFLOAD_GLOBAL_SESSION_ID` in that case.
     */
    val sessionId: String? = null,
)

data class NativeOffloadResult(
    val exitCode: Int,
    val output: String,
)

fun interface NativeOffloadHandler {
    fun handle(request: NativeOffloadRequest): NativeOffloadResult
}

object NativeOffloadServer {
    private const val TAG = "NativeOffloadServer"
    private const val SOCKET_NAME = "native-offload"
    private const val MAGIC_REQ = 0x46464F4E  // 'N' 'O' 'F' 'F' little-endian
    private const val MAGIC_RSP = 0x52464F4E  // 'N' 'O' 'F' 'R'
    private const val VERSION = 1

    /** [T-android-offload-tmp-leak] Filename prefix of a handler reply file. */
    private const val REPLY_PREFIX = ".native-offload-"

    /**
     * How long a reply file may live before the in-session sweep may remove it.
     *
     * The real gap between writing the file and the rewritten `/bin/cat` reading
     * it is sub-millisecond, so 10 minutes is enormously conservative — it
     * exists only so a stopped/slow tracee can never lose its output.
     */
    private const val REPLY_TTL_MS = 10 * 60 * 1000L

    /** Run the opportunistic sweep every N replies, not on every single one. */
    private const val SWEEP_EVERY_N_REPLIES = 50L

    const val socketName: String = SOCKET_NAME

    private val handlers = ConcurrentHashMap<String, NativeOffloadHandler>()
    private val counter = AtomicLong(0)
    private var serverSocket: LocalServerSocket? = null
    private var acceptThread: Thread? = null

    @Volatile
    private var rootfsTmpDir: File? = null

    val registeredHandlers: Set<String> get() = handlers.keys.toSet()

    fun register(name: String, handler: NativeOffloadHandler) {
        require(name.isNotEmpty())
        handlers[name] = handler
        Log.d(TAG, "register '$name' (total=${handlers.size})")
    }

    @Synchronized
    fun start(rootfsDir: File) {
        rootfsTmpDir = File(rootfsDir, "tmp")
        if (serverSocket != null) return

        // T287-followup: bind with bounded retry. Linux abstract sockets are
        // freed by the kernel only after the owning process is fully reaped —
        // when the previous app process dies (debug crash button, OOM kill,
        // ANR-kill) and Android's ActivityManager respawns us within ~100ms,
        // the kernel may still hold our prior namespace entry and bindLocal
        // returns EADDRINUSE. Crashing onCreate here puts the app in a
        // restart loop forever (re-spawn → EADDRINUSE → ACRA caught → die →
        // re-spawn …). Retry up to ~2s with exponential backoff; in the
        // overwhelming majority of cases the socket frees within the first
        // 100-300ms window.
        val s = bindWithRetry()
            ?: throw java.io.IOException(
                "failed to bind abstract socket '$SOCKET_NAME' after retries — " +
                "previous process holding the namespace?",
            )
        serverSocket = s
        acceptThread = thread(name = "native-offload-accept", isDaemon = true) {
            runAcceptLoop(s)
        }
        Log.i(TAG, "listening on abstract socket '$SOCKET_NAME' " +
            "handlers=${handlers.keys.sorted()} tmpDir=${rootfsTmpDir?.absolutePath}")

        // [T-android-offload-tmp-leak] Sweep reply files orphaned by earlier
        // app processes. See sweepStaleReplies for why this is safe here and
        // why the mechanism leaks in the first place.
        sweepStaleReplies(all = true)
    }

    /**
     * [T-android-offload-tmp-leak] Delete `.native-offload-*` reply files.
     *
     * WHY THESE LEAK. Each offload call writes the handler's combined output to
     * `<rootfs>/tmp/.native-offload-<pid>-<seq>` and returns the GUEST path;
     * proot's native_offload extension then rewrites the tracee's execve into
     * `/bin/cat <tmpfile>`. So the host cannot delete the file at reply time —
     * `cat` has not run yet, and deleting it would turn every offload call into
     * "No such file or directory". Nothing else ever removed them either
     * (`delete`/`cleanup` were zero occurrences in this file), so one file
     * accumulated per offload call, forever: measured on a dev device, 35 files
     * spanning 12 days and surviving many app restarts, growing +1 per call.
     * On a heavy user's device this reached thousands of files / GBs, showing
     * up as an inflated "Shell container" figure on the storage screen.
     *
     * WHY DELETING IS SAFE HERE.
     *  - [all] = true is used at server start. Any file present then belongs to
     *    a PREVIOUS app process: its tracee died with that process, so no `cat`
     *    can still be pending on it.
     *  - [all] = false keeps files younger than [REPLY_TTL_MS] and is used
     *    opportunistically while serving. The TTL is what makes it safe: it only
     *    ever removes files far older than the microseconds between writing the
     *    reply and the rewritten `cat` reading it. A pathologically stopped
     *    tracee (SIGSTOP between execve-enter and the read) is the sole way to
     *    exceed it, and that already means the caller is not reading its output.
     *
     * Failures are logged and swallowed: a leaked temp file must never break an
     * offload call.
     */
    private fun sweepStaleReplies(all: Boolean) {
        val dir = rootfsTmpDir ?: return
        try {
            val cutoff = System.currentTimeMillis() - REPLY_TTL_MS
            var removed = 0
            var bytes = 0L
            dir.listFiles { f -> f.isFile && f.name.startsWith(REPLY_PREFIX) }?.forEach { f ->
                if (!all && f.lastModified() > cutoff) return@forEach
                val len = f.length()
                if (f.delete()) {
                    removed++
                    bytes += len
                }
            }
            if (removed > 0) {
                Log.i(TAG, "swept $removed stale reply file(s), freed ${bytes / 1024}KB (all=$all)")
            }
        } catch (e: Exception) {
            Log.w(TAG, "sweepStaleReplies failed: ${e.message}")
        }
    }

    private fun bindWithRetry(): LocalServerSocket? {
        // Backoff schedule: 0, 50, 100, 200, 400, 800 ms — total ~1.55s.
        val delays = longArrayOf(0L, 50L, 100L, 200L, 400L, 800L)
        for ((attempt, delay) in delays.withIndex()) {
            if (delay > 0) Thread.sleep(delay)
            try {
                return LocalServerSocket(SOCKET_NAME)
            } catch (e: java.io.IOException) {
                Log.w(TAG, "bind attempt ${attempt + 1}/${delays.size} failed: ${e.message}")
            }
        }
        return null
    }

    @Synchronized
    fun stop() {
        try { serverSocket?.close() } catch (_: Exception) {}
        serverSocket = null
        acceptThread = null
    }

    private fun runAcceptLoop(s: LocalServerSocket) {
        while (true) {
            val client = try {
                s.accept()
            } catch (e: Exception) {
                Log.i(TAG, "accept loop terminated: ${e.message}")
                return
            }
            Log.d(TAG, "accepted client from proot extension")
            thread(name = "native-offload-worker", isDaemon = true) {
                try {
                    handleClient(client)
                } catch (e: Exception) {
                    Log.w(TAG, "worker error: ${e.message}", e)
                } finally {
                    try { client.close() } catch (_: Exception) {}
                }
            }
        }
    }

    private fun handleClient(client: LocalSocket) {
        val input = DataInputStream(client.inputStream)
        val output = DataOutputStream(client.outputStream)

        val magic = input.readLEInt()
        if (magic != MAGIC_REQ) {
            Log.w(TAG, "bad magic: 0x${magic.toUInt().toString(16)}")
            return
        }
        val version = input.readLEInt()
        if (version != VERSION) {
            Log.w(TAG, "unsupported version $version")
            return
        }

        val pid = input.readLEInt()
        val argc = input.readLEInt()
        if (argc < 0 || argc > 256) throw IllegalStateException("bad argc=$argc")
        val argv = ArrayList<String>(argc)
        repeat(argc) { argv.add(input.readLEString()) }

        val envc = input.readLEInt()
        if (envc < 0 || envc > 4096) throw IllegalStateException("bad envc=$envc")
        val env = LinkedHashMap<String, String>(envc)
        repeat(envc) {
            val s = input.readLEString()
            val eq = s.indexOf('=')
            if (eq >= 0) env[s.substring(0, eq)] = s.substring(eq + 1) else env[s] = ""
        }
        val cwd = input.readLEString()

        val name = argv.firstOrNull().orEmpty().substringAfterLast('/')
        Log.d(TAG, "recv pid=$pid name='$name' argc=$argc argv=$argv cwd=$cwd envc=$envc")

        val t0 = System.nanoTime()
        val handler = handlers[name]
        val result = if (handler == null) {
            Log.w(TAG, "no handler registered for '$name' (known=${handlers.keys})")
            NativeOffloadResult(exitCode = 127, output = "native_offload: no handler for '$name'\n")
        } else {
            try {
                handler.handle(NativeOffloadRequest(
                    pid = pid,
                    argv = argv,
                    env = env,
                    cwd = cwd,
                    sessionId = env["MINIS_CHAT_SESSION_ID"]?.takeIf { it.isNotEmpty() },
                ))
            } catch (e: Exception) {
                Log.w(TAG, "handler '$name' threw: ${e.message}", e)
                NativeOffloadResult(exitCode = 1, output = "native_offload: ${e.message}\n")
            }
        }
        val elapsedMs = (System.nanoTime() - t0) / 1_000_000

        val tmpDir = rootfsTmpDir ?: throw IllegalStateException("server not started")
        tmpDir.mkdirs()
        val seq = counter.incrementAndGet()
        val tmpHost = File(tmpDir, "$REPLY_PREFIX$pid-$seq")
        tmpHost.writeText(result.output)
        val tmpGuest = "/tmp/${tmpHost.name}"

        // [T-android-offload-tmp-leak] Bound growth WITHIN a long-running
        // process. The start-time sweep only catches files from previous
        // processes, but a single session can issue thousands of offload calls
        // (agent loops shelling out repeatedly), so without this the leak simply
        // moves from "across restarts" to "within one run". Age-gated, so the
        // file just written — and any other still awaiting its `cat` — is never
        // touched. Sampled rather than run per reply to keep the hot path cheap.
        if (seq % SWEEP_EVERY_N_REPLIES == 0L) sweepStaleReplies(all = false)

        Log.d(TAG, "reply name='$name' exit=${result.exitCode} outBytes=${result.output.length} " +
            "tmpGuest=$tmpGuest elapsed=${elapsedMs}ms")

        output.writeLEInt(MAGIC_RSP)
        output.writeLEInt(result.exitCode)
        output.writeLEString(tmpGuest)
        output.flush()
    }

    // ---- little-endian helpers ----

    private fun DataInputStream.readLEInt(): Int {
        val buf = ByteArray(4)
        readFully(buf)
        return ByteBuffer.wrap(buf).order(ByteOrder.LITTLE_ENDIAN).int
    }

    private fun DataInputStream.readLEString(): String {
        val len = readLEInt()
        if (len < 0 || len > 1 shl 20) throw IllegalStateException("bad string len $len")
        if (len == 0) return ""
        val buf = ByteArray(len)
        readFully(buf)
        return String(buf, Charsets.UTF_8)
    }

    private fun DataOutputStream.writeLEInt(v: Int) {
        val buf = ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(v).array()
        write(buf)
    }

    private fun DataOutputStream.writeLEString(s: String) {
        val bytes = s.toByteArray(Charsets.UTF_8)
        writeLEInt(bytes.size)
        if (bytes.isNotEmpty()) write(bytes)
    }
}
