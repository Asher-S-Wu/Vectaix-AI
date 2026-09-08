import Foundation

/// Maps text to a locale-appropriate phonetic key, so that homophone/near-homophone
/// ASR errors ("张山" vs "张三") collapse onto the same lookup key (design §4.2).
///
/// The protocol — and every column/field name derived from it (`phonetic_key`,
/// `original_phonetic_key`) — is deliberately locale-agnostic. The design calls this
/// out as the single most important correction over earlier drafts: "拼音" is a
/// Chinese-specific concept and must NOT leak into the schema or the interfaces,
/// otherwise English (Soundex/Metaphone) and Japanese (kana) support later require a
/// migration instead of just registering another implementation.
protocol PhoneticNormalizer: Sendable {
    /// The locale this normalizer serves ("zh", "en", "ja"…).
    var locale: String { get }
    /// Normalized phonetic key for `text`. Returns "" when `text` has no phonetic
    /// content the normalizer can represent.
    func normalize(_ text: String) -> String
}

// MARK: - Registry

/// Routes text to a normalizer by locale. v1 registers only `PinyinNormalizer` (zh);
/// `MetaphoneNormalizer` (en) / `KanaNormalizer` (ja) plug in here later without any
/// change to callers or schema (design §8).
enum PhoneticNormalizerRegistry {
    /// Normalizer for `locale`, or nil when the locale has no phonetic support yet.
    /// Callers must treat nil as "cannot phonetically compare" and degrade, never crash.
    ///
    /// A `switch`, not a static dictionary: under Swift 6 strict concurrency a
    /// `static let [String: any PhoneticNormalizer]` is not Sendable (the existential can't
    /// prove it), so it fails to compile in a strict-concurrency target. Switching is also
    /// cheaper — no dictionary allocation at first use — and adding a locale is still a
    /// one-line change, which was the whole point of the registry.
    static func normalizer(for locale: String) -> (any PhoneticNormalizer)? {
        switch normalizedLocaleKey(locale) {
        case "zh": return PinyinNormalizer.shared
        // Future: case "en": return MetaphoneNormalizer.shared
        //         case "ja": return KanaNormalizer.shared
        default:   return nil
        }
    }

    /// "zh-Hans", "zh_CN", "zh-Hant" → "zh". Keeps the DB `locale` column coarse so
    /// a user switching between Simplified/Traditional keyboards doesn't fragment
    /// their learned dictionary into disjoint buckets.
    static func normalizedLocaleKey(_ locale: String) -> String {
        let lower = locale.lowercased()
        guard let base = lower.split(whereSeparator: { $0 == "-" || $0 == "_" }).first else {
            return lower
        }
        return String(base)
    }
}

// MARK: - Chinese (pinyin)

/// Chinese phonetic key = toneless, space-collapsed pinyin.
///
/// Uses Foundation's `CFStringTransform` (`kCFStringTransformMandarinLatin`, then
/// `kCFStringTransformStripDiacritics` to drop tone marks) rather than bundling a
/// pinyin table: it ships with the OS, needs no extra resource, and dropping tones is
/// exactly what we want here — ASR homophone confusion is overwhelmingly *within* a
/// syllable across tones ("shan" vs "san" is the interesting axis; "shān" vs "shàn"
/// distinctions would only make near-misses fail to collapse).
///
/// Non-Han characters (Latin, digits) are passed through lowercased, so a mixed term
/// like "iPhone手机" still produces a stable, comparable key.
struct PinyinNormalizer: PhoneticNormalizer {
    static let shared = PinyinNormalizer()

    let locale = "zh"

    func normalize(_ text: String) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "" }

        let mutable = NSMutableString(string: trimmed) as CFMutableString
        // Han → Latin with tone marks, then strip the tone marks.
        CFStringTransform(mutable, nil, kCFStringTransformMandarinLatin, false)
        CFStringTransform(mutable, nil, kCFStringTransformStripDiacritics, false)

        let latin = (mutable as String).lowercased()
        // Collapse the whitespace CFStringTransform inserts between syllables so
        // "zhang san" and "zhangsan" hash to the same key.
        let syllables = latin.split(whereSeparator: { $0 == " " || $0 == "\t" || $0 == "\n" })
        return syllables.joined()
    }

    /// Similarity in [0, 1] between two phonetic keys — used by the recorder to tell
    /// an ASR homophone fix apart from a genuine content rewrite (design §3.2/§5).
    /// Normalized Levenshtein over the phonetic keys: identical keys → 1.0.
    static func similarity(_ a: String, _ b: String) -> Double {
        if a.isEmpty && b.isEmpty { return 1.0 }
        if a.isEmpty || b.isEmpty { return 0.0 }
        if a == b { return 1.0 }
        let distance = levenshtein(Array(a), Array(b))
        let longest = max(a.count, b.count)
        return 1.0 - (Double(distance) / Double(longest))
    }

    /// Plain Levenshtein edit distance (two-row DP — we only ever need the previous row).
    static func levenshtein(_ a: [Character], _ b: [Character]) -> Int {
        if a.isEmpty { return b.count }
        if b.isEmpty { return a.count }
        var previous = Array(0...b.count)
        var current = [Int](repeating: 0, count: b.count + 1)
        for i in 1...a.count {
            current[0] = i
            for j in 1...b.count {
                let substitution = previous[j - 1] + (a[i - 1] == b[j - 1] ? 0 : 1)
                current[j] = min(previous[j] + 1,      // deletion
                                 current[j - 1] + 1,   // insertion
                                 substitution)
            }
            swap(&previous, &current)
        }
        return previous[b.count]
    }
}
