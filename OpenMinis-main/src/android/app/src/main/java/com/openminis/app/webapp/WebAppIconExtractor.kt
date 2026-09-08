package com.openminis.app.webapp

import java.io.File

/**
 * T-pwa-1 stub (renamed Pwa → WebApp): extract a relative icon path
 * from an HTML file's `<link rel="icon">` / `<link rel="apple-touch-icon">`
 * tags. Network fetching is intentionally NOT implemented in this
 * sub-task — only relative path resolution against the HTML's parent
 * directory.
 *
 * Returns an [IconCandidate] with an absolute path to the on-device file
 * if the `href` is a relative reference and the file exists; otherwise
 * null.
 */
object WebAppIconExtractor {

    data class IconCandidate(val localPath: String)

    private val LINK_RE = Regex(
        "<link\\s+[^>]*rel\\s*=\\s*[\"'](?:apple-touch-icon|icon|shortcut\\s+icon)[\"'][^>]*>",
        RegexOption.IGNORE_CASE,
    )
    private val HREF_RE = Regex(
        "href\\s*=\\s*[\"']([^\"']+)[\"']",
        RegexOption.IGNORE_CASE,
    )

    fun extractFromHtml(htmlPath: String): IconCandidate? {
        val htmlFile = File(htmlPath)
        if (!htmlFile.exists() || !htmlFile.isFile) return null
        val parent = htmlFile.parentFile ?: return null
        val head = runCatching {
            // Read up to ~256KB — favicon links are always in <head>.
            htmlFile.inputStream().use { input ->
                val buf = ByteArray(256 * 1024)
                val n = input.read(buf)
                if (n <= 0) "" else String(buf, 0, n, Charsets.UTF_8)
            }
        }.getOrNull() ?: return null

        for (match in LINK_RE.findAll(head)) {
            val href = HREF_RE.find(match.value)?.groupValues?.getOrNull(1)
                ?: continue
            // Skip data URIs and absolute URLs — out of scope for the stub.
            if (href.startsWith("data:") || href.contains("://")) continue
            val candidate = File(parent, href.trimStart('/'))
            if (candidate.exists() && candidate.isFile) {
                return IconCandidate(candidate.absolutePath)
            }
        }
        return null
    }
}
