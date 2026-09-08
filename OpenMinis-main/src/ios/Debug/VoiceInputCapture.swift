#if DEBUG
import Foundation

/// One captured voice-transcription input: a snapshot of the EXACT audio payload
/// that was about to be sent to the ASR model, taken at the chokepoint just
/// before `transcribe(request)` fires. [T-debug-voice-input-capture]
///
/// This is the *final request payload* audio (16-bit PCM WAV), not a VAD
/// intermediate — so it answers "what did the model actually receive", which is
/// what you need to tell whether VAD trimmed/dropped speech before the request.
final class CapturedVoiceInput {
    let id: String
    let capturedAt: Date
    /// Model id the request carried (nil = provider default).
    let model: String?
    /// Requested language (nil = auto-detect).
    let language: String?
    /// System ASR on-device flag: true=forced offline, false=cloud, nil=auto.
    let onDeviceRecognition: Bool?
    /// Total payload byte count (WAV header + PCM).
    let byteCount: Int
    /// Parsed WAV header. Zero if the payload isn't a parseable RIFF/WAVE.
    let sampleRate: Int
    let channels: Int
    let bitsPerSample: Int
    /// Duration (seconds) derived from the WAV byte rate + data size.
    let durationSeconds: Double

    // VAD context available at the capture point — for diagnosing whether the
    // segmentation cut audio short.
    /// How many VAD segments were merged into this payload.
    let vadSegmentCount: Int
    /// Reason the LAST contributing VAD segment ended (silence / max-length /
    /// manual-flush / raw-fallback), if known.
    let vadEndReason: String?
    /// The VAD's running speech duration at capture time (seconds), if known —
    /// compared against `durationSeconds`, a gap hints at trimming.
    let vadRunningDuration: Double?

    /// The raw audio bytes. Kept in memory only (bounded ring, ≤5 entries), never
    /// persisted. Exposed base64 by the RPC for export/inspection.
    let audioData: Data

    // [T-debug-full-session-capture] Un-cut reference recording for this entry's
    // recording session. Every payload captured between one VAD start() and
    // stop() shares a `sessionId`, and the full session audio is attached to all
    // of them once the session ends — so you can line the ASR payload up against
    // the untrimmed original and see exactly where VAD cut.
    /// Identifies the VAD start()→stop() session this payload came from.
    /// Nil if the payload was captured outside a tracked session.
    let sessionId: String?
    /// Whole-session WAV (16-bit PCM, same sample rate as capture). Populated
    /// when the session ends, so it is nil for entries read mid-recording.
    var fullSessionAudio: Data?
    /// Duration of `fullSessionAudio` in seconds.
    var fullSessionDurationSeconds: Double?
    /// True when the session exceeded the 10-minute capture ceiling and the tail
    /// was dropped (the start is always preserved).
    var fullSessionTruncated: Bool = false

    init(audioData: Data,
         model: String?,
         language: String?,
         onDeviceRecognition: Bool?,
         vadSegmentCount: Int,
         vadEndReason: String?,
         vadRunningDuration: Double?,
         sessionId: String? = nil) {
        self.id = UUID().uuidString
        self.sessionId = sessionId
        self.capturedAt = Date()
        self.model = model
        self.language = language
        self.onDeviceRecognition = onDeviceRecognition
        self.byteCount = audioData.count
        self.audioData = audioData
        self.vadSegmentCount = vadSegmentCount
        self.vadEndReason = vadEndReason
        self.vadRunningDuration = vadRunningDuration

        let hdr = Self.parseWavHeader(audioData)
        self.sampleRate = hdr.sampleRate
        self.channels = hdr.channels
        self.bitsPerSample = hdr.bitsPerSample
        self.durationSeconds = hdr.durationSeconds
    }

    /// Minimal RIFF/WAVE header parse. Standard PCM layout:
    /// channels @22 (u16), sampleRate @24 (u32), byteRate @28 (u32),
    /// bitsPerSample @34 (u16), then a 44-byte header before PCM data.
    static func parseWavHeader(_ wav: Data)
        -> (sampleRate: Int, channels: Int, bitsPerSample: Int, durationSeconds: Double) {
        let headerSize = 44
        guard wav.count >= headerSize,
              wav.starts(with: [0x52, 0x49, 0x46, 0x46]) /* "RIFF" */ else {
            return (0, 0, 0, 0)
        }
        func u16(_ off: Int) -> UInt16 {
            wav.withUnsafeBytes { UInt16(littleEndian: $0.loadUnaligned(fromByteOffset: off, as: UInt16.self)) }
        }
        func u32(_ off: Int) -> UInt32 {
            wav.withUnsafeBytes { UInt32(littleEndian: $0.loadUnaligned(fromByteOffset: off, as: UInt32.self)) }
        }
        let channels = Int(u16(22))
        let sampleRate = Int(u32(24))
        let byteRate = u32(28)
        let bits = Int(u16(34))
        let dataBytes = Double(wav.count - headerSize)
        let duration = byteRate > 0 ? dataBytes / Double(byteRate) : 0
        return (sampleRate, channels, bits, duration)
    }

