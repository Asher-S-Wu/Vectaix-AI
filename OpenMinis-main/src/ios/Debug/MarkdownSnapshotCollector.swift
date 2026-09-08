#if DEBUG
import Foundation
import UIKit

/// Debug-only in-memory collector that captures full markdown rendering
/// snapshots (attributedString structure, attachment positions, view frames)
/// each time SelectableMarkdownView completes a render pass.
///
/// Default OFF. Toggle via `debug.markdownSnapshot.setEnabled` RPC.
/// Read out via `debug.markdownSnapshot.list` / `.get`.
///
/// IMPORTANT: Compiled only in DEBUG builds. Release builds get nothing.
/// The 3 collection sites inside SelectableMarkdownView guard their calls
/// with `MarkdownSnapshotCollector.isEnabled` so the off path is a single
/// atomic-load + branch — no measurable overhead.
final class MarkdownSnapshotCollector {
    static let shared = MarkdownSnapshotCollector()

    // Atomic-ish flag. Reads are lock-free; writes use the lock.
    private var _isEnabled: Bool = false
    private let lock = NSLock()

    /// Global on/off switch. Read frequently from the render hot path so we
    /// avoid the lock on read and accept the small race: a write may take a
    /// frame to be visible. Use a regular Bool with memory barrier on write.
    static var isEnabled: Bool {
        get { shared.lock.lock(); defer { shared.lock.unlock() }; return shared._isEnabled }
        set {
            shared.lock.lock()
            shared._isEnabled = newValue
            if !newValue {
                // Clear buffer when disabling so a later re-enable starts fresh.
                shared.snapshots.removeAll(keepingCapacity: true)
            }
            shared.lock.unlock()
        }
    }

    // MARK: - Snapshot model

    struct AttachmentInfo: Encodable {
        let kind: String              // e.g. "TableAttachment", "VideoAttachment"
        let charRange: ClosedIntRange // character range in storage
        let glyphRange: ClosedIntRange?
        let boundingRect: RectDesc?   // layoutManager.boundingRect(forGlyphRange:)
        let lineFragmentRect: RectDesc?
        let attachmentBoundsOwnQuery: RectDesc?  // direct attachment.attachmentBounds()
        let glyphProperty: Int?       // NSLayoutManager.GlyphProperty rawValue
        let attachmentViewFrame: RectDesc?  // actual UIView frame after render
        let attachmentViewType: String?
    }

    struct TextRunInfo: Encodable {
        let charRange: ClosedIntRange
        let preview: String           // first 60 chars
        let font: String?             // "name@size"
        let hasParagraphStyle: Bool
    }

    struct ContainerInfo: Encodable {
        let textContainerSize: SizeDesc
        let textContainerInset: EdgeInsetsDesc
        let lineFragmentPadding: Double
        let usedRect: RectDesc        // layoutManager.usedRect(for:)
        let numberOfGlyphs: Int
        let numberOfLineFragments: Int
    }

    struct Snapshot: Encodable {
        let id: String
        let timestamp: Double
        let phase: String             // "afterUpdateUIView" | "afterSizeThatFits.mtv" | "afterLayoutSubviews"
        let messageId: String?
        let textViewPointer: String   // for cross-correlation
        let textViewIsMeasureView: Bool
        let bounds: RectDesc
        let frame: RectDesc
        let intrinsicContentSize: SizeDesc?
        let contentSize: SizeDesc?
        let textStorageLen: Int
        let markdownPreview: String   // first 200 chars of textStorage.string
        let markdownTail: String      // last 100 chars
        let container: ContainerInfo
        let attachments: [AttachmentInfo]
        let textRuns: [TextRunInfo]
        let inWindow: Bool
        let sizeThatFitsResult: SizeDesc?   // size returned by sizeThatFits (mtv phase only)
        // PNG of the textView rendered at this exact phase. nil if the view
        // had zero bounds (e.g. off-screen measureTextView). Stored on the
        // snapshot itself so a later RPC fetch returns view + metadata together.
        // NOT encoded in the brief listing; only returned by `.get`.
        let imagePNGBase64: String?
        // Compact bytes count so callers can size their UI before fetching.
        let imagePNGBytes: Int
    }

    // MARK: - Tiny encodable shims

