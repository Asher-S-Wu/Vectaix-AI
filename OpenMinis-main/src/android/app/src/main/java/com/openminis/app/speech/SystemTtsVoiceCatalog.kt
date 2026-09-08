package com.openminis.app.speech

import android.content.Context
import android.speech.tts.TextToSpeech
import android.speech.tts.Voice
import com.openminis.app.logging.AppLogger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.Locale

/**
 * [T-android-system-voice-catalog] Enumerates the device TTS engine's voices —
 * the Android counterpart of iOS `SystemVoiceCatalog`, which is what lets the
 * iOS voice-output picker list "Tingting (Chinese)…, Anna (German)…" as
 * individually selectable rows while Android only offered a single generic
 * "System Voice (Auto)".
 *
 * Android's [Voice] API exposes no human display name (names are technical,
 * e.g. "cmn-cn-x-ssa-local"), so rows are labelled from the voice's locale
 * plus a variant marker derived from the technical name — "中文 (中国) · ssa"
 * — with a network tag where the voice is cloud-only. Not as pretty as iOS's
 * curated names, but honest about what the engine actually reports.
 *
 * Enumeration requires a BOUND engine, so the first call spins up a throwaway
 * TextToSpeech, waits for init (bounded), snapshots `voices`, and shuts it
 * down; the result is cached for the process (the installed voice set doesn't
 * change under a running app in practice).
 */
object SystemTtsVoiceCatalog {

    data class SystemVoice(
        /** Engine voice name — the stable id passed to TextToSpeech.setVoice. */
        val name: String,
        /** Human-facing label: localized locale name + variant + network tag. */
        val label: String,
        val locale: Locale,
        val networkRequired: Boolean,
    )

    private const val TAG = "SystemTtsVoiceCatalog"
    private const val INIT_TIMEOUT_MS = 4_000L

    @Volatile
    private var cache: List<SystemVoice>? = null
    private val lock = Mutex()

    suspend fun voices(context: Context): List<SystemVoice> {
        cache?.let { return it }
        return lock.withLock {
            cache?.let { return it }
            val listed = enumerate(context.applicationContext)
            // [T-android-tts-catalog-empty-cache] Never cache an EMPTY result.
            // Enumeration fails transiently — cold boot before the TTS service
            // binds, or the 4 s timeout expiring on a slow OEM engine — and
            // caching that for the process left the voice picker permanently
            // blank, including after the user installed a TTS engine from the
            // prompt. Only a non-empty listing is a real answer worth keeping;
            // an empty one just means "ask again next time".
            if (listed.isNotEmpty()) cache = listed
            listed
        }
    }

    private suspend fun enumerate(context: Context): List<SystemVoice> {
        val ready = CompletableDeferred<Boolean>()
        var tts: TextToSpeech? = null
        tts = TextToSpeech(context) { status ->
            ready.complete(status == TextToSpeech.SUCCESS)
        }
        val ok = kotlinx.coroutines.withTimeoutOrNull(INIT_TIMEOUT_MS) { ready.await() } ?: false
        val raw: Set<Voice> = if (ok) {
            // voices can THROW on some engines (documented fragmentation).
            runCatching { tts.voices ?: emptySet() }.getOrElse { emptySet() }
        } else emptySet()
        runCatching { tts.shutdown() }
        if (raw.isEmpty()) {
            AppLogger.info(TAG, "no voices enumerated (initOk=$ok)")
            return emptyList()
        }

        val uiLocale = Locale.getDefault()
        val mapped = raw
            .filterNot { it.features?.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED) == true }
            .map { v ->
                val variant = v.name.substringAfterLast("-x-", "")
                    .substringBefore("-").ifBlank { null }
                val net = v.isNetworkConnectionRequired
                val base = v.locale.getDisplayName(uiLocale).ifBlank { v.locale.toLanguageTag() }
                val label = buildString {
                    append(base)
                    if (variant != null) append(" · ").append(variant)
                    if (net) append(" ☁")
                }
                SystemVoice(name = v.name, label = label, locale = v.locale, networkRequired = net)
            }
            // UI language's voices first, then other Chinese/English, then rest;
            // stable alphabetical inside each tier so the list is reproducible.
            .sortedWith(
                compareBy(
                    { tier(it.locale, uiLocale) },
                    { it.locale.toLanguageTag() },
                    { it.label },
                ),
            )
        AppLogger.info(TAG, "enumerated ${mapped.size} voices (raw=${raw.size})")
        return mapped
    }

    private fun tier(l: Locale, ui: Locale): Int = when {
        l.language == ui.language -> 0
        l.language == "zh" || l.language == "en" -> 1
        else -> 2
    }
}
