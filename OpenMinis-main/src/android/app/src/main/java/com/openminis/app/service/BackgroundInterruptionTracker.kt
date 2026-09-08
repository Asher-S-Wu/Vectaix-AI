package com.openminis.app.service

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Tracks whether an agent session was interrupted by the app going to background.
 * Records a timestamp when the app backgrounds; on resume, if an active session was
 * running, flags the interruption so the UI can alert the user.
 */
object BackgroundInterruptionTracker {

    private var backgroundTimestampMs: Long? = null
    private var wasSessionActive = false

    private val _interrupted = MutableStateFlow(false)
    val interrupted: StateFlow<Boolean> = _interrupted.asStateFlow()

    private val _interruptionDurationMs = MutableStateFlow(0L)
    val interruptionDurationMs: StateFlow<Long> = _interruptionDurationMs.asStateFlow()

    /**
     * Called when the app enters background. Records timestamp and active state.
     */
    fun onBackground(sessionActive: Boolean) {
        backgroundTimestampMs = System.currentTimeMillis()
        wasSessionActive = sessionActive
    }

    /**
     * Called when the app returns to foreground. Checks for interruption.
     */
    fun onForeground() {
        val bgTs = backgroundTimestampMs ?: return
        if (wasSessionActive) {
            val duration = System.currentTimeMillis() - bgTs
            // Only flag as interrupted if backgrounded for more than 5 seconds
            if (duration > 5_000) {
                _interruptionDurationMs.value = duration
                _interrupted.value = true
            }
        }
        backgroundTimestampMs = null
        wasSessionActive = false
    }

    /**
     * Dismiss the interruption alert.
     */
    fun acknowledge() {
        _interrupted.value = false
        _interruptionDurationMs.value = 0
    }
}
