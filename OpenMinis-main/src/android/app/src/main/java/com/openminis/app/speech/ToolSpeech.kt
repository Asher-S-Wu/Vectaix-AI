package com.openminis.app.speech

import org.json.JSONObject

/**
 * Spoken announcement for a tool call — "正在执行脚本:安装依赖" /
 * "Executing script: install deps".
 *
 * Port of iOS `AIChatViewModel.makeToolSpeech`
 * (Agent/Chat/AIChatViewModel+SSEStream.swift), including its phrasing, its
 * 40-character clip and its per-tool argument fallbacks — a listener who
 * switches platforms should hear the same sentence.
 *
 * Deliberately NOT the on-screen preview text ("Executing…", "Reading /x…").
 * Those are terse because the screen shows the arguments next to them; spoken
 * aloud with no visual context they say almost nothing, so this builds a
 * natural cue instead.
 *
 * Pure and framework-free so it is unit-testable — the announcement is the part
 * that has to stay aligned across platforms, and it should not need a device to
 * verify.
 */
object ToolSpeech {

    /** Longest detail we will speak; beyond this the tail becomes "…". */
    private const val DETAIL_MAX = 40

    private val HAN = Regex("\\p{IsHan}")

    /**
     * Build the announcement for a tool call.
     *
     * @param name tool name as the model called it (`shell_execute`, `file_read`…)
     * @param argsJson raw JSON arguments; malformed or partial JSON is tolerated
     *   and simply yields no argument fallback.
     * @param title the model's own `tool_title` summary, when it supplied one.
     */
    fun announcement(name: String, argsJson: String?, title: String?): String {
        val args = parseArgs(argsJson)
        // Language follows the model's own summary, matching iOS: the title is
        // written in the user's language (the tool schema asks for it), so it
        // is a better signal than the device locale — a Chinese user talking to
        // an English-answering model should hear one language, not a mix.
        val zh = title?.let { HAN.containsMatchIn(it) } ?: false
        val detail = clip(title)

        return when (name) {
            "shell_execute" -> {
                val d = detail ?: clip(args?.optString("command")) ?: ""
                if (zh) "正在执行脚本:$d" else "Executing script: $d"
            }
            "file_read" -> {
                val d = detail ?: fileName(args?.optString("path"), zh)
                if (zh) "正在读取文件:$d" else "Reading file: $d"
            }
            "file_write" -> {
                val d = detail ?: fileName(args?.optString("path"), zh)
                if (zh) "正在写入文件:$d" else "Writing file: $d"
            }
            "file_edit" -> {
                val d = detail ?: fileName(args?.optString("path"), zh)
                if (zh) "正在编辑文件:$d" else "Editing file: $d"
            }
            "browser_use" -> {
                val d = detail ?: clip(args?.optString("action")) ?: ""
                if (zh) "正在操作浏览器:$d" else "Using browser: $d"
            }
            "read_image" -> {
                val d = detail ?: fileName(args?.optString("path"), zh)
                if (zh) "正在读取图片:$d" else "Reading image: $d"
            }
            else -> {
                val d = detail ?: name
                if (zh) "正在执行:$d" else "Running: $d"
            }
        }
    }

    /**
     * Tool args arrive as the raw JSON the model streamed, which can be
     * incomplete when a call is announced mid-stream. A parse failure is not an
     * error here — it just means no argument fallback is available and the
     * tool name carries the announcement.
     */
    private fun parseArgs(argsJson: String?): JSONObject? {
        if (argsJson.isNullOrBlank()) return null
        return runCatching { JSONObject(argsJson) }.getOrNull()
    }

    private fun clip(s: String?): String? {
        val t = s?.trim()?.takeIf { it.isNotEmpty() && it != "null" } ?: return null
        return if (t.length > DETAIL_MAX) t.take(DETAIL_MAX) + "…" else t
    }

    /** Last path component — the full path is noise when spoken. */
    private fun fileName(path: String?, zh: Boolean): String {
        val p = path?.trim()?.takeIf { it.isNotEmpty() && it != "null" }
            ?: return if (zh) "文件" else "a file"
        return p.trimEnd('/').substringAfterLast('/').ifEmpty { p }
    }
}
