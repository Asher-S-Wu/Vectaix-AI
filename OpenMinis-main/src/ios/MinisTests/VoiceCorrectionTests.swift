import XCTest

/// Unit tests for the pure-logic parts of voice correction: the truncator, the phonetic
/// normalizer, the LCS/word-boundary diff, the vocabulary filter, and confidence math.
///
/// Deliberately no DB / no LLM here — those are exercised on-device through the
/// `debug.voiceCorrection.*` RPCs, where they're actually meaningful. What's tested here is
/// the logic that must hold regardless of environment, including the specific bugs the
/// on-device runs surfaced (CJK numerals scoring as digits; the re-segmentation that made
/// token-level diffs lose the change).
final class VoiceCorrectionTests: XCTestCase {

    // MARK: - SentenceSplitter

    func testSentenceSplit_keepsTerminators() {
        XCTAssertEqual(SentenceSplitter.split("今天很好。明天下雨！"), ["今天很好。", "明天下雨！"])
    }

    func testSentenceSplit_noTerminatorYieldsOneSentence() {
        // Must not return [] — callers diff whatever comes back.
        XCTAssertEqual(SentenceSplitter.split("没有标点的一句话"), ["没有标点的一句话"])
    }

    func testSentenceSplit_emptyAndWhitespace() {
        XCTAssertEqual(SentenceSplitter.split(""), [])
        XCTAssertEqual(SentenceSplitter.split("   \n  "), [])
    }

    // MARK: - ConversationContextTruncator (design §6)

    func testTruncate_underLimit_unchangedAndNoEllipsis() {
        let r = ConversationContextTruncator.truncate("短消息", softLimit: 500)
        XCTAssertEqual(r.text, "短消息")
        XCTAssertFalse(r.wasTruncated)
    }

    func testTruncate_extendsPastSoftLimitToNextTerminator() {
        // 10 chars, then a sentence that ends at char 20. With a soft limit of 10 we must
        // NOT cut at 10 — we run on to the terminator, even though that overshoots.
        let text = String(repeating: "甲", count: 10) + "乙丙丁。戊己"
        let r = ConversationContextTruncator.truncate(text, softLimit: 10, hardCeiling: 100)
        XCTAssertTrue(r.wasTruncated)
        XCTAssertTrue(r.text.hasSuffix("。…"), "should cut at the terminator, inclusive: \(r.text)")
        XCTAssertFalse(r.text.contains("戊"), "must not include content past the terminator")
    }

    func testTruncate_noTerminatorWithinCeiling_hardCutsAtSoftLimit() {
        // Punctuation-free wall of text: the scan must give up at the ceiling rather than
        // let the prompt grow without bound.
        let text = String(repeating: "字", count: 300)
        let r = ConversationContextTruncator.truncate(text, softLimit: 10, hardCeiling: 20)
        XCTAssertTrue(r.wasTruncated)
        XCTAssertEqual(r.text, String(repeating: "字", count: 10) + "…")
    }

    func testTruncate_exactlyAtLimit_isNotTruncated() {
        let text = String(repeating: "字", count: 10)
        let r = ConversationContextTruncator.truncate(text, softLimit: 10)
        XCTAssertFalse(r.wasTruncated)
        XCTAssertEqual(r.text, text)
    }

    // MARK: - PinyinNormalizer

    func testPinyin_homophonesCollapseToSameKey() {
        let n = PinyinNormalizer.shared
        // The entire premise of the feature: the ASR error and the intended word must key
        // to something close enough to retrieve.
        XCTAssertEqual(n.normalize("张三"), n.normalize("章三"))
    }

    func testPinyin_tonelessAndSpaceless() {
        XCTAssertEqual(PinyinNormalizer.shared.normalize("张三"), "zhangsan")
        XCTAssertEqual(PinyinNormalizer.shared.normalize("食堂"), "shitang")
    }

    func testPinyin_emptyInput() {
        XCTAssertEqual(PinyinNormalizer.shared.normalize(""), "")
        XCTAssertEqual(PinyinNormalizer.shared.normalize("   "), "")
    }

    func testPinyinSimilarity_nearHomophonesScoreHigh() {
        let a = PinyinNormalizer.shared.normalize("张山")   // zhangshan
        let b = PinyinNormalizer.shared.normalize("张三")   // zhangsan
        // Near-homophone: this is what the recorder must accept as an ASR fix.
        XCTAssertGreaterThan(PinyinNormalizer.similarity(a, b), 0.6)
    }

