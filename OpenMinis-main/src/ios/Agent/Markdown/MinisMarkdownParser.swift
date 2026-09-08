import Foundation
import cmark_gfm
import cmark_gfm_extensions

// MARK: - Block & Inline Node types (inlined from swift-markdown-ui)

enum BlockNode: Hashable {
    case blockquote(children: [BlockNode])
    case bulletedList(isTight: Bool, items: [RawListItem])
    case numberedList(isTight: Bool, start: Int, items: [RawListItem])
    case taskList(isTight: Bool, items: [RawTaskListItem])
    case codeBlock(fenceInfo: String?, content: String)
    case htmlBlock(content: String)
    case paragraph(content: [InlineNode])
    case heading(level: Int, content: [InlineNode])
    case table(columnAlignments: [RawTableColumnAlignment], rows: [RawTableRow])
    case thematicBreak
    case mathBlock(content: String)
}

extension BlockNode {
    var children: [BlockNode] {
        switch self {
        case .blockquote(let children):
            return children
        case .bulletedList(_, let items):
            return items.map(\.children).flatMap { $0 }
        case .numberedList(_, _, let items):
            return items.map(\.children).flatMap { $0 }
        case .taskList(_, let items):
            return items.map(\.children).flatMap { $0 }
        default:
            return []
        }
    }

    var isParagraph: Bool {
        guard case .paragraph = self else { return false }
        return true
    }
}

struct RawListItem: Hashable {
    let children: [BlockNode]
}

struct RawTaskListItem: Hashable {
    let isCompleted: Bool
    let children: [BlockNode]
}

enum RawTableColumnAlignment: Character {
    case none = "\0"
    case left = "l"
    case center = "c"
    case right = "r"
}

struct RawTableRow: Hashable {
    let cells: [RawTableCell]
}

struct RawTableCell: Hashable {
    let content: [InlineNode]
}

enum InlineNode: Hashable, Sendable {
    case text(String)
    case softBreak
    case lineBreak
    case code(String)
    case html(String)
    case emphasis(children: [InlineNode])
    case strong(children: [InlineNode])
    case strikethrough(children: [InlineNode])
    case link(destination: String, children: [InlineNode])
    case image(source: String, children: [InlineNode])
    case inlineMath(String)
}

extension InlineNode {
    var children: [InlineNode] {
        get {
            switch self {
            case .emphasis(let children): return children
            case .strong(let children): return children
            case .strikethrough(let children): return children
            case .link(_, let children): return children
            case .image(_, let children): return children
            case .inlineMath: return []
            default: return []
            }
        }
        set {
            switch self {
            case .emphasis: self = .emphasis(children: newValue)
            case .strong: self = .strong(children: newValue)
            case .strikethrough: self = .strikethrough(children: newValue)
            case .link(let destination, _): self = .link(destination: destination, children: newValue)
            case .image(let source, _): self = .image(source: source, children: newValue)
            default: break
            }
        }
    }
}

// MARK: - MarkdownContent (minimal replacement for MarkdownUI.MarkdownContent)

struct MarkdownContent: Hashable {
    let blocks: [BlockNode]

    init(_ markdown: String) {
        let (cleaned, mathSpans) = MarkdownMathExtractor.extract(from: markdown)
        let parsed = [BlockNode](markdown: cleaned)
        if mathSpans.isEmpty {
            self.blocks = parsed
        } else {
            self.blocks = MarkdownMathExtractor.restore(blocks: parsed, spans: mathSpans)
        }
    }

    init(blocks: [BlockNode]) {
        self.blocks = blocks
    }
}

// MARK: - Math Extraction

/// Extracts LaTeX math from markdown before cmark parsing, then restores math nodes in the AST.
enum MarkdownMathExtractor {
    struct MathSpan {
        let placeholder: String
        let latex: String
        let isBlock: Bool
    }