    func toDict(includeAudio: Bool) -> [String: Any] {
        let tf = ISO8601DateFormatter()
        tf.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var d: [String: Any] = [
            "id": id,
            "capturedAt": tf.string(from: capturedAt),
            "byteCount": byteCount,
            "durationSeconds": durationSeconds,
            "audioFormat": [
                "container": sampleRate > 0 ? "wav" : "unknown",
                "sampleRate": sampleRate,
                "channels": channels,
                "bitsPerSample": bitsPerSample,
            ] as [String: Any],
            "vad": [
                "segmentCount": vadSegmentCount,
                "endReason": vadEndReason as Any,
                "runningDurationSeconds": vadRunningDuration as Any,
            ] as [String: Any],
        ]
        if let model { d["model"] = model }
        if let language { d["language"] = language }
        if let onDeviceRecognition { d["onDeviceRecognition"] = onDeviceRecognition }
        if let sessionId { d["sessionId"] = sessionId }
        if let fullSessionAudio {
            var fs: [String: Any] = [
                "byteCount": fullSessionAudio.count,
                "truncated": fullSessionTruncated,
            ]
            if let fullSessionDurationSeconds { fs["durationSeconds"] = fullSessionDurationSeconds }
            if includeAudio {
                fs["audioBase64"] = fullSessionAudio.base64EncodedString()
            }
            d["fullSession"] = fs
        }
        if includeAudio {
            // base64 WAV — directly saveable to a .wav for playback/inspection.
            d["audioBase64"] = audioData.base64EncodedString()
        }
        return d
    }
}

/// Thread-safe, bounded (last 5) ring of voice-transcription inputs, mirroring
/// `AgentRequestTrace` / `LastAPIRequestBody`. `#if DEBUG` only; no disk, no
/// effect on the realtime transcription path beyond one lock-guarded append.
final class VoiceInputCapture: @unchecked Sendable {
    static let shared = VoiceInputCapture()

    private let lock = NSLock()
    private let maxEntries = 5
    private var _entries: [CapturedVoiceInput] = []

    /// [T-debug-full-session-capture] Session id of the VAD recording currently
    /// in progress; stamped onto every payload recorded while it is set.
    private var _currentSessionId: String?
    /// Full-session audio for recently finished sessions, kept so that payloads
    /// recorded AFTER `stop()` still get it. Transcription runs asynchronously,
    /// so the last segment's `record()` frequently lands after the session ended.
    /// Bounded to the last 2 sessions (one more than the ring can straddle).
    private var _finishedSessions: [(id: String, audio: Data, duration: Double, truncated: Bool)] = []

    private init() {}

    /// Mark the start of a VAD recording session. Payloads recorded from now
    /// until the session's audio is attached carry this id.
    func beginSession(id: String) {
        lock.lock()
        _currentSessionId = id
        lock.unlock()
    }

    /// Attach the un-cut whole-session recording once the VAD session ends.
    /// Applies it to every already-recorded entry of that session, and keeps it
    /// around so late-arriving entries (async transcription) pick it up too.
    func attachFullSessionAudio(sessionId: String,
                                audioData: Data,
                                durationSeconds: Double,
                                truncated: Bool) {
        lock.lock()
        if _currentSessionId == sessionId { _currentSessionId = nil }
        for entry in _entries where entry.sessionId == sessionId {
            entry.fullSessionAudio = audioData
            entry.fullSessionDurationSeconds = durationSeconds
            entry.fullSessionTruncated = truncated
        }
        _finishedSessions.removeAll { $0.id == sessionId }
        _finishedSessions.append((sessionId, audioData, durationSeconds, truncated))
        if _finishedSessions.count > 2 {
            _finishedSessions.removeFirst(_finishedSessions.count - 2)
        }
        lock.unlock()
    }

    /// Snapshot the audio about to be transcribed. Called on the capture-side
    /// path immediately before `transcribe(request)`.
    func record(audioData: Data,
                model: String?,
                language: String?,
                onDeviceRecognition: Bool?,
                vadSegmentCount: Int,
                vadEndReason: String?,
                vadRunningDuration: Double?) {
        lock.lock()
        // Which recording session does this payload belong to? While the mic is
        // live it's the open session. Transcription is async, so the LAST
        // segment of a recording is often handed over after stop() cleared it —
        // in that case fall back to the session that just finished, which is the
        // one this audio actually came from.
        let session = _currentSessionId ?? _finishedSessions.last?.id
        let finished = _finishedSessions.last(where: { $0.id == session })
        lock.unlock()

        let entry = CapturedVoiceInput(
            audioData: audioData,
            model: model,
            language: language,
            onDeviceRecognition: onDeviceRecognition,
            vadSegmentCount: vadSegmentCount,
            vadEndReason: vadEndReason,
            vadRunningDuration: vadRunningDuration,
            sessionId: session
        )
        if let finished {
            entry.fullSessionAudio = finished.audio
            entry.fullSessionDurationSeconds = finished.duration
            entry.fullSessionTruncated = finished.truncated
        }
        lock.lock()
        _entries.append(entry)
        if _entries.count > maxEntries {
            _entries.removeFirst(_entries.count - maxEntries)
        }
        lock.unlock()
    }

    /// All captured inputs, newest last.
    func getAll(includeAudio: Bool) -> [[String: Any]] {
        lock.lock()
        defer { lock.unlock() }
        return _entries.map { $0.toDict(includeAudio: includeAudio) }
    }

    func clear() {
        lock.lock()
        _entries.removeAll()
        _finishedSessions.removeAll()
        lock.unlock()
    }
}
#endif