    struct RectDesc: Encodable {
        let x: Double; let y: Double; let w: Double; let h: Double
        init(_ r: CGRect) { x = Double(r.origin.x); y = Double(r.origin.y); w = Double(r.size.width); h = Double(r.size.height) }
    }
    struct SizeDesc: Encodable {
        let w: Double; let h: Double
        init(_ s: CGSize) { w = Double(s.width); h = Double(s.height) }
    }
    struct EdgeInsetsDesc: Encodable {
        let top: Double; let left: Double; let bottom: Double; let right: Double
        init(_ e: UIEdgeInsets) { top = Double(e.top); left = Double(e.left); bottom = Double(e.bottom); right = Double(e.right) }
    }
    struct ClosedIntRange: Encodable {
        let lower: Int; let upper: Int
        init(_ r: NSRange) { lower = r.location; upper = r.location + r.length }
    }

    // MARK: - Ring buffer

    private static let capacity = 64
    private var snapshots: [Snapshot] = []
    private var nextSequence: Int = 0

    /// Append a snapshot to the ring buffer (FIFO eviction).
    func append(_ s: Snapshot) {
        lock.lock()
        defer { lock.unlock() }
        snapshots.append(s)
        if snapshots.count > Self.capacity {
            snapshots.removeFirst(snapshots.count - Self.capacity)
        }
    }

    func nextId() -> String {
        lock.lock()
        defer { lock.unlock() }
        nextSequence &+= 1
        return "md-\(nextSequence)"
    }

    // MARK: - Readout

    /// Returns a list of brief snapshot summaries for the index RPC.
    func listBrief() -> [[String: Any]] {
        lock.lock()
        defer { lock.unlock() }
        return snapshots.map { s in
            [
                "id": s.id,
                "timestamp": s.timestamp,
                "phase": s.phase,
                "messageId": s.messageId ?? NSNull(),
                "textViewPointer": s.textViewPointer,
                "isMeasureView": s.textViewIsMeasureView,
                "boundsW": s.bounds.w,
                "boundsH": s.bounds.h,
                "textStorageLen": s.textStorageLen,
                "attachmentCount": s.attachments.count,
                "markdownPreview": s.markdownPreview,
                "imagePNGBytes": s.imagePNGBytes,
            ]
        }
    }

    /// Returns a full snapshot as a JSON-encodable dict.
    func getFull(id: String) -> [String: Any]? {
        lock.lock()
        defer { lock.unlock() }
        guard let s = snapshots.first(where: { $0.id == id }) else { return nil }
        // Encode to JSON then decode back to [String:Any] for the RPC envelope.
        guard let data = try? JSONEncoder().encode(s),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return obj
    }

    func clear() {
        lock.lock()
        defer { lock.unlock() }
        snapshots.removeAll(keepingCapacity: true)
    }

    // MARK: - Capture helpers (called from SelectableMarkdownView)

    /// Capture from a SelectableMarkdownTextView. Skips work entirely if disabled.
    /// `phase` tags where in the lifecycle this snapshot was taken.
    /// `messageId` is the renderer's message id if known.
    /// `isMeasureView` flags whether this is the off-screen measureTextView vs. the live uiView.
    /// `sizeThatFitsResult` is non-nil only when called right after a sizeThatFits result.
    static func captureIfEnabled(textView: UITextView,
                                 phase: String,
                                 messageId: String?,
                                 isMeasureView: Bool,
                                 sizeThatFitsResult: CGSize? = nil) {
        guard isEnabled else { return }
        shared.captureInternal(textView: textView,
                               phase: phase,
                               messageId: messageId,
                               isMeasureView: isMeasureView,
                               sizeThatFitsResult: sizeThatFitsResult)
    }

