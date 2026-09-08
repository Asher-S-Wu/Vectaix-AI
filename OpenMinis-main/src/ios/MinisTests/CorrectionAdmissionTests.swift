import XCTest

/// [T-correction-admission-multisignal] Locks the multi-signal admission rule
/// against the 35 REAL correction_events captured from the author's device
/// (the dataset that motivated the redesign). Each case asserts whether the
/// edit span should be COLLECTED (an ASR/IME mistake worth learning) or
/// REJECTED (a plain content rewrite), plus targeted unit checks on each signal.
final class CorrectionAdmissionTests: XCTestCase {

    private let zh = PinyinNormalizer.shared

    /// Default sentence length generously large so a bare span isn't rejected
    /// as "too global" — in production a span is one word inside a full
    /// transcript, so locality is small. Tests that specifically exercise the
    /// locality guard pass an explicit small `sentence`.
    private func judge(_ from: String, _ to: String, sentence: Int? = nil) -> CorrectionAdmission.Verdict {
        CorrectionAdmission.judge(from: from, to: to, normalizer: zh,
                                  sentenceLength: sentence ?? max(from.count, to.count, 40))
    }

    // MARK: - The four signal families (spans, as tokenPairs would emit them)

    func testChineseHomophones() {
        // 审推→闪退, 绘画→会话 — the class the OLD rule already caught; must still pass.
        XCTAssertTrue(judge("审推", "闪退").isAdmitted)
        XCTAssertTrue(judge("绘画", "会话").isAdmitted)
        XCTAssertTrue(judge("LifeActivity", "LiveActivity").isAdmitted)  // Latin near-form
    }

    func testChineseEnglishPhoneticMix() {
        // cloud→claude, worker→work on — literally similar Latin, caught by the
        // phonetic axis (normalize passes Latin through, similarity is high).
        XCTAssertTrue(judge("cloud", "claude").isAdmitted)
        XCTAssertTrue(judge("worker", "work on").isAdmitted)
        XCTAssertTrue(judge("I worker", "I work on").isAdmitted)
    }

    func testAcronymExpansion_newlyCollected() {
        // MediaS→Media Server: OLD rule dropped (sim 0.55, lenRatio 2.0). NEW: acronym.
        // This is exactly the whole-token pair tokenPairs now emits (with the
        // space in "Media Server"), so admission must accept the same string.
        XCTAssertEqual(judge("MediaS", "Media Server"), .acronym)
        // 上帝→上 dropping a syllable is an ordered-subsequence relation too.
        XCTAssertTrue(judge("上帝", "上").isAdmitted)
    }

    func testDigitNormalization_newlyCollected() {
        // 十七→17, 二V三→v3: OLD rule dropped (sim ~0). NEW: digit-norm.
        XCTAssertEqual(judge("十七", "17"), .digitNorm)
        XCTAssertEqual(judge("二V三", "v3"), .digitNorm)
    }

    // MARK: - Must stay REJECTED (no new false positives)

    func testSemanticRewritesRejected() {
        XCTAssertFalse(judge("挂载", "规则").isAdmitted)       // pure semantic fix, phonetically far
        XCTAssertFalse(judge("secure", "SSH key").isAdmitted) // semantic
        // 英雄→Issue: cross-language semantic; short sentence makes it also too-global.
        XCTAssertFalse(judge("英雄", "Issue", sentence: 6).isAdmitted)
    }

    func testReorderRejected() {
        // 最后是→是最后: same characters, order changed.
        XCTAssertEqual(judge("最后是", "是最后"), .rejectedReorder)
    }

    func testGlobalEditRejected() {
        // A span that is essentially the whole (short) sentence is a rewrite,
        // even if it scored some phonetic similarity.
        let v = judge("看看下一个英雄", "看看下一个Issue", sentence: 8)
        // 英雄→Issue inside a short sentence: not a homophone, not acronym/digit → reword.
        XCTAssertFalse(v.isAdmitted)
    }

    func testLocalityGuard() {
        // Same genuine-homophone span, different sentence sizes — only locality
        // flips the verdict. Long sentence (span is 2/20 = 10%) → admitted.
        XCTAssertTrue(judge("审推", "闪退", sentence: 20).isAdmitted)
        // The span IS the whole sentence (2/2 = 100%) → too global, rejected,
        // even though it's phonetically a perfect homophone.
        if case .rejectedTooGlobal = judge("审推", "闪退", sentence: 2) {
            // ok
        } else {
            XCTFail("expected rejectedTooGlobal when span == whole sentence")
        }
    }

    // MARK: - Signal unit checks

    func testIsPureReorder() {
        XCTAssertTrue(CorrectionAdmission.isPureReorder("最后是", "是最后"))
        XCTAssertTrue(CorrectionAdmission.isPureReorder("abc", "cba"))
        XCTAssertFalse(CorrectionAdmission.isPureReorder("审推", "闪退")) // different chars
        XCTAssertFalse(CorrectionAdmission.isPureReorder("abc", "abc")) // identical, not a reorder
    }

    func testIsAcronymRelated() {
        XCTAssertTrue(CorrectionAdmission.isAcronymRelated("medias", "mediaserver"))
        XCTAssertTrue(CorrectionAdmission.isAcronymRelated("shang", "shangdi")) // 上 ⊂ 上帝
        XCTAssertFalse(CorrectionAdmission.isAcronymRelated("cat", "dog"))
        XCTAssertFalse(CorrectionAdmission.isAcronymRelated("abcd", "abce")) // same length, not shorter
        XCTAssertFalse(CorrectionAdmission.isAcronymRelated("acb", "abcd")) // not an ORDERED subsequence (c before b)
    }