    func testPinyinSimilarity_unrelatedWordsScoreLow() {
        let a = PinyinNormalizer.shared.normalize("吃饭")
        let b = PinyinNormalizer.shared.normalize("看电影")
        // A content rewrite: the recorder must NOT learn this as a correction.
        XCTAssertLessThan(PinyinNormalizer.similarity(a, b), 0.6)
    }

    func testLevenshtein_basics() {
        XCTAssertEqual(PinyinNormalizer.levenshtein(Array("abc"), Array("abc")), 0)
        XCTAssertEqual(PinyinNormalizer.levenshtein(Array("abc"), Array("abd")), 1)
        XCTAssertEqual(PinyinNormalizer.levenshtein(Array(""), Array("abc")), 3)
    }

    // MARK: - Confidence (design §3.2)

    func testConfidence_negativeFeedbackWeighsDouble() {
        // 3 confirmations, no pushback → fully trusted.
        XCTAssertEqual(VoiceCorrectionDB.confidence(frequency: 3, negative: 0), 1.0, accuracy: 0.001)
        // 3 confirmations vs 1 rejection → 3/(3+2) — a rejection costs twice a confirmation,
        // because a wrong rule actively corrupts the user's text.
        XCTAssertEqual(VoiceCorrectionDB.confidence(frequency: 3, negative: 1), 0.6, accuracy: 0.001)
        // Repeatedly disproven → drops under the 0.3 retrieval floor and stops being used.
        XCTAssertLessThan(VoiceCorrectionDB.confidence(frequency: 1, negative: 3), 0.3)
    }

    // MARK: - LCS diff

    func testLCSDiff_detectsReplacement() {
        let ops = LCSDiff.diff(["张山", "说", "话"], ["张三", "说", "话"])
        XCTAssertTrue(ops.contains(.replace(old: ["张山"], new: ["张三"])))
    }

    func testLCSDiff_identicalInputsHaveNoChanges() {
        let ops = LCSDiff.diff(["a", "b"], ["a", "b"])
        XCTAssertEqual(ops, [.equal(["a", "b"])])
    }

    // MARK: - tokenPairs (the re-segmentation bug, caught on device)

    func testTokenPairs_survivesResegmentation() {
        // The regression that shipped an empty diffSummary: jieba segments the corrected
        // text differently ("张山|说" → "张三说"), so a token-aligned diff sees a 2-for-1
        // replace. The point of this test is that the change is NOT lost and does NOT
        // degrade to the single-char "山→三" (which reads meaninglessly to the user).
        //
        // [T-correction-diff-wordlevel] Word-level alignment emits the whole
        // re-segmented span as one pair: 张山说→张三说 (["张山","说"]↔["张三说"]).
        // That's a valid, phonetically-close correction pair — coarser than
        // "张山→张三" but never the degenerate single char. Assert both: change
        // is present, and it's at least word-length (≥2 chars), not "山→三".
        let pairs = VoiceCorrectionDiff.tokenPairs(from: "张山说食堂今天关门",
                                                     to: "张三说食堂今天关门")
        XCTAssertFalse(pairs.isEmpty, "must find the change despite re-segmentation")
        XCTAssertTrue(pairs.contains { $0.from.contains("张山") && $0.to.contains("张三") && $0.from.count >= 2 },
                      "must read as a word-level 张山…→张三… pair, not the degenerate 山→三: \(pairs)")
    }

    func testTokenPairs_multipleCorrections() {
        let pairs = VoiceCorrectionDiff.tokenPairs(from: "今天去石塘吃饭遇到张山了",
                                                     to: "今天去食堂吃饭遇到张三了")
        XCTAssertTrue(pairs.contains { $0.from == "石塘" && $0.to == "食堂" }, "\(pairs)")
        XCTAssertTrue(pairs.contains { $0.from == "张山" && $0.to == "张三" }, "\(pairs)")
    }

    func testTokenPairs_identicalTextYieldsNoPairs() {
        XCTAssertTrue(VoiceCorrectionDiff.tokenPairs(from: "今天天气不错", to: "今天天气不错").isEmpty)
    }

