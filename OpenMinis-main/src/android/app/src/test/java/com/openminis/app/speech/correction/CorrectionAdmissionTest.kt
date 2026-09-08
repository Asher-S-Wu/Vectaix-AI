package com.openminis.app.speech.correction

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * [T-android-correction-admission-multisignal] Locks the multi-signal admission
 * rule against the real correction_events that motivated the iOS redesign
 * (bf0234a7). Each case asserts whether the edit span should be COLLECTED (an
 * ASR/IME mistake worth learning) or REJECTED (a plain content rewrite), plus
 * targeted unit checks on each signal.
 *
 * The normalizer is injected: production PinyinNormalizer uses `android.icu`,
 * which is unavailable on the JVM. The fake maps the exact terms these cases
 * use to the same pinyin keys the real normalizer produces, and passes
 * Latin/digits through literally — which is what the real one does too, and is
 * precisely why the old single-axis rule mis-scored mixed-script edits.
 */
class CorrectionAdmissionTest {

    private val zh = object : PhoneticNormalizer {
        private val table = mapOf(
            "审推" to "shentui", "闪退" to "shantui",
            "绘画" to "huihua", "会话" to "huihua",
            "上帝" to "shangdi", "上" to "shang",
            "十七" to "shiqi",
            "二V三" to "erv san",
            "挂载" to "guazai", "规则" to "guize",
            "最后是" to "zuihoushi", "是最后" to "shizuihou",
            "英雄" to "yingxiong",
            "看看下一个英雄" to "kankanxiayigeyingxiong",
            "看看下一个Issue" to "kankanxiayigeissue",
        )
        override val locale: String = "zh"

        /**
         * Mirrors the real PinyinNormalizer's two observable behaviours:
         * Latin/digits pass through lowercased, and ALL whitespace is collapsed
         * (it joins ICU's per-syllable output, so "work on" keys as "workon" —
         * load-bearing, since that is what lifts worker→work on to sim 0.71).
         */
        override fun normalize(text: String): String =
            (table[text] ?: text.lowercase())
                .split(' ', '\t', '\n').filter { it.isNotEmpty() }.joinToString("")
    }

    /**
     * Default sentence length generously large so a bare span isn't rejected as
     * "too global" — in production a span is one word inside a full transcript,
     * so locality is small. Cases that exercise the locality guard pass an
     * explicit small [sentence].
     */
    private fun judge(from: String, to: String, sentence: Int? = null) =
        CorrectionAdmission.judge(
            from, to, zh,
            sentence ?: maxOf(from.length, to.length, 40),
        )

    // ── The four signal families (spans, as tokenPairs would emit them) ──

    @Test
    fun `chinese homophones are admitted`() {
        // The class the OLD rule already caught; must still pass.
        assertTrue(judge("审推", "闪退").isAdmitted)
        assertTrue(judge("绘画", "会话").isAdmitted)
        assertTrue(judge("LifeActivity", "LiveActivity").isAdmitted) // Latin near-form
    }

    @Test
    fun `chinese-english phonetic mixes are admitted`() {
        // Literally similar Latin — the phonetic axis catches these because
        // normalize passes Latin through.
        assertTrue(judge("cloud", "claude").isAdmitted)
        assertTrue(judge("worker", "work on").isAdmitted)
        assertTrue(judge("I worker", "I work on").isAdmitted)
    }

    @Test
    fun `acronym expansion is newly collected`() {
        // MediaS -> Media Server: the OLD rule dropped this (sim 0.55,
        // lengthRatio 2.0). New rule: acronym.
        assertEquals(CorrectionAdmission.Verdict.Acronym, judge("MediaS", "Media Server"))
        // 上帝 -> 上: dropping a syllable is an ordered-subsequence relation.
        assertTrue(judge("上帝", "上").isAdmitted)
    }

    @Test
    fun `digit normalization is newly collected`() {
        // OLD rule dropped both (sim ~0). New rule: digit-norm.
        assertEquals(CorrectionAdmission.Verdict.DigitNorm, judge("十七", "17"))
        assertEquals(CorrectionAdmission.Verdict.DigitNorm, judge("二V三", "v3"))
    }

    // ── Must stay REJECTED (no new false positives) ──

    @Test
    fun `semantic rewrites are rejected`() {
        assertFalse(judge("挂载", "规则").isAdmitted)       // phonetically far
        assertFalse(judge("secure", "SSH key").isAdmitted) // semantic
        // Cross-language semantic; the short sentence also makes it too-global.
        assertFalse(judge("英雄", "Issue", sentence = 6).isAdmitted)
    }

    @Test
    fun `a pure reorder is rejected`() {
        assertEquals(CorrectionAdmission.Verdict.RejectedReorder, judge("最后是", "是最后"))
    }