    private func captureInternal(textView: UITextView,
                                 phase: String,
                                 messageId: String?,
                                 isMeasureView: Bool,
                                 sizeThatFitsResult: CGSize?) {
        let lm = textView.layoutManager
        let tc = textView.textContainer
        guard let storage = textView.textStorage as NSTextStorage? else { return }

        // ---- Container info
        var numLineFrags = 0
        if lm.numberOfGlyphs > 0 {
            lm.enumerateLineFragments(forGlyphRange: NSRange(location: 0, length: lm.numberOfGlyphs)) { _, _, _, _, _ in
                numLineFrags += 1
            }
        }
        let container = ContainerInfo(
            textContainerSize: SizeDesc(tc.size.applying(.identity)),
            textContainerInset: EdgeInsetsDesc(textView.textContainerInset),
            lineFragmentPadding: Double(tc.lineFragmentPadding),
            usedRect: RectDesc(lm.usedRect(for: tc)),
            numberOfGlyphs: lm.numberOfGlyphs,
            numberOfLineFragments: numLineFrags
        )

        // ---- Attachments: walk every NSTextAttachment
        let storageString = storage.string as NSString
        var attachments: [AttachmentInfo] = []
        // Find any sibling UIViews on the textView (these are the attachment
        // overlays added by updateAttachmentViews). Map them by frame for
        // cross-ref against the layoutManager's boundingRect.
        let attachViews: [UIView] = textView.subviews.filter { sub in
            // Skip TextKit's internal layout/canvas/scroll-indicator views.
            let t = String(describing: type(of: sub))
            if t.hasPrefix("_UI") { return false }
            return true
        }

        storage.enumerateAttribute(.attachment, in: NSRange(location: 0, length: storage.length), options: []) { value, range, _ in
            guard let attachment = value as? NSTextAttachment else { return }
            let kind = String(describing: type(of: attachment))
            let glyphRange = lm.glyphRange(forCharacterRange: range, actualCharacterRange: nil)
            let br = lm.boundingRect(forGlyphRange: glyphRange, in: tc)
            var lineFragEff = NSRange()
            let lineFragRect: CGRect? = {
                guard glyphRange.length > 0, glyphRange.location < lm.numberOfGlyphs else { return nil }
                return lm.lineFragmentRect(forGlyphAt: glyphRange.location, effectiveRange: &lineFragEff)
            }()
            let prop: Int? = {
                guard glyphRange.length > 0, glyphRange.location < lm.numberOfGlyphs else { return nil }
                return Int(lm.propertyForGlyph(at: glyphRange.location).rawValue)
            }()
            // Direct query of attachment's own bounds (independent of layout).
            let proposedFrag = CGRect(x: 0, y: 0, width: tc.size.width, height: 1000)
            let ownBounds = attachment.attachmentBounds(for: tc, proposedLineFragment: proposedFrag, glyphPosition: .zero, characterIndex: range.location)
            // Find the matching attachment subview (heuristic: closest y to br.origin.y).
            // Cheap because the live textView usually has < 10 attachment subviews.
            let bestView: UIView? = attachViews.min(by: { a, b in
                abs(a.frame.origin.y - br.origin.y) < abs(b.frame.origin.y - br.origin.y)
            })
            attachments.append(AttachmentInfo(
                kind: kind,
                charRange: ClosedIntRange(range),
                glyphRange: glyphRange.length > 0 ? ClosedIntRange(glyphRange) : nil,
                boundingRect: RectDesc(br),
                lineFragmentRect: lineFragRect.map(RectDesc.init),
                attachmentBoundsOwnQuery: RectDesc(ownBounds),
                glyphProperty: prop,
                attachmentViewFrame: bestView.map { RectDesc($0.frame) },
                attachmentViewType: bestView.map { String(describing: type(of: $0)) }
            ))
        }

        // ---- Text runs: collect non-attachment text segments (preview only,
        // to keep snapshot size bounded).
        var textRuns: [TextRunInfo] = []
        var cursor = 0
        while cursor < storage.length {
            // Stop early if we've collected enough runs to bound memory.
            if textRuns.count >= 32 { break }
            let attrs = storage.attributes(at: cursor, effectiveRange: nil)
            var range = NSRange()
            _ = storage.attributedSubstring(from: NSRange(location: cursor, length: 1))
            // Get the effective range of the font attribute as a coarse "run".
            _ = storage.attribute(.font, at: cursor, longestEffectiveRange: &range, in: NSRange(location: cursor, length: storage.length - cursor))
            guard range.length > 0 else { cursor += 1; continue }
            let nsStr = storageString.substring(with: range)
            let preview = String(nsStr.prefix(60)).replacingOccurrences(of: "\n", with: "⏎")
            let font = (attrs[.font] as? UIFont).map { "\($0.fontName)@\(String(format: "%.0f", $0.pointSize))" }
            textRuns.append(TextRunInfo(
                charRange: ClosedIntRange(range),
                preview: preview,
                font: font,
                hasParagraphStyle: attrs[.paragraphStyle] != nil
            ))
            cursor = range.location + range.length
        }

        // Render the textView itself to a PNG. Skip when bounds are zero
        // (off-screen measureTextView during the very first sizeThatFits
        // probe — drawHierarchy would emit nothing).
        var pngBase64: String?
        var pngBytes = 0
        if textView.bounds.width > 0 && textView.bounds.height > 0 {
            let fmt = UIGraphicsImageRendererFormat()
            fmt.scale = 1.0   // 1x to keep RAM bounded
            let renderer = UIGraphicsImageRenderer(bounds: textView.bounds, format: fmt)
            let img = renderer.image { _ in
                // afterScreenUpdates:false so we don't force another layout pass
                // (we may be mid-render). For the measure view this will be a
                // mostly-empty draw since it's not in the window, but that's OK.
                textView.drawHierarchy(in: textView.bounds, afterScreenUpdates: false)
            }
            if let data = img.pngData() {
                pngBase64 = data.base64EncodedString()
                pngBytes = data.count
            }
        }

        let snapshot = Snapshot(
            id: nextId(),
            timestamp: Date().timeIntervalSince1970,
            phase: phase,
            messageId: messageId,
            textViewPointer: String(format: "%p", Int(bitPattern: Unmanaged.passUnretained(textView).toOpaque())),
            textViewIsMeasureView: isMeasureView,
            bounds: RectDesc(textView.bounds),
            frame: RectDesc(textView.frame),
            intrinsicContentSize: SizeDesc(textView.intrinsicContentSize),
            contentSize: SizeDesc(textView.contentSize),
            textStorageLen: storage.length,
            markdownPreview: String(storage.string.prefix(200)).replacingOccurrences(of: "\n", with: "⏎"),
            markdownTail: String(storage.string.suffix(100)).replacingOccurrences(of: "\n", with: "⏎"),
            container: container,
            attachments: attachments,
            textRuns: textRuns,
            inWindow: textView.window != nil,
            sizeThatFitsResult: sizeThatFitsResult.map(SizeDesc.init),
            imagePNGBase64: pngBase64,
            imagePNGBytes: pngBytes
        )
        append(snapshot)
    }
}

