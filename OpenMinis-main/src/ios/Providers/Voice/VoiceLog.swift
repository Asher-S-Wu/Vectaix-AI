import Foundation

/// Debug-only logging for the voice capture → transcription pipeline.
/// All messages share the `[Voice]` prefix for easy grep. Routed through
/// AppLogger (NSLog-backed, captured by LoggingManager) per project convention;
/// compiled out of release builds.
enum VoiceLog {
    #if DEBUG
    private static let logger = AppLogger(category: "Voice")
    #endif

    static func log(_ message: @autoclosure () -> String) {
        #if DEBUG
        logger.info("[Voice] \(message())")
        #endif
    }
}