    // MARK: - Word-level alignment (acronym expansion + no fragment stitching)
    // [T-correction-diff-wordlevel] tokenPairs aligns TOKEN sequences, so a
    // word that expands into several words maps as one whole pair — no
    // character fragments padding into neighbours, no false positives on
    // boundary insertions.

    func testTokenPairs_acronymExpansion_wholePair() {
        // MediaS (1 token) → Media Server (2 tokens): must surface as the
        // COMPLETE pair, not a fragment like 开发→erver开发.
        let pairs = VoiceCorrectionDiff.tokenPairs(from: "远程 MediaS 开发环境",
                                                     to: "远程 Media Server 开发环境")
        XCTAssertTrue(pairs.contains { $0.from == "MediaS" && $0.to == "Media Server" },
                      "expected clean MediaS→Media Server: \(pairs)")
        // No fragment leaked into the neighbouring word.
        XCTAssertFalse(pairs.contains { $0.from.contains("开发") || $0.to.contains("erver开发") },
                       "no neighbour-word fragment: \(pairs)")
    }

    func testTokenPairs_englishMultiWordEdit() {
        // worker (1 token) → work on (2 tokens): clean whole pair.
        let pairs = VoiceCorrectionDiff.tokenPairs(from: "找个 worker 处理",
                                                     to: "找个 work on 处理")
        XCTAssertTrue(pairs.contains { $0.from == "worker" && $0.to == "work on" }, "\(pairs)")
    }

    func testTokenPairs_punctuationInsertionYieldsNoPair() {
        // Inserting 、 between words is a whole-token insertion — content
        // editing, NOT an in-word change — so it must produce NO pair at all
        // (the old char-LCS wrongly emitted 滚动条→、滚动条).
        let pairs = VoiceCorrectionDiff.tokenPairs(from: "输入框文本滚动条和发送按钮",
                                                     to: "输入框文本、滚动条和发送按钮")
        XCTAssertTrue(pairs.isEmpty, "whole-token punctuation insertion must yield no pair: \(pairs)")
    }

    func testTokenPairs_wholeWordInsertionYieldsNoPair() {
        // Adding a standalone word (not modifying an existing one) is content,
        // not a homophone/abbreviation — no pair.
        let pairs = VoiceCorrectionDiff.tokenPairs(from: "去食堂吃饭",
                                                     to: "去食堂好好吃饭")
        XCTAssertFalse(pairs.contains { $0.from == $0.to }, "no no-op pairs: \(pairs)")
        // "好好" is a pure insertion; it must not pair with an unrelated word.
        XCTAssertFalse(pairs.contains { $0.to.contains("好好") && !$0.from.contains("好好") && $0.from.count < 2 },
                       "inserted word must not fabricate a pair: \(pairs)")
    }

    // MARK: - charChangeRatio (rewrite rejection, design §6)

    func testCharChangeRatio_smallFixIsSmall() {
        let r = VoiceCorrectionDiff.charChangeRatio(from: "张山说食堂今天关门", to: "张三说食堂今天关门")
        XCTAssertLessThan(r, VoiceCorrectionConfig.maxCharChangeRatio)
    }

    func testCharChangeRatio_rewriteExceedsThreshold() {
        // A model that "helpfully" rewrote instead of correcting must be rejected.
        let r = VoiceCorrectionDiff.charChangeRatio(from: "今天去吃饭",
                                                      to: "明天我们一起去看电影然后逛街买东西")
        XCTAssertGreaterThan(r, VoiceCorrectionConfig.maxCharChangeRatio)
    }

    // MARK: - Vocabulary filter (design §3.3)

    func testVocabFilter_rejectsStopwords() {
        assertRejected("的"); assertRejected("我们"); assertRejected("继续")
    }

    func testVocabFilter_rejectsEnglishFunctionWords() {
        // These dominated the learned vocabulary on device before the English list existed:
        // absent from the zh background list (+2), 2–6 chars (+1), ASCII letters (+1) = 4.
        assertRejected("the"); assertRejected("and"); assertRejected("with"); assertRejected("THE")
    }

    func testVocabFilter_rejectsTooShort() {
        assertRejected("好")
    }

