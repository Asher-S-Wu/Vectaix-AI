import Foundation

/// Pure text-diff helpers for voice correction, split out of `VoiceCorrectionEngine`.
///
/// The engine itself depends on the provider stack (it calls an LLM), which would drag half
/// the app into any target that wants to unit-test the diff logic. These functions are pure
/// string math with no such dependency, so they live here and the unit tests can compile
/// them on their own.
enum VoiceCorrectionDiff {

    // MARK: - Diff helpers

    /// Share of characters that changed, by Levenshtein over the raw text.
    static func charChangeRatio(from: String, to: String) -> Double {
        if from.isEmpty && to.isEmpty { return 0 }
        let distance = PinyinNormalizer.levenshtein(Array(from), Array(to))
        return Double(distance) / Double(max(from.count, to.count, 1))
    }

    /// The substitutions between two texts, as (was, became) pairs — this is what the UI
    /// shows ("张山→张三") and what attributes negative feedback to a dictionary row (§15.3.4).
    ///
    /// Deliberately CHARACTER-level, not token-level. Token alignment looked like the
    /// obvious choice, but it breaks on the exact case this feature exists for. Measured
    /// on device:
    ///
    ///     "张山说食堂今天关门"  → jieba: ["张山", "说", "食堂", ...]
    ///     "张三说食堂今天关门"  → jieba: ["张三说",      "食堂", ...]
    ///
    /// Fixing the name changed how jieba segments its *neighbour* — so the LCS emits
    /// `replace(old: ["张山","说"], new: ["张三说"])`, a 2-for-1 that any "1-for-1 only"
    /// filter silently discards, and the summary comes back empty even though the
    /// correction was applied. Re-segmentation after a substitution is the norm here, not
    /// an edge case, so aligning on tokens is simply the wrong primitive.
    ///
    /// Characters don't have this problem: we LCS the characters, then re-group each
    /// contiguous run of changes into one pair. Runs whose two sides are wildly different
    /// in length are dropped — those are rewrites, not homophone swaps, and there's no
    /// dictionary row they'd correspond to.
    /// A raw character diff finds the *minimal* edit, which is technically right but
    /// useless to read: "张山"→"张三" minimally reduces to `山→三`, and a user shown
    /// "山→三" has no idea what was corrected. So after diffing characters we widen each
    /// change run out to the word that contains it (using the ORIGINAL text's
    /// segmentation, which is the one the user's transcript actually has), yielding
    /// `张山→张三` — word-level for humans, character-level under the hood so it survives
    /// the re-segmentation described above.
    /// [T-correction-diff-wordlevel] Word-LEVEL alignment. Both texts are
    /// segmented into tokens (jieba), and the LCS runs over the TOKEN sequences.
    /// Each `.replace(oldTokens, newTokens)` becomes exactly one pair —
    /// `oldTokens.joined → newTokens.joined` — so a changed word maps to its
    /// replacement *as a whole*, with no character-level fragment stitching.
    ///
    /// Why this replaces the earlier char-LCS + word-widening:
    ///   • `MediaS`(1 token) → `Media Server`(2 tokens) is a clean
    ///     `replace(["MediaS"], ["Media","Server"])` → `MediaS→Media Server`.
    ///     The old char-LCS matched every letter of "MediaS" inside "Media
    ///     Server", producing scattered inserts whose "became" side padded into
    ///     the neighbouring word (`开发→erver开发`) — wrong content, and a
    ///     false-positive on adjacent punctuation inserts (`滚动条→、滚动条`).
    ///   • Token-level insert / delete (a whole word added or removed) is
    ///     content editing, NOT a homophone/abbreviation of an existing word, so
    ///     it yields NO pair — killing that class of false positive by design.
    ///   • The re-segmentation case that motivated char-level diffing
    ///     ("张山|说" → "张三说") still works: LCS over tokens sees
    ///     `replace(["张山","说"], ["张三说"])` → `张山说→张三说`, a valid pair
    ///     the downstream phonetic check accepts. No token is silently dropped.
    static func tokenPairs(from: String, to: String) -> [(from: String, to: String)] {
        let aTokens = TextSegmenter.shared.segment(from)
        let bTokens = TextSegmenter.shared.segment(to)
        guard !aTokens.isEmpty || !bTokens.isEmpty else { return [] }

        var pairs: [(from: String, to: String)] = []
        for op in LCSDiff.diff(aTokens, bTokens) {
            guard case .replace(let old, let new) = op else { continue }
            let was = joinTokens(old)
            let became = joinTokens(new)
            guard !was.isEmpty, !became.isEmpty, was != became else { continue }
            // [T-correction-admission-multisignal] Loose sanity cap only — the
            // real "homophone vs rewrite / acronym / digit" judgement is
            // CorrectionAdmission's, applied per-pair by the recorder. A cap
            // keeps a pathological many-token replace from ballooning into a
            // whole-clause span (which admission would reject as too_global
            // anyway); the real decision is one layer up.
            let ratio = Double(max(was.count, became.count)) / Double(max(1, min(was.count, became.count)))
            guard ratio <= 8.0 else { continue }
            pairs.append((from: was, to: became))
        }
        return pairs
    }

