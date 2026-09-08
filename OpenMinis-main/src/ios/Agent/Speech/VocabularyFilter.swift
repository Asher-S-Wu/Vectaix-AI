import Foundation

private let logger = AppLogger(category: "VoiceCorrection")

/// The pure `typed_vocabulary` intake rules (design §3.3), split out of
/// `TypedVocabularyBuilder`.
///
/// The builder itself reads `ChatStore`, which drags the whole app into any target that
/// imports it. These rules are pure functions over a string — exactly what a unit test
/// wants to pin down — so they live here, with no app dependency.
enum VocabularyFilter {

// MARK: - Filtering (design §3.3)

/// The scoring breakdown, returned by `evaluate` rather than recomputed by callers.
///
/// The debug RPC used to recompute this to display it, which meant two copies of the
/// scoring rule that could disagree — and did. Keep exactly one implementation.
struct ScoreBreakdown: Equatable {
    var backgroundRank = 0
    var posTag = 0
    var hasLatinOrDigit = 0
    var lengthOk = 0
    var total: Int { backgroundRank + posTag + hasLatinOrDigit + lengthOk }
}

enum Decision {
    case accepted(score: Int, breakdown: ScoreBreakdown)
    case rejected(reason: String)
}

/// The §3.3 gauntlet. Note the deliberate asymmetry: the *rejection* layers are cheap
/// and absolute (stopword, length), while acceptance requires positive evidence that a
/// term is a proper noun / jargon — the things an ASR gets wrong. Ordinary vocabulary
/// is not worth storing: the model already knows "今天" is a word.
///
/// The frequency/distinct-days layers (§3.3 layers 3–4) are enforced at RETRIEVAL, not
/// here — we have to store a term before we can count how often it recurs, and across
/// how many days. Storing with frequency=1 and letting it accumulate is the only way to
/// ever reach the threshold.
static func evaluate(term: String, posTag: String?) -> Decision {
    if StopWords.contains(term) { return .rejected(reason: "stopword_blacklist") }
    if term.count < 2 { return .rejected(reason: "too_short") }
    if term.count > 12 { return .rejected(reason: "too_long") }
    // Pure punctuation / bare-digit tokens carry no vocabulary signal. Same `isASCII`
    // caveat as below: unqualified `isNumber` is true for CJK numerals, so this test
    // must be ASCII-only or it would throw away real words like "三星" or "十字路口".
    if term.allSatisfy({ ($0.isASCII && $0.isNumber) || $0.isPunctuation || $0.isWhitespace }) {
        return .rejected(reason: "no_lexical_content")
    }

    var b = ScoreBreakdown()
    let rank = BackgroundWordFrequency.shared.rank(of: term)
    // Absent from (or deep in) the common-word list ⇒ unusual ⇒ likely a name/jargon.
    if rank == nil || rank! > VoiceCorrectionConfig.vocabBackgroundRankThreshold { b.backgroundRank = 2 }
    // Proper-noun POS tags are the strongest single signal (§3.3).
    if let posTag, ["nr", "ns", "nz", "nt"].contains(posTag) { b.posTag = 2 }
    // Latin/digits ⇒ brand, model number, code identifier.
    //
    // NOTE the `isASCII` guard on the letter test: `Character.isLetter` is true for
    // Han characters too, so testing `isLetter` alone would score EVERY Chinese term
    // as "contains Latin". Likewise `isNumber` is true for CJK numerals (一, 二, 三 —
    // yes, really), which is why "张三说" was scoring a spurious Latin point on device:
    // the 三 in the name is a Unicode Number. Restrict both tests to ASCII.
    let hasLatin = term.contains { $0.isASCII && $0.isLetter }
    let hasDigit = term.contains { $0.isASCII && $0.isNumber }
    if hasLatin || hasDigit { b.hasLatinOrDigit = 1 }
    // Mid-length terms look like standalone lexical entries.
    if (2...6).contains(term.count) { b.lengthOk = 1 }

    return b.total >= VoiceCorrectionConfig.vocabMinScore
        ? .accepted(score: b.total, breakdown: b)
        : .rejected(reason: "low_score(\(b.total))")
}

/// Segment + POS-tag one message into (term, occurrences, tag) triples.
static func candidates(in text: String) -> [(String, Int, String?)] {
    let tagged = TextSegmenter.shared.posTag(text)
    if !tagged.isEmpty {
        var counts: [String: Int] = [:]
        var tags: [String: String] = [:]
        for pair in tagged {
            counts[pair.token, default: 0] += 1
            tags[pair.token] = pair.tag
        }
        return counts.map { ($0.key, $0.value, tags[$0.key]) }
    }
    // Non-Chinese (or jieba unavailable): still harvest terms, just without POS.
    var counts: [String: Int] = [:]
    for token in TextSegmenter.shared.segment(text) { counts[token, default: 0] += 1 }
    return counts.map { ($0.key, $0.value, nil) }
}


}

