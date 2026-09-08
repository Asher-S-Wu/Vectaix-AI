import AppIntents
import Foundation

/// Opens a specific chat session in the Minis app.
struct OpenSessionIntent: AppIntent {
    static var title: LocalizedStringResource = "Open Session"
    static var description = IntentDescription("Opens a Minis chat session in the app.")
    static var openAppWhenRun = true

    @Parameter(title: "Session")
    var session: SessionEntity

    @MainActor
    func perform() async throws -> some IntentResult {
        NotificationCenter.default.post(
            name: .openSessionFromIntent,
            object: nil,
            userInfo: ["sessionId": session.id]
        )
        return .result()
    }
}

extension Notification.Name {
    static let openSessionFromIntent = Notification.Name("openSessionFromIntent")
}
