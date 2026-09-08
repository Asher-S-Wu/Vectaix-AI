package com.openminis.app.shared

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * [T-android-voice-correction] Mirrors the iOS SentenceSplitter test cases
 * (MinisTests/VoiceCorrectionTests.swift L15-27).
 */
class SentenceSplitterTest {

    @Test
    fun `keeps trailing terminators`() {
        assertEquals(listOf("你好。", "今天天气不错！"), SentenceSplitter.split("你好。今天天气不错！"))
    }

    @Test
    fun `text without a terminator returns one sentence not an empty list`() {
        // Load-bearing: callers diff whatever comes back, so an empty list here
        // would silently discard the user's entire edit.
        assertEquals(listOf("没有标点的一句话"), SentenceSplitter.split("没有标点的一句话"))
    }

    @Test
    fun `empty and whitespace-only yield no sentences`() {
        assertEquals(emptyList<String>(), SentenceSplitter.split(""))
        assertEquals(emptyList<String>(), SentenceSplitter.split("   \n  "))
    }

    @Test
    fun `ascii and cjk terminators both split`() {
        assertEquals(listOf("Hello.", "World!"), SentenceSplitter.split("Hello. World!"))
        assertEquals(listOf("甲；", "乙…"), SentenceSplitter.split("甲；乙…"))
    }

    @Test
    fun `trailing fragment after the last terminator is kept`() {
        assertEquals(listOf("完整句。", "残句"), SentenceSplitter.split("完整句。残句"))
    }

    @Test
    fun `whitespace around sentences is trimmed`() {
        assertEquals(listOf("甲。", "乙。"), SentenceSplitter.split("  甲。   乙。  "))
    }

    @Test
    fun `terminator set is distinct from the TTS chunking set`() {
        // Guard against someone "unifying" the two: newline must NOT split here.
        assertTrue('\n' !in SentenceSplitter.TERMINATORS)
        assertTrue('；' in SentenceSplitter.TERMINATORS)
        assertEquals(listOf("甲\n乙"), SentenceSplitter.split("甲\n乙"))
    }
}
