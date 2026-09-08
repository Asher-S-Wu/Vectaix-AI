//
//  VideoPlayer.swift
//  MinisApp
//
//  Inline video thumbnail bubble + fullscreen player overlay +
//  AVPlayerLayer UIViewRepresentable. Extracted from AIChatView.swift.
//

import AVFoundation
import AVKit
import Photos
import SwiftUI
import UIKit

// MARK: - Inline Video Player

struct MinisVideoPlayerView: View {
    let url: URL
    let fileURL: URL
    @State private var thumbnail: UIImage?
    @State private var showPlayer = false
    @State private var fileReady = false
    // [T-attachment-size-invalidate] Guard against re-posting on cell
    // reconfigure / view rebuild. Two separate transitions can grow the
    // cell (placeholder→videoContent, then thumb-nil→thumb-set), so we
    // need an idempotent post-on-grow gate per transition, but each
    // transition must only fire its own notification once.
    @State private var didNotifyFileReady = false
    @State private var didNotifyThumbnail = false

    var body: some View {
        if fileReady {
            videoContent
        } else {
            placeholder
                .task { await waitForFile() }
        }
    }

    private var videoContent: some View {
        let maxH = UIScreen.main.bounds.height / 2
        return VStack(alignment: .leading, spacing: 0) {
            if let thumb = thumbnail {
                ZStack {
                    Image(uiImage: thumb)
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                    Image(systemName: "play.circle.fill")
                        .font(.system(size: 48))
                        .foregroundStyle(.white.opacity(0.9))
                        .shadow(radius: 4)
                }
                .frame(maxWidth: 400, maxHeight: maxH)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8)
                    .stroke(Color(UIColor.separator).opacity(0.5), lineWidth: 0.5))
                .onTapGesture { showPlayer = true }
            } else {
                // Fixed-size placeholder matches mediaPlaceholderHeight to prevent layout jumps
                ZStack {
                    RoundedRectangle(cornerRadius: 8)
                        .fill(ChatColors.secondaryBg)
                    VStack(spacing: 8) {
                        Image(systemName: "play.circle.fill")
                            .font(.system(size: 48))
                            .foregroundStyle(.secondary)
                        Text(url.lastPathComponent)
                            .lineLimit(1)
                            .font(.caption)
                            .foregroundColor(ChatColors.secondaryText)
                    }
                }
                .frame(maxWidth: 400, minHeight: mediaPlaceholderHeight, maxHeight: mediaPlaceholderHeight)
                .onTapGesture { showPlayer = true }
            }

            if thumbnail != nil {
                HStack(spacing: 4) {
                    Image(systemName: "film")
                        .font(.caption2)
                    Text(url.lastPathComponent)
                        .lineLimit(1)
                        .font(.caption)
                }
                .foregroundColor(ChatColors.secondaryText)
                .padding(.top, 4)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear {
            loadThumbnail()
        }
        .fullScreenCover(isPresented: $showPlayer) {
            MinisVideoFullscreenPlayer(fileURL: fileURL)
        }
    }

    private var placeholder: some View {
        VStack(spacing: 8) {
            ProgressView()
            Text(url.lastPathComponent).lineLimit(1).font(.caption)
        }
        .foregroundColor(ChatColors.secondaryText)
        .frame(maxWidth: 400, minHeight: mediaPlaceholderHeight, maxHeight: mediaPlaceholderHeight)
        .background(ChatColors.secondaryBg)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func waitForFile() async {
        for _ in 0..<12 {
            if FileManager.default.fileExists(atPath: fileURL.path) {
                fileReady = true
                notifyFileReadyOnce()
                return
            }
            try? await Task.sleep(nanoseconds: 500_000_000)
        }
        fileReady = true
        notifyFileReadyOnce()
    }

    private func notifyFileReadyOnce() {
        guard !didNotifyFileReady else { return }
        didNotifyFileReady = true
        NotificationCenter.default.post(name: .minisAttachmentSizeChanged, object: url.absoluteString)
    }

    private func notifyThumbnailOnce() {
        guard !didNotifyThumbnail else { return }
        didNotifyThumbnail = true
        NotificationCenter.default.post(name: .minisAttachmentSizeChanged, object: url.absoluteString)
    }

    private func loadThumbnail() {
        let cacheKey = fileURL.path
        // Check cache first — avoids regenerating on cell recycle
        if let cached = MinisMediaCache.shared.thumbnail(for: cacheKey) {
            thumbnail = cached
            // [T-attachment-size-invalidate] Even cache hit changes layout
            // (placeholder fixed height → aspect-fit thumbnail).
            notifyThumbnailOnce()
            return
        }
        let asset = AVAsset(url: fileURL)
        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: 400, height: 400)
        generator.generateCGImagesAsynchronously(
            forTimes: [NSValue(time: .zero)]
        ) { _, cgImage, _, _, _ in
            if let cgImage {
                let img = UIImage(cgImage: cgImage)
                MinisMediaCache.shared.setThumbnail(img, for: cacheKey)
                DispatchQueue.main.async {
                    self.thumbnail = img
                    self.notifyThumbnailOnce()
                }
            }
        }
    }
}