    @Test
    fun `an edit spanning most of a short sentence is rejected`() {
        // Not a homophone, not acronym/digit -> reword; and in a short sentence
        // the locality guard fires first.
        assertFalse(judge("看看下一个英雄", "看看下一个Issue", sentence = 8).isAdmitted)
    }

    @Test
    fun `locality alone flips the verdict on an identical span`() {
        // Same genuine-homophone span, different sentence sizes.
        assertTrue(judge("审推", "闪退", sentence = 20).isAdmitted) // 2/20 = 10%
        // The span IS the whole sentence (2/2 = 100%) -> too global, rejected,
        // even though it is phonetically a homophone.
        val v = judge("审推", "闪退", sentence = 2)
        assertTrue("expected RejectedTooGlobal, got ${v.reason}", v is CorrectionAdmission.Verdict.RejectedTooGlobal)
    }

    // ── Signal unit checks ──

    @Test
    fun `isPureReorder detects anagrams only`() {
        assertTrue(CorrectionAdmission.isPureReorder("最后是", "是最后"))
        assertTrue(CorrectionAdmission.isPureReorder("abc", "cba"))
        assertFalse(CorrectionAdmission.isPureReorder("审推", "闪退")) // different chars
        assertFalse(CorrectionAdmission.isPureReorder("abc", "abc")) // identical, not a reorder
    }

    @Test
    fun `isAcronymRelated requires an ordered, meaningfully shorter subsequence`() {
        assertTrue(CorrectionAdmission.isAcronymRelated("medias", "mediaserver"))
        assertTrue(CorrectionAdmission.isAcronymRelated("shang", "shangdi")) // 上 ⊂ 上帝
        assertFalse(CorrectionAdmission.isAcronymRelated("cat", "dog"))
        assertFalse(CorrectionAdmission.isAcronymRelated("abcd", "abce")) // same length
        assertFalse(CorrectionAdmission.isAcronymRelated("acb", "abcd"))  // not ORDERED (c before b)
        // Near-equal lengths must not qualify: 3/4 = 0.75 is under the 0.9 bar
        // so this DOES match; 9/10 = 0.9 is at the bar and must not.
        assertFalse(CorrectionAdmission.isAcronymRelated("abcdefghi", "abcdefghij"))
    }

    @Test
    fun `isDigitTermNormalization needs spoken-vs-digit on opposite sides`() {
        assertTrue(CorrectionAdmission.isDigitTermNormalization("十七", "17"))
        assertTrue(CorrectionAdmission.isDigitTermNormalization("二V三", "v3"))
        assertFalse(CorrectionAdmission.isDigitTermNormalization("挂载", "规则")) // no digits
        assertFalse(CorrectionAdmission.isDigitTermNormalization("17", "18"))    // both digits
    }

    // ── RTU→Retry: decision REVISITED, now collected via Signal 4 ──

    @Test
    fun `RTU to Retry is now collected by the latin-phonetic signal`() {
        // This test previously asserted the opposite, with the note "asserted so
        // a future change that tries to force it also revisits this decision".
        // This IS that revisit: iOS 4f061b70 added Signal 4 and flipped the call.
        //
        // Rationale for the flip: RTU/Retry is a plausible ASR near-sound
        // (skeletons rt/rtry, similarity 0.50, 'r' anchored at index 0).
        // Admission here only means "worth learning as a possible confusion";
        // whether the correction actually APPLIES is decided downstream by
        // vocabulary evidence. Signals 1-3 still miss it (sim 0.40, no ordered
        // subsequence, no digits), which is precisely the gap Signal 4 fills.
        val v = judge("RTU", "Retry")
        assertTrue("RTU->Retry should now be collected, got $v", v.isAdmitted)
        assertEquals(CorrectionAdmission.Verdict.LatinPhonetic, v)
    }

    // ── Aggregate: the real-data matrix ──

    @Test
    fun `the real-data matrix collects ASR errors and rejects rewrites`() {
        val shouldCollect = listOf(
            "审推" to "闪退", "绘画" to "会话", "LifeActivity" to "LiveActivity",
            "cloud" to "claude", "worker" to "work on", "I worker" to "I work on",
            "MediaS" to "Media Server", "十七" to "17", "二V三" to "v3",
        )
        val shouldReject = listOf(
            "挂载" to "规则", "secure" to "SSH key", "最后是" to "是最后",
        )
        for ((a, b) in shouldCollect) {
            val v = judge(a, b, sentence = 40)
            assertTrue("expected COLLECT for $a->$b, got ${v.reason}", v.isAdmitted)
        }
        for ((a, b) in shouldReject) {
            val v = judge(a, b, sentence = 40)
            assertFalse("expected REJECT for $a->$b, got ${v.reason}", v.isAdmitted)
        }
    }

    // ── The regression this redesign exists to fix ──

