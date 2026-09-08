import Foundation

/// [T-correction-admission-multisignal] Decides whether one diffed edit span
/// (`from` → `to`, already jieba-widened to word boundaries by
/// `VoiceCorrectionDiff.tokenPairs`) is an ASR/IME-style mistake worth learning
/// into `confusion_dictionary`, or a plain content rewrite to discard.
///
/// Replaces the old single-axis rule (`phoneticSim ≥ 0.6 AND lengthRatio ≤ 2`),
/// which — because `PinyinNormalizer.normalize` passes Latin/digits through
/// literally — mis-scored the project's most common real edits (Chinese-English
/// mixing, acronym expansion, digit normalization) as rewrites and dropped them.
/// Analysis of 35 real correction_events: the old rule kept ~1 of the ~14 that
/// should have been collected. See CorrectionAdmissionTests.
///
/// Pure value logic — no DB, no provider, no actor — so it unit-tests standalone.
enum CorrectionAdmission {

    /// Tunables, grouped so they're easy to retune from the tests.
    enum Config {
        /// Phonetic-key Levenshtein similarity at/above which a span counts as a
        /// homophone/near-homophone (covers Chinese homophones AND literally
        /// similar Latin like cloud/claude). Kept at the historical 0.6 — the
        /// new acronym/digit signals cover the sub-0.6 cases (MediaS→Media
        /// Server etc.) without loosening this axis into false positives.
        static let phoneticSimilarity = 0.6
        /// A span may be short but still be a rewrite if it's a big fraction of
        /// the whole sentence. `editLocality` = changed-span chars / sentence
        /// chars; above this the edit is treated as a rewrite regardless of the
        /// other signals. Replaces lengthRatio as the primary "rewrite" guard.
        static let maxEditLocality = 0.6
        /// Acronym/subsequence relation requires the short side to be
        /// meaningfully shorter than the long side (else "abc"⊆"abcd" trivially
        /// matches near-equal strings and lets rewrites through).
        static let maxAcronymLengthFraction = 0.9
        /// Signal 4: Levenshtein similarity of the two consonant skeletons at or
        /// above which a same-syllable-count Latin pair counts as a near-sound.
        /// 0.30 is the loosest value that still admits linux↔minis (skeletons
        /// lnx/mns, sim 0.33) while rejecting cursor↔claude (crsr/cld, 0.25) —
        /// the latter already passes Signal 1 anyway.
        static let latinSkeletonSimilarity = 0.30
    }

    /// Why a span was admitted or rejected — surfaced in logs (privacy-safe: it
    /// names the SIGNAL, never the user's text) and asserted in tests.
    enum Verdict: Equatable {
        case homophone(sim: Double)   // phonetic near-match
        case acronym                  // one side is an ordered subsequence of the other
        case digitNorm                // Chinese-number ↔ arabic / alphanumeric term
        case latinPhonetic            // Latin near-sound (consonant skeleton match)
        case rejectedReword(sim: Double)
        case rejectedReorder          // same characters, only order changed
        case rejectedTooGlobal(locality: Double)

        var isAdmitted: Bool {
            switch self {
            case .homophone, .acronym, .digitNorm, .latinPhonetic: return true
            case .rejectedReword, .rejectedReorder, .rejectedTooGlobal: return false
            }
        }
        /// Privacy-safe reason tag for logs.
        var reason: String {
            switch self {
            case .homophone(let s): return "homophone(sim=\(String(format: "%.2f", s)))"
            case .acronym: return "acronym"
            case .digitNorm: return "digit_norm"
            case .latinPhonetic: return "latin_phonetic"
            case .rejectedReword(let s): return "reword(sim=\(String(format: "%.2f", s)))"
            case .rejectedReorder: return "reorder"
            case .rejectedTooGlobal(let l): return "too_global(loc=\(String(format: "%.2f", l)))"
            }
        }
    }

