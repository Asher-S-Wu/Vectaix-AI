//
//  MinisShareSheet.swift
//  MinisApp
//
//  UIKit UIActivityViewController wrapper used throughout the chat UI
//  to share minis:// files, images, audio, video, links, and previews.
//  Extracted from AIChatView.swift.
//

import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// UIKit share sheet wrapper for sharing a single URL (file or link).
struct MinisShareSheet: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> UIActivityViewController {
        let safeURL = MinisShareSheet.sanitizedShareURL(url) ?? url
        return UIActivityViewController(activityItems: [safeURL], applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}

    /// [T-share-sheet-uti] Catalyst ShareKit crash mitigation
    /// (`Minis-2026-05-18-205557.ips`): `SHKItemIsPDF` →
    /// `UTTypeGetForIdentifier` traps on file URLs whose path extension
    /// produces a malformed UTI string (empty / non-ASCII / very long
    /// extensions, or when iOS can't map the extension to a registered
    /// type). Workaround: if the URL is a file URL whose extension
    /// isn't a short ASCII-alphanumeric token that resolves to a known
    /// `UTType`, copy the file to a `.bin` neighbor in `tmp/` so the
    /// share sheet sees a vanilla `public.data` UTI and skips the
    /// PDF-detection assert. http/https URLs pass through unchanged;
    /// other schemes (minis://, file:// with no path, etc.) return
    /// nil so the caller can fall back to the raw URL — those scheme
    /// strings reach ShareKit through a different code path and have
    /// not been observed to crash.
    static func sanitizedShareURL(_ url: URL) -> URL? {
        // Non-file URLs: only sanitize http/https; let everything else
        // through untouched (ShareKit handles raw URLs via the URL
        // branch, not the file-UTI branch).
        guard url.isFileURL else {
            return nil
        }
        let ext = url.pathExtension
        if isSafePathExtension(ext) {
            return nil // original URL is fine — no copy needed
        }
        // Make a sanitized copy in tmp with a `.bin` extension. We
        // keep the basename to retain hint value in the share UI but
        // strip non-ASCII / control chars so the receiving app sees a
        // sane filename.
        let fm = FileManager.default
        let tmpDir = fm.temporaryDirectory.appendingPathComponent("share-sanitized", isDirectory: true)
        try? fm.createDirectory(at: tmpDir, withIntermediateDirectories: true)
        let baseName = sanitizedBaseName(url.deletingPathExtension().lastPathComponent)
        let stamp = String(Int(Date().timeIntervalSince1970 * 1000))
        let safeURL = tmpDir.appendingPathComponent("\(baseName)-\(stamp).bin")
        // If the source file doesn't exist or copy fails, returning
        // nil makes the caller fall back to the raw URL — better to
        // attempt the share with the original (and risk the assert
        // again) than to silently swallow the user's share request.
        guard fm.fileExists(atPath: url.path) else { return nil }
        try? fm.removeItem(at: safeURL)
        do {
            try fm.copyItem(at: url, to: safeURL)
            return safeURL
        } catch {
            return nil
        }
    }

    /// `true` iff `ext` is a short ASCII-alphanumeric string that maps
    /// to a registered `UTType`. Empty extensions, anything containing
    /// non-ASCII or punctuation, and extensions that don't resolve to
    /// a known type all fail the check — those are the inputs that
    /// can produce the ShareKit assertion.
    private static func isSafePathExtension(_ ext: String) -> Bool {
        guard !ext.isEmpty, ext.count <= 8 else { return false }
        for scalar in ext.unicodeScalars {
            // 0-9 / A-Z / a-z only.
            let v = scalar.value
            let isDigit = v >= 0x30 && v <= 0x39
            let isUpper = v >= 0x41 && v <= 0x5A
            let isLower = v >= 0x61 && v <= 0x7A
            if !(isDigit || isUpper || isLower) { return false }
        }
        return UTType(filenameExtension: ext) != nil
    }

    /// Strip non-ASCII-alnum / non-`-_.` chars from a basename so the
    /// share-sheet's filename hint is benign even if the source name
    /// contained CJK or punctuation that contributed to the original
    /// UTI mishap.
    private static func sanitizedBaseName(_ name: String) -> String {
        let allowed: Set<Character> = Set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")
        let filtered = String(name.filter { allowed.contains($0) })
        return filtered.isEmpty ? "share" : String(filtered.prefix(40))
    }
}
