import Foundation

/// Failure modes a ConfigField operation may surface.
///
/// Errors flow back through the offload bridge into the CLI's stdout
/// JSON envelope, where each case maps to a specific exit code:
///   typeMismatch / invalidValue / outOfRange / regexMismatch  → 1
///   permissionDenied                                          → 126
///   unknownPath                                               → 1
///   io                                                        → 1
enum ConfigError: Error, CustomStringConvertible {
    case typeMismatch(expected: String)
    case invalidValue(String)
    case outOfRange(min: Double?, max: Double?)
    case regexMismatch(pattern: String)
    case permissionDenied(reason: String = "Hidden from minis-config")
    case unknownPath(String)
    case io(String)

    var description: String {
        switch self {
        case .typeMismatch(let exp):     return "type_mismatch: expected \(exp)"
        case .invalidValue(let msg):     return "invalid_value: \(msg)"
        case .outOfRange(let lo, let hi):
            let bounds = [lo.map { "min=\($0)" }, hi.map { "max=\($0)" }]
                .compactMap { $0 }.joined(separator: ", ")
            return "out_of_range: \(bounds)"
        case .regexMismatch(let p):      return "regex_mismatch: must match /\(p)/"
        case .permissionDenied(let r):   return "permission_denied: \(r)"
        case .unknownPath(let p):        return "unknown_path: \(p)"
        case .io(let msg):               return "io_error: \(msg)"
        }
    }
}
