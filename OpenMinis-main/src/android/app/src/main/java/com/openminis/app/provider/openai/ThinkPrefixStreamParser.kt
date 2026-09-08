package com.openminis.app.provider.openai

/**
 * [T-android-think-prefix-stream] Splits a streamed `content` field into live
 * thinking deltas and visible body text, for models that embed reasoning as a
 * `<think>…</think>` PREFIX of `content` instead of using the
 * `reasoning_content` field (MiniMax M3, some Qwen/DeepSeek deployments).
 *
 * Port of iOS `ThinkPrefixStreamParser` (22ca4285). Replaces the previous
 * `extractThinkTags` scanner, which had two defects reproduced on Android:
 *
 *  1. **Leading whitespace leaked into the body.** M3 always emits "\n\n" after
 *     `</think>`; the old scanner passed it straight through, so every such
 *     message body began with a blank line. A think-only tool turn could also
 *     leave a whitespace-only text block, which renders as a blank band because
 *     every empty-block guard checks `isEmpty()` and "\n\n" passes that.
 *  2. **Mid-text tags were stripped anywhere.** The old scanner searched for
 *     `<think>` at ANY offset, so a message merely *explaining* the tag —
 *     "Use the `<think>` tag to mark reasoning" — had its prose silently
 *     swallowed into the thinking bubble. Verified against the old
 *     implementation: `"Use the <think> tag to mark reasoning."` produced
 *     visible `"Use the "` and thinking `" tag to mark re"`.
 *
 * Design: an explicit `UNDECIDED → THINKING → BODY` state machine.
 *  - Only a `<think>` at the very START of a turn (leading whitespace tolerated
 *    and dropped) enters THINKING. Anything else commits the turn to BODY, and
 *    from then on tags are passed through verbatim.
 *  - After `</think>`, leading whitespace is dropped, and a trailing-whitespace
 *    run is withheld until proven interior — so a think-only turn ends with an
 *    empty body rather than "\n\n".
 *
 * Not thread-safe; one instance per streaming turn (the provider creates one
 * per request).
 */
internal class ThinkPrefixStreamParser {

    private enum class State { UNDECIDED, THINKING, BODY }

    /** One chunk's worth of split output. Either side may be empty. */
    data class Output(val visible: String, val thinking: String)

    private var state = State.UNDECIDED

    /**
     * Holds bytes we cannot classify yet: a partial `<think>`/`</think>` tag
     * split across chunks, or leading whitespace before we know whether a
     * `<think>` follows.
     */
    private val pending = StringBuilder()

    /**
     * Trailing whitespace in BODY state, withheld until we see a non-space
     * character after it (proving it is interior). Dropped at [finishTurn].
     */
    private val heldWhitespace = StringBuilder()

    private companion object {
        const val OPEN = "<think>"
        const val CLOSE = "</think>"
    }

