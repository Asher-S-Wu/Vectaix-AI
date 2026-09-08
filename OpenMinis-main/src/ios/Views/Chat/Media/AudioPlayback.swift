//
//  AudioPlayback.swift
//  MinisApp
//
//  Global audio player singleton + floating PiP capsule + inline audio
//  bubble. Extracted from AIChatView.swift.
//

import AVFoundation
import Combine
import SwiftUI
import UIKit

private let logger = AppLogger(category: "AudioPlayback")

// MARK: - Global Audio Player (Singleton)

@MainActor
class GlobalAudioPlayer: ObservableObject {
    static let shared = GlobalAudioPlayer()
    private init() {
        // Observe AVAudioSession interruptions so we can log when playback
        // is paused by an external audio source (call, Siri, another media
        // app). The actual decision to resume lives elsewhere — this is a
        // diagnostic hook for the silent-audio keep-alive investigation.
        NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: nil,
            queue: .main
        ) { [weak self] note in
            guard let typeRaw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  let type = AVAudioSession.InterruptionType(rawValue: typeRaw) else { return }
            let optionsRaw = note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
            let shouldResume = AVAudioSession.InterruptionOptions(rawValue: optionsRaw)
                .contains(.shouldResume)
            let label = type == .began ? "began" : "ended"
            let isPlaying = self?.isPlaying ?? false
            logger.info("[AudioPlayback] interruption: type=\(label) shouldResume=\(shouldResume) wasPlaying=\(isPlaying)")
        }
        // [T-ios-live-activity-audio-toggle] The Live Activity play/pause toggle
        // is handled by VoiceOutputState (read-aloud engine), NOT here — see
        // VoiceOutputState.registerLiveActivityToggleObserver (b0f3f884 fix).
    }

    @Published var isPlaying = false
    @Published var currentTime: TimeInterval = 0
    @Published var duration: TimeInterval = 0
    @Published var rate: Float = 1.0
    @Published var isLoaded = false
    @Published var activeFileURL: URL?
    @Published var fileName: String = ""
    /// Set to true when user taps capsule to re-open the full preview.
    @Published var showFullPreview = false

    /// Capsule is shown whenever an audio file is loaded. The only way to hide
    /// it is to call `stop()` (e.g. via the capsule's close button), which
    /// resets `isLoaded`. The capsule view itself further hides when the full
    /// preview sheet is open to avoid overlapping UI.
    var isPiPActive: Bool { isLoaded }

    private var player: AVAudioPlayer?
    private var timer: Timer?
    private var seekWorkItem: DispatchWorkItem?

    /// Whether the given URL is the currently active audio file.
    func isActive(url: URL) -> Bool {
        activeFileURL == url
    }

    /// Load and play a URL. If already playing this URL, just ensures playback. If a different URL, stops current and loads new.
    func play(url: URL) {
        if activeFileURL == url {
            // Same file — restart from beginning if finished, otherwise resume
            if !isPlaying {
                if duration > 0 && currentTime >= duration - 0.1 {
                    seek(to: 0)
                }
                togglePlayPause()
            }
            return
        }
        // Stop any current playback
        stopInternal()
        // Suspend silent audio so media gets full volume
        let preCount = BackgroundKeepAliveManager.shared.silentAudioSuspendCount
        logger.info("[AudioPlayback] play: url=\(url.lastPathComponent) suspendSilentAudio → count will be \(preCount + 1)")
        BackgroundKeepAliveManager.shared.suspendSilentAudioForMedia()
        // Load new file
        let loadURL = url
        Task.detached(priority: .userInitiated) {
            guard let p = try? AVAudioPlayer(contentsOf: loadURL) else {
                await MainActor.run {
                    BackgroundKeepAliveManager.shared.resumeSilentAudioForMedia()
                }
                return
            }
            p.prepareToPlay()
            p.enableRate = true
            let dur = p.duration
            await MainActor.run { [weak self] in
                guard let self else { return }
                self.player = p
                self.activeFileURL = loadURL
                self.fileName = loadURL.deletingPathExtension().lastPathComponent
                self.duration = dur
                self.currentTime = 0
                self.isLoaded = true
                self.rate = 1.0
                // Start playing immediately. Declaring `.mediaAttachment` preempts
                // reply TTS (mutually exclusive) and applies the playback profile.
                AudioSessionCoordinator.shared.begin(.mediaAttachment)
                p.play()
                self.isPlaying = true
                self.startTimer()
            }
        }
    }

    func togglePlayPause() {
        guard let p = player else { return }
        if p.isPlaying {
            p.pause()
            isPlaying = false
            timer?.invalidate()
        } else {
            AudioSessionCoordinator.shared.begin(.mediaAttachment)
            p.play()
            p.rate = rate
            isPlaying = true
            startTimer()
        }
    }

    func seek(to time: TimeInterval) {
        player?.currentTime = time
        currentTime = time
    }

    /// Debounced seek — updates the displayed time immediately but delays the actual
    /// AVAudioPlayer seek by 100 ms, coalescing rapid slider/drag movements.
    func debouncedSeek(to time: TimeInterval) {
        currentTime = time
        seekWorkItem?.cancel()
        let item = DispatchWorkItem { [weak self] in
            guard let self else { return }
            self.player?.currentTime = time
        }
        seekWorkItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1, execute: item)
    }

    func setRate(_ r: Float) {
        rate = r
        if let p = player, p.isPlaying {
            p.rate = r
        }
    }

    func skip(by seconds: TimeInterval) {
        let newTime = max(0, min(currentTime + seconds, duration))
        seek(to: newTime)
    }

    /// Deprecated: capsule visibility is now derived from `isLoaded`. Kept as a
    /// no-op so existing callers that minimize the full preview into PiP keep
    /// compiling — minimization now happens by simply dismissing the sheet.
    func activatePiP() {}

    /// Deprecated: capsule visibility is now derived from `isLoaded`. Use
    /// `stop()` to fully hide the capsule.
    func deactivatePiP() {}

    /// Stop all playback and reset state. This is the only way to hide the
    /// PiP capsule (driven by `isLoaded` flipping to false in `stopInternal`).
    func stop() {
        stopInternal()
        showFullPreview = false
    }

    private func stopInternal() {
        let wasLoaded = isLoaded
        timer?.invalidate()
        timer = nil
        player?.stop()
        player = nil
        activeFileURL = nil
        fileName = ""
        isPlaying = false
        currentTime = 0
        duration = 0
        isLoaded = false
        // End the media-attachment intent — coordinator re-applies the next intent
        // or deactivates. Note: TTS is NOT auto-resumed (per plan scenario 1).
        AudioSessionCoordinator.shared.end(.mediaAttachment)
        // Resume silent audio keep-alive if we had suspended it
        if wasLoaded {
            let preCount = BackgroundKeepAliveManager.shared.silentAudioSuspendCount
            logger.info("[AudioPlayback] stopInternal: resumeSilentAudio → count will be \(max(0, preCount - 1))")
            BackgroundKeepAliveManager.shared.resumeSilentAudioForMedia()
        }
    }

    private func startTimer() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            guard let self, let p = self.player else { return }
            DispatchQueue.main.async {
                self.currentTime = p.currentTime
                if !p.isPlaying {
                    self.isPlaying = false
                    self.timer?.invalidate()
                    // Natural end → release the media-attachment intent.
                    AudioSessionCoordinator.shared.end(.mediaAttachment)
                }
            }
        }
    }
}