    /// Join tokens back into a readable span. Latin tokens are space-joined
    /// ("Media" + "Server" → "Media Server"); CJK/punctuation tokens abut with
    /// no separator ("张三" + "说" → "张三说"). Mixed runs put a space only
    /// between two Latin/digit tokens, matching how the source text reads.
    private static func joinTokens(_ tokens: [String]) -> String {
        var out = ""
        for token in tokens {
            if !out.isEmpty,
               let last = out.last, let first = token.first,
               isLatinOrDigit(last), isLatinOrDigit(first) {
                out.append(" ")
            }
            out.append(token)
        }
        return out
    }

    private static func isLatinOrDigit(_ c: Character) -> Bool {
        c.isASCII && (c.isLetter || c.isNumber)
    }
}

// MARK: - LCS token diff

/// Token-level LCS diff (design §5). Used both by the recorder (to learn from a manual
/// edit) and by the engine (to summarise what the model changed).
enum LCSDiff {
    enum Op: Equatable {
        case equal([String])
        case replace(old: [String], new: [String])
        case insert([String])
        case delete([String])
    }

    static func diff(_ a: [String], _ b: [String]) -> [Op] {
        // Classic LCS table. Transcripts are sentence-sized, so O(n·m) is fine here — and
        // it runs off the main actor anyway (§12.6).
        let n = a.count, m = b.count
        if n == 0 && m == 0 { return [] }
        if n == 0 { return [.insert(b)] }
        if m == 0 { return [.delete(a)] }

        var lengths = Array(repeating: Array(repeating: 0, count: m + 1), count: n + 1)
        for i in stride(from: n - 1, through: 0, by: -1) {
            for j in stride(from: m - 1, through: 0, by: -1) {
                lengths[i][j] = a[i] == b[j]
                    ? lengths[i + 1][j + 1] + 1
                    : max(lengths[i + 1][j], lengths[i][j + 1])
            }
        }

        var ops: [Op] = []
        var i = 0, j = 0
        var pendingOld: [String] = [], pendingNew: [String] = [], pendingEqual: [String] = []

        func flushChanges() {
            guard !pendingOld.isEmpty || !pendingNew.isEmpty else { return }
            if !pendingOld.isEmpty && !pendingNew.isEmpty {
                ops.append(.replace(old: pendingOld, new: pendingNew))
            } else if !pendingOld.isEmpty {
                ops.append(.delete(pendingOld))
            } else {
                ops.append(.insert(pendingNew))
            }
            pendingOld = []; pendingNew = []
        }
        func flushEqual() {
            guard !pendingEqual.isEmpty else { return }
            ops.append(.equal(pendingEqual)); pendingEqual = []
        }

        while i < n && j < m {
            if a[i] == b[j] {
                flushChanges()
                pendingEqual.append(a[i]); i += 1; j += 1
            } else {
                flushEqual()
                if lengths[i + 1][j] >= lengths[i][j + 1] {
                    pendingOld.append(a[i]); i += 1
                } else {
                    pendingNew.append(b[j]); j += 1
                }
            }
        }
        flushEqual()
        while i < n { pendingOld.append(a[i]); i += 1 }
        while j < m { pendingNew.append(b[j]); j += 1 }
        flushChanges()
        return ops
    }
}