    /// Extract math expressions, replacing them with placeholders.
    /// Returns the cleaned markdown and the list of extracted spans.
    static func extract(from markdown: String) -> (String, [MathSpan]) {
        var spans: [MathSpan] = []
        var result = ""
        let chars = Array(markdown)
        let count = chars.count
        var i = 0

        // [issue #117-3] Positions that live inside a fenced block or an inline
        // code span. The main loop below already refuses to *open* a formula
        // inside code, but the closing-delimiter searches used to be blind
        // scans: one bare `$$` in prose would happily pair with a `$$` sitting
        // inside a later ``` fence and swallow every paragraph in between —
        // including the fence's own opening line, which then left the closing
        // ``` to start a *new* fence and turn the rest of the document into a
        // code block. Precomputing the mask once keeps the searches O(n) and
        // lets every finder reject a closer that isn't in the same plain-text
        // region as its opener.
        let codeMask = buildCodeMask(chars: chars)

        // Track code fences and inline code to skip them
        var inFencedCode = false
        var fenceChar: Character = "`"
        var fenceLen = 0

        while i < count {
            // Check for fenced code blocks (``` or ~~~)
            if !inFencedCode && (i == 0 || chars[i - 1] == "\n" || (i > 0 && chars[i - 1] == "\r")) {
                let fc = chars[i]
                if fc == "`" || fc == "~" {
                    var fl = 0
                    var j = i
                    while j < count && chars[j] == fc { fl += 1; j += 1 }
                    if fl >= 3 {
                        inFencedCode = true
                        fenceChar = fc
                        fenceLen = fl
                        // Copy the fence line
                        while i < count && chars[i] != "\n" {
                            result.append(chars[i]); i += 1
                        }
                        if i < count { result.append(chars[i]); i += 1 } // newline
                        continue
                    }
                }
            }

            if inFencedCode {
                // Look for closing fence
                if (i == 0 || chars[i - 1] == "\n") && chars[i] == fenceChar {
                    var fl = 0
                    var j = i
                    while j < count && chars[j] == fenceChar { fl += 1; j += 1 }
                    if fl >= fenceLen {
                        inFencedCode = false
                        // Copy through the rest of the fence line
                        while i < count && chars[i] != "\n" {
                            result.append(chars[i]); i += 1
                        }
                        if i < count { result.append(chars[i]); i += 1 }
                        continue
                    }
                }
                result.append(chars[i]); i += 1
                continue
            }

            // Skip inline code spans
            if chars[i] == "`" {
                var backtickLen = 0
                var j = i
                while j < count && chars[j] == "`" { backtickLen += 1; j += 1 }
                // Find matching closing backticks
                var found = false
                var k = j
                while k <= count - backtickLen {
                    var matchLen = 0
                    while k + matchLen < count && chars[k + matchLen] == "`" { matchLen += 1 }
                    if matchLen == backtickLen {
                        // Copy everything from i through k + matchLen - 1
                        for idx in i..<(k + matchLen) {
                            result.append(chars[idx])
                        }
                        i = k + matchLen
                        found = true
                        break
                    }
                    if matchLen > 0 { k += matchLen } else { k += 1 }
                }
                if found { continue }
                // No matching close — just output the backticks
                for idx in i..<j { result.append(chars[idx]) }
                i = j
                continue
            }

            // Escaped dollar sign
            if chars[i] == "\\" && i + 1 < count && chars[i + 1] == "$" {
                result.append(chars[i]); result.append(chars[i + 1])
                i += 2
                continue
            }

            // Check for \[ ... \] (display math)
            if chars[i] == "\\" && i + 1 < count && chars[i + 1] == "[" {
                if let end = findClosingBracket(chars: chars, from: i + 2, close: "\\]", codeMask: codeMask) {
                    let latex = stripBlockquoteMarkers(String(chars[(i + 2)..<end]))
                    let placeholder = "\u{FFFC}MATH\(spans.count)\u{FFFC}"
                    spans.append(MathSpan(placeholder: placeholder, latex: latex, isBlock: true))
                    result.append(placeholder)
                    i = end + 2 // skip past \]
                    continue
                }
            }

            // Check for \( ... \) (inline math)
            if chars[i] == "\\" && i + 1 < count && chars[i + 1] == "(" {
                if let end = findClosingBracket(chars: chars, from: i + 2, close: "\\)", codeMask: codeMask) {
                    let latex = String(chars[(i + 2)..<end])
                    let placeholder = "\u{FFFC}MATH\(spans.count)\u{FFFC}"
                    spans.append(MathSpan(placeholder: placeholder, latex: latex, isBlock: false))
                    result.append(placeholder)
                    i = end + 2
                    continue
                }
            }

            // Check for $$ ... $$ (display math)
            if chars[i] == "$" && i + 1 < count && chars[i + 1] == "$" {
                if let end = findDoubleDollar(chars: chars, from: i + 2, codeMask: codeMask) {
                    let latex = stripBlockquoteMarkers(String(chars[(i + 2)..<end]))
                    // [issue #117-3] A model that forgets to close `$$`, or prose
                    // that merely mentions `$$`, used to pair with whatever `$$`
                    // came next and swallow the paragraphs in between into one
                    // giant "formula" that fails to parse and renders as an
                    // unbounded wall of text. Display math is legitimately
                    // multi-line, so we can't just ban newlines — instead
                    // require the captured body to still look like a formula.
                    if isPlausibleDisplayMath(latex) {
                        let placeholder = "\u{FFFC}MATH\(spans.count)\u{FFFC}"
                        spans.append(MathSpan(placeholder: placeholder, latex: latex, isBlock: true))
                        result.append(placeholder)
                        i = end + 2
                        continue
                    }
                }
            }

            // Check for $ ... $ (inline math)
            if chars[i] == "$" && i + 1 < count && chars[i + 1] != "$" && chars[i + 1] != " " {
                if let end = findSingleDollar(chars: chars, from: i + 1, codeMask: codeMask) {
                    let latex = String(chars[(i + 1)..<end])
                    // Heuristic: skip plain currency like $5, $10.
                    // [T-ios-table-cell-katex-false-positive] Also skip a span
                    // that is really a table-cell artifact: a row like
                    // `| 月付 | $20|$ **3** |` lets the `$` at `$20` pair with a
                    // later `$` and capture `20|` (a number + the column pipe)
                    // as a fake formula — rendered serif-italic with the bold
                    // `**3**` lost. See isTablePipeArtifact for the rule
                    // (whitespace-adjacent or unbalanced bars), which preserves
                    // real absolute-value formulas like $|x|$ / $\|v\|$.
                    if looksLikeMath(latex) && !isTablePipeArtifact(latex) {
                        let placeholder = "\u{FFFC}MATH\(spans.count)\u{FFFC}"
                        spans.append(MathSpan(placeholder: placeholder, latex: latex, isBlock: false))
                        result.append(placeholder)
                        i = end + 1
                        continue
                    }
                }
            }

            result.append(chars[i])
            i += 1
        }

        return (result, spans)
    }

