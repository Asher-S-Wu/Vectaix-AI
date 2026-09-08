import Foundation
import UIKit
import UniformTypeIdentifiers

/// Processes NSExtensionItems from the share sheet, saves files to the shared
/// container, and writes a PendingShare for the main app to consume.
final class ShareViewModel {
    private var pendingItems: [PendingShare.Item] = []
    private let inlineTextLimit = 1000

    /// Process all extension items from the share context.
    func processExtensionItems(_ extensionItems: [NSExtensionItem]) async {
        pendingItems.removeAll()

        let fm = FileManager.default
        if let dir = SharedContainerStore.sharedFileDirectory {
            try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        }

        for extensionItem in extensionItems {
            guard let attachments = extensionItem.attachments else { continue }

            for provider in attachments {
                if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                    await processURL(provider)
                } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                    await processText(provider)
                } else if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
                    await processImage(provider)
                } else if provider.hasItemConformingToTypeIdentifier(UTType.movie.identifier) {
                    await processVideo(provider)
                } else if provider.hasItemConformingToTypeIdentifier(UTType.item.identifier) {
                    await processFile(provider)
                }
            }
        }
    }

    /// Save pending share and return true on success.
    /// [T-share-buffer-merge] MERGE with any unconsumed previous share instead
    /// of overwriting it. Rapid consecutive shares (user shares screenshot A,
    /// then B a few seconds later, before the main app ran
    /// processPendingShare) used to silently lose A: this save() replaced the
    /// App Group record wholesale. Attachment file names are UUID-suffixed so
    /// the merged item lists never collide on disk. The 300s window matches
    /// checkForPendingShare's staleness cutoff; anything older is abandoned
    /// content whose files the main app will clean up.
    func save() -> Bool {
        guard !pendingItems.isEmpty else { return false }
        var items = pendingItems
        if let existing = SharedContainerStore.loadPendingShare(),
           Date().timeIntervalSince(existing.timestamp) < 300 {
            NSLog("[ShareExt] save: merging %d existing unconsumed items with %d new",
                  existing.items.count, pendingItems.count)
            items = existing.items + items
        }
        let share = PendingShare(items: items, timestamp: Date())
        SharedContainerStore.savePendingShare(share)
        return true
    }

    // MARK: - Processors

    private func processURL(_ provider: NSItemProvider) async {
        guard let item = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier),
              let url = item as? URL else { return }

        // file:// URLs are local files — treat as file attachment, not inline text
        if url.isFileURL {
            await copyFileToShared(from: url)
            return
        }

        pendingItems.append(.init(kind: .inlineText, value: url.absoluteString))
    }

    /// Copy a local file URL to the shared container as an attachment.
    private func copyFileToShared(from url: URL) async {
        let accessed = url.startAccessingSecurityScopedResource()
        defer { if accessed { url.stopAccessingSecurityScopedResource() } }

        // If it's an image, process through image pipeline for JPEG conversion
        let ext = url.pathExtension.lowercased()
        if ["jpg", "jpeg", "png", "gif", "webp", "heic"].contains(ext),
           let data = try? Data(contentsOf: url),
           let image = UIImage(data: data) {
            let fileName = "shared-image-\(UUID().uuidString.prefix(8)).jpg"
            if let dir = SharedContainerStore.sharedFileDirectory,
               let jpegData = image.jpegData(compressionQuality: 0.85) {
                let fileURL = dir.appendingPathComponent(fileName)
                try? jpegData.write(to: fileURL)
                pendingItems.append(.init(kind: .attachment, value: fileName))
            }
            return
        }

        // General file copy
        let fileName = "shared-\(UUID().uuidString.prefix(8))_\(url.lastPathComponent)"
        if let dir = SharedContainerStore.sharedFileDirectory {
            let destURL = dir.appendingPathComponent(fileName)
            try? FileManager.default.copyItem(at: url, to: destURL)
            pendingItems.append(.init(kind: .attachment, value: fileName))
        }
    }

    private func processText(_ provider: NSItemProvider) async {
        guard let item = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier),
              let text = item as? String else { return }

        if text.count <= inlineTextLimit {
            pendingItems.append(.init(kind: .inlineText, value: text))
        } else {
            let fileName = "shared-text-\(UUID().uuidString.prefix(8)).txt"
            if let dir = SharedContainerStore.sharedFileDirectory {
                let fileURL = dir.appendingPathComponent(fileName)
                try? text.write(to: fileURL, atomically: true, encoding: .utf8)
                pendingItems.append(.init(kind: .attachment, value: fileName))
            }
        }
    }

    private func processImage(_ provider: NSItemProvider) async {
        if let item = try? await provider.loadItem(forTypeIdentifier: UTType.image.identifier) {
            var image: UIImage?
            if let uiImage = item as? UIImage {
                image = uiImage
            } else if let imageData = item as? Data {
                image = UIImage(data: imageData)
            } else if let url = item as? URL, let data = try? Data(contentsOf: url) {
                image = UIImage(data: data)
            }

            if let image {
                let fileName = "shared-image-\(UUID().uuidString.prefix(8)).jpg"
                if let dir = SharedContainerStore.sharedFileDirectory,
                   let jpegData = image.jpegData(compressionQuality: 0.85) {
                    let fileURL = dir.appendingPathComponent(fileName)
                    try? jpegData.write(to: fileURL)
                    pendingItems.append(.init(kind: .attachment, value: fileName))
                }
            }
        }
    }

    private func processVideo(_ provider: NSItemProvider) async {
        guard let item = try? await provider.loadItem(forTypeIdentifier: UTType.movie.identifier),
              let url = item as? URL else { return }

        let accessed = url.startAccessingSecurityScopedResource()
        defer { if accessed { url.stopAccessingSecurityScopedResource() } }

        let ext = url.pathExtension.lowercased()
        let suffix = ext.isEmpty ? "mov" : ext
        let fileName = "shared-video-\(UUID().uuidString.prefix(8)).\(suffix)"
        if let dir = SharedContainerStore.sharedFileDirectory {
            let destURL = dir.appendingPathComponent(fileName)
            try? FileManager.default.copyItem(at: url, to: destURL)
            pendingItems.append(.init(kind: .attachment, value: fileName))
        }
    }

    private func processFile(_ provider: NSItemProvider) async {
        guard let item = try? await provider.loadItem(forTypeIdentifier: UTType.item.identifier),
              let url = item as? URL else { return }

        let accessed = url.startAccessingSecurityScopedResource()
        defer { if accessed { url.stopAccessingSecurityScopedResource() } }

        let fileName = "shared-\(UUID().uuidString.prefix(8))_\(url.lastPathComponent)"
        if let dir = SharedContainerStore.sharedFileDirectory {
            let destURL = dir.appendingPathComponent(fileName)
            try? FileManager.default.copyItem(at: url, to: destURL)
            pendingItems.append(.init(kind: .attachment, value: fileName))
        }
    }
}