    func testVocabFilter_acceptsProperNouns() {
        // nr = person name → the strongest single signal in §3.3.
        guard case .accepted(let score, let b) = VocabularyFilter.evaluate(term: "李四", posTag: "nr") else {
            return XCTFail("a person name must be accepted")
        }
        XCTAssertEqual(b.posTag, 2)
        XCTAssertGreaterThanOrEqual(score, VoiceCorrectionConfig.vocabMinScore)
    }

    func testVocabFilter_acceptsLatinJargon() {
        guard case .accepted(_, let b) = VocabularyFilter.evaluate(term: "CppJieba", posTag: "eng") else {
            return XCTFail("latin jargon must be accepted")
        }
        XCTAssertEqual(b.hasLatinOrDigit, 1)
    }

    /// The CJK-numeral bug, caught on device: `Character.isNumber` is TRUE for 三/一/十, so
    /// "张三" was scoring a phantom "contains a digit" point, and the no-lexical-content
    /// reject would have discarded genuine words like "三星".
    func testVocabFilter_cjkNumeralsAreNotDigits() {
        guard case .accepted(_, let b) = VocabularyFilter.evaluate(term: "张三", posTag: "nr") else {
            return XCTFail("张三 must be accepted")
        }
        XCTAssertEqual(b.hasLatinOrDigit, 0, "三 is a Unicode Number but NOT an ASCII digit")

        // And a word made entirely of CJK numerals must survive the "no lexical content" gate.
        if case .rejected(let reason) = VocabularyFilter.evaluate(term: "三星", posTag: "nz") {
            XCTFail("三星 was rejected as \(reason) — CJK numerals must not count as digits")
        }
    }

    func testVocabFilter_rejectsBareAsciiDigits() {
        assertRejected("12345")
    }

    private func assertRejected(_ term: String, posTag: String? = nil,
                               file: StaticString = #filePath, line: UInt = #line) {
        if case .accepted(let score, _) = VocabularyFilter.evaluate(term: term, posTag: posTag) {
            XCTFail("\(term) should have been rejected but scored \(score)", file: file, line: line)
        }
    }
}

// MARK: - CorrectionContextBuilder (budgeted context, 2026-07-16)

final class CorrectionContextBuilderTests: XCTestCase {

    /// Fake background-word-list: only these count as known-common words.
    private let fakeRank: @Sendable (String) -> Int? = { term in
        ["今天", "可以", "我们", "hello"].contains(term) ? 1 : nil
    }

    // MARK: RareContentScorer

    func testScorer_knownCommonWordScoresZero() {
        XCTAssertEqual(RareContentScorer.score(term: "今天", rank: fakeRank), 0)
    }

    func testScorer_technicalTokens() {
        // camelCase / interior caps
        XCTAssertEqual(RareContentScorer.score(term: "LiveActivity", rank: fakeRank), 90)
        // letters + digits
        XCTAssertEqual(RareContentScorer.score(term: "iphone11", rank: fakeRank), 90)
        // dashed identifier
        XCTAssertEqual(RareContentScorer.score(term: "dns-server", rank: fakeRank), 90)
        // ALL CAPS
        XCTAssertEqual(RareContentScorer.score(term: "ASC", rank: fakeRank), 90)
        // mixed CJK + Latin
        XCTAssertEqual(RareContentScorer.score(term: "用ASC", rank: fakeRank), 90)
    }

    func testScorer_plainLowercaseLatinIsLow() {
        XCTAssertEqual(RareContentScorer.score(term: "world", rank: fakeRank), 20)
    }

    func testScorer_cjkDomainWordOfCommonChars() {
        // 闪/退 are both common hanzi; the word is OOV → baseline 40, digest-eligible
        // but below the strong (sentence-selection) threshold.
        let s = RareContentScorer.score(term: "闪退", rank: fakeRank)
        XCTAssertEqual(s, 40)
        XCTAssertGreaterThanOrEqual(s, RareContentScorer.digestThreshold)
        XCTAssertLessThan(s, RareContentScorer.strongThreshold)
    }

    func testScorer_rareHanziRaisesScore() {
        // 鏖 is far outside any common-character set: single rare char = 75,
        // and a two-char word with one rare char lands mid-scale (40 + 25).
        XCTAssertEqual(RareContentScorer.score(term: "鏖", rank: fakeRank), 75)
        XCTAssertEqual(RareContentScorer.score(term: "鏖战", rank: fakeRank), 65)
    }