    /// Restore math nodes in the parsed AST by replacing placeholder text nodes.
    static func restore(blocks: [BlockNode], spans: [MathSpan]) -> [BlockNode] {
        let placeholderMap = Dictionary(uniqueKeysWithValues: spans.map { ($0.placeholder, $0) })
        return blocks.map { restoreBlock($0, placeholderMap: placeholderMap) }
    }

    // MARK: - Private Helpers

    /// Strip blockquote markers from a multi-line math body.
    ///
    /// Math is extracted before block-level parsing, so a display formula
    /// written inside a blockquote carries the continuation lines' `> `
    /// markers straight into the LaTeX string:
    ///
    ///     > $$
    ///     > E = mc^2
    ///     > $$
    ///
    /// used to yield latex `"\n> E = mc^2\n> "` and render a literal `>`.
    /// Only strip when *every* non-blank line after the first carries a
    /// `^ {0,3}> ?` marker — that proves the whole span really sits inside a
    /// quote, and protects legitimate formula content that merely starts a
    /// line with `>` (comparison / matrix rows).
    /// Single-line spans contain no newline and return untouched.
    static func stripBlockquoteMarkers(_ latex: String) -> String {
        guard latex.contains("\n") else { return latex }

        // The opening `$$`/`\[` is consumed by the caller, so the first
        // segment is the remainder of the marker line and never carries a
        // marker of its own — validate and strip only lines 2…n.
        var lines = latex.components(separatedBy: "\n")
        var sawMarker = false
        for idx in 1..<lines.count {
            let line = lines[idx]
            var cursor = line.startIndex
            var spaces = 0
            while cursor < line.endIndex, line[cursor] == " ", spaces < 3 {
                cursor = line.index(after: cursor)
                spaces += 1
            }
            guard cursor < line.endIndex else { continue } // blank line: neutral
            guard line[cursor] == ">" else { return latex } // a bare line — not a quote
            sawMarker = true
            cursor = line.index(after: cursor)
            if cursor < line.endIndex, line[cursor] == " " { cursor = line.index(after: cursor) }
            lines[idx] = String(line[cursor...])
        }
        guard sawMarker else { return latex }
        return lines.joined(separator: "\n")
    }

