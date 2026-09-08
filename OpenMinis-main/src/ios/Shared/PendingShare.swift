import Foundation

/// Describes content shared into the app via the Share Extension.
/// Encoded to JSON and stored in the App Group UserDefaults.
struct PendingShare: Codable, Equatable {
    let items: [Item]
    let timestamp: Date

    struct Item: Codable, Equatable {
        let kind: Kind
        /// For `.inlineText`: the text/URL content. For `.attachment`: the filename in the shared container.
        let value: String

        enum Kind: String, Codable {
            case inlineText
            case attachment
        }
    }
}