    /** Feed one streamed `content` delta. */
    fun feed(text: String): Output {
        if (text.isEmpty()) return Output("", "")
        val visible = StringBuilder()
        val thinking = StringBuilder()
        pending.append(text)

        loop@ while (pending.isNotEmpty()) {
            when (state) {
                State.UNDECIDED -> {
                    // Tolerate (and drop) leading whitespace before a <think>.
                    val firstNonSpace = pending.indexOfFirst { !it.isWhitespace() }
                    if (firstNonSpace < 0) {
                        // All whitespace so far — can't decide yet. Keep it: if a
                        // <think> follows we drop it, otherwise it belongs to the body.
                        break@loop
                    }
                    val rest = pending.substring(firstNonSpace)
                    if (OPEN.startsWith(rest.take(OPEN.length))) {
                        // Could still become "<think>" once more bytes arrive.
                        if (rest.length < OPEN.length) break@loop
                    }
                    if (rest.startsWith(OPEN)) {
                        state = State.THINKING
                        // Drop the tolerated leading whitespace AND the tag.
                        pending.delete(0, firstNonSpace + OPEN.length)
                    } else {
                        // No think prefix — the whole turn is body, tags and all.
                        state = State.BODY
                        // Leading whitespace here is genuine body content.
                    }
                }

                State.THINKING -> {
                    val closeIdx = pending.indexOf(CLOSE)
                    if (closeIdx < 0) {
                        // Emit everything except a possible partial closing tag.
                        val safe = safeEmitLength(pending, CLOSE)
                        if (safe <= 0) break@loop
                        thinking.append(pending, 0, safe)
                        pending.delete(0, safe)
                        break@loop
                    }
                    thinking.append(pending, 0, closeIdx)
                    pending.delete(0, closeIdx + CLOSE.length)
                    state = State.BODY
                    // Drop the whitespace M3 emits right after </think>.
                    while (pending.isNotEmpty() && pending[0].isWhitespace()) pending.deleteCharAt(0)
                }

                State.BODY -> {
                    // Withhold a trailing whitespace run until proven interior, so
                    // a think-only turn doesn't end with a whitespace-only block.
                    var cut = pending.length
                    while (cut > 0 && pending[cut - 1].isWhitespace()) cut--
                    if (cut > 0) {
                        // Anything held from earlier is now interior — release it.
                        visible.append(heldWhitespace)
                        heldWhitespace.setLength(0)
                        visible.append(pending, 0, cut)
                    }
                    heldWhitespace.append(pending, cut, pending.length)
                    pending.setLength(0)
                    break@loop
                }
            }
        }
        return Output(visible.toString(), thinking.toString())
    }

    /**
     * Flush whatever is still buffered at end of turn. Idempotent — the caller
     * may invoke it on both `finish_reason` and `[DONE]`.
     *
     * Withheld trailing whitespace is intentionally DROPPED, not emitted: that
     * is the whole point of holding it.
     */
    fun finishTurn(): Output {
        val visible = StringBuilder()
        val thinking = StringBuilder()
        if (pending.isNotEmpty()) {
            when (state) {
                // An unterminated <think> — treat the remainder as thinking
                // rather than dumping raw reasoning into the body.
                State.THINKING -> thinking.append(pending)
                // Undecided at end of turn means no think prefix ever arrived,
                // so the buffered bytes are ordinary body text.
                State.UNDECIDED, State.BODY -> visible.append(pending)
            }
            pending.setLength(0)
        }
        heldWhitespace.setLength(0)
        return Output(visible.toString(), thinking.toString())
    }

    /**
     * Flush a short UNDECIDED buffer before a tool boundary, so the ViewModel's
     * pre-tool snapshot isn't missing text. Cross-chunk tag tails and withheld
     * whitespace stay buffered. Mirrors iOS `resolveAtToolBoundary()`.
     */
    fun resolveAtToolBoundary(): Output {
        if (state != State.UNDECIDED || pending.isEmpty()) return Output("", "")
        // If the buffer could still grow into "<think>", leave it alone.
        val rest = pending.trimStart()
        if (rest.isNotEmpty() && OPEN.startsWith(rest.take(OPEN.length)) && rest.length < OPEN.length) {
            return Output("", "")
        }
        state = State.BODY
        val out = pending.toString()
        pending.setLength(0)
        return Output(out, "")
    }

    /**
     * How many chars are safe to emit without splitting a potential [tag]
     * occurrence. Keeps the longest suffix of [buf] that is a proper prefix of
     * [tag] buffered.
     */
    private fun safeEmitLength(buf: StringBuilder, tag: String): Int {
        val maxKeep = minOf(tag.length - 1, buf.length)
        for (keep in maxKeep downTo 1) {
            val suffixStart = buf.length - keep
            var matches = true
            for (k in 0 until keep) {
                if (buf[suffixStart + k] != tag[k]) { matches = false; break }
            }
            if (matches) return suffixStart
        }
        return buf.length
    }
}

private inline fun CharSequence.indexOfFirst(predicate: (Char) -> Boolean): Int {
    for (i in indices) if (predicate(this[i])) return i
    return -1
}