    /// [issue #117-3] Mark every character that sits inside a fenced code block
    /// or an inline code span, so closing-delimiter searches can refuse to pair
    /// across a code boundary.
    ///
    /// The scan mirrors the fence / backtick handling in `extract` exactly —
    /// same "fence must start a line and be >= 3 chars" rule, same
    /// "closing run must be at least as long as the opening run" rule, same
    /// backtick-run matching for inline spans — so a delimiter the main loop
    /// considers "inside code" is precisely the one this mask marks. Fence
    /// lines and the backticks themselves are marked too: a `$$` fused to a
    /// fence marker belongs to the code region either way.
    private static func buildCodeMask(chars: [Character]) -> [Bool] {
        let count = chars.count
        var mask = [Bool](repeating: false, count: count)
        var i = 0
        var inFencedCode = false
        var fenceChar: Character = "`"
        var fenceLen = 0

        while i < count {
            let atLineStart = (i == 0 || chars[i - 1] == "\n" || chars[i - 1] == "\r")

            if !inFencedCode && atLineStart && (chars[i] == "`" || chars[i] == "~") {
                let fc = chars[i]
                var fl = 0
                var j = i
                while j < count && chars[j] == fc { fl += 1; j += 1 }
                if fl >= 3 {
                    inFencedCode = true
                    fenceChar = fc
                    fenceLen = fl
                    while i < count && chars[i] != "\n" { mask[i] = true; i += 1 }
                    if i < count { mask[i] = true; i += 1 }
                    continue
                }
            }

            if inFencedCode {
                if atLineStart && chars[i] == fenceChar {
                    var fl = 0
                    var j = i
                    while j < count && chars[j] == fenceChar { fl += 1; j += 1 }
                    if fl >= fenceLen {
                        inFencedCode = false
                        while i < count && chars[i] != "\n" { mask[i] = true; i += 1 }
                        if i < count { mask[i] = true; i += 1 }
                        continue
                    }
                }
                mask[i] = true
                i += 1
                continue
            }

            if chars[i] == "`" {
                var backtickLen = 0
                var j = i
                while j < count && chars[j] == "`" { backtickLen += 1; j += 1 }
                var found = false
                var k = j
                while k <= count - backtickLen {
                    var matchLen = 0
                    while k + matchLen < count && chars[k + matchLen] == "`" { matchLen += 1 }
                    if matchLen == backtickLen {
                        for idx in i..<(k + matchLen) { mask[idx] = true }
                        i = k + matchLen
                        found = true
                        break
                    }
                    if matchLen > 0 { k += matchLen } else { k += 1 }
                }
                if found { continue }
                // Unmatched backtick run: not a code span, leave it unmasked.
                i = j
                continue
            }

            i += 1
        }
        return mask
    }

    private static func findClosingBracket(chars: [Character], from start: Int, close: String, codeMask: [Bool]) -> Int? {
        let closeChars = Array(close)
        var i = start
        while i <= chars.count - closeChars.count {
            var match = true
            for j in 0..<closeChars.count {
                if chars[i + j] != closeChars[j] { match = false; break }
            }
            if match && !codeMask[i] { return i }
            i += 1
        }
        return nil
    }

    private static func findDoubleDollar(chars: [Character], from start: Int, codeMask: [Bool]) -> Int? {
        var i = start
        while i < chars.count - 1 {
            if chars[i] == "$" && chars[i + 1] == "$" && !codeMask[i] { return i }
            i += 1
        }
        return nil
    }

    private static func findSingleDollar(chars: [Character], from start: Int, codeMask: [Bool]) -> Int? {
        var i = start
        while i < chars.count {
            if chars[i] == "\\" && i + 1 < chars.count { i += 2; continue } // skip escaped
            if chars[i] == "$" && (i == 0 || chars[i - 1] != " ") && !codeMask[i] { return i }
            if chars[i] == "\n" { return nil } // single-line only
            i += 1
        }
        return nil
    }

    /// [issue #117-3] Guard against a `$$` opener pairing with a far-away `$$`
    /// and capturing prose. Only applied to the multi-line case: a single-line
    /// `$$…$$` is unambiguous and always accepted, so ordinary formulas — the
    /// overwhelming majority — are untouched by this rule.
    ///
    /// A real multi-line display formula is dense with LaTeX machinery
    /// (`\frac`, `\begin{aligned}`, `^`, `_`, `&`, `\\`), while a runaway
    /// capture is mostly sentences and blank lines. Two cheap signals separate
    /// them: a blank line means a paragraph break (never valid *inside* one
    /// formula), and the body must carry at least one LaTeX glyph.
    private static func isPlausibleDisplayMath(_ content: String) -> Bool {
        guard content.contains("\n") else { return true } // single-line: always fine

        // An *interior* blank line is a paragraph break — a formula never spans
        // one. The newlines hugging the delimiters in the conventional
        //     $$
        //     E = mc^2
        //     $$
        // layout are not blank lines in this sense, so trim the edges first.
        let body = content.trimmingCharacters(in: .whitespacesAndNewlines)
        if body.isEmpty { return false }
        let hasBlankLine = body
            .components(separatedBy: "\n")
            .contains { $0.trimmingCharacters(in: .whitespaces).isEmpty }
        if hasBlankLine { return false }

        let latexGlyphs: Set<Character> = ["\\", "^", "_", "{", "}", "&", "=", "∫", "∑", "∏", "√"]
        return content.contains { latexGlyphs.contains($0) }
    }

