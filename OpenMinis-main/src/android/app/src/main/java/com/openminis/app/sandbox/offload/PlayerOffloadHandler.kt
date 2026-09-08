package com.openminis.app.sandbox.offload

import com.openminis.app.offload.MediaPlayerManager
import com.openminis.app.sandbox.NativeOffloadHandler
import com.openminis.app.sandbox.NativeOffloadRequest
import com.openminis.app.sandbox.NativeOffloadResult

/**
 * android-player — control audio playback.
 *
 * Usage:
 *   android-player play <session> <path>
 *   android-player pause <session>
 *   android-player resume <session>
 *   android-player seek <session> <position_ms>
 *   android-player stop <session>
 *   android-player status <session>
 *   android-player list
 */
class PlayerOffloadHandler : NativeOffloadHandler {
    override fun handle(request: NativeOffloadRequest): NativeOffloadResult {
        val args = OffloadArgs(request.argv.drop(1))
        // [T-offload-defaults-batch-android] Help only on explicit
        // --help/-h; no subcommand defaults to `list` (NOT `status`, which
        // requires a <session> id and would exit 2 with zero args).
        if (args.hasFlag("h", "help")) {
            return NativeOffloadResult(0, HELP)
        }

        val sub = args.positional.firstOrNull() ?: "list"
        val id = args.positional.getOrNull(1)
        val result = try {
            when (sub) {
                "play" -> {
                    val path = args.positional.getOrNull(2)
                    if (id == null || path == null) {
                        return NativeOffloadResult(2, "android-player play: need <session> <path>\n")
                    }
                    MediaPlayerManager.play(id, path)
                }
                "pause" -> {
                    if (id == null) return NativeOffloadResult(2, "android-player pause: need <session>\n")
                    MediaPlayerManager.pause(id)
                }
                "resume" -> {
                    if (id == null) return NativeOffloadResult(2, "android-player resume: need <session>\n")
                    MediaPlayerManager.resume(id)
                }
                "seek" -> {
                    val pos = args.positional.getOrNull(2)?.toIntOrNull()
                    if (id == null || pos == null) {
                        return NativeOffloadResult(2, "android-player seek: need <session> <position_ms>\n")
                    }
                    MediaPlayerManager.seek(id, pos)
                }
                "stop" -> {
                    if (id == null) return NativeOffloadResult(2, "android-player stop: need <session>\n")
                    MediaPlayerManager.stop(id)
                }
                "status" -> {
                    if (id == null) return NativeOffloadResult(2, "android-player status: need <session>\n")
                    MediaPlayerManager.status(id)
                }
                "list" -> MediaPlayerManager.listSessions()
                else -> return NativeOffloadResult(2, "android-player: unknown subcommand '$sub'\n$HELP")
            }
        } catch (e: Throwable) {
            val body = org.json.JSONObject().put("error", "player_failed")
                .put("message", e.message ?: "unknown").toString()
            return NativeOffloadResult(1, OffloadOutput.formatBody(body, args) + "\n")
        }
        val err = result.startsWith("Error")
        val formatted = OffloadOutput.formatBody(result.trimEnd('\n'), args)
        return NativeOffloadResult(if (err) 1 else 0, "$formatted\n")
    }

    companion object {
        private const val HELP = """android-player — control audio playback sessions

Usage:
  android-player                    Same as `list` (default subcommand)
  android-player play <session> <path>
  android-player pause <session>
  android-player resume <session>
  android-player seek <session> <position_ms>
  android-player stop <session>
  android-player status <session>
  android-player list
"""
    }
}
