package com.openminis.app.browser

/**
 * Result of a browser action execution, mirroring iOS BrowserActionResult.
 */
data class BrowserActionResult(
    val text: String,
    val success: Boolean = true,
    /** Base64-encoded JPEG for the vision API. */
    val base64Image: String? = null,
    /** Local file path where the screenshot was saved to disk. */
    val imageFilePath: String? = null,
    /** Raw downloaded file data (for fetch action). */
    val fetchedFileData: ByteArray? = null,
    /** Determined filename for the fetched file. */
    val fetchedFileName: String? = null,
    /** The page URL at the time this action was executed. */
    val pageURL: String? = null,
    /**
     * [T-android-browser-result-tab-id] The tab id this action actually ran on.
     * Stamped by [com.openminis.app.browser.BrowserTabPool] at the point of
     * dispatch using the acquired tab's id (the VERIFIED target), NOT the global
     * selectedTabId — which the fan-out branch overwrites when it spawns a fresh
     * tab for a concurrent navigate. Without this, the agent had to guess tab_id
     * for its follow-up reads/scrolls and routinely picked the wrong one,
     * sometimes surfacing as empty get_text results.
     */
    val tabId: Int? = null,
) {
    companion object {
        fun error(message: String) = BrowserActionResult(
            text = "Error: $message",
            success = false,
        )
    }
}