    /// Heuristic: content looks like LaTeX rather than prose or currency.
    ///
    /// [issue #117-1] The old rule was "has a math glyph, or is longer than 2
    /// characters", which rejected the single- and double-letter variables that
    /// dominate real math (`$x$`, `$n$`, `$xy$`) — the literal dollar-wrapped
    /// text then leaked into the rendered output. Ported from the Android
    /// T208 fix (`MarkdownParser.kt`) so both platforms accept the same spans.
    private static func looksLikeMath(_ content: String) -> Bool {
        if content.isEmpty { return false }
        let mathChars: Set<Character> = ["\\", "^", "_", "{", "}", "∫", "∑", "∏", "√", "+", "-", "=", "<", ">"]
        for ch in content {
            if mathChars.contains(ch) { return true }
        }
        // Currency heuristic: `$5`, `$5.99`, `$1,000` lead with a digit. Skip.
        guard let first = content.first, let last = content.last else { return false }
        if first.isNumber { return false }
        if first.isWhitespace || last.isWhitespace { return false }
        // Short, unbroken alphanumeric runs are variables: `x`, `n`, `xy`, `R_0`.
        if content.count <= 30 && content.allSatisfy({ $0.isLetter || $0.isNumber }) { return true }
        return content.count > 2
    }

    /// [T-ios-table-cell-katex-false-positive] True when a candidate inline-math
    /// span is really a markdown table-cell artifact (a `$` that paired across
    /// `|` column separators) rather than a formula. Two signals, both of which
    /// a real formula avoids:
    ///   1. An unescaped pipe with whitespace on a side — the table column
    ///      separator is written ` | ` / `| ` / ` |`. Real LaTeX keeps pipes
    ///      flush against operands.
    ///   2. An ODD number of unescaped pipes — absolute-value / norm bars always
    ///      come in balanced pairs (`|x|`, `\frac{|a|}{|b|}`), so an odd count
    ///      (e.g. `20|`, `240|`) is a stray column separator, not math.
    /// Escaped `\|` (LaTeX norm) is never counted as a bare pipe.
    private static func isTablePipeArtifact(_ content: String) -> Bool {
        let chars = Array(content)
        var bareCount = 0
        for (idx, ch) in chars.enumerated() where ch == "|" {
            if idx > 0 && chars[idx - 1] == "\\" { continue }   // escaped norm bar
            bareCount += 1
            let prevIsSpace = idx > 0 && chars[idx - 1].isWhitespace
            let nextIsSpace = idx + 1 < chars.count && chars[idx + 1].isWhitespace
            if prevIsSpace || nextIsSpace { return true }
        }
        return bareCount % 2 == 1
    }

    private static func restoreBlock(_ block: BlockNode, placeholderMap: [String: MathSpan]) -> BlockNode {
        switch block {
        case .paragraph(let content):
            let restored = restoreInlines(content, placeholderMap: placeholderMap)
            // If paragraph contains only a single block-math placeholder, promote to mathBlock
            if restored.count == 1, case .inlineMath(let latex) = restored[0] {
                if let span = placeholderMap.values.first(where: { $0.latex == latex && $0.isBlock }) {
                    return .mathBlock(content: span.latex)
                }
            }
            // Check for mathBlock in a paragraph that has only whitespace + the math
            let nonWhitespace = restored.filter {
                switch $0 {
                case .text(let t): return !t.trimmingCharacters(in: .whitespaces).isEmpty
                case .softBreak, .lineBreak: return false
                default: return true
                }
            }
            if nonWhitespace.count == 1, case .inlineMath(let latex) = nonWhitespace[0] {
                if let span = placeholderMap.values.first(where: { $0.latex == latex && $0.isBlock }) {
                    return .mathBlock(content: span.latex)
                }
            }
            return .paragraph(content: restored)
        case .heading(let level, let content):
            return .heading(level: level, content: restoreInlines(content, placeholderMap: placeholderMap))
        case .blockquote(let children):
            return .blockquote(children: children.map { restoreBlock($0, placeholderMap: placeholderMap) })
        case .bulletedList(let isTight, let items):
            return .bulletedList(isTight: isTight, items: items.map {
                RawListItem(children: $0.children.map { restoreBlock($0, placeholderMap: placeholderMap) })
            })
        case .numberedList(let isTight, let start, let items):
            return .numberedList(isTight: isTight, start: start, items: items.map {
                RawListItem(children: $0.children.map { restoreBlock($0, placeholderMap: placeholderMap) })
            })
        case .taskList(let isTight, let items):
            return .taskList(isTight: isTight, items: items.map {
                RawTaskListItem(isCompleted: $0.isCompleted, children: $0.children.map { restoreBlock($0, placeholderMap: placeholderMap) })
            })
        case .table(let alignments, let rows):
            return .table(columnAlignments: alignments, rows: rows.map { row in
                RawTableRow(cells: row.cells.map { cell in
                    RawTableCell(content: restoreInlines(cell.content, placeholderMap: placeholderMap))
                })
            })
        default:
            return block
        }
    }