    @Test
    fun `the old single-axis rule would have dropped these, the new one keeps them`() {
        // Reproduce the OLD rule and show it fails exactly where the new one
        // succeeds — this is the whole point of the change, so lock it in.
        fun oldRuleAdmits(from: String, to: String): Boolean {
            val sim = PinyinNormalizer.similarity(zh.normalize(from), zh.normalize(to))
            val lengthRatio = maxOf(from.length, to.length).toDouble() /
                maxOf(1, minOf(from.length, to.length)).toDouble()
            return sim >= 0.6 && lengthRatio <= 2.0
        }
        val recovered = listOf("MediaS" to "Media Server", "十七" to "17", "二V三" to "v3")
        for ((a, b) in recovered) {
            assertFalse("old rule should have DROPPED $a->$b", oldRuleAdmits(a, b))
            assertTrue("new rule must COLLECT $a->$b", judge(a, b, sentence = 40).isAdmitted)
        }
    }

    // ── Signal 4: Latin near-sound ────────────────────────────────────────────
    // [T-android-correction-latin-phonetic] iOS 4f061b70. Signals 1-3 all miss
    // linux→minis: phonetic Levenshtein on the full key is 0.40 (consonants
    // differ outright), neither side is an ordered subsequence of the other, and
    // there are no digits. It fell through to RejectedReword, so the confusion
    // dictionary never accumulated evidence and correction never fired.

    @Test
    fun `signal 4 admits linux to minis`() {
        val v = judge("linux", "minis", sentence = 40)
        assertTrue("linux->minis must be collected, got $v", v.isAdmitted)
        assertEquals(CorrectionAdmission.Verdict.LatinPhonetic, v)
    }

    @Test
    fun `signal 4 rejects unrelated words with no shared consonant slot`() {
        // cat/dog: same syllable count but skeletons ct/dg share no consonant at
        // any index, so the anchor requirement rejects it.
        assertFalse(judge("cat", "dog", sentence = 40).isAdmitted)
        assertFalse(CorrectionAdmission.isLatinPhoneticSimilar("cat", "dog"))
    }

    @Test
    fun `signal 4 requires equal syllable counts`() {
        // Differing vowel-group counts ⇒ different rhythm ⇒ not an ASR confusion.
        assertFalse(CorrectionAdmission.isLatinPhoneticSimilar("minis", "mn"))
    }

    @Test
    fun `signal 4 cannot fire on Chinese input`() {
        // THE load-bearing guard. PinyinNormalizer renders 挂载/规则 as
        // guazai/guize — same syllable count, skeletons gz/gz (similarity 1.00),
        // 'g' anchored at 0 — so the raw signal WOULD admit them. Only the
        // isLatinOrigin check on the ORIGINAL text keeps this rejected, which is
        // why the guard must not be applied to the normalized key.
        assertTrue(
            "raw signal admits the pinyin keys — the guard is what saves us",
            CorrectionAdmission.isLatinPhoneticSimilar("guazai", "guize"),
        )
        assertFalse(CorrectionAdmission.isLatinOrigin("挂载"))
        assertFalse("挂载->规则 must stay rejected", judge("挂载", "规则").isAdmitted)
    }

    @Test
    fun `isLatinOrigin accepts latin words with separators and digits`() {
        assertTrue(CorrectionAdmission.isLatinOrigin("linux"))
        assertTrue(CorrectionAdmission.isLatinOrigin("work on"))
        assertTrue(CorrectionAdmission.isLatinOrigin("gpl-v3"))
        assertTrue(CorrectionAdmission.isLatinOrigin("read_image.file"))
        // No letter at all ⇒ not a Latin word.
        assertFalse(CorrectionAdmission.isLatinOrigin("123"))
        assertFalse(CorrectionAdmission.isLatinOrigin(""))
        // Mixed script is not Latin-origin.
        assertFalse(CorrectionAdmission.isLatinOrigin("linux挂载"))
        // Non-ASCII latin-ish letters are excluded too.
        assertFalse(CorrectionAdmission.isLatinOrigin("café"))
    }

    @Test
    fun `signal 4 does not loosen the acknowledged near-threshold pair`() {
        // cursor/claude: skeletons crsr/cld, similarity 0.25 — below the 0.30
        // floor, so Signal 4 does not fire. (It already passes Signal 1, so the
        // pair is still collected; this pins the SIGNAL boundary, not the verdict.)
        assertFalse(CorrectionAdmission.isLatinPhoneticSimilar("cursor", "claude"))
    }

    @Test
    fun `signal 4 runs after the earlier signals`() {
        // A pair that Signal 1 already catches must be reported as Homophone, not
        // LatinPhonetic — the signal ORDER is part of the contract (the reason tag
        // feeds logs and downstream weighting).
        val v = judge("cloud", "claude", sentence = 40)
        assertTrue(v is CorrectionAdmission.Verdict.Homophone)
    }
}
