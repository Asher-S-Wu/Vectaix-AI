package com.openminis.app.provider.voice

import com.openminis.app.data.model.LLMModel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * [T-android-openrouter-voice] Branch selection for OpenRouter voice
 * (parity with iOS 1946b0b2 / 1f23fd02).
 *
 * OpenRouter serves transcription from TWO endpoints with DISJOINT model sets,
 * and each endpoint REJECTS the other's models. Picking the wrong branch is
 * therefore always an HTTP 400, never a degraded-but-working request — which is
 * exactly the bug being fixed. These tests pin the routing predicate itself,
 * since it is the whole of the fix that can be checked without a live key.
 */
class OpenRouterVoiceRoutingTest {

    private fun provider() =
        OpenRouterVoiceProvider("test-instance", "https://openrouter.ai/api", "sk-test")

    private fun model(id: String) = LLMModel(id = id, displayName = id, provider = "OpenRouter")

    // -- ASR: dedicated transcription models stay on /v1/audio/transcriptions --

    @Test
    fun `whisper stays on the REST transcriptions endpoint`() {
        // The regression control from the iOS fix: whisper works TODAY on REST
        // and is explicitly rejected by chat.completions ("is a transcription
        // model and cannot be used with the chat/completions endpoint").
        assertFalse(provider().usesChatBasedASR(model("openai/whisper-1")))
    }

    @Test
    fun `gpt-4o transcribe variants stay on REST`() {
        assertFalse(provider().usesChatBasedASR(model("openai/gpt-4o-transcribe")))
        assertFalse(provider().usesChatBasedASR(model("openai/gpt-4o-mini-transcribe")))
    }

    @Test
    fun `deepgram is matched vendor-qualified, so amazon nova is NOT misrouted`() {
        // A bare "nova-2"/"nova-3" pattern would also match amazon/nova-2-lite-v1,
        // a CHAT model in the catalogue — sending it to /audio/transcriptions
        // returns the very 400 this fix removes.
        assertFalse(provider().usesChatBasedASR(model("deepgram/nova-3")))
        assertTrue(provider().usesChatBasedASR(model("amazon/nova-2-lite-v1")))
    }

    // -- ASR: everything else is treated as a chat model ----------------------

    @Test
    fun `audio-capable chat models route to chat completions`() {
        // These are the ids from the user report that used to 400 on REST.
        assertTrue(provider().usesChatBasedASR(model("google/gemini-3.6-flash")))
        assertTrue(provider().usesChatBasedASR(model("openai/gpt-audio-mini")))
    }

    @Test
    fun `the rule is inverted versus the base class, covering future audio chat models`() {
        // The base class allowlists chat-audio stems; here the DEFAULT is chat,
        // so a new audio chat model needs no code change. Contrast with the base,
        // which would send this to the REST endpoint that only takes ASR models.
        val future = model("somevendor/brand-new-speech-chat")
        assertTrue(provider().usesChatBasedASR(future))
        assertFalse(VoiceProvider("i", "https://x", null).usesChatBasedASR(future))
    }

    // -- The WAV wrapper the TTS half depends on ------------------------------

    @Test
    fun `PCM16 is wrapped in a RIFF WAV header with the declared sample rate`() {
        // synthesize() must return something a media player can open; headerless
        // PCM is not that. 24 kHz is asserted because a wrong rate is not an
        // error, just wrong pitch — silent unless pinned.
        val pcm = ByteArray(480) { 0 }
        val wav = VoiceProvider.wrapPcm16InWav(pcm, 24000)

        assertEquals("RIFF", String(wav.copyOfRange(0, 4)))
        assertEquals("WAVE", String(wav.copyOfRange(8, 12)))
        assertEquals(44 + pcm.size, wav.size)

        fun le32(at: Int) = (wav[at].toInt() and 0xFF) or
            ((wav[at + 1].toInt() and 0xFF) shl 8) or
            ((wav[at + 2].toInt() and 0xFF) shl 16) or
            ((wav[at + 3].toInt() and 0xFF) shl 24)

        assertEquals(24000, le32(24))          // sample rate
        assertEquals(24000 * 2, le32(28))      // byte rate = rate * 1ch * 16bit/8
        assertEquals(pcm.size, le32(40))       // data chunk size
    }
}