    /// Judge one span. `sentenceLength` is the character length of the sentence
    /// the span was diffed within — used for the locality guard. Pass the
    /// max of the before/after sentence lengths (the recorder has both).
    static func judge(from: String, to: String,
                      normalizer: any PhoneticNormalizer,
                      sentenceLength: Int) -> Verdict {
        let a = from.trimmingCharacters(in: .whitespacesAndNewlines)
        let b = to.trimmingCharacters(in: .whitespacesAndNewlines)

        // Locality first: a span that IS most of the sentence is a rewrite even
        // if it happens to look phonetically similar. Uses the larger side so a
        // long deletion still counts as a big edit.
        let spanLen = max(a.count, b.count)
        let locality = sentenceLength > 0 ? Double(spanLen) / Double(sentenceLength) : 1.0
        if locality > Config.maxEditLocality {
            return .rejectedTooGlobal(locality: locality)
        }

        // Pure reorder (same multiset of characters, different order) → the user
        // rearranged words, not fixed a mis-hear. Catch it before phonetics,
        // because reordered text often keeps a high phonetic similarity.
        if isPureReorder(a, b) {
            return .rejectedReorder
        }

        let keyA = normalizer.normalize(a)
        let keyB = normalizer.normalize(b)

        // Signal 1 — homophone / near-homophone (phonetic-key Levenshtein).
        let sim = PinyinNormalizer.similarity(keyA, keyB)
        if sim >= Config.phoneticSimilarity, !keyA.isEmpty {
            return .homophone(sim: sim)
        }

        // Signal 2 — digit / term normalization (十七→17, 二V三→v3, A P P→APP).
        if isDigitTermNormalization(a, b) {
            return .digitNorm
        }

        // Signal 3 — acronym ⇄ expansion (MediaS→Media Server, worker→work on,
        // 上帝→上). One phonetic key is an ordered subsequence of the other and
        // meaningfully shorter.
        if isAcronymRelated(keyA, keyB) {
            return .acronym
        }

        // Signal 4 — Latin near-sound (linux→minis). Levenshtein over the full
        // key scores these ~0.40 because the consonants differ outright, but the
        // words share syllable rhythm and a consonant landmark, which is what an
        // ASR actually confuses. Gated on the ORIGINAL text being Latin-script:
        // PinyinNormalizer renders Chinese as toneless a-z, so testing the KEY
        // for "purely a-z" would not exclude Chinese at all and would let
        // unrelated pairs like 挂载/规则 (guazai/guize) through.
        if isLatinOrigin(a), isLatinOrigin(b), isLatinPhoneticSimilar(keyA, keyB) {
            return .latinPhonetic
        }

        return .rejectedReword(sim: sim)
    }

    // MARK: - Signals

    /// True when the two strings are anagrams over their non-space characters —
    /// i.e. the same content reordered, not a substitution.
    static func isPureReorder(_ a: String, _ b: String) -> Bool {
        func bag(_ s: String) -> [Character: Int] {
            var m: [Character: Int] = [:]
            for c in s where !c.isWhitespace { m[c, default: 0] += 1 }
            return m
        }
        let ba = bag(a), bb = bag(b)
        // Require a real reorder: same non-empty multiset AND the ordered strings
        // actually differ (identical strings are handled elsewhere).
        guard !ba.isEmpty, ba == bb else { return false }
        return a != b
    }

    /// One side's phonetic key is an ordered subsequence of the other's and
    /// clearly shorter — an initialism / abbreviation of an expansion.
    static func isAcronymRelated(_ keyA: String, _ keyB: String) -> Bool {
        let (short, long) = keyA.count <= keyB.count ? (keyA, keyB) : (keyB, keyA)
        guard !short.isEmpty, short.count < long.count else { return false }
        guard Double(short.count) / Double(long.count) < Config.maxAcronymLengthFraction else { return false }
        // Ordered-subsequence test.
        var it = long.startIndex
        for ch in short {
            guard let f = long[it...].firstIndex(of: ch) else { return false }
            it = long.index(after: f)
        }
        return true
    }

    /// True when the ORIGINAL span is Latin-script — ASCII letters, digits and
    /// separators only, with at least one letter. Used to keep Signal 4 off
    /// Chinese input: `PinyinNormalizer` renders 挂载 as "guazai", which is
    /// indistinguishable from a real Latin word once you only look at the key.
    static func isLatinOrigin(_ s: String) -> Bool {
        var sawLetter = false
        for ch in s {
            if ch.isLetter {
                guard ch.isASCII else { return false }
                sawLetter = true
            } else if !(ch.isWhitespace || ch.isNumber && ch.isASCII || ch == "-" || ch == "_" || ch == ".") {
                return false
            }
        }
        return sawLetter
    }