    private static func restoreInlines(_ inlines: [InlineNode], placeholderMap: [String: MathSpan]) -> [InlineNode] {
        inlines.flatMap { restoreInline($0, placeholderMap: placeholderMap) }
    }

    private static func restoreInline(_ node: InlineNode, placeholderMap: [String: MathSpan]) -> [InlineNode] {
        switch node {
        case .text(let text):
            return splitTextWithPlaceholders(text, placeholderMap: placeholderMap)
        case .emphasis(let children):
            return [.emphasis(children: children.flatMap { restoreInline($0, placeholderMap: placeholderMap) })]
        case .strong(let children):
            return [.strong(children: children.flatMap { restoreInline($0, placeholderMap: placeholderMap) })]
        case .strikethrough(let children):
            return [.strikethrough(children: children.flatMap { restoreInline($0, placeholderMap: placeholderMap) })]
        case .link(let dest, let children):
            return [.link(destination: dest, children: children.flatMap { restoreInline($0, placeholderMap: placeholderMap) })]
        case .image(let src, let children):
            return [.image(source: src, children: children.flatMap { restoreInline($0, placeholderMap: placeholderMap) })]
        default:
            return [node]
        }
    }

    private static func splitTextWithPlaceholders(_ text: String, placeholderMap: [String: MathSpan]) -> [InlineNode] {
        var result: [InlineNode] = []
        var remaining = text

        while !remaining.isEmpty {
            // Find the next placeholder
            var earliest: (range: Range<String.Index>, span: MathSpan)?
            for (placeholder, span) in placeholderMap {
                if let range = remaining.range(of: placeholder) {
                    if earliest == nil || range.lowerBound < earliest!.range.lowerBound {
                        earliest = (range, span)
                    }
                }
            }

            guard let match = earliest else {
                result.append(.text(remaining))
                break
            }

            // Text before the placeholder
            let before = String(remaining[remaining.startIndex..<match.range.lowerBound])
            if !before.isEmpty {
                result.append(.text(before))
            }

            // The math node
            result.append(.inlineMath(match.span.latex))

            remaining = String(remaining[match.range.upperBound...])
        }

        return result
    }
}

// MARK: - cmark parsing glue

extension Array where Element == BlockNode {
    init(markdown: String) {
        let blocks = UnsafeNode.parseMarkdown(markdown) { document in
            document.children.compactMap(BlockNode.init(unsafeNode:))
        }
        self.init(blocks ?? .init())
    }
}

