//
//  AudioPreview.swift
//  MinisApp
//
//  Standalone audio preview sheet with artwork, scrubber, controls,
//  export to document picker, and PiP activation. Extracted from
//  AIChatView.swift.
//

import AVFoundation
import SwiftUI
import UIKit

// MARK: - minis:// Audio Preview (standalone sheet)

struct MinisAudioPreviewView: View {
    let fileURL: URL
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var player = GlobalAudioPlayer.shared
    @State private var showShareSheet = false
    @State private var showSavePicker = false
    @State private var artworkImage: UIImage? = nil
    @State private var dominantColor: Color = Color(UIColor.secondarySystemBackground)

    var body: some View {
        ZStack(alignment: .top) {
            backgroundLayer

            VStack(spacing: 0) {
                topBar
                Spacer()
                artworkSection
                    .padding(.horizontal, 32)
                    .padding(.bottom, 24)
                trackInfoRow
                progressSection
                    .padding(.horizontal, 32)
                    .padding(.bottom, 24)
                controlRow
                    .padding(.bottom, 16)
                Spacer()
                bottomBar
            }
        }
        .onAppear {
            // If not already playing this file, start playback
            if !player.isActive(url: fileURL) {
                player.play(url: fileURL)
            }
            loadArtwork()
        }
        .onDisappear {
            // Playback continues; the floating PiP capsule is shown
            // automatically whenever audio is loaded. The capsule's close
            // button is the user-facing way to stop playback.
        }
        .sheet(isPresented: $showShareSheet) {
            MinisShareSheet(url: fileURL)
        }
        .sheet(isPresented: $showSavePicker) {
            AudioFileSavePicker(url: fileURL)
        }
    }

    // MARK: - Background

    @ViewBuilder
    private var backgroundLayer: some View {
        if let img = artworkImage {
            ZStack {
                Image(uiImage: img)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
                    .ignoresSafeArea()
                Rectangle()
                    .fill(.ultraThinMaterial)
                    .ignoresSafeArea()
                dominantColor
                    .opacity(0.5)
                    .ignoresSafeArea()
            }
        } else {
            Color(UIColor.systemBackground)
                .ignoresSafeArea()
        }
    }

    // MARK: - Top Bar

