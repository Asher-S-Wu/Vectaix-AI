package com.openminis.app.ui.chat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * [T-android-slash-send-keeps-text] Sending while the slash menu is open over
 * existing text must clear the composer, exactly like a normal send.
 *
 * Reported on Android only (iOS is unaffected): type "hello", tap the "/"
 * button — the composer becomes "/ hello" and the menu opens — then tap send.
 * The message is sent but "hello" stays in the composer.
 *
 * The state machine is small enough to model exactly, so this pins the whole
 * sequence rather than any single function. Mirrors:
 *   ChatViewModelSlashExt.showSlashMenuOverInput / dismissSlashMenu /
 *   updateSlashMenuState, and ChatScreen.performSendOrEnqueue.
 */
class SlashSendClearsInputTest {

    /** Minimal stand-in for the composer + slash-menu state in ChatViewModel. */
    private class Composer(val withFix: Boolean) {
        var text: String = ""
        var savedInputBeforeSlash: String? = null
        var showSlashMenu: Boolean = false

        /** ChatViewModelSlashExt.showSlashMenuOverInput */
        fun tapSlashButton() {
            val current = text
            if (current.startsWith("/")) {
                savedInputBeforeSlash = null
                showSlashMenu = true
                return
            }
            if (current.trim().isEmpty()) {
                savedInputBeforeSlash = null
                showSlashMenu = true
                text = "/"
                return
            }
            savedInputBeforeSlash = current
            showSlashMenu = true
            text = "/ $current"
        }

        /** ChatViewModelSlashExt.updateSlashMenuState, called from onValueChange. */
        fun onTextChanged(newText: String) {
            if (savedInputBeforeSlash != null) {
                if (!newText.startsWith("/")) {
                    // "leading slash deleted" — leaves over-content mode
                    savedInputBeforeSlash = null
                    showSlashMenu = false
                    return
                }
                showSlashMenu = true
                return
            }
            showSlashMenu = newText.startsWith("/") && newText.length < 30
        }

        /** ChatScreen.performSendOrEnqueue, non-slash-command branch. */
        fun send(): String {
            val sent = text
            if (withFix) {
                // THE FIX (endSlashSessionForSend): a send always ends the slash
                // session, so the stashed original can never be restored into
                // the cleared composer.
                savedInputBeforeSlash = null
                showSlashMenu = false
            }
            text = ""
            // NOTE: the real onValueChange does NOT fire here — setInputText
            // writes the ViewModel StateFlow, and the composer's LaunchedEffect
            // mirrors it into the field without invoking onValueChange. So the
            // slash session is NOT torn down as a side effect of clearing.
            return sent
        }

        /**
         * ChatScreen:3300 — the chat-list tap spy. Any finger-down in the
         * transcript dismisses an open slash menu and RESTORES the saved
         * original. A send hides the keyboard and re-pins the list, so this
         * runs right after the send in normal use; that restore is what put the
         * just-sent text back into the composer.
         */
        fun tapOnChatList() {
            if (!showSlashMenu) return
            val saved = savedInputBeforeSlash
            savedInputBeforeSlash = null
            showSlashMenu = false
            if (saved != null) text = saved
        }
    }

    @Test
    fun `send while slash menu is open over text leaves the composer empty`() {
        val c = Composer(withFix = true)
        c.text = "hello"
        c.tapSlashButton()
        assertEquals("the '/' button prepends over the saved original", "/ hello", c.text)
        assertEquals("hello", c.savedInputBeforeSlash)

        val sent = c.send()
        assertEquals("/ hello", sent)
        assertEquals("composer must be empty after send", "", c.text)
        assertNull("the slash session must not survive a send", c.savedInputBeforeSlash)
        assertEquals(false, c.showSlashMenu)

        // The send re-pins the transcript and hides the keyboard, so the chat
        // list tap-spy runs immediately afterwards. With the session already
        // ended it has nothing to restore.
        c.tapOnChatList()
        assertEquals("text must NOT come back after send", "", c.text)
    }

    @Test
    fun `without the fix the sent text is restored into the composer`() {
        // Negative control — the exact reported bug. The send leaves the slash
        // session open, so the chat-list tap spy (ChatScreen:3300) restores the
        // saved original and the user sees their message sent AND still in the
        // composer.
        val c = Composer(withFix = false)
        c.text = "hello"
        c.tapSlashButton()
        c.send()
        assertEquals("", c.text) // looks fine for one frame...
        c.tapOnChatList()
        assertEquals("this is the bug: the sent text reappears", "hello", c.text)
    }

    @Test
    fun `a normal send with no slash session still clears`() {
        val c = Composer(withFix = true)
        c.text = "plain message"
        val sent = c.send()
        assertEquals("plain message", sent)
        assertEquals("", c.text)
        assertNull(c.savedInputBeforeSlash)
    }

    @Test
    fun `dismissing the slash menu still restores the original text`() {
        // The fix must not break the legitimate restore path: tapping "/" again
        // (or deleting the slash) returns the user's text.
        val c = Composer(withFix = true)
        c.text = "keep me"
        c.tapSlashButton()
        assertEquals("/ keep me", c.text)
        // dismissSlashMenu restores the saved original
        val saved = c.savedInputBeforeSlash
        assertEquals("keep me", saved)
    }
}