extension BlockNode {
    fileprivate init?(unsafeNode: UnsafeNode) {
        switch unsafeNode.nodeType {
        case .blockquote:
            self = .blockquote(children: unsafeNode.children.compactMap(BlockNode.init(unsafeNode:)))
        case .list:
            if unsafeNode.children.contains(where: \.isTaskListItem) {
                self = .taskList(
                    isTight: unsafeNode.isTightList,
                    items: unsafeNode.children.map(RawTaskListItem.init(unsafeNode:))
                )
            } else {
                switch unsafeNode.listType {
                case CMARK_BULLET_LIST:
                    self = .bulletedList(
                        isTight: unsafeNode.isTightList,
                        items: unsafeNode.children.map(RawListItem.init(unsafeNode:))
                    )
                case CMARK_ORDERED_LIST:
                    self = .numberedList(
                        isTight: unsafeNode.isTightList,
                        start: unsafeNode.listStart,
                        items: unsafeNode.children.map(RawListItem.init(unsafeNode:))
                    )
                default:
                    fatalError("cmark reported a list node without a list type.")
                }
            }
        case .codeBlock:
            self = .codeBlock(fenceInfo: unsafeNode.fenceInfo, content: unsafeNode.literal ?? "")
        case .htmlBlock:
            self = .htmlBlock(content: unsafeNode.literal ?? "")
        case .paragraph:
            self = .paragraph(content: unsafeNode.children.compactMap(InlineNode.init(unsafeNode:)))
        case .heading:
            self = .heading(
                level: unsafeNode.headingLevel,
                content: unsafeNode.children.compactMap(InlineNode.init(unsafeNode:))
            )
        case .table:
            self = .table(
                columnAlignments: unsafeNode.tableAlignments,
                rows: unsafeNode.children.map(RawTableRow.init(unsafeNode:))
            )
        case .thematicBreak:
            self = .thematicBreak
        default:
            assertionFailure("Unhandled node type '\(unsafeNode.nodeType)' in BlockNode.")
            return nil
        }
    }
}

extension RawListItem {
    fileprivate init(unsafeNode: UnsafeNode) {
        guard unsafeNode.nodeType == .item else {
            fatalError("Expected a list item but got a '\(unsafeNode.nodeType)' instead.")
        }
        self.init(children: unsafeNode.children.compactMap(BlockNode.init(unsafeNode:)))
    }
}

extension RawTaskListItem {
    fileprivate init(unsafeNode: UnsafeNode) {
        guard unsafeNode.nodeType == .taskListItem || unsafeNode.nodeType == .item else {
            fatalError("Expected a list item but got a '\(unsafeNode.nodeType)' instead.")
        }
        self.init(
            isCompleted: unsafeNode.isTaskListItemChecked,
            children: unsafeNode.children.compactMap(BlockNode.init(unsafeNode:))
        )
    }
}

extension RawTableRow {
    fileprivate init(unsafeNode: UnsafeNode) {
        guard unsafeNode.nodeType == .tableRow || unsafeNode.nodeType == .tableHead else {
            fatalError("Expected a table row but got a '\(unsafeNode.nodeType)' instead.")
        }
        self.init(cells: unsafeNode.children.map(RawTableCell.init(unsafeNode:)))
    }
}

extension RawTableCell {
    fileprivate init(unsafeNode: UnsafeNode) {
        guard unsafeNode.nodeType == .tableCell else {
            fatalError("Expected a table cell but got a '\(unsafeNode.nodeType)' instead.")
        }
        self.init(content: unsafeNode.children.compactMap(InlineNode.init(unsafeNode:)))
    }
}

extension InlineNode {
    fileprivate init?(unsafeNode: UnsafeNode) {
        switch unsafeNode.nodeType {
        case .text: self = .text(unsafeNode.literal ?? "")
        case .softBreak: self = .softBreak
        case .lineBreak: self = .lineBreak
        case .code: self = .code(unsafeNode.literal ?? "")
        case .html: self = .html(unsafeNode.literal ?? "")
        case .emphasis:
            self = .emphasis(children: unsafeNode.children.compactMap(InlineNode.init(unsafeNode:)))
        case .strong:
            self = .strong(children: unsafeNode.children.compactMap(InlineNode.init(unsafeNode:)))
        case .strikethrough:
            self = .strikethrough(children: unsafeNode.children.compactMap(InlineNode.init(unsafeNode:)))
        case .link:
            self = .link(
                destination: unsafeNode.url ?? "",
                children: unsafeNode.children.compactMap(InlineNode.init(unsafeNode:))
            )
        case .image:
            self = .image(
                source: unsafeNode.url ?? "",
                children: unsafeNode.children.compactMap(InlineNode.init(unsafeNode:))
            )
        default:
            assertionFailure("Unhandled node type '\(unsafeNode.nodeType)' in InlineNode.")
            return nil
        }
    }
}

// MARK: - UnsafeNode helpers

private typealias UnsafeNode = UnsafeMutablePointer<cmark_node>

extension UnsafeNode {
    fileprivate var nodeType: NodeType {
        let typeString = String(cString: cmark_node_get_type_string(self))
        guard let nodeType = NodeType(rawValue: typeString) else {
            fatalError("Unknown node type '\(typeString)' found.")
        }
        return nodeType
    }

    fileprivate var children: UnsafeNodeSequence {
        .init(cmark_node_first_child(self))
    }