// MARK: - MessageListSnapshotCollector

/// Debug-only in-memory collector for the entire CollectionView message-list
/// hierarchy: collection-view geometry, every visible cell's frame, and inside
/// each cell every NSTextAttachment's character range + boundingRect +
/// matched attachment-subview frame. Distinguished from
/// `MarkdownSnapshotCollector` (which scopes to a single textView): this one
/// is for inter-cell / collection-level diagnosis — e.g. "after layoutSubviews
/// finishes table container is at y=248, but 5 seconds later it has moved
/// back to y=0 — who moved it?".
///
/// Default OFF. Toggle via `debug.messageListSnapshot.setEnabled`.
/// Compiled only in DEBUG.
final class MessageListSnapshotCollector {
    static let shared = MessageListSnapshotCollector()

    private var _isEnabled: Bool = false
    private let lock = NSLock()

    static var isEnabled: Bool {
        get { shared.lock.lock(); defer { shared.lock.unlock() }; return shared._isEnabled }
        set {
            shared.lock.lock()
            shared._isEnabled = newValue
            if !newValue { shared.snapshots.removeAll(keepingCapacity: true) }
            shared.lock.unlock()
        }
    }

    // MARK: - Snapshot model

    struct AttachmentEntry: Encodable {
        let kind: String
        let charRange: MarkdownSnapshotCollector.ClosedIntRange
        let boundingRect: MarkdownSnapshotCollector.RectDesc?  // from layoutManager.boundingRect
        let glyphProperty: Int?
        // Matched subview (heuristic: closest-y subview inside textView).
        let subviewFrame: MarkdownSnapshotCollector.RectDesc?
        let subviewType: String?
        let subviewPointer: String?
    }

    struct CellEntry: Encodable {
        let cellType: String
        let cellPointer: String
        let cellFrame: MarkdownSnapshotCollector.RectDesc
        let indexPath: [Int]?
        // Optional textView (only present for cells that host a SelectableMarkdownTextView)
        let textViewPointer: String?
        let textViewFrame: MarkdownSnapshotCollector.RectDesc?
        let textViewBounds: MarkdownSnapshotCollector.RectDesc?
        let textStorageLen: Int?
        let textContainerSize: MarkdownSnapshotCollector.SizeDesc?
        let usedRect: MarkdownSnapshotCollector.RectDesc?
        let attachments: [AttachmentEntry]
        let markdownPreview: String?
    }

