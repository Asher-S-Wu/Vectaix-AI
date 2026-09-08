package com.openminis.app.ui.chat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

/**
 * [T-android-moveto-stash-binding] Regression tests for the "Move to…"
 * stash guard (iOS 6c3093c8 / GH OpenMinis#120).
 *
 * Before the fix [ChatViewModelStore.PendingTransfer] carried no target and
 * no timestamp, so `consumePendingTransfer()` handed the content to whichever
 * ChatScreen composed first — the moved text could land in an unrelated
 * session — and an unclaimed stash lived forever, ambushing a session opened
 * much later.
 *
 * Attachments are deliberately empty here: InputAttachment holds an
 * android.net.Uri, which is not available to a plain JVM unit test. The
 * guard under test keys off targetId / stashedAtMs only, so this is
 * sufficient coverage.
 */
class MoveToStashBindingTest {

    @Before
    fun drainAnyLeftoverStash() {
        // The store is a process-wide singleton; make sure a previous test
        // (or ordering) can't leak a stash into this one.
        ChatViewModelStore.consumePendingTransfer("any-session")
        ChatViewModelStore.consumePendingTransfer("session-B")
    }

    @Test
    fun `target session drains its own stash`() {
        ChatViewModelStore.stashPendingTransfer(
            ChatViewModelStore.PendingTransfer(
                inputText = "payload",
                attachments = emptyList(),
                targetId = "session-B",
            ),
        )
        val got = ChatViewModelStore.consumePendingTransfer("session-B")
        assertEquals("payload", got?.inputText)
    }

    @Test
    fun `stash is drained exactly once`() {
        ChatViewModelStore.stashPendingTransfer(
            ChatViewModelStore.PendingTransfer(
                inputText = "payload",
                attachments = emptyList(),
                targetId = "session-B",
            ),
        )
        assertEquals("payload", ChatViewModelStore.consumePendingTransfer("session-B")?.inputText)
        assertNull(ChatViewModelStore.consumePendingTransfer("session-B"))
    }

    @Test
    fun `non-target session does not consume the stash, and the real target still can`() {
        ChatViewModelStore.stashPendingTransfer(
            ChatViewModelStore.PendingTransfer(
                inputText = "payload",
                attachments = emptyList(),
                targetId = "session-B",
            ),
        )
        // The pre-fix bug: an unrelated session opened first ate the content.
        assertNull(ChatViewModelStore.consumePendingTransfer("session-C"))
        // And crucially the stash must survive that miss for its real target.
        assertEquals("payload", ChatViewModelStore.consumePendingTransfer("session-B")?.inputText)
    }

    @Test
    fun `stale stash is dropped rather than injected`() {
        ChatViewModelStore.stashPendingTransfer(
            ChatViewModelStore.PendingTransfer(
                inputText = "payload",
                attachments = emptyList(),
                targetId = "session-B",
                // 301s old — just past the 300s TTL.
                stashedAtMs = System.currentTimeMillis() - 301_000L,
            ),
        )
        assertNull(ChatViewModelStore.consumePendingTransfer("session-B"))
        // Dropped, not merely skipped — a later open must not resurrect it.
        assertNull(ChatViewModelStore.consumePendingTransfer("session-B"))
    }
}