// MARK: - Fullscreen Video Player

struct MinisVideoFullscreenPlayer: View {
    let fileURL: URL
    /// Optional externally-managed AVPlayer (e.g. from PlayerOffloadBridge).
    /// When provided, the view skips creating its own player.
    let externalPlayer: AVPlayer?
    @Environment(\.dismiss) private var dismiss
    @State private var player: AVPlayer?
    @State private var showShareSheet = false
    @State private var saveStatus: SaveStatus = .idle

    init(fileURL: URL, externalPlayer: AVPlayer? = nil) {
        self.fileURL = fileURL
        self.externalPlayer = externalPlayer
    }

    // Custom controls state
    @State private var isPlaying = false
    @State private var currentTime: Double = 0
    @State private var duration: Double = 0
    @State private var showControls = true
    @State private var isScrubbing = false
    @State private var timeObserver: Any?
    @State private var hideTask: DispatchWorkItem?
    @State private var rateObservation: NSKeyValueObservation?

    // Pull-to-dismiss state
    @State private var dragOffset: CGFloat = 0
    private let dismissThreshold: CGFloat = 120

    private enum SaveStatus {
        case idle, saving, saved, failed
    }

    var body: some View {
        ZStack {
            Color.black.opacity(1.0 - Double(max(dragOffset, 0) / dismissThreshold) * 0.4)
                .ignoresSafeArea()
            if let player {
                MinisAVPlayerLayerView(player: player)
                    .ignoresSafeArea()
                    .offset(y: dragOffset)
            }

            // Tap target to toggle controls + drag to dismiss
            Color.clear
                .contentShape(Rectangle())
                .onTapGesture { toggleControls() }
                .gesture(
                    DragGesture()
                        .onChanged { value in
                            let ty = value.translation.height
                            // Only allow downward drag (rubber-band for upward)
                            dragOffset = ty > 0 ? ty : ty * 0.3
                        }
                        .onEnded { value in
                            if dragOffset > dismissThreshold * 0.5 {
                                player?.pause()
                                dismiss()
                            } else {
                                withAnimation(.spring(response: 0.3)) {
                                    dragOffset = 0
                                }
                            }
                        }
                )

            // Overlays
            if showControls {
                // Top bar overlay
                VStack {
                    HStack {
                        Button {
                            player?.pause()
                            dismiss()
                        } label: {
                            Image(systemName: "xmark")
                                .font(.body.weight(.semibold))
                                .foregroundStyle(ChatColors.primaryText)
                                .frame(width: 44, height: 44)
                                .contentShape(Circle())
                                .background(.ultraThinMaterial, in: Circle())
                        }

                        Spacer()

                        Button {
                            saveVideoToPhotos()
                        } label: {
                            Group {
                                switch saveStatus {
                                case .idle:
                                    Image(systemName: "square.and.arrow.down")
                                        .offset(y: -1)
                                case .saving:
                                    ProgressView()
                                        .tint(ChatColors.primaryText)
                                case .saved:
                                    Image(systemName: "checkmark")
                                        .foregroundStyle(.green)
                                case .failed:
                                    Image(systemName: "exclamationmark.triangle")
                                }
                            }
                            .font(.body.weight(.semibold))
                            .foregroundStyle(ChatColors.primaryText)
                            .frame(width: 44, height: 44)
                            .contentShape(Circle())
                            .background(.ultraThinMaterial, in: Circle())
                        }
                        .disabled(saveStatus == .saving || saveStatus == .saved)

                        Button {
                            showShareSheet = true
                        } label: {
                            Image(systemName: "square.and.arrow.up")
                                .offset(y: -1)
                                .font(.body.weight(.semibold))
                                .foregroundStyle(ChatColors.primaryText)
                                .frame(width: 44, height: 44)
                                .contentShape(Circle())
                                .background(.ultraThinMaterial, in: Circle())
                        }
                    }
                    .padding(.horizontal)
                    .padding(.top, 7)
                    Spacer()
                }
                .zIndex(10)
                .transition(.opacity)

                // Bottom controls overlay
                VStack {
                    Spacer()
                    HStack(spacing: 16) {
                        // Play / Pause
                        Button {
                            if isPlaying {
                                player?.pause()
                                isPlaying = false
                            } else {
                                // If at end, seek to start
                                if currentTime >= duration - 0.5 && duration > 0 {
                                    player?.seek(to: .zero)
                                    currentTime = 0
                                }
                                player?.play()
                                isPlaying = true
                            }
                            scheduleHide()
                        } label: {
                            Image(systemName: isPlaying ? "pause.fill" : "play.fill")
                                .font(.title2)
                                .foregroundStyle(.white)
                                .frame(width: 44, height: 44)
                        }

                        // Current time
                        Text(formatTime(currentTime))
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.white.opacity(0.8))

                        // Progress slider
                        Slider(
                            value: $currentTime,
                            in: 0...max(duration, 1),
                            onEditingChanged: { editing in
                                isScrubbing = editing
                                if editing {
                                    hideTask?.cancel()
                                } else {
                                    let target = CMTime(seconds: currentTime, preferredTimescale: 600)
                                    player?.seek(to: target, toleranceBefore: .zero, toleranceAfter: .zero)
                                    scheduleHide()
                                }
                            }
                        )
                        .tint(.white)

                        // Duration
                        Text(formatTime(duration))
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.white.opacity(0.8))
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 12)
                    .background(
                        LinearGradient(
                            colors: [.clear, .black.opacity(0.5)],
                            startPoint: .top, endPoint: .bottom
                        )
                    )
                }
                .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.25), value: showControls)
        .onAppear {
            let p: AVPlayer
            if let externalPlayer {
                p = externalPlayer
            } else {
                p = AVPlayer(url: fileURL)
            }
            player = p
            try? AVAudioSession.sharedInstance().setCategory(.playback, options: [.mixWithOthers])
            try? AVAudioSession.sharedInstance().setActive(true)
            if externalPlayer == nil {
                p.play()
            }
            isPlaying = p.rate > 0

            // Observe duration
            if let item = p.currentItem {
                Task { @MainActor in
                    // Wait for duration to become available
                    let dur = try? await item.asset.load(.duration)
                    if let dur, dur.isNumeric {
                        duration = dur.seconds
                    }
                }
            }

            // Periodic time observer
            let interval = CMTime(seconds: 0.25, preferredTimescale: 600)
            timeObserver = p.addPeriodicTimeObserver(forInterval: interval, queue: .main) { time in
                guard !isScrubbing else { return }
                currentTime = time.seconds
                // Update duration if not yet set
                if duration == 0, let item = p.currentItem, item.duration.isNumeric {
                    duration = item.duration.seconds
                }
                // Detect playback ended
                if let item = p.currentItem, item.duration.isNumeric,
                   time.seconds >= item.duration.seconds - 0.1 {
                    isPlaying = false
                }
            }

            // Observe rate changes (e.g. system pause on background)
            rateObservation = p.observe(\.rate, options: [.new]) { _, change in
                Task { @MainActor in
                    if let newRate = change.newValue {
                        isPlaying = newRate > 0
                    }
                }
            }

            scheduleHide()
        }
        .onDisappear {
            if let observer = timeObserver {
                player?.removeTimeObserver(observer)
                timeObserver = nil
            }
            rateObservation?.invalidate()
            rateObservation = nil
            hideTask?.cancel()
            player?.pause()
            player = nil
        }
        .sheet(isPresented: $showShareSheet) {
            MinisShareSheet(url: fileURL)
        }
        .statusBar(hidden: true)
    }

    private func toggleControls() {
        showControls.toggle()
        if showControls { scheduleHide() }
    }

    private func scheduleHide() {
        hideTask?.cancel()
        let task = DispatchWorkItem { showControls = false }
        hideTask = task
        DispatchQueue.main.asyncAfter(deadline: .now() + 3, execute: task)
    }

    private func formatTime(_ seconds: Double) -> String {
        guard seconds.isFinite && seconds >= 0 else { return "0:00" }
        let total = Int(seconds)
        let m = total / 60
        let s = total % 60
        return String(format: "%d:%02d", m, s)
    }

    private func saveVideoToPhotos() {
        saveStatus = .saving
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
            guard status == .authorized || status == .limited else {
                DispatchQueue.main.async { saveStatus = .failed }
                return
            }
            PHPhotoLibrary.shared().performChanges {
                PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: fileURL)
            } completionHandler: { success, _ in
                DispatchQueue.main.async {
                    saveStatus = success ? .saved : .failed
                    if success {
                        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                            saveStatus = .idle
                        }
                    }
                }
            }
        }
    }
}

/// Raw AVPlayerLayer wrapper – renders video with no system controls.
struct MinisAVPlayerLayerView: UIViewRepresentable {
    let player: AVPlayer

    func makeUIView(context: Context) -> UIView {
        let view = PlayerLayerUIView()
        view.backgroundColor = .black
        view.playerLayer.player = player
        view.playerLayer.videoGravity = .resizeAspect
        return view
    }

    func updateUIView(_ uiView: UIView, context: Context) {}

    class PlayerLayerUIView: UIView {
        override class var layerClass: AnyClass { AVPlayerLayer.self }
        var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
    }
}
