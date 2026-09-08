#if DEBUG
import XCTest

/// Unit tests for the debug voice-input capture ring (`debug.voiceInputs`
/// backing store). Verifies WAV-header parsing, the ≤5 bounded ring, and the
/// RPC-serialized shape — the pure logic behind the RPC, without needing a live
/// mic/VAD segment. [T-debug-voice-input-capture]
final class VoiceInputCaptureTests: XCTestCase {

    /// Build a minimal 16-bit PCM mono WAV with `pcmBytes` of body at the given
    /// sample rate, so header parsing + duration can be checked deterministically.
    private func makeWav(sampleRate: Int, channels: Int = 1, bitsPerSample: Int = 16,
                         pcmBytes: Int) -> Data {
        var d = Data()
        let byteRate = sampleRate * channels * (bitsPerSample / 8)
        let blockAlign = channels * (bitsPerSample / 8)
        func u32(_ v: UInt32) -> Data { withUnsafeBytes(of: v.littleEndian) { Data($0) } }
        func u16(_ v: UInt16) -> Data { withUnsafeBytes(of: v.littleEndian) { Data($0) } }
        d.append("RIFF".data(using: .ascii)!)
        d.append(u32(UInt32(36 + pcmBytes)))
        d.append("WAVE".data(using: .ascii)!)
        d.append("fmt ".data(using: .ascii)!)
        d.append(u32(16))                       // fmt chunk size
        d.append(u16(1))                        // PCM
        d.append(u16(UInt16(channels)))
        d.append(u32(UInt32(sampleRate)))
        d.append(u32(UInt32(byteRate)))
        d.append(u16(UInt16(blockAlign)))
        d.append(u16(UInt16(bitsPerSample)))
        d.append("data".data(using: .ascii)!)
        d.append(u32(UInt32(pcmBytes)))
        d.append(Data(repeating: 0, count: pcmBytes)) // silent PCM body
        return d
    }

    func testWavHeaderParse_16kMono() {
        // 16000 Hz mono 16-bit, 32000 PCM bytes = 1.0s.
        let wav = makeWav(sampleRate: 16000, pcmBytes: 32000)
        let h = CapturedVoiceInput.parseWavHeader(wav)
        XCTAssertEqual(h.sampleRate, 16000)
        XCTAssertEqual(h.channels, 1)
        XCTAssertEqual(h.bitsPerSample, 16)
        XCTAssertEqual(h.durationSeconds, 1.0, accuracy: 0.001)
    }

    func testWavHeaderParse_48kMatchesCaptureRate() {
        // Confirms the parser reads the ACTUAL header rate (48k native capture),
        // not an assumed 16k — the whole point of surfacing real format.
        let wav = makeWav(sampleRate: 48000, pcmBytes: 96000) // 1.0s @48k mono 16-bit
        let h = CapturedVoiceInput.parseWavHeader(wav)
        XCTAssertEqual(h.sampleRate, 48000)
        XCTAssertEqual(h.durationSeconds, 1.0, accuracy: 0.001)
    }

    func testNonWavYieldsZeroedFormat() {
        let h = CapturedVoiceInput.parseWavHeader(Data([0x00, 0x01, 0x02, 0x03]))
        XCTAssertEqual(h.sampleRate, 0)
        XCTAssertEqual(h.channels, 0)
        XCTAssertEqual(h.durationSeconds, 0)
    }

    func testDictShape_metadataAndAudioToggle() {
        let wav = makeWav(sampleRate: 16000, pcmBytes: 16000) // 0.5s
        let entry = CapturedVoiceInput(
            audioData: wav, model: "whisper-1", language: "zh",
            onDeviceRecognition: false, vadSegmentCount: 2,
            vadEndReason: "silenceDetected", vadRunningDuration: 3.4
        )
        let withAudio = entry.toDict(includeAudio: true)
        XCTAssertEqual(withAudio["byteCount"] as? Int, wav.count)
        XCTAssertEqual(withAudio["model"] as? String, "whisper-1")
        XCTAssertEqual(withAudio["language"] as? String, "zh")
        XCTAssertNotNil(withAudio["audioBase64"])
        let fmt = withAudio["audioFormat"] as? [String: Any]
        XCTAssertEqual(fmt?["sampleRate"] as? Int, 16000)
        XCTAssertEqual(fmt?["container"] as? String, "wav")
        let vad = withAudio["vad"] as? [String: Any]
        XCTAssertEqual(vad?["segmentCount"] as? Int, 2)
        XCTAssertEqual(vad?["endReason"] as? String, "silenceDetected")

        let noAudio = entry.toDict(includeAudio: false)
        XCTAssertNil(noAudio["audioBase64"], "includeAudio=false must omit the base64 blob")
        XCTAssertEqual(noAudio["byteCount"] as? Int, wav.count)
    }

    func testRingBoundedToFiveNewestLast() {
        let cap = VoiceInputCapture.shared
        cap.clear()
        for i in 0..<8 {
            // vary sampleRate as an identity marker per entry
            let wav = makeWav(sampleRate: 8000 + i, pcmBytes: 1600)
            cap.record(audioData: wav, model: "m\(i)", language: nil,
                       onDeviceRecognition: nil, vadSegmentCount: 1,
                       vadEndReason: nil, vadRunningDuration: nil)
        }
        let all = cap.getAll(includeAudio: false)
        XCTAssertEqual(all.count, 5, "ring must cap at 5")
        // Newest-last: last entry is the 8th recorded (model m7).
        XCTAssertEqual(all.last?["model"] as? String, "m7")
        XCTAssertEqual(all.first?["model"] as? String, "m3", "oldest surviving is m3 (m0-m2 evicted)")
        cap.clear()
        XCTAssertEqual(cap.getAll(includeAudio: false).count, 0)
    }
}
#endif