    /// True when two Latin phonetic keys plausibly sound alike to an ASR: same
    /// syllable count (vowel-group parity), and consonant skeletons that are
    /// Levenshtein-similar AND share a consonant at the same skeleton index.
    ///
    /// Why the skeleton rather than a consonant multiset: a bag of consonants
    /// throws away order, and linux/minis (l,n,x vs m,n,s) then scores exactly
    /// the same as linux/ninja (l,n,x vs n,n,j) — 0.20 either way — so no
    /// threshold can separate the real confusion from the spurious one. The
    /// skeleton keeps position, and the same-index anchor requires the shared
    /// consonant to actually land in the same slot ("n" is 2nd in both lnx and
    /// mns). cat/dog has no shared consonant at any index and is rejected.
    ///
    /// This signal is deliberately loose — it answers "could an ASR have
    /// confused these?", not "should this correction apply". The locality guard
    /// here and the vocabulary evidence downstream are the real gatekeepers.
    /// Known accepted false positive: linux↔ninja (indistinguishable from
    /// linux↔minis on every feature available here).
    static func isLatinPhoneticSimilar(_ keyA: String, _ keyB: String) -> Bool {
        let vowels: Set<Character> = ["a", "e", "i", "o", "u"]

        // Syllable count = number of maximal vowel-character groups.
        func syllableCount(_ s: String) -> Int {
            var count = 0, inVowel = false
            for c in s {
                if vowels.contains(c) {
                    if !inVowel { count += 1; inVowel = true }
                } else {
                    inVowel = false
                }
            }
            return count
        }
        let scA = syllableCount(keyA), scB = syllableCount(keyB)
        guard scA > 0, scB > 0, scA == scB else { return false }

        let skelA = Array(keyA.filter { !vowels.contains($0) })
        let skelB = Array(keyB.filter { !vowels.contains($0) })
        guard !skelA.isEmpty, !skelB.isEmpty else { return false }

        // Same-index consonant anchor.
        var anchored = false
        for i in 0..<min(skelA.count, skelB.count) where skelA[i] == skelB[i] {
            anchored = true
            break
        }
        guard anchored else { return false }

        // Levenshtein similarity over the skeletons.
        let distance = levenshtein(skelA, skelB)
        let longest = max(skelA.count, skelB.count)
        let sim = longest > 0 ? 1.0 - Double(distance) / Double(longest) : 0.0
        return sim >= Config.latinSkeletonSimilarity
    }

    /// Plain Levenshtein edit distance over character arrays (two-row DP).
    private static func levenshtein(_ a: [Character], _ b: [Character]) -> Int {
        if a.isEmpty { return b.count }
        if b.isEmpty { return a.count }
        var previous = Array(0...b.count)
        var current = [Int](repeating: 0, count: b.count + 1)
        for i in 1...a.count {
            current[0] = i
            for j in 1...b.count {
                current[j] = a[i - 1] == b[j - 1]
                    ? previous[j - 1]
                    : min(previous[j - 1], previous[j], current[j - 1]) + 1
            }
            previous = current
        }
        return previous[b.count]
    }

    /// One side carries Chinese number words while the other carries Arabic
    /// digits — the user normalized spoken numbers ("十七"→"17", "二V三"→"v3"),
    /// which pinyin similarity scores as totally dissimilar. Also covers spaced
    /// alphanumeric terms ("G P L 二 V 三"→"GPLv3") via the digit presence.
    static func isDigitTermNormalization(_ a: String, _ b: String) -> Bool {
        let chineseNumerals = Set("零一二三四五六七八九十百千万两")
        func hasChineseNumeral(_ s: String) -> Bool { s.contains(where: chineseNumerals.contains) }
        func hasArabicDigit(_ s: String) -> Bool { s.contains(where: { $0.isNumber && $0.isASCII }) }
        // Direction-agnostic: spoken (Chinese numeral) on one side, digit on the other.
        let aCN = hasChineseNumeral(a), bCN = hasChineseNumeral(b)
        let aDigit = hasArabicDigit(a), bDigit = hasArabicDigit(b)
        return (aCN && bDigit && !bCN) || (bCN && aDigit && !aCN)
    }
}
