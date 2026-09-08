package com.openminis.app.sandbox.offload

import android.content.Context
import android.util.Log
import com.openminis.app.sandbox.NativeOffloadHandler
import com.openminis.app.sandbox.NativeOffloadRequest
import com.openminis.app.sandbox.NativeOffloadResult
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketTimeoutException

/**
 * minis-debug — DEBUG-ONLY CLI wrapper for the local DebugServer JSON-RPC
 * endpoint at 127.0.0.1:5321.
 *
 * Lets a user (or agent) in the PRoot shell drive the in-app debug RPC
 * without hand-rolling curl + JSON. Each subcommand maps to one RPC
 * method registered in DebugMethodRegistry; the response envelope from
 * the server is forwarded verbatim through OffloadOutput so the standard
 * `--compact` / `-q` / `--quiet` flags work the same way as every other
 * `android-*` / `minis-*` offload.
 *
 * Registration is guarded by `BuildConfig.DEBUG` in MinisApp.kt so the
 * Release APK contains no trace of this command.
 */
class DebugOffloadHandler(@Suppress("UNUSED_PARAMETER") context: Context) : NativeOffloadHandler {

    override fun handle(request: NativeOffloadRequest): NativeOffloadResult {
        val args = OffloadArgs(request.argv.drop(1), booleanFlags = BOOLEAN_FLAGS)
        if (request.argv.size <= 1 || args.hasFlag("h", "help") && args.positional.isEmpty()) {
            return NativeOffloadResult(if (request.argv.size <= 1) 2 else 0, HELP)
        }

        // Per-subcommand --help: `minis-debug ls --help` prints the same
        // top-level help so the user discovers the full surface either
        // way. Cheaper than per-subcommand help strings; the help text
        // already enumerates every subcommand's flags.
        if (args.hasFlag("h", "help")) {
            return NativeOffloadResult(0, HELP)
        }

        val sub = args.positional.getOrNull(0)
            ?: return NativeOffloadResult(2, HELP)

        val rpc: RpcCall = try {
            buildRpcCall(sub, args)
        } catch (e: BadArgsException) {
            return NativeOffloadResult(2, "minis-debug $sub: ${e.message}\n")
        }

        return try {
            val response = postJsonRpc(rpc.method, rpc.params)
            // DebugServer returns a JSON-RPC 2.0 envelope: {jsonrpc, id, result|error}.
            // We pass it through formatBody so --compact / -q work; -q strips to
            // the iOS-style {ok, data, error} envelope when present, otherwise
            // returns the raw object. Exit code reflects RPC error.
            val obj = try { JSONObject(response) } catch (_: Exception) { null }
            val isError = obj?.has("error") == true
            NativeOffloadResult(
                if (isError) 1 else 0,
                OffloadOutput.formatBody(response, args) + "\n",
            )
        } catch (e: ConnectionRefused) {
            val body = JSONObject()
                .put("error", "debug_server_unreachable")
                .put("message", "Debug server not running on 127.0.0.1:5321. Is this a debug build?")
                .toString()
            NativeOffloadResult(1, OffloadOutput.formatBody(body, args) + "\n")
        } catch (e: SocketTimeoutException) {
            val body = JSONObject()
                .put("error", "debug_server_timeout")
                .put("message", "Debug server did not respond within ${TIMEOUT_MS / 1000}s.")
                .toString()
            NativeOffloadResult(1, OffloadOutput.formatBody(body, args) + "\n")
        } catch (e: Throwable) {
            Log.w(TAG, "uncaught: ${e.message}", e)
            val body = JSONObject()
                .put("error", "internal")
                .put("message", e.message ?: e.javaClass.simpleName)
                .toString()
            NativeOffloadResult(1, OffloadOutput.formatBody(body, args) + "\n")
        }
    }

    // ── Subcommand → JSON-RPC mapping ────────────────────────────────────────

    private data class RpcCall(val method: String, val params: JSONObject)
    private class BadArgsException(msg: String) : RuntimeException(msg)

