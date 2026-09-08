import Foundation

/// [T-gemini-empty-part-oneof-400] Pure, testable helpers that enforce Gemini's
/// wire-format invariants when building `contents[].parts[]`.
///
/// Gemini's REST API models a part's payload as a protobuf `oneof` ("data"). An
/// EMPTY text part — `{"text": ""}` — is treated as an *uninitialized* oneof and
/// rejected:
///
///   contents[N].parts[M].data: required oneof field 'data' must have one
///   initialized field  (HTTP 400 INVALID_ARGUMENT)
///
/// This bites Gemini 3.x / 3.5 Flash especially: a thinking-heavy turn (whole
/// budget spent thinking) or a safety-stripped candidate can yield an empty
/// assistant text, and a naive `{"text": text}` then ships `{"text": ""}` → 400,
/// surfacing to users as "tool format errors". The fix (cc-plugins #99, verified
/// against the live gateway: `{"text":""}`→400, `{"text":" "}`→200) is to never
/// emit an empty text part — substitute a single space.
///
/// Centralised here so every call site shares one guarantee and a regression
/// test can pin the behaviour.
enum GeminiWireFormat {

    /// Placeholder used in place of an empty text so the `oneof` is always
    /// initialised. A single space is the minimal non-empty, semantically-inert
    /// value (mirrors the Anthropic path's "never send an empty text block").
    static let nonEmptyPlaceholder = " "

    /// Coerce a text value so it is never the empty string. `nil`/`""` → `" "`.
    static func nonEmptyText(_ text: String?) -> String {
        guard let text, !text.isEmpty else { return nonEmptyPlaceholder }
        return text
    }

    /// Build a text part guaranteed to satisfy the oneof constraint (never empty).
    static func textPart(_ text: String?) -> [String: Any] {
        ["text": nonEmptyText(text)]
    }

    /// The `response` object for a `functionResponse` part, guaranteeing the
    /// wrapped `result` string is never empty (an empty tool result would ship an
    /// empty string into the response payload).
    static func functionResponseResult(_ content: String?) -> [String: Any] {
        ["result": nonEmptyText(content)]
    }
}