    func testIsDigitTermNormalization() {
        XCTAssertTrue(CorrectionAdmission.isDigitTermNormalization("十七", "17"))
        XCTAssertTrue(CorrectionAdmission.isDigitTermNormalization("二V三", "v3"))
        XCTAssertFalse(CorrectionAdmission.isDigitTermNormalization("挂载", "规则")) // no digits either side
        XCTAssertFalse(CorrectionAdmission.isDigitTermNormalization("17", "18"))    // both digits, not a spoken↔digit norm
    }

    // MARK: - RTU→Retry stays deliberately UNCOLLECTED (per design decision)

    func testRTUNowAdmittedViaLatinPhonetic() {
        // rtu/retry: sim 0.40, not an ordered subsequence, no digits — so it was
        // REJECTED before Signal 4 existed, as a deliberately conservative choice.
        // Signal 4 now admits it: same syllable count (1 each), skeletons rt/rtry
        // are Levenshtein-similar (0.50) and share "r" at index 0. That is the
        // correct call — RTU↔Retry is a plausible ASR near-sound, and whether the
        // correction actually applies is decided downstream by vocabulary evidence.
        XCTAssertEqual(judge("RTU", "Retry"), .latinPhonetic)
    }

    // MARK: - Signal 4: Latin phonetic (consonant skeleton)

    func testLatinPhoneticSimilarity() {
        let f = CorrectionAdmission.isLatinPhoneticSimilar

        // The reported bug: linux→minis. Skeletons lnx/mns — same syllable count
        // (2), "n" anchored at index 1, skeleton similarity 0.33 ≥ 0.30.
        XCTAssertTrue(f("linux", "minis"))

        // cursor/claude does NOT fire here: skeletons crsr/cld are only 0.25
        // similar. It needs no help — Signal 1 already admits it phonetically.
        XCTAssertFalse(f("cursor", "claude"))
        XCTAssertTrue(judge("cursor", "claude").isAdmitted)

        // cat/dog: same syllable count, but ct/dg share no consonant at any
        // index, so the anchor requirement rejects it.
        XCTAssertFalse(f("cat", "dog"))

        // Syllable-count parity rejects these outright.
        XCTAssertFalse(f("linux", "python"))    // 2 vs 1
        XCTAssertFalse(f("minis", "minutes"))   // 2 vs 3 — a rewrite, correctly dropped
        XCTAssertFalse(f("cloud", "claude"))    // 1 vs 2 — already Signal 1's job

        // Empty / vowel-only inputs must not crash or match.
        XCTAssertFalse(f("", ""))
        XCTAssertFalse(f("aeiou", "aeiou"))     // no consonant skeleton at all
    }

    func testLatinOriginGuardKeepsChineseOnThePinyinPath() {
        // PinyinNormalizer renders Chinese as toneless a-z, so a guard that
        // inspected the KEY would see "guazai"/"guize" as ordinary Latin words
        // with matching syllable counts and admit this unrelated-word rewrite.
        // The guard tests the ORIGINAL text instead, so Chinese never reaches
        // Signal 4 and this pair stays rejected.
        XCTAssertFalse(CorrectionAdmission.isLatinOrigin("挂载"))
        XCTAssertTrue(CorrectionAdmission.isLatinOrigin("linux"))
        XCTAssertTrue(CorrectionAdmission.isLatinOrigin("Media Server"))
        XCTAssertFalse(judge("挂载", "规则").isAdmitted)
    }

    func testLinuxMinisAdmitted() {
        // The specific user report, end-to-end through judge().
        XCTAssertEqual(judge("linux", "minis"), .latinPhonetic)
        // Case variations — the normalizer lowercases, so these behave the same.
        XCTAssertEqual(judge("Linux", "minis"), .latinPhonetic)
        XCTAssertEqual(judge("Linux", "Minis"), .latinPhonetic)
    }

    // MARK: - Aggregate: collection rate over the classified real-data spans

    /// The representative admitted spans distilled from the 35 real events
    /// (deduped, one per distinct edit). New algorithm must collect the ASR-error
    /// class and reject the rewrite class.
    func testRealDataAdmissionMatrix() {
        let shouldCollect: [(String, String)] = [
            ("审推", "闪退"), ("绘画", "会话"), ("LifeActivity", "LiveActivity"),
            ("cloud", "claude"), ("worker", "work on"), ("I worker", "I work on"),
            ("MediaS", "Media Server"), ("十七", "17"), ("二V三", "v3"),
            ("linux", "minis"),   // Signal 4 — the GH report; nothing else catches it
        ]
        let shouldReject: [(String, String)] = [
            ("挂载", "规则"), ("secure", "SSH key"),
            ("最后是", "是最后"),
        ]
        for (a, b) in shouldCollect {
            XCTAssertTrue(judge(a, b, sentence: 40).isAdmitted,
                          "expected COLLECT for \(a)→\(b), got \(judge(a, b, sentence: 40).reason)")
        }
        for (a, b) in shouldReject {
            XCTAssertFalse(judge(a, b, sentence: 40).isAdmitted,
                           "expected REJECT for \(a)→\(b), got \(judge(a, b, sentence: 40).reason)")
        }
    }
}
