package com.openminis.app.speech

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Pause/resume bookkeeping for the mic-capture gate.
 *
 * ReadAloudPlayer itself needs a Context and a live TTS engine, so the state
 * machine is modelled here instead. What these pin is the part that has bitten
 * before: which transitions resume, and whether a resume can strand or
 * duplicate held utterances.
 */
class CapturePauseLogicTest {

    /** Mirrors ReadAloudPlayer's held-queue bookkeeping. */
    private class Player {
        val queue = ArrayDeque<String>()
        val held = mutableListOf<String>()
        var paused = false
        val spoken = mutableListOf<String>()

        fun enqueue(s: String) = queue.addLast(s)

        fun drainToSpeaker() {
            while (queue.isNotEmpty()) spoken.add(queue.removeFirst())
        }

        fun suspendForCapture() {
            if (paused) return
            paused = true
            while (queue.isNotEmpty()) held.add(queue.removeFirst())
        }

        fun resumeAfterCapture() {
            if (!paused) return
            paused = false
            val toSpeak = held.toList()
            held.clear()
            toSpeak.forEach { enqueue(it) }
        }

        fun stop() {
            paused = false
            held.clear()
            queue.clear()
        }
    }

    /** Mirrors SpeechRecognitionManager.setState's resume condition. */
    private fun shouldResume(prev: RecognitionState, next: RecognitionState): Boolean =
        next == RecognitionState.IDLE && prev != RecognitionState.IDLE

    @Test
    fun `unspoken utterances survive a capture and are replayed after it`() {
        val p = Player()
        p.enqueue("first sentence")
        p.enqueue("second sentence")

        p.suspendForCapture()
        assertTrue("queue must be emptied while the mic is open", p.queue.isEmpty())
        assertEquals(2, p.held.size)

        p.resumeAfterCapture()
        p.drainToSpeaker()
        assertEquals(listOf("first sentence", "second sentence"), p.spoken)
    }

    @Test
    fun `resume without a preceding suspend is a no-op`() {
        val p = Player()
        p.enqueue("x")
        p.resumeAfterCapture()
        p.drainToSpeaker()
        assertEquals(listOf("x"), p.spoken)
        assertTrue(p.held.isEmpty())
    }

    /** A double suspend must not clear what the first one held. */
    @Test
    fun `suspending twice does not lose the first batch`() {
        val p = Player()
        p.enqueue("a")
        p.suspendForCapture()
        p.enqueue("b")          // arrived while paused
        p.suspendForCapture()   // second call — must be a no-op for held state

        p.resumeAfterCapture()
        p.drainToSpeaker()
        assertTrue("the first batch must survive", "a" in p.spoken)
    }

    /** Resuming twice must not speak the same text again. */
    @Test
    fun `resuming twice does not duplicate utterances`() {
        val p = Player()
        p.enqueue("only once")
        p.suspendForCapture()
        p.resumeAfterCapture()
        p.resumeAfterCapture()
        p.drainToSpeaker()
        assertEquals(listOf("only once"), p.spoken)
    }

    /** An explicit stop supersedes a pause — nothing held is still wanted. */
    @Test
    fun `stop discards held utterances so they never resurface`() {
        val p = Player()
        p.enqueue("stale")
        p.suspendForCapture()
        p.stop()
        p.resumeAfterCapture()
        p.drainToSpeaker()
        assertTrue("a stopped player must stay silent", p.spoken.isEmpty())
        assertFalse(p.paused)
    }

    /**
     * Every way capture can end must resume. A path that fails to would leave
     * read-aloud muted for the rest of the session — the failure mode the
     * single-setter funnel exists to prevent.
     */
    @Test
    fun `all capture-ending transitions resume playback`() {
        // Normal finish, engine error, cancel, start-throw, locale restart.
        assertTrue(shouldResume(RecognitionState.FINISHING, RecognitionState.IDLE))
        assertTrue(shouldResume(RecognitionState.RECORDING, RecognitionState.IDLE))
        assertTrue(shouldResume(RecognitionState.STARTING, RecognitionState.IDLE))
    }

    /**
     * FINISHING must NOT resume: the engine is still delivering its final
     * result and the mic can still be hot, so speaking now would be captured.
     */
    @Test
    fun `finishing does not resume while the mic may still be hot`() {
        assertFalse(shouldResume(RecognitionState.RECORDING, RecognitionState.FINISHING))
        assertFalse(shouldResume(RecognitionState.STARTING, RecognitionState.RECORDING))
    }

    /** Idle→idle is not a capture ending and must not re-trigger a resume. */
    @Test
    fun `an idle to idle transition does not resume`() {
        assertFalse(shouldResume(RecognitionState.IDLE, RecognitionState.IDLE))
    }
}
