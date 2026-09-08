package com.openminis.app.ui.chat

import android.content.Context

/**
 * [T-voice-input-mode-preference-android] Remembers the user's preferred
 * composer input method (voice vs text).
 *
 * Preference update rule:
 *  - tapping the mic so a recording actually STARTS → "voice"
 *  - sending a message composed without any voice session since the
 *    composer was last cleared → "text"
 *
 * Default is "text".
 *
 * [T-android-remove-auto-enter-voice] The preference is recorded but NO LONGER
 * drives auto-entry into voice on cold launch / new chat (that behaviour, added
 * in ec95451a, was removed). The composer always starts in text mode; voice is
 * entered only when the user taps the mic. The launch-landing one-shot
 * (markLaunchChatLanding / consumeLaunchLanding) and the unused isVoice() reader
 * were removed along with the auto-enter logic; only save() remains, still
 * called on send so the stored preference stays current for any future use.
 */
object ComposerInputModePrefs {

    private const val PREFS = "composer_input_prefs"
    private const val KEY_MODE = "composer_input_mode_pref"

    fun save(context: Context, voice: Boolean) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_MODE, if (voice) "voice" else "text")
            .apply()
    }
}
