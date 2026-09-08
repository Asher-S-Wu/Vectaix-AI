//
//  PlayerOffloadBridge.swift
//  MinisApp
//
//  Swift bridge for apple-player offload — manages playback sessions
//  using the shared UI components (MinisAudioPreviewView, MinisVideoFullscreenPlayer).
//

import Foundation
import AVFoundation
import AVKit
import SwiftUI
import UIKit

private let logger = AppLogger(category: "PlayerOffloadBridge")

// MARK: - Player Session

private class PlayerSession {
    let id: String
    let fileURL: URL
    let guestPath: String
    let mediaType: MediaType
    let createdAt: Date
    weak var presentedController: UIViewController?

    /// Video sessions own their AVPlayer; audio sessions delegate to GlobalAudioPlayer.
    var videoPlayer: AVPlayer?

    /// True once this session has called `suspendSilentAudioForMedia()` and
    /// not yet called the matching resume. Cleared by stopSession /
    /// cleanupSession, and used by `deinit` as a last-ditch resume so the
    /// silent-audio suspendCount doesn't leak when ARC drops the session
    /// without a full stop.
    var didSuspendSilentAudio = false

    enum MediaType: String {
        case video
        case audio
    }

    init(id: String, fileURL: URL, guestPath: String, mediaType: MediaType) {
        self.id = id
        self.fileURL = fileURL
        self.guestPath = guestPath
        self.mediaType = mediaType
        self.createdAt = Date()
    }

    deinit {
        videoPlayer?.pause()
        // Last-resort: if stopSession / cleanupSession never ran (e.g. user
        // dismissed the hosting controller in a way that bypassed both
        // entry points), balance the suspend count here so the keep-alive
        // can re-engage. MainActor hop because BackgroundKeepAliveManager
        // is @MainActor.
        if didSuspendSilentAudio {
            Task { @MainActor in
                BackgroundKeepAliveManager.shared.resumeSilentAudioForMedia(caller: "PlayerSession.deinit")
            }
        }
    }
}

// MARK: - Bridge

@MainActor @objc public class PlayerOffloadBridge: NSObject {

    private static var sessions: [String: PlayerSession] = [:]

    // MARK: - File Type Detection

    private static let videoExtensions: Set<String> = [
        "mp4", "m4v", "mov", "avi", "mkv", "webm", "ts", "mts", "3gp", "3g2"
    ]
    private static let audioExtensions: Set<String> = [
        "mp3", "m4a", "aac", "wav", "flac", "ogg", "opus", "aiff", "aif", "wma", "caf"
    ]

    private static func detectMediaType(for url: URL) -> PlayerSession.MediaType {
        let ext = url.pathExtension.lowercased()
        if videoExtensions.contains(ext) { return .video }
        return .audio
    }

    // MARK: - Open Player

    @objc public static func openPlayer(
        withUrl url: URL,
        guestPath: String,
        completion: @escaping (NSDictionary?, NSString?) -> Void
    ) {
        let sessionId = UUID().uuidString.prefix(8).lowercased()
        let mediaType = detectMediaType(for: url)

        let session = PlayerSession(
            id: String(sessionId),
            fileURL: url,
            guestPath: guestPath,
            mediaType: mediaType
        )
        sessions[session.id] = session

        if mediaType == .audio {
            openAudioSession(session, completion: completion)
        } else {
            openVideoSession(session, completion: completion)
        }
    }

    // MARK: - Audio (delegates to GlobalAudioPlayer + MinisAudioPreviewView)

    private static func openAudioSession(_ session: PlayerSession, completion: @escaping (NSDictionary?, NSString?) -> Void) {
        // Use GlobalAudioPlayer for playback
        GlobalAudioPlayer.shared.play(url: session.fileURL)

        // Build metadata from GlobalAudioPlayer
        let durationSecs = GlobalAudioPlayer.shared.duration

        let data: NSDictionary = [
            "session_id": session.id,
            "file": session.guestPath,
            "media_type": "audio",
            "duration": durationSecs,
            "codec": "unknown",
            "width": 0,
            "height": 0,
            "status": "playing",
        ]

        // Present MinisAudioPreviewView
        presentAudioUI(for: session)
        completion(data, nil)
    }

    // MARK: - Video (own AVPlayer + MinisVideoFullscreenPlayer)