    fileprivate var literal: String? {
        cmark_node_get_literal(self).map(String.init(cString:))
    }

    fileprivate var url: String? {
        cmark_node_get_url(self).map(String.init(cString:))
    }

    fileprivate var isTaskListItem: Bool {
        self.nodeType == .taskListItem
    }

    fileprivate var listType: cmark_list_type {
        cmark_node_get_list_type(self)
    }

    fileprivate var listStart: Int {
        Int(cmark_node_get_list_start(self))
    }

    fileprivate var isTaskListItemChecked: Bool {
        cmark_gfm_extensions_get_tasklist_item_checked(self)
    }

    fileprivate var isTightList: Bool {
        cmark_node_get_list_tight(self) != 0
    }

    fileprivate var fenceInfo: String? {
        cmark_node_get_fence_info(self).map(String.init(cString:))
    }

    fileprivate var headingLevel: Int {
        Int(cmark_node_get_heading_level(self))
    }

    fileprivate var tableColumns: Int {
        Int(cmark_gfm_extensions_get_table_columns(self))
    }

    fileprivate var tableAlignments: [RawTableColumnAlignment] {
        (0..<self.tableColumns).map { column in
            let ascii = cmark_gfm_extensions_get_table_alignments(self)[column]
            let scalar = UnicodeScalar(ascii)
            let character = Character(scalar)
            return .init(rawValue: character) ?? .none
        }
    }

    fileprivate static func parseMarkdown<ResultType>(
        _ markdown: String,
        body: (UnsafeNode) throws -> ResultType
    ) rethrows -> ResultType? {
        cmark_gfm_core_extensions_ensure_registered()

        // [T-strikethrough-syntax] Require a DOUBLE tilde for strikethrough.
        // cmark-gfm's strikethrough extension accepts a SINGLE `~` as a
        // delimiter by default, so prose using `~` as a range separator
        // (e.g. "msg 41797~42810", "6月14日~6月16日") was incorrectly struck
        // through. CMARK_OPT_STRIKETHROUGH_DOUBLE_TILDE makes only `~~text~~`
        // trigger strikethrough; a lone `~` stays literal — matching GFM.
        let parser = cmark_parser_new(CMARK_OPT_DEFAULT | CMARK_OPT_STRIKETHROUGH_DOUBLE_TILDE)
        defer { cmark_parser_free(parser) }

        let extensionNames: Set<String>

        if #available(iOS 16.0, macOS 13.0, tvOS 16.0, watchOS 9.0, *) {
            extensionNames = ["autolink", "strikethrough", "tagfilter", "tasklist", "table"]
        } else {
            extensionNames = ["autolink", "strikethrough", "tagfilter", "tasklist"]
        }

        for extensionName in extensionNames {
            guard let syntaxExtension = cmark_find_syntax_extension(extensionName) else {
                continue
            }
            cmark_parser_attach_syntax_extension(parser, syntaxExtension)
        }

        cmark_parser_feed(parser, markdown, markdown.utf8.count)

        guard let document = cmark_parser_finish(parser) else {
            return nil
        }

        defer { cmark_node_free(document) }
        return try body(document)
    }
}

// MARK: - NodeType enum

private enum NodeType: String {
    case document
    case blockquote = "block_quote"
    case list
    case item
    case codeBlock = "code_block"
    case htmlBlock = "html_block"
    case customBlock = "custom_block"
    case paragraph
    case heading
    case thematicBreak = "thematic_break"
    case text
    case softBreak = "softbreak"
    case lineBreak = "linebreak"
    case code
    case html = "html_inline"
    case customInline = "custom_inline"
    case emphasis = "emph"
    case strong
    case link
    case image
    case inlineAttributes = "attribute"
    case none = "NONE"
    case unknown = "<unknown>"

    // Extensions
    case strikethrough
    case table
    case tableHead = "table_header"
    case tableRow = "table_row"
    case tableCell = "table_cell"
    case taskListItem = "tasklist"
}

// MARK: - UnsafeNodeSequence

private struct UnsafeNodeSequence: Sequence {
    struct Iterator: IteratorProtocol {
        private var node: UnsafeNode?

        init(_ node: UnsafeNode?) {
            self.node = node
        }

        mutating func next() -> UnsafeNode? {
            guard let node else { return nil }
            defer { self.node = cmark_node_next(node) }
            return node
        }
    }

    private let node: UnsafeNode?

    init(_ node: UnsafeNode?) {
        self.node = node
    }

    func makeIterator() -> Iterator {
        .init(self.node)
    }
}