    struct Snapshot: Encodable {
        let id: String
        let timestamp: Double
        let trigger: String           // "manual" | "cell.PLAF" | "mtv.layoutSubviews" | "mtv.updateAttachmentViews" | "manual"
        let triggerDetail: String?    // arbitrary context (e.g. ptr of view that triggered)
        // Collection-view state
        let collectionViewPointer: String?
        let collectionViewBounds: MarkdownSnapshotCollector.RectDesc?
        let collectionViewContentOffset: MarkdownSnapshotCollector.SizeDesc?  // x as w, y as h (reuse)
        let collectionViewContentSize: MarkdownSnapshotCollector.SizeDesc?
        let cells: [CellEntry]
        // Optional screenshot of the collection view itself.
        let imagePNGBase64: String?
        let imagePNGBytes: Int
    }

    // MARK: - Ring buffer

    private static let capacity = 128
    private var snapshots: [Snapshot] = []
    private var nextSequence: Int = 0

    func append(_ s: Snapshot) {
        lock.lock(); defer { lock.unlock() }
        snapshots.append(s)
        if snapshots.count > Self.capacity {
            snapshots.removeFirst(snapshots.count - Self.capacity)
        }
    }

    func nextId() -> String {
        lock.lock(); defer { lock.unlock() }
        nextSequence &+= 1
        return "ml-\(nextSequence)"
    }

    func listBrief() -> [[String: Any]] {
        lock.lock(); defer { lock.unlock() }
        return snapshots.map { s in
            [
                "id": s.id,
                "timestamp": s.timestamp,
                "trigger": s.trigger,
                "triggerDetail": s.triggerDetail ?? NSNull(),
                "cellCount": s.cells.count,
                "imagePNGBytes": s.imagePNGBytes,
                "collectionContentOffsetY": s.collectionViewContentOffset?.h ?? -1,
            ]
        }
    }

    func getFull(id: String) -> [String: Any]? {
        lock.lock(); defer { lock.unlock() }
        guard let s = snapshots.first(where: { $0.id == id }) else { return nil }
        guard let data = try? JSONEncoder().encode(s),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return obj
    }

    func clear() {
        lock.lock(); defer { lock.unlock() }
        snapshots.removeAll(keepingCapacity: true)
    }

    // MARK: - Capture entry point

    /// Walk the chain UIView → first ancestor UICollectionView, then snapshot
    /// every visible cell.  Skips work entirely if disabled.
    static func captureIfEnabled(from anyView: UIView?,
                                 trigger: String,
                                 triggerDetail: String? = nil) {
        guard isEnabled else { return }
        guard let cv = MessageListSnapshotCollector.findCollectionView(from: anyView) else { return }
        shared.captureInternal(collectionView: cv, trigger: trigger, triggerDetail: triggerDetail)
    }

    /// Manual capture from a specific UICollectionView (e.g. via RPC).
    static func captureManually(collectionView: UICollectionView) {
        guard isEnabled else { return }
        shared.captureInternal(collectionView: collectionView, trigger: "manual", triggerDetail: nil)
    }

    private static func findCollectionView(from start: UIView?) -> UICollectionView? {
        var node: UIView? = start
        while let cur = node {
            if let cv = cur as? UICollectionView { return cv }
            node = cur.superview
        }
        return nil
    }