// MARK: - Floating Audio PiP Capsule

struct AudioPiPCapsule: View {
    @ObservedObject private var player = GlobalAudioPlayer.shared
    /// Persisted position of the capsule center.
    @State private var position: CGPoint? = nil
    @State private var dragOffset: CGSize = .zero

    private let capsuleWidth: CGFloat = 160
    private let capsuleHeight: CGFloat = 40

    /// Default position: bottom-trailing, 10pt above the Tool Status Bar area.
    private func defaultPosition(in size: CGSize) -> CGPoint {
        CGPoint(
            x: size.width - capsuleWidth / 2 - 10,
            y: size.height - capsuleHeight / 2 - 165
        )
    }

    /// Clamp the position within the container bounds with padding.
    private func clamp(_ point: CGPoint, in size: CGSize) -> CGPoint {
        let margin: CGFloat = 6
        let minX = capsuleWidth / 2 + margin
        let maxX = size.width - capsuleWidth / 2 - margin
        let minY = capsuleHeight / 2 + margin
        let maxY = size.height - capsuleHeight / 2 - margin
        return CGPoint(
            x: max(minX, min(maxX, point.x)),
            y: max(minY, min(maxY, point.y))
        )
    }

    var body: some View {
        GeometryReader { geo in
            if player.isPiPActive && !player.showFullPreview {
                let current = position ?? defaultPosition(in: geo.size)
                capsuleContent
                    .position(
                        x: current.x + dragOffset.width,
                        y: current.y + dragOffset.height
                    )
                    .highPriorityGesture(
                        DragGesture(minimumDistance: 5)
                            .onChanged { dragOffset = $0.translation }
                            .onEnded { value in
                                let raw = CGPoint(
                                    x: current.x + value.translation.width,
                                    y: current.y + value.translation.height
                                )
                                withAnimation(.spring(response: 0.3)) {
                                    position = clamp(raw, in: geo.size)
                                    dragOffset = .zero
                                }
                            }
                    )
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .sheet(isPresented: $player.showFullPreview) {
                        if let url = player.activeFileURL {
                            MinisAudioPreviewView(fileURL: url)
                                .presentationDetents([.large])
                                .presentationDragIndicator(.hidden)
                        }
                    }
                    .onAppear {
                        if position == nil {
                            position = defaultPosition(in: geo.size)
                        }
                    }
            }
        }
    }