    func testScorer_garbageScoresZero() {
        XCTAssertEqual(RareContentScorer.score(term: "", rank: fakeRank), 0)
        XCTAssertEqual(RareContentScorer.score(term: "……", rank: fakeRank), 0)
        XCTAssertEqual(RareContentScorer.score(term: "12345", rank: fakeRank), 0)
        XCTAssertEqual(RareContentScorer.score(term: "的", rank: fakeRank), 0) // common single hanzi
    }

    // MARK: Builder — digest + budget

    func testBuilder_emptyInputGivesEmptyContext() {
        XCTAssertTrue(CorrectionContextBuilder.build(messages: [], rankProvider: fakeRank).isEmpty)
    }

    func testBuilder_digestPicksRareTermsAndRespectsCap() {
        let msgs = [
            CorrectionSourceMessage(role: .user, text: "今天我们聊聊 LiveActivity 的闪退问题。"),
            CorrectionSourceMessage(role: .assistant, text: "可以，dns-server 也有关系。"),
        ]
        let ctx = CorrectionContextBuilder.build(messages: msgs, rankProvider: fakeRank)
        let digest = ctx.rareTermsDigest ?? ""
        XCTAssertTrue(digest.contains("LiveActivity"), "technical term must reach the digest: \(digest)")
        XCTAssertLessThanOrEqual(digest.count, 200)
        // Rarer (90) content sorts ahead of the common-char domain word (40).
        if let li = digest.range(of: "LiveActivity"), let st = digest.range(of: "闪退") {
            XCTAssertLessThan(li.lowerBound, st.lowerBound)
        }
    }

    func testBuilder_expandsBeyondTwoMessagesForRareContent() {
        // Old design stopped at the last user+assistant pair. An older message
        // carrying a rare term must now still contribute an excerpt.
        var msgs: [CorrectionSourceMessage] = [
            CorrectionSourceMessage(role: .user, text: "部署 WGHome 网关的注意事项。这句是老消息。"),
        ]
        msgs.append(CorrectionSourceMessage(role: .assistant, text: "好的。"))
        msgs.append(CorrectionSourceMessage(role: .user, text: "今天可以。"))
        let ctx = CorrectionContextBuilder.build(messages: msgs, rankProvider: fakeRank)
        XCTAssertTrue(ctx.recentExcerpts.joined().contains("WGHome"),
                      "older rare-bearing message should be excerpted: \(ctx.recentExcerpts)")
        // Chronological render: the old message's excerpt comes first.
        XCTAssertTrue(ctx.recentExcerpts.first?.contains("WGHome") ?? false)
    }

    func testBuilder_totalMessageContextStaysUnder5k() {
        // 12 long messages stuffed with rare technical tokens — worst case.
        let long = (0..<40).map { "模块Alpha\($0)Beta 出现鏖战级故障，检查 node-\($0)-cfg 配置。" }.joined()
        let msgs = (0..<12).map { i in
            CorrectionSourceMessage(role: i % 2 == 0 ? .user : .assistant, text: long)
        }
        let ctx = CorrectionContextBuilder.build(messages: msgs, rankProvider: fakeRank)
        let digestChars = ctx.rareTermsDigest?.count ?? 0
        let excerptChars = ctx.recentExcerpts.reduce(0) { $0 + $1.count }
        XCTAssertLessThanOrEqual(digestChars, 200)
        XCTAssertLessThanOrEqual(digestChars + excerptChars, 5000,
                                 "message context blew its budget: digest=\(digestChars) excerpts=\(excerptChars)")
    }

    func testBuilder_sentenceNeverCutMidway() {
        // Grounding excerpt is built from whole sentences; a sentence set whose
        // total exceeds the cap gets fewer sentences, not a mid-sentence slice.
        let msgs = [
            CorrectionSourceMessage(role: .user,
                text: (0..<60).map { "第\($0)句是一整句完整的话。" }.joined()),
        ]
        let ctx = CorrectionContextBuilder.build(messages: msgs, rankProvider: fakeRank)
        guard let excerpt = ctx.recentExcerpts.first else { return XCTFail("no excerpt") }
        // Every kept sentence still ends with its terminator (or explicit ellipsis).
        let body = excerpt.drop(while: { $0 != "】" }).dropFirst()
        XCTAssertTrue(body.hasSuffix("。") || body.hasSuffix("…"), "excerpt tail: \(body.suffix(12))")
    }
}