    private fun buildRpcCall(sub: String, args: OffloadArgs): RpcCall {
        val rest = args.positional.drop(1)
        return when (sub) {
            "discover" -> RpcCall("rpc.discover", JSONObject())

            "appInfo" -> RpcCall("debug.appInfo", JSONObject())

            "screenshot" -> {
                val p = JSONObject()
                args.getDouble("scale")?.let { p.put("scale", it) }
                RpcCall("debug.screenshot", p)
            }

            "ls" -> {
                val p = JSONObject()
                rest.firstOrNull()?.let { p.put("path", it) }
                if (args.hasFlag("recursive")) p.put("recursive", true)
                args.getInt("maxDepth")?.let { p.put("maxDepth", it) }
                RpcCall("debug.ls", p)
            }

            "read" -> {
                val path = rest.firstOrNull()
                    ?: throw BadArgsException("missing <path>")
                val p = JSONObject().put("path", path)
                args.getInt("offset")?.let { p.put("offset", it) }
                args.getInt("limit")?.let { p.put("limit", it) }
                if (args.hasFlag("base64")) p.put("base64", true)
                RpcCall("debug.readFile", p)
            }

            "write" -> {
                val path = rest.firstOrNull()
                    ?: throw BadArgsException("missing <path>")
                val content = args.get("content")
                    ?: throw BadArgsException("missing --content <text>")
                val p = JSONObject().put("path", path).put("content", content)
                args.get("encoding")?.let { p.put("encoding", it) }
                RpcCall("debug.writeFile", p)
            }

            "exec" -> {
                if (rest.isEmpty()) throw BadArgsException("missing <command...>")
                val command = rest.joinToString(" ")
                RpcCall("debug.shellExecute", JSONObject().put("command", command))
            }

            // Android-only debug-build methods, exposed because they live
            // in DEBUG_ONLY_METHODS of DebugMethodRegistry and are useful
            // from a shell context. Both take an `args` JSON array; we
            // accept either a positional command line or `--args '["a","b"]'`.
            "shizuku" -> RpcCall("debug.shizuku.exec", buildExecForwarder(rest, args))
            "model-use", "modelUse" -> RpcCall("debug.modelUse.exec", buildExecForwarder(rest, args))

            // Generic escape hatch — call any registered method directly.
            // `minis-debug call <method> [--params '<json>']`
            "call" -> {
                val method = rest.firstOrNull()
                    ?: throw BadArgsException("missing <method>")
                val raw = args.get("params")
                val params = if (raw.isNullOrBlank()) JSONObject() else try {
                    JSONObject(raw)
                } catch (_: Exception) {
                    throw BadArgsException("--params must be a JSON object")
                }
                RpcCall(method, params)
            }

            else -> throw BadArgsException("unknown subcommand '$sub' (try `minis-debug --help`)")
        }
    }

    /**
     * Build the `{args: [...]}` envelope expected by `debug.shizuku.exec` /
     * `debug.modelUse.exec`. If the user passes `--args '["foo","bar"]'`
     * we take that verbatim; otherwise we use the remaining positional
     * arguments as the argv slice.
     */
    private fun buildExecForwarder(rest: List<String>, args: OffloadArgs): JSONObject {
        val explicit = args.get("args")
        val argvArr = if (explicit != null) {
            try { JSONArray(explicit) }
            catch (_: Exception) { throw BadArgsException("--args must be a JSON array of strings") }
        } else {
            JSONArray().apply { rest.forEach { put(it) } }
        }
        return JSONObject().put("args", argvArr)
    }

    // ── Raw HTTP POST over Socket ────────────────────────────────────────────

    private class ConnectionRefused(cause: Throwable) : IOException(cause)

    /**
     * Hand-rolled HTTP/1.1 POST so we don't pull in OkHttp or HttpURLConnection's
     * connection-pool quirks for what is a single localhost round-trip.
     * DebugServer reads exactly Content-Length bytes off the wire and writes
     * an HTTP/1.1 response with its own Content-Length header — see
     * DebugServer.handleConnection.
     */
    private fun postJsonRpc(method: String, params: JSONObject): String {
        val body = JSONObject()
            .put("jsonrpc", "2.0")
            .put("id", 1)
            .put("method", method)
            .put("params", params)
            .toString()
        val bodyBytes = body.toByteArray(Charsets.UTF_8)

        val socket = Socket()
        try {
            try {
                socket.connect(InetSocketAddress("127.0.0.1", DEBUG_SERVER_PORT), TIMEOUT_MS)
            } catch (e: java.net.ConnectException) {
                throw ConnectionRefused(e)
            }
            socket.soTimeout = TIMEOUT_MS

            val out: OutputStream = socket.getOutputStream()
            val req = buildString {
                append("POST / HTTP/1.1\r\n")
                append("Host: 127.0.0.1:$DEBUG_SERVER_PORT\r\n")
                append("Content-Type: application/json\r\n")
                append("Content-Length: ${bodyBytes.size}\r\n")
                append("Connection: close\r\n")
                append("\r\n")
            }.toByteArray(Charsets.UTF_8)
            out.write(req)
            out.write(bodyBytes)
            out.flush()

            return readHttpResponse(BufferedInputStream(socket.getInputStream()))
        } finally {
            try { socket.close() } catch (_: Throwable) {}
        }
    }