    private var capsuleContent: some View {
        HStack {
            Button {
                player.showFullPreview = true
            } label: {
                Image(systemName: "waveform")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .frame(width: 36, height: 40)
            }
            .buttonStyle(.plain)

            Spacer()

            Button {
                player.togglePlayPause()
            } label: {
                Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(.primary)
                    .frame(width: 36, height: 40)
            }
            .buttonStyle(.plain)

            Spacer()

            Button {
                player.stop()
            } label: {
                Image(systemName: "xmark")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.secondary)
                    .frame(width: 36, height: 40)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 16)
        .frame(width: 160, height: 40)
        .background {
            Capsule()
                .fill(.ultraThinMaterial)
                .overlay(
                    Capsule()
                        .fill(
                            LinearGradient(
                                colors: [
                                    Color.white.opacity(0.15),
                                    Color.white.opacity(0.05),
                                    Color.clear
                                ],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        )
                )
                .opacity(0.85)
        }
        .clipShape(Capsule())
        .shadow(color: .black.opacity(0.2), radius: 10, y: 4)
    }
}

// MARK: - Inline Audio Bubble

struct MinisAudioPlayerView: View {
    let url: URL
    let fileURL: URL
    @ObservedObject private var player = GlobalAudioPlayer.shared
    @State private var fileReady = false
    @State private var showPreview = false

    /// Fixed height for both placeholder and controls to prevent layout jumps.
    private let controlsHeight: CGFloat = 70

    /// Whether this file is the one currently active in the global player.
    private var isActive: Bool { player.isActive(url: fileURL) }

    var body: some View {
        if fileReady {
            audioControls
        } else {
            placeholder
                .task { await waitForFile() }
        }
    }

    private var audioControls: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 4) {
                Image(systemName: "waveform")
                    .font(.caption2)
                Text(url.lastPathComponent)
                    .lineLimit(1)
                    .font(.caption)
                Spacer()
                Button {
                    showPreview = true
                } label: {
                    Image(systemName: "arrow.up.left.and.arrow.down.right")
                        .font(.caption2)
                        .foregroundColor(ChatColors.secondaryText)
                }
                .buttonStyle(.plain)
            }
            .foregroundColor(ChatColors.secondaryText)

            HStack(spacing: 10) {
                Button {
                    if isActive {
                        player.togglePlayPause()
                    } else {
                        player.play(url: fileURL)
                    }
                } label: {
                    Image(systemName: isActive && player.isPlaying ? "pause.circle.fill" : "play.circle.fill")
                        .font(.title2)
                        .foregroundColor(.accentColor)
                }
                .buttonStyle(.plain)

                if isActive && player.isLoaded {
                    Slider(
                        value: Binding(
                            get: { player.currentTime },
                            set: { player.debouncedSeek(to: $0) }
                        ),
                        in: 0...max(player.duration, 0.01)
                    )
                    .tint(.accentColor)

                    Text(formatTime(player.duration))
                        .font(.caption2)
                        .foregroundColor(ChatColors.secondaryText)
                        .monospacedDigit()
                } else {
                    // Idle state — show empty slider
                    Slider(value: .constant(0), in: 0...1)
                        .tint(.accentColor)
                        .disabled(true)

                    Text(formatTime(0))
                        .font(.caption2)
                        .foregroundColor(ChatColors.secondaryText)
                        .monospacedDigit()
                }
            }
        }
        .padding(10)
        .frame(maxWidth: 320, minHeight: controlsHeight)
        .background(ChatColors.secondaryBg)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .sheet(isPresented: $showPreview) {
            MinisAudioPreviewView(fileURL: fileURL)
                .presentationDetents([.large])
                .presentationDragIndicator(.hidden)
        }
    }

    private var placeholder: some View {
        HStack(spacing: 6) {
            ProgressView().controlSize(.small)
            Text(url.lastPathComponent).lineLimit(1)
        }
        .font(.caption)
        .foregroundColor(ChatColors.secondaryText)
        .padding(10)
        .frame(maxWidth: 320, minHeight: controlsHeight)
        .background(ChatColors.secondaryBg)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func waitForFile() async {
        for _ in 0..<12 {
            if FileManager.default.fileExists(atPath: fileURL.path) {
                fileReady = true
                return
            }
            try? await Task.sleep(nanoseconds: 500_000_000)
        }
        fileReady = true
    }

    private func formatTime(_ t: TimeInterval) -> String {
        let m = Int(t) / 60
        let s = Int(t) % 60
        return String(format: "%d:%02d", m, s)
    }
}