    private var topBar: some View {
        HStack {
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(ChatColors.primaryText)
                    .frame(width: 44, height: 44)
                    .contentShape(Circle())
                    .background(.ultraThinMaterial, in: Circle())
            }
            .buttonStyle(.plain)

            Spacer()

            Button {
                showSavePicker = true
            } label: {
                Image(systemName: "square.and.arrow.down")
                    .offset(y: -1)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(ChatColors.primaryText)
                    .frame(width: 44, height: 44)
                    .contentShape(Circle())
                    .background(.ultraThinMaterial, in: Circle())
            }
            .buttonStyle(.plain)

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
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 12)
        .padding(.top, 13)
        .padding(.bottom, 4)
    }

    // MARK: - Artwork

    @ViewBuilder
    private var artworkSection: some View {
        if let img = artworkImage {
            Image(uiImage: img)
                .resizable()
                .aspectRatio(contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: 20))
                .shadow(color: .black.opacity(0.4), radius: 24, x: 0, y: 10)
                .frame(maxWidth: .infinity)
                .aspectRatio(1, contentMode: .fit)
        } else {
            ZStack {
                RoundedRectangle(cornerRadius: 20)
                    .fill(Color(UIColor.secondarySystemBackground))
                Image(systemName: "waveform")
                    .font(.system(size: 64, weight: .light))
                    .foregroundStyle(Color.accentColor.opacity(0.8))
            }
            .frame(maxWidth: .infinity)
            .aspectRatio(1, contentMode: .fit)
            .shadow(color: .black.opacity(0.1), radius: 12, x: 0, y: 4)
        }
    }

    // MARK: - Track Info

    private var trackInfoRow: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(displayTitle)
                    .font(.title2.bold())
                    .lineLimit(1)
                    .foregroundColor(artworkImage != nil ? .white : Color(UIColor.label))
                Text(displaySubtitle)
                    .font(.subheadline)
                    .lineLimit(1)
                    .foregroundColor(artworkImage != nil ? .white.opacity(0.7) : Color(UIColor.secondaryLabel))
            }
            Spacer()
        }
        .padding(.horizontal, 32)
        .padding(.bottom, 20)
    }

    // MARK: - Progress

    private var progressSection: some View {
        VStack(spacing: 8) {
            // Custom progress bar
            GeometryReader { geo in
                let progress = player.duration > 0 ? player.currentTime / player.duration : 0
                ZStack(alignment: .leading) {
                    // Background track
                    RoundedRectangle(cornerRadius: 3)
                        .fill(artworkImage != nil ? Color.white.opacity(0.3) : Color(UIColor.tertiarySystemFill))
                        .frame(height: 5)
                    // Played portion
                    RoundedRectangle(cornerRadius: 3)
                        .fill(artworkImage != nil ? Color.white : Color.accentColor)
                        .frame(width: max(0, geo.size.width * CGFloat(progress)), height: 5)
                    // Drag handle
                    Circle()
                        .fill(artworkImage != nil ? Color.white : Color.accentColor)
                        .frame(width: 14, height: 14)
                        .offset(x: max(0, geo.size.width * CGFloat(progress) - 7))
                }
                .frame(height: 14)
                .contentShape(Rectangle())
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { value in
                            let ratio = max(0, min(1, value.location.x / geo.size.width))
                            player.debouncedSeek(to: TimeInterval(ratio) * player.duration)
                        }
                )
            }
            .frame(height: 14)

            // Time labels
            HStack {
                Text(formatTime(player.currentTime))
                Spacer()
                Text(formatTime(player.duration))
            }
            .font(.caption2.monospacedDigit())
            .foregroundColor(artworkImage != nil ? .white.opacity(0.7) : Color(UIColor.secondaryLabel))
        }
    }

    // MARK: - Controls

    private var controlRow: some View {
        HStack(spacing: 40) {
            Button { player.skip(by: -10) } label: {
                Image(systemName: "gobackward.10")
                    .font(.system(size: 28, weight: .medium))
                    .foregroundColor(artworkImage != nil ? .white : Color(UIColor.label))
            }
            .buttonStyle(.plain)

            Button { player.togglePlayPause() } label: {
                Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                    .font(.system(size: 44, weight: .medium))
                    .foregroundColor(artworkImage != nil ? .white : Color(UIColor.label))
            }
            .buttonStyle(.plain)

            Button { player.skip(by: 10) } label: {
                Image(systemName: "goforward.10")
                    .font(.system(size: 28, weight: .medium))
                    .foregroundColor(artworkImage != nil ? .white : Color(UIColor.label))
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
    }

    // MARK: - Bottom Bar

    private var bottomBar: some View {
        HStack {
            // Playback speed menu
            Menu {
                ForEach([0.5, 0.75, 1.0, 1.25, 1.5, 2.0] as [Float], id: \.self) { r in
                    Button {
                        player.setRate(r)
                    } label: {
                        if player.rate == r { Label(rateDisplayLabel(r), systemImage: "checkmark") }
                        else { Text(rateDisplayLabel(r)) }
                    }
                }
            } label: {
                ZStack(alignment: .topTrailing) {
                    Circle()
                        .fill(artworkImage != nil
                            ? Color.white.opacity(0.2)
                            : Color(UIColor.secondarySystemBackground))
                        .frame(width: 44, height: 44)
                    Image(systemName: "speedometer")
                        .font(.system(size: 22, weight: .medium))
                        .foregroundColor(artworkImage != nil ? .white : Color(UIColor.label))
                        .frame(width: 44, height: 44)
                }
                .overlay(alignment: .topTrailing) {
                    Text(rateLabel(player.rate))
                        .font(.system(size: 9, weight: .bold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 3)
                        .padding(.vertical, 1)
                        .background(Capsule().fill(Color.accentColor))
                        .offset(x: 4, y: -2)
                }
                .frame(width: 56, height: 56)
                .contentShape(Circle())
            }

            Spacer()

            Button {
                player.activatePiP()
                dismiss()
            } label: {
                ZStack {
                    Circle()
                        .fill(artworkImage != nil
                            ? Color.white.opacity(0.2)
                            : Color(UIColor.secondarySystemBackground))
                        .frame(width: 44, height: 44)
                    Image(systemName: "pip")
                        .font(.system(size: 17, weight: .medium))
                        .foregroundColor(artworkImage != nil ? .white : Color(UIColor.label))
                }
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 36)
        .padding(.bottom, 24)
    }

    // MARK: - Helpers

    private var displayTitle: String {
        fileURL.deletingPathExtension().lastPathComponent
    }

    private var displaySubtitle: String {
        fileURL.pathExtension.uppercased() + " Audio"
    }

    private func loadArtwork() {
        let url = fileURL
        Task.detached(priority: .userInitiated) {
            let asset = AVAsset(url: url)
            let formats: [AVMetadataFormat] = [.iTunesMetadata, .id3Metadata, .isoUserData]
            var foundImage: UIImage? = nil
            for format in formats {
                guard foundImage == nil else { break }
                if let items = try? await asset.loadMetadata(for: format) {
                    for item in items {
                        if item.commonKey == .commonKeyArtwork {
                            if let data = try? await item.load(.dataValue),
                               let img = UIImage(data: data) {
                                foundImage = img
                                break
                            }
                        }
                    }
                }
            }
            if foundImage == nil {
                if let items = try? await asset.load(.commonMetadata) {
                    for item in items {
                        if item.commonKey == .commonKeyArtwork {
                            if let data = try? await item.load(.dataValue),
                               let img = UIImage(data: data) {
                                foundImage = img
                                break
                            }
                        }
                    }
                }
            }
            await MainActor.run {
                if let img = foundImage {
                    artworkImage = img
                    dominantColor = img.dominantSwiftUIColor()
                }
            }
        }
    }

    private func formatTime(_ t: TimeInterval) -> String {
        let m = Int(t) / 60
        let s = Int(t) % 60
        return String(format: "%d:%02d", m, s)
    }

    private func rateLabel(_ r: Float) -> String {
        if r == Float(Int(r)) { return "\(Int(r))x" }
        return String(format: "%.2gx", r)
    }

    private func rateDisplayLabel(_ r: Float) -> String {
        if r == Float(Int(r)) { return "Speed \(Int(r))x" }
        return String(format: "Speed %.2gx", r)
    }
}

// MARK: - Audio Preview Helpers

private struct CircleIconButton: View {
    let icon: String
    let hasArtwork: Bool
    var body: some View {
        Image(systemName: icon)
            .font(.system(size: 16, weight: .medium))
            .foregroundColor(hasArtwork ? .white : Color(UIColor.secondaryLabel))
            .frame(width: 36, height: 36)
            .background(
                Circle().fill(hasArtwork ? Color.white.opacity(0.2) : Color(UIColor.tertiarySystemBackground))
            )
    }
}

// MARK: - UIImage dominant color helper

private extension UIImage {
    /// Returns an approximate dominant color by sampling the image at low resolution.
    func dominantSwiftUIColor() -> Color {
        guard let resized = resized(to: CGSize(width: 50, height: 50)),
              let cgImage = resized.cgImage else { return Color(UIColor.secondarySystemBackground) }
        let width = cgImage.width
        let height = cgImage.height
        guard let data = cgImage.dataProvider?.data,
              let ptr = CFDataGetBytePtr(data) else { return Color(UIColor.secondarySystemBackground) }
        let bytesPerPixel = cgImage.bitsPerPixel / 8
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0
        let total = width * height
        for y in 0..<height {
            for x in 0..<width {
                let offset = (y * cgImage.bytesPerRow) + (x * bytesPerPixel)
                r += CGFloat(ptr[offset]) / 255.0
                g += CGFloat(ptr[offset + 1]) / 255.0
                b += CGFloat(ptr[offset + 2]) / 255.0
            }
        }
        let count = CGFloat(total)
        return Color(red: r / count, green: g / count, blue: b / count)
    }

    func resized(to size: CGSize) -> UIImage? {
        UIGraphicsBeginImageContextWithOptions(size, false, 1.0)
        draw(in: CGRect(origin: .zero, size: size))
        let result = UIGraphicsGetImageFromCurrentImageContext()
        UIGraphicsEndImageContext()
        return result
    }
}

// MARK: - Audio File Save Picker

private struct AudioFileSavePicker: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        let picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true)
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIDocumentPickerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator() }

    class Coordinator: NSObject, UIDocumentPickerDelegate {}
}