    /**
     * Minimal HTTP/1.1 response parser: status line, headers, then body
     * sized by Content-Length (DebugServer always sends one). We don't
     * support chunked transfer because DebugServer doesn't emit it.
     */
    private fun readHttpResponse(input: BufferedInputStream): String {
        // Read header section: bytes up to and including "\r\n\r\n".
        val headerBuf = ByteArrayOutputStream()
        var prev = -1
        var prev2 = -1
        var prev3 = -1
        while (true) {
            val b = input.read()
            if (b == -1) throw IOException("debug server closed connection before headers complete")
            headerBuf.write(b)
            if (prev3 == 0x0D && prev2 == 0x0A && prev == 0x0D && b == 0x0A) break
            prev3 = prev2
            prev2 = prev
            prev = b
        }
        val headerText = headerBuf.toString("UTF-8")
        var contentLength = -1
        for (line in headerText.split("\r\n")) {
            val idx = line.indexOf(':')
            if (idx <= 0) continue
            if (line.substring(0, idx).equals("Content-Length", ignoreCase = true)) {
                contentLength = line.substring(idx + 1).trim().toIntOrNull() ?: -1
            }
        }
        if (contentLength < 0) {
            // Fall back to read-to-EOF — DebugServer normally sets the
            // header, but we'd rather degrade than fail outright.
            val rest = ByteArrayOutputStream()
            val buf = ByteArray(4096)
            while (true) {
                val n = input.read(buf)
                if (n <= 0) break
                rest.write(buf, 0, n)
            }
            return rest.toString("UTF-8")
        }

        val bodyBuf = ByteArray(contentLength)
        var read = 0
        while (read < contentLength) {
            val n = input.read(bodyBuf, read, contentLength - read)
            if (n < 0) throw IOException("debug server closed connection at $read / $contentLength bytes")
            read += n
        }
        return String(bodyBuf, Charsets.UTF_8)
    }

    companion object {
        private const val TAG = "DebugOffload"
        private const val DEBUG_SERVER_PORT = 5321
        private const val TIMEOUT_MS = 30_000

        /**
         * Declared boolean flags so OffloadArgs doesn't greedily consume the
         * following positional token as a value. e.g. `--recursive /sdcard`
         * must parse as flag + positional, not `--recursive=/sdcard`.
         */
        private val BOOLEAN_FLAGS = setOf("recursive", "base64")

        private const val HELP = """minis-debug — CLI for the in-app DebugServer JSON-RPC (debug builds only)

Usage:
  minis-debug <subcommand> [options]

SUBCOMMANDS:
  discover                           List all registered RPC methods (rpc.discover)
  appInfo                            Show platform / SDK / build info (debug.appInfo)
  screenshot [--scale N]             Capture foreground Activity (debug.screenshot)

  ls [path] [--recursive] [--maxDepth N]
                                     List a path inside the PRoot rootfs (debug.ls)
  read <path> [--offset N] [--limit N] [--base64]
                                     Read a file from PRoot rootfs (debug.readFile)
  write <path> --content <text> [--encoding utf8|base64]
                                     Write a file inside PRoot rootfs (debug.writeFile)
  exec <command...>                  Run a shell command via debug.shellExecute

Android-only (DEBUG_ONLY_METHODS in DebugMethodRegistry):
  shizuku <argv...>                  Invoke android-shizuku-cli (debug.shizuku.exec)
  model-use <argv...>                Invoke minis-model-use (debug.modelUse.exec)

Escape hatch (for any method not listed above):
  call <method> [--params '<json>']  Invoke an arbitrary registered method

GLOBAL OPTIONS:
  --help, -h                         Show this help
  --compact                          Minimize JSON output
  -q, --quiet                        Output only the data/error field of the
                                     iOS-style envelope (when present)

EXAMPLES:
  minis-debug discover
  minis-debug appInfo
  minis-debug ls /sdcard --recursive --maxDepth 2
  minis-debug read /etc/passwd --offset 0 --limit 100
  minis-debug exec uname -a
  minis-debug call debug.logs.list --params '{}'

The handler talks to 127.0.0.1:$DEBUG_SERVER_PORT (DebugServer). If the server
isn't running you'll see `debug_server_unreachable` — Release builds don't
ship this command at all.
"""
    }
}