    private static func openVideoSession(_ session: PlayerSession, completion: @escaping (NSDictionary?, NSString?) -> Void) {
        // Suspend silent audio keep-alive for full volume
        logger.info("[PlayerOffload] play: sessionId=\(session.id) url=\(session.fileURL.lastPathComponent) suspendingSilentAudio")
        BackgroundKeepAliveManager.shared.suspendSilentAudioForMedia()
        session.didSuspendSilentAudio = true

        // Configure audio session. .mixWithOthers so we don't yank the
        // system audio session away from external apps (Spotify, Apple
        // Music, etc.) — taking it away triggers an interruption chain
        // that can kill our background keepalive when they reclaim it.
        try? AVAudioSession.sharedInstance().setCategory(.playback, options: [.mixWithOthers])
        try? AVAudioSession.sharedInstance().setActive(true)

        let player = AVPlayer(url: session.fileURL)
        session.videoPlayer = player
        player.play()

        // Get metadata async
        let asset = player.currentItem!.asset
        Task {
            var durationSecs: Double = 0
            var codec = "unknown"
            var width: Int = 0
            var height: Int = 0

            if let dur = try? await asset.load(.duration) {
                durationSecs = CMTimeGetSeconds(dur)
                if durationSecs.isNaN || durationSecs.isInfinite { durationSecs = 0 }
            }
            if let tracks = try? await asset.load(.tracks) {
                for track in tracks {
                    if let descs = try? await track.load(.formatDescriptions),
                       let desc = descs.first {
                        let mediaSubType = CMFormatDescriptionGetMediaSubType(desc)
                        codec = fourCCToString(mediaSubType)
                    }
                    if track.mediaType == .video {
                        if let size = try? await track.load(.naturalSize) {
                            width = Int(size.width)
                            height = Int(size.height)
                        }
                    }
                }
            }

            let data: NSDictionary = [
                "session_id": session.id,
                "file": session.guestPath,
                "media_type": "video",
                "duration": durationSecs,
                "codec": codec,
                "width": width,
                "height": height,
                "status": "playing",
            ]

            await MainActor.run {
                presentVideoUI(for: session)
                completion(data, nil)
            }
        }
    }

    // MARK: - Session Control

    @objc public static func pauseSession(_ sessionId: String, error: UnsafeMutablePointer<NSString?>) -> NSDictionary? {
        guard let session = sessions[sessionId] else {
            error.pointee = "Session '\(sessionId)' not found" as NSString
            return nil
        }
        if session.mediaType == .audio {
            let player = GlobalAudioPlayer.shared
            if player.isPlaying { player.togglePlayPause() }
            return [
                "session_id": sessionId,
                "status": "paused",
                "current_time": player.currentTime,
            ]
        } else {
            session.videoPlayer?.pause()
            return [
                "session_id": sessionId,
                "status": "paused",
                "current_time": CMTimeGetSeconds(session.videoPlayer?.currentTime() ?? .zero),
            ]
        }
    }

    @objc public static func resumeSession(_ sessionId: String, error: UnsafeMutablePointer<NSString?>) -> NSDictionary? {
        guard let session = sessions[sessionId] else {
            error.pointee = "Session '\(sessionId)' not found" as NSString
            return nil
        }
        if session.mediaType == .audio {
            let player = GlobalAudioPlayer.shared
            if !player.isPlaying { player.togglePlayPause() }
            return [
                "session_id": sessionId,
                "status": "playing",
                "current_time": player.currentTime,
            ]
        } else {
            session.videoPlayer?.play()
            return [
                "session_id": sessionId,
                "status": "playing",
                "current_time": CMTimeGetSeconds(session.videoPlayer?.currentTime() ?? .zero),
            ]
        }
    }

    @objc public static func seekSession(_ sessionId: String, toSeconds seconds: Double, error: UnsafeMutablePointer<NSString?>) -> NSDictionary? {
        guard let session = sessions[sessionId] else {
            error.pointee = "Session '\(sessionId)' not found" as NSString
            return nil
        }
        if session.mediaType == .audio {
            GlobalAudioPlayer.shared.seek(to: seconds)
            return [
                "session_id": sessionId,
                "status": GlobalAudioPlayer.shared.isPlaying ? "playing" : "paused",
                "current_time": seconds,
            ]
        } else {
            let time = CMTime(seconds: seconds, preferredTimescale: 600)
            session.videoPlayer?.seek(to: time, toleranceBefore: .zero, toleranceAfter: .zero)
            return [
                "session_id": sessionId,
                "status": (session.videoPlayer?.rate ?? 0) > 0 ? "playing" : "paused",
                "current_time": seconds,
            ]
        }
    }

    @objc public static func statusForSession(_ sessionId: String, error: UnsafeMutablePointer<NSString?>) -> NSDictionary? {
        guard let session = sessions[sessionId] else {
            error.pointee = "Session '\(sessionId)' not found" as NSString
            return nil
        }
        if session.mediaType == .audio {
            let player = GlobalAudioPlayer.shared
            return [
                "session_id": sessionId,
                "file": session.guestPath,
                "media_type": "audio",
                "status": player.isPlaying ? "playing" : "paused",
                "current_time": player.currentTime,
                "duration": player.duration,
                "rate": player.rate,
            ]
        } else {
            guard let vp = session.videoPlayer else {
                error.pointee = "Video player not available" as NSString
                return nil
            }
            let currentTime = CMTimeGetSeconds(vp.currentTime())
            let duration = CMTimeGetSeconds(vp.currentItem?.duration ?? .zero)
            let rate = vp.rate

            var status = "paused"
            if rate > 0 { status = "playing" }
            if vp.currentItem?.status == .failed { status = "error" }

            return [
                "session_id": sessionId,
                "file": session.guestPath,
                "media_type": "video",
                "status": status,
                "current_time": currentTime.isNaN ? 0 : currentTime,
                "duration": duration.isNaN ? 0 : duration,
                "rate": rate,
            ]
        }
    }

