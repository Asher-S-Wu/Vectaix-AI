import NaturalLanguage

/// Unified tokenizer facade. Routes by script: text whose non-whitespace content is
/// ≥50% CJK (U+4E00–U+9FFF, sampled over the first 200 characters) goes through
/// jieba (CppJieba via `JiebaWrapper`); everything else uses `NLTokenizer`.
///
/// `Sendable`: the type holds no stored state — `NLTokenizer` is created per call,
/// and the jieba dictionary lives behind `JiebaWrapper.shared`, which is loaded once
/// under `dispatch_once` and only read afterwards. So `shared` is safe to touch from
/// any thread/actor.
public final class TextSegmenter: Sendable {

    public static let shared = TextSegmenter()
    private init() {}

    public func segment(_ text: String) -> [String] {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return [] }
        if isMajorityChinese(trimmed) {
            return segmentWithJieba(trimmed, forSearch: false)
        }
        return segmentWithNLTokenizer(trimmed)
    }

    public func segmentForSearch(_ text: String) -> [String] {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return [] }
        if isMajorityChinese(trimmed) {
            return segmentWithJieba(trimmed, forSearch: true)
        }
        return segmentWithNLTokenizer(trimmed)
    }

    /// Part-of-speech tags as (token, tag) pairs — jieba's tag set: nr=person, ns=place,
    /// nz=other proper noun, nt=organisation, eng=latin, m=number…
    ///
    /// Chinese only: this is jieba's tagger and there is no NLTokenizer equivalent, so
    /// non-Chinese text returns [] rather than something misleading.
    public func posTag(_ text: String) -> [(token: String, tag: String)] {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, isMajorityChinese(trimmed) else { return [] }
        let wrapper = JiebaWrapper.shared()
        guard wrapper.isReady else { return [] }
        return wrapper.posTag(trimmed).compactMap { pair in
            guard pair.count == 2 else { return nil }
            return (token: pair[0], tag: pair[1])
        }
    }

    // MARK: - Private

    /// True when the sampled text should be segmented by jieba.
    ///
    /// Rule: over the first 200 characters, the share of Han ideographs
    /// (U+4E00–U+9FFF) among non-whitespace characters must be ≥ 50%.
    ///
    /// Japanese exception: kanji live in the SAME Unicode block as Chinese hanzi,
    /// so a pure Han-ratio test cannot tell the two apart — "東京は日本の首都です"
    /// is 60% Han and would otherwise be handed to a Chinese dictionary. Any
    /// Hiragana/Katakana (U+3040–U+30FF) is a reliable "this is Japanese, not
    /// Chinese" signal, so its presence routes the text to NLTokenizer instead.
    internal func isMajorityChinese(_ text: String) -> Bool {
        let sample = text.prefix(200)
        var cjk = 0
        var nonWhitespace = 0
        for scalar in sample.unicodeScalars {
            // Hiragana (U+3040–U+309F) or Katakana (U+30A0–U+30FF) ⇒ Japanese.
            if scalar.value >= 0x3040 && scalar.value <= 0x30FF { return false }
            if scalar.properties.isWhitespace { continue }
            nonWhitespace += 1
            if scalar.value >= 0x4E00 && scalar.value <= 0x9FFF {
                cjk += 1
            }
        }
        guard nonWhitespace > 0 else { return false }
        return Double(cjk) / Double(nonWhitespace) >= 0.5
    }

    private func segmentWithJieba(_ text: String, forSearch: Bool) -> [String] {
        let wrapper = JiebaWrapper.shared()
        guard wrapper.isReady else { return segmentWithNLTokenizer(text) }
        let result: [String]
        if forSearch {
            result = wrapper.segment(forSearch: text) as? [String] ?? []
        } else {
            result = wrapper.segment(text) as? [String] ?? []
        }
        return result.filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }

    private func segmentWithNLTokenizer(_ text: String) -> [String] {
        let tokenizer = NLTokenizer(unit: .word)
        tokenizer.string = text
        var tokens: [String] = []
        tokenizer.enumerateTokens(in: text.startIndex..<text.endIndex) { range, _ in
            let token = String(text[range])
            if !token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                tokens.append(token)
            }
            return true
        }
        return tokens
    }
}
