package com.openminis.app.terminal

/**
 * Parses the OSC 1337 `MinisOpenURL` escape sequence emitted by the rootfs
 * shim at `/usr/local/bin/minis-open`. The shim stands in for `xdg-open`,
 * `sensible-browser`, `www-browser`, and `$BROWSER`; whenever an in-sandbox
 * command tries to open a URL, it prints:
 *
 *     ESC ] 1337 ; MinisOpenURL = <url> BEL
 *
 * This parser strips the marker from the displayed shell output and returns
 * the captured URLs so the host can present the in-app preview (WebView for
 * http(s)/about, file preview for minis://).
 *
 * Mirrors iOS `MinisURLMarker` in `AIChatViewModel.swift`.
 */
object MinisUrlMarker {
    /**
     * ESC ] 1337 ; MinisOpenURL = <url> (BEL | ESC \)
     *
     * The URL runs until the first BEL (0x07) or ESC (0x1B) — the ST
     * terminator `ESC \` is accepted as an alternative to BEL for robustness.
     */
    private val PATTERN = Regex("\u001B]1337;MinisOpenURL=([^\u0007\u001B]*)(?:\u0007|\u001B\\\\)")

    /**
     * Extract every captured URL from [text] and return the text with every
     * marker sequence removed. When [text] contains no marker, returns
     * `(text, emptyList())` untouched (no allocation overhead).
     */
    fun extract(text: String): Pair<String, List<String>> {
        if (!text.contains("MinisOpenURL=")) return text to emptyList()
        val matches = PATTERN.findAll(text).toList()
        if (matches.isEmpty()) return text to emptyList()

        val urls = matches.map { it.groupValues[1] }.filter { it.isNotEmpty() }
        val cleaned = PATTERN.replace(text, "")
        return cleaned to urls
    }

    /** Convenience: drop the markers, discard captured URLs. */
    fun stripMarkers(text: String): String {
        if (!text.contains("MinisOpenURL=")) return text
        return PATTERN.replace(text, "")
    }

    /**
     * Convenience for streaming single-line callers: return the first captured
     * URL or null. Use [extract] when you may encounter multiple markers on a
     * single line (rare but possible when a command chains several opens).
     */
    fun extractUrl(text: String): String? {
        if (!text.contains("MinisOpenURL=")) return null
        return PATTERN.find(text)?.groupValues?.getOrNull(1)?.takeIf { it.isNotEmpty() }
    }
}