// MARK: - Stop words

/// Conversational filler that carries no vocabulary signal (design §3.3 Layer 1).
/// Kept small and blunt on purpose: the score gate downstream does the nuanced work, this
/// just drops the words that would otherwise dominate any frequency count.
enum StopWords {
    /// English function words.
    ///
    /// Measured on device: without these, a real chat history produced `the`(×31),
    /// `and`(×18), `to`, `with`, `of`, `me`, `for`, `from` as the TOP typed-vocabulary
    /// entries by frequency. They sail through every Chinese-oriented rule — absent from
    /// the zh background list (+2 "rare"), 2–6 chars (+1), and ASCII letters (+1 "brand or
    /// code identifier") — scoring 4 and outranking genuine terms. The Latin-script bonus
    /// is meant to catch "CppJieba", not "the".
    ///
    /// Lowercased on lookup, so casing doesn't matter.
    static let english: Set<String> = [
        "the", "a", "an", "and", "or", "but", "if", "then", "than", "that", "this", "these", "those",
        "is", "are", "was", "were", "be", "been", "being", "am",
        "do", "does", "did", "done", "have", "has", "had",
        "can", "could", "will", "would", "shall", "should", "may", "might", "must",
        "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them",
        "my", "your", "his", "its", "our", "their",
        "to", "of", "in", "on", "at", "by", "for", "with", "from", "into", "about", "as",
        "not", "no", "yes", "ok", "okay", "so", "just", "very", "too", "also", "only",
        "what", "which", "who", "when", "where", "why", "how",
        "there", "here", "some", "any", "all", "more", "most", "one", "two",
        "get", "got", "let", "make", "made", "use", "used", "like", "want", "need",
        "please", "thanks", "thank", "hi", "hello", "now", "still", "even", "up", "out", "over",
    ]

    static let set: Set<String> = [
        "的", "了", "是", "我", "你", "他", "她", "它", "我们", "你们", "他们",
        "这", "那", "这个", "那个", "什么", "怎么", "为什么", "哪里", "谁",
        "有", "没有", "不", "也", "都", "很", "太", "就", "还", "又", "再", "才", "只",
        "可以", "能", "会", "要", "想", "需要", "应该", "可能", "或者", "但是", "因为", "所以",
        "然后", "而且", "不过", "虽然", "如果", "继续", "好的", "嗯", "就是", "其实", "反正",
        "一下", "一点", "一样", "一起", "现在", "今天", "明天", "昨天",
        "说", "讲", "看", "听", "做", "用", "给", "让", "把", "被", "在", "和", "与", "对",
    ]
    static func contains(_ term: String) -> Bool {
        if set.contains(term) { return true }
        return english.contains(term.lowercased())
    }
}

// MARK: - Background word frequency

/// The bundled common-word list (design §3.3).
///
/// Semantics worth being precise about: a term's PRESENCE here means "this is an ordinary
/// word", which *suppresses* its proper-noun score. Absence is the interesting signal —
/// it suggests a name, a brand, or jargon, i.e. exactly what an ASR mangles and what the
/// corrector needs to know about.
///
/// The design cites SUBTLEX-CH; that corpus isn't bundled here, so this is a curated
/// high-frequency list instead. It's honest about being small: for this scoring rule,
/// recognising the common words is what matters, and being absent from a *short* list is a
/// weaker signal than being absent from a big one — which only makes the rule more
/// conservative (more terms look "rare"), never more reckless.
final class BackgroundWordFrequency: @unchecked Sendable {
    static let shared = BackgroundWordFrequency()

    private var ranks: [String: Int] = [:]
    private(set) var version = 0

    private init() {
        let bundle = Bundle(for: BackgroundWordFrequency.self)
        guard let url = bundle.url(forResource: "zh_background_wordfreq", withExtension: "txt")
                ?? Bundle.main.url(forResource: "zh_background_wordfreq", withExtension: "txt"),
              let content = try? String(contentsOf: url, encoding: .utf8) else {
            logger.warning("[VoiceCorrection][VocabBuild] background word-frequency list missing — every term will score as 'rare'")
            return
        }
        for line in content.split(separator: "\n") {
            if line.hasPrefix("#") {
                if line.contains("version:"),
                   let v = line.split(separator: ":").last.flatMap({ Int($0.trimmingCharacters(in: .whitespaces)) }) {
                    version = v
                }
                continue
            }
            let parts = line.split(separator: " ")
            guard parts.count == 2, let rank = Int(parts[1]) else { continue }
            ranks[String(parts[0])] = rank
        }
        logger.info("[VoiceCorrection][VocabBuild] background word-frequency list loaded terms=\(ranks.count) version=\(version)")
    }

    /// Rank if the term is a known common word; nil = not in the list ⇒ treat as rare.
    func rank(of term: String) -> Int? { ranks[term] }
}