    private func captureInternal(collectionView cv: UICollectionView,
                                 trigger: String,
                                 triggerDetail: String?) {
        // ---- Collect cell entries
        var cells: [CellEntry] = []
        for cell in cv.visibleCells {
            let ip = cv.indexPath(for: cell)
            let cellType = String(describing: type(of: cell))
            let cellPtr = String(format: "%p", Int(bitPattern: Unmanaged.passUnretained(cell).toOpaque()))

            // Look for a SelectableMarkdownTextView anywhere inside the cell.
            var foundMtv: UITextView?
            func searchMtv(_ v: UIView) {
                if foundMtv != nil { return }
                if String(describing: type(of: v)) == "SelectableMarkdownTextView" {
                    foundMtv = v as? UITextView
                    return
                }
                for sub in v.subviews { searchMtv(sub); if foundMtv != nil { return } }
            }
            searchMtv(cell)

            var attachEntries: [AttachmentEntry] = []
            var textViewPtr: String?
            var textViewFrame: MarkdownSnapshotCollector.RectDesc?
            var textViewBounds: MarkdownSnapshotCollector.RectDesc?
            var textStorageLen: Int?
            var textContainerSize: MarkdownSnapshotCollector.SizeDesc?
            var usedRect: MarkdownSnapshotCollector.RectDesc?
            var markdownPreview: String?

            if let tv = foundMtv {
                textViewPtr = String(format: "%p", Int(bitPattern: Unmanaged.passUnretained(tv).toOpaque()))
                textViewFrame = MarkdownSnapshotCollector.RectDesc(tv.frame)
                textViewBounds = MarkdownSnapshotCollector.RectDesc(tv.bounds)
                let storage = tv.textStorage
                textStorageLen = storage.length
                textContainerSize = MarkdownSnapshotCollector.SizeDesc(tv.textContainer.size)
                usedRect = MarkdownSnapshotCollector.RectDesc(tv.layoutManager.usedRect(for: tv.textContainer))
                markdownPreview = String(storage.string.prefix(120)).replacingOccurrences(of: "\n", with: "⏎")

                // Candidate attachment subviews (skip TextKit internals).
                let attachViews: [UIView] = tv.subviews.filter { sub in
                    let t = String(describing: type(of: sub))
                    return !t.hasPrefix("_UI")
                }

                storage.enumerateAttribute(.attachment, in: NSRange(location: 0, length: storage.length), options: []) { value, range, _ in
                    guard let attach = value as? NSTextAttachment else { return }
                    let kind = String(describing: type(of: attach))
                    let glyphRange = tv.layoutManager.glyphRange(forCharacterRange: range, actualCharacterRange: nil)
                    let br = tv.layoutManager.boundingRect(forGlyphRange: glyphRange, in: tv.textContainer)
                    let prop: Int? = {
                        guard glyphRange.length > 0, glyphRange.location < tv.layoutManager.numberOfGlyphs else { return nil }
                        return Int(tv.layoutManager.propertyForGlyph(at: glyphRange.location).rawValue)
                    }()
                    // Pick the closest-y subview not yet claimed.
                    let bestView: UIView? = attachViews.min(by: { a, b in
                        abs(a.frame.origin.y - br.origin.y) < abs(b.frame.origin.y - br.origin.y)
                    })
                    attachEntries.append(AttachmentEntry(
                        kind: kind,
                        charRange: MarkdownSnapshotCollector.ClosedIntRange(range),
                        boundingRect: MarkdownSnapshotCollector.RectDesc(br),
                        glyphProperty: prop,
                        subviewFrame: bestView.map { MarkdownSnapshotCollector.RectDesc($0.frame) },
                        subviewType: bestView.map { String(describing: type(of: $0)) },
                        subviewPointer: bestView.map { String(format: "%p", Int(bitPattern: Unmanaged.passUnretained($0).toOpaque())) }
                    ))
                }
            }

            cells.append(CellEntry(
                cellType: cellType,
                cellPointer: cellPtr,
                cellFrame: MarkdownSnapshotCollector.RectDesc(cell.frame),
                indexPath: ip.map { [$0.section, $0.item] },
                textViewPointer: textViewPtr,
                textViewFrame: textViewFrame,
                textViewBounds: textViewBounds,
                textStorageLen: textStorageLen,
                textContainerSize: textContainerSize,
                usedRect: usedRect,
                attachments: attachEntries,
                markdownPreview: markdownPreview
            ))
        }

        // ---- Capture a 1× PNG of the collection-view bounds region.
        // The collection view itself doesn't render off-screen content; this
        // is the same visual the user sees minus chrome.
        var pngBase64: String?
        var pngBytes = 0
        if cv.bounds.width > 0 && cv.bounds.height > 0 {
            let fmt = UIGraphicsImageRendererFormat()
            fmt.scale = 1.0
            let renderer = UIGraphicsImageRenderer(bounds: cv.bounds, format: fmt)
            let img = renderer.image { _ in
                cv.drawHierarchy(in: cv.bounds, afterScreenUpdates: false)
            }
            if let data = img.pngData() {
                pngBase64 = data.base64EncodedString()
                pngBytes = data.count
            }
        }

        let snapshot = Snapshot(
            id: nextId(),
            timestamp: Date().timeIntervalSince1970,
            trigger: trigger,
            triggerDetail: triggerDetail,
            collectionViewPointer: String(format: "%p", Int(bitPattern: Unmanaged.passUnretained(cv).toOpaque())),
            collectionViewBounds: MarkdownSnapshotCollector.RectDesc(cv.bounds),
            collectionViewContentOffset: MarkdownSnapshotCollector.SizeDesc(CGSize(width: cv.contentOffset.x, height: cv.contentOffset.y)),
            collectionViewContentSize: MarkdownSnapshotCollector.SizeDesc(cv.contentSize),
            cells: cells,
            imagePNGBase64: pngBase64,
            imagePNGBytes: pngBytes
        )
        append(snapshot)
    }
}
#endif
