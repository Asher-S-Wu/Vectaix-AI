import AppIntents
import Foundation

/// Structured result returned by SendPromptIntent, usable in Shortcuts automation chains.
struct SendPromptResult: AppEntity {
    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Prompt Result")
    static var defaultQuery = SendPromptResultQuery()

    var id: String  // session ID

    @Property(title: "Session ID")
    var sessionId: String

    @Property(title: "Model")
    var modelName: String

    @Property(title: "Status")
    var status: String

    @Property(title: "Is New Session")
    var isNewSession: Bool

    @Property(title: "Prompt")
    var prompt: String

    @Property(title: "Response")
    var responseText: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(
            title: "\(sessionId)",
            subtitle: "\(modelName) · \(status)"
        )
    }

    init(sessionId: String, modelName: String, status: String, isNewSession: Bool, prompt: String = "", responseText: String = "") {
        self.id = sessionId
        self.sessionId = sessionId
        self.modelName = modelName
        self.status = status
        self.isNewSession = isNewSession
        self.prompt = prompt
        self.responseText = responseText
    }
}

/// Minimal query — result entities are ephemeral, not persisted.
struct SendPromptResultQuery: EntityQuery {
    func entities(for identifiers: [String]) async throws -> [SendPromptResult] {
        []
    }
}
