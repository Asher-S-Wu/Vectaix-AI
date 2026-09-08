package com.openminis.app.ui.chat

import android.content.Context
import com.openminis.app.R
import com.openminis.app.data.model.ThinkingLevel

/**
 * Localized display name for [ThinkingLevel]. The data-layer
 * [ThinkingLevel.displayName] returns hard-coded English (it predates the
 * UI i18n pass and is also consumed by debug surfaces) — this extension
 * provides the user-facing translation for the slash panel + Thinking
 * level chips, threading through Context to reach strings.xml.
 */
fun ThinkingLevel.localizedName(context: Context): String =
    context.getString(
        when (this) {
            ThinkingLevel.OFF -> R.string.thinking_level_off
            ThinkingLevel.LOW -> R.string.thinking_level_low
            ThinkingLevel.MEDIUM -> R.string.thinking_level_medium
            ThinkingLevel.HIGH -> R.string.thinking_level_high
            // [T-android-thinking-level-arch] XHIGH now has its own label; "Max"
            // moved to the new MAX case, plus ULTRA.
            ThinkingLevel.XHIGH -> R.string.thinking_level_xhigh
            ThinkingLevel.MAX -> R.string.thinking_level_max
            ThinkingLevel.ULTRA -> R.string.thinking_level_ultra
        },
    )