    @objc public static func stopSession(_ sessionId: String, error: UnsafeMutablePointer<NSString?>) -> NSDictionary? {
        guard let session = sessions[sessionId] else {
            error.pointee = "Session '\(sessionId)' not found" as NSString
            return nil
        }
        if session.mediaType == .audio {
            GlobalAudioPlayer.shared.stop()
        } else {
            session.videoPlayer?.pause()
        }
        session.presentedController?.dismiss(animated: true)
        sessions.removeValue(forKey: sessionId)
        // Resume silent audio for video sessions
        if session.mediaType == .video && !sessions.values.contains(where: { $0.mediaType == .video }) {
            logger.info("[PlayerOffload] stop: sessionId=\(sessionId) resumingSilentAudio wasActive=true")
            BackgroundKeepAliveManager.shared.resumeSilentAudioForMedia()
            session.didSuspendSilentAudio = false
        } else {
            logger.info("[PlayerOffload] stop: sessionId=\(sessionId) mediaType=\(session.mediaType.rawValue) (no resume — other video sessions still active or audio session)")
        }
        return [
            "session_id": sessionId,
            "status": "stopped",
        ]
    }

    @objc public static func listSessions() -> NSDictionary {
        var items: [[String: Any]] = []
        for (_, session) in sessions {
            if session.mediaType == .audio {
                let player = GlobalAudioPlayer.shared
                items.append([
                    "session_id": session.id,
                    "file": session.guestPath,
                    "media_type": "audio",
                    "status": player.isPlaying ? "playing" : "paused",
                    "current_time": player.currentTime,
                    "duration": player.duration,
                ])
            } else if let vp = session.videoPlayer {
                let currentTime = CMTimeGetSeconds(vp.currentTime())
                let duration = CMTimeGetSeconds(vp.currentItem?.duration ?? .zero)
                items.append([
                    "session_id": session.id,
                    "file": session.guestPath,
                    "media_type": "video",
                    "status": vp.rate > 0 ? "playing" : "paused",
                    "current_time": currentTime.isNaN ? 0 : currentTime,
                    "duration": duration.isNaN ? 0 : duration,
                ])
            }
        }
        return [
            "sessions": items,
            "count": items.count,
        ]
    }

    // MARK: - Cleanup (called when user dismisses UI)

    static func cleanupSession(_ sessionId: String) {
        guard let session = sessions[sessionId] else { return }
        if session.mediaType == .audio {
            GlobalAudioPlayer.shared.stop()
        } else {
            session.videoPlayer?.pause()
        }
        sessions.removeValue(forKey: sessionId)
        if session.mediaType == .video && !sessions.values.contains(where: { $0.mediaType == .video }) {
            logger.info("[PlayerOffload] cleanup: sessionId=\(sessionId) resumingSilentAudio wasActive=true")
            BackgroundKeepAliveManager.shared.resumeSilentAudioForMedia()
            session.didSuspendSilentAudio = false
        } else {
            logger.info("[PlayerOffload] cleanup: sessionId=\(sessionId) mediaType=\(session.mediaType.rawValue) (no resume — other video sessions still active or audio session)")
        }
    }

    // MARK: - UI Presentation

    private static func presentAudioUI(for session: PlayerSession) {
        guard let topVC = topViewController() else { return }

        let view = MinisAudioPreviewView(fileURL: session.fileURL)
        let hostingVC = UIHostingController(rootView: view)
        hostingVC.modalPresentationStyle = .pageSheet
        if let sheet = hostingVC.sheetPresentationController {
            sheet.detents = [.large()]
            sheet.prefersGrabberVisible = false
        }

        session.presentedController = hostingVC
        topVC.present(hostingVC, animated: true)
    }

    private static func presentVideoUI(for session: PlayerSession) {
        guard let topVC = topViewController() else { return }
        guard let player = session.videoPlayer else { return }

        let view = MinisVideoFullscreenPlayer(fileURL: session.fileURL, externalPlayer: player)
        let hostingVC = UIHostingController(rootView: view)
        hostingVC.modalPresentationStyle = .overFullScreen
        hostingVC.modalTransitionStyle = .crossDissolve

        session.presentedController = hostingVC
        topVC.present(hostingVC, animated: true)
    }

    private static func topViewController() -> UIViewController? {
        guard let windowScene = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene }).first,
              let rootVC = windowScene.windows.first(where: { $0.isKeyWindow })?.rootViewController else {
            return nil
        }
        var topVC = rootVC
        while let presented = topVC.presentedViewController {
            topVC = presented
        }
        return topVC
    }

    // MARK: - Helpers

    private static func fourCCToString(_ code: FourCharCode) -> String {
        let chars: [Character] = [
            Character(UnicodeScalar((code >> 24) & 0xFF)!),
            Character(UnicodeScalar((code >> 16) & 0xFF)!),
            Character(UnicodeScalar((code >> 8)  & 0xFF)!),
            Character(UnicodeScalar( code        & 0xFF)!),
        ]
        return String(chars).trimmingCharacters(in: .whitespaces)
    }
}
