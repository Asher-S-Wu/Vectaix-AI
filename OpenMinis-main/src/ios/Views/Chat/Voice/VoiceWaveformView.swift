import SwiftUI

// MARK: - Waveform animation (shown while recording)

struct VoiceWaveformView: View {
    let levels: [Float]   // 0.0...1.0, one per bar

    var body: some View {
        HStack(spacing: 3) {
            ForEach(Array(levels.enumerated()), id: \.offset) { _, level in
                Capsule()
                    .fill(Color.accentColor)
                    .frame(width: 3, height: max(4, CGFloat(level) * 32))
                    .animation(.spring(response: 0.15, dampingFraction: 0.6), value: level)
            }
        }
    }
}
