import Foundation

/// Lightweight punctuation-based sentence splitting. Pure rules, no third-party
/// dependency (design §9).
///
/// The terminator set is defined ONCE here and reused by everything that needs to
/// reason about sentence boundaries — the edit-diff pass (design §5), and the
/// conversation-context truncator's "extend to the next punctuation" rule
/// (design §6). Keeping a single definition is deliberate: the design explicitly
/// says the truncator must use the same terminators as the splitter rather than
/// inventing a second set.
enum SentenceSplitter {

    /// Sentence-terminating punctuation, CJK + ASCII. Semicolons count as
    /// terminators (design §6 lists 。！？；.!?; ).
    static let terminators: Set<Character> = [
        "。", "！", "？", "；", "…",
        ".", "!", "?", ";",
    ]

    static func isTerminator(_ c: Character) -> Bool { terminators.contains(c) }

    /// Split `text` into sentences, keeping each sentence's trailing punctuation.
    /// Whitespace-only fragments are dropped. Text with no terminator at all comes
    /// back as a single sentence (not an empty array), so callers always have
    /// something to diff.
    static func split(_ text: String) -> [String] {
        var sentences: [String] = []
        var current = ""
        for ch in text {
            current.append(ch)
            if isTerminator(ch) {
                let trimmed = current.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty { sentences.append(trimmed) }
                current = ""
            }
        }
        let tail = current.trimmingCharacters(in: .whitespacesAndNewlines)
        if !tail.isEmpty { sentences.append(tail) }
        return sentences
    }
}
