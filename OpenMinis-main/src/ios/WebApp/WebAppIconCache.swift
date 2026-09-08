import Foundation
import UIKit

private let iconCacheLogger = AppLogger(category: "WebAppIconCache")

/// Manages the on-disk bitmap cache for WebApp-shortcut icons under
/// `Library/WebAppIconCache/`. Bitmaps written here are referenced by
/// `WebAppShortcut.iconCachePath` (sandbox-relative). Files are owned 1:1 by
/// shortcut id so deleting a shortcut can deterministically delete its icon.
enum WebAppIconCache {
    /// Path component below `Library/` where all icon bitmaps live.
    static let directoryName = "WebAppIconCache"

    /// Absolute URL of the cache directory. Idempotently created.
    static func directoryURL() -> URL {
        let lib = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first!
        let dir = lib.appendingPathComponent(directoryName, isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    /// Sandbox-relative path stored in `WebAppShortcut.iconCachePath`. Survives
    /// container UUID rotation (we recompute the absolute URL at read time).
    static func relativePath(forShortcutId id: String) -> String {
        // Encoded as "<dir>/<id>.png" — we always write PNG since iOS's
        // home-screen icon pipeline copes with PNG more reliably than JPEG
        // (transparency, alpha-premultiplication).
        "\(directoryName)/\(id).png"
    }

    /// Convert a stored relative path to an absolute URL.
    static func resolveURL(relativePath: String) -> URL {
        let lib = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first!
        return lib.appendingPathComponent(relativePath)
    }

    /// Write a bitmap for the given shortcut id. Resizes to `targetEdge`
    /// (default 192px, sized for iOS home-screen rendering at @2x/@3x) and
    /// encodes as PNG. Returns the sandbox-relative path on success.
    @discardableResult
    static func write(_ image: UIImage, forShortcutId id: String, targetEdge: CGFloat = 192) -> String? {
        let resized = resize(image, longestEdge: targetEdge)
        guard let data = resized.pngData() else {
            iconCacheLogger.warning("write: pngData failed for id=\(id.prefix(8))")
            return nil
        }
        let dir = directoryURL()
        let url = dir.appendingPathComponent("\(id).png")
        do {
            try data.write(to: url, options: .atomic)
            return relativePath(forShortcutId: id)
        } catch {
            iconCacheLogger.error("write: failed for id=\(id.prefix(8)) err=\(error)")
            return nil
        }
    }

    /// Read a cached bitmap by shortcut id. Returns nil when missing.
    static func read(forShortcutId id: String) -> UIImage? {
        let url = directoryURL().appendingPathComponent("\(id).png")
        guard let data = try? Data(contentsOf: url) else { return nil }
        return UIImage(data: data)
    }

    /// Delete the cached bitmap for a shortcut id, if any. Safe to call when
    /// the file doesn't exist.
    static func delete(forShortcutId id: String) {
        let url = directoryURL().appendingPathComponent("\(id).png")
        try? FileManager.default.removeItem(at: url)
    }

    // MARK: - Private

    /// Aspect-fit downscale with no upscale. Handles both the
    /// HTML-extracted icon (often 180×180 / 192×192 already) and a photo
    /// from the picker (much bigger).
    private static func resize(_ image: UIImage, longestEdge: CGFloat) -> UIImage {
        let size = image.size
        let longest = max(size.width, size.height)
        if longest <= longestEdge { return image }
        let scale = longestEdge / longest
        let target = CGSize(width: size.width * scale, height: size.height * scale)
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1.0  // store at exact pixel dimensions, not @screen scale
        let renderer = UIGraphicsImageRenderer(size: target, format: format)
        return renderer.image { _ in
            image.draw(in: CGRect(origin: .zero, size: target))
        }
    }
}
