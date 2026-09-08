import UIKit

private let renderLogger = AppLogger(category: "MdRenderView")

// MARK: - MarkdownRenderView

/// A lightweight UIView that renders NSAttributedString using a standalone TextKit 1
/// stack (NSTextStorage + MinisLayoutManager + NSTextContainer).
///
/// Unlike `SelectableMarkdownTextView` (UITextView), this view does NOT create
/// `_UITextViewCanvasView` tiled CALayers — text is drawn directly via
/// `NSLayoutManager.drawGlyphs/drawBackground` in `draw(_:)`. This reduces per-instance
/// memory from ~16MB (tiled layer) to ~1-2MB (single bitmap backing store).
///
/// Text selection is handled on-demand: long-press creates a temporary
/// `SelectableMarkdownTextView` overlay. Tapping links and inline code is handled
/// via gesture recognizers + TextKit character index lookup.
final class MarkdownRenderView: UIView, UIGestureRecognizerDelegate {

    // MARK: - TextKit Stack

    let textStorage: NSTextStorage
    let textLayoutManager: MinisLayoutManager
    let textContainer: NSTextContainer

    // MARK: - Attachment Tracking

    /// Active attachment subviews (code blocks, tables, images, video, audio, math).
    private(set) var attachmentViews: [UIView] = []

    /// Maps attachment identity → current UIView for reuse during streaming.
    private var attachmentViewMap: [ObjectIdentifier: UIView] = [:]

    /// Maps code block sequential index → UIView for reuse when content changes.
    private var codeBlockViewCache: [Int: UIView] = [:]

    /// Whether attachment recovery has been scheduled for the current content snapshot.
    var hasScheduledRecoveryForCurrentContent = false

    // MARK: - State

    /// The raw markdown source for "Copy Markdown" action.
    var rawMarkdown: String = ""

    /// Called when the user taps a blank (non-link, non-code) area.
    /// CGPoint is in window coordinates.
    var onTapBlank: ((CGPoint) -> Void)?

    /// Closure to open URLs (set by the SwiftUI coordinator).
    var onOpenURL: ((URL) -> Void)?

    /// Tracks the last textContainer width for rotation/size change detection.
    private var lastLayoutWidth: CGFloat = 0

    /// Tracks the last computed height for cell self-sizing invalidation.
    private var lastComputedHeight: CGFloat = 0

    /// Gesture recognizer for inline code copy + blank area tap + link tap.
    private var tapGesture: UITapGestureRecognizer?

    /// Long-press gesture recognizer for promoting to UITextView selection.
    private var longPressGesture: UILongPressGestureRecognizer?

    /// The promoted UITextView overlay (if active).
    private weak var activeTextView: SelectableMarkdownTextView?

    // MARK: - Init

    override init(frame: CGRect) {
        textStorage = NSTextStorage()
        textLayoutManager = MinisLayoutManager()
        textContainer = NSTextContainer()
        textContainer.lineFragmentPadding = 0
        textContainer.lineBreakMode = .byWordWrapping
        textLayoutManager.addTextContainer(textContainer)
        textStorage.addLayoutManager(textLayoutManager)

        super.init(frame: frame)

        backgroundColor = .clear
        isOpaque = false
        contentMode = .redraw
        clipsToBounds = true

        // Tap gesture for inline code copy, link tapping, and blank area tap.
        let tap = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
        tap.delegate = self
        addGestureRecognizer(tap)
        tapGesture = tap

        // Long-press to promote to UITextView for selection.
        let lp = UILongPressGestureRecognizer(target: self, action: #selector(handleLongPress(_:)))
        lp.minimumPressDuration = 0.4
        lp.delegate = self
        addGestureRecognizer(lp)
        longPressGesture = lp
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }

    // MARK: - Attributed Text

    /// The current attributed text being rendered.
    var attributedText: NSAttributedString? {
        get { textStorage.length > 0 ? NSAttributedString(attributedString: textStorage) : nil }
        set {
            // Clear the layer backing store immediately so stale content from a
            // previous cell reuse cycle doesn't show through before draw() runs.
            layer.contents = nil
            if let newValue {
                textStorage.setAttributedString(newValue)
            } else {
                textStorage.setAttributedString(NSAttributedString())
            }
        }
    }

    // MARK: - Sizing

    override var intrinsicContentSize: CGSize {
        // Only compute intrinsic height when text container has a valid width.
        // Before sizeThatFits sets the width, return noIntrinsicMetric to avoid
        // computing layout at an incorrect (0 or too-small) width, which would
        // cause the cell to briefly expand to a huge height then snap back.
        let width = textContainer.size.width
        guard width > 1, textStorage.length > 0 else {
            return CGSize(width: UIView.noIntrinsicMetric, height: UIView.noIntrinsicMetric)
        }
        textLayoutManager.ensureLayout(for: textContainer)
        let usedRect = textLayoutManager.usedRect(for: textContainer)
        return CGSize(width: UIView.noIntrinsicMetric, height: ceil(usedRect.height) + 4)
    }

    override func sizeThatFits(_ size: CGSize) -> CGSize {
        let width = size.width > 0 ? size.width : textContainer.size.width
        guard width > 1, textStorage.length > 0 else { return CGSize(width: size.width, height: 4) }
        textContainer.size = CGSize(width: width, height: .greatestFiniteMagnitude)
        textLayoutManager.ensureLayout(for: textContainer)
        let usedRect = textLayoutManager.usedRect(for: textContainer)
        return CGSize(width: width, height: ceil(usedRect.height) + 4)
    }

    // MARK: - Drawing

    override func draw(_ rect: CGRect) {
        guard textStorage.length > 0 else { return }
        let glyphRange = textLayoutManager.glyphRange(for: textContainer)
        guard glyphRange.length > 0 else { return }
        // Draw background (inline code pills, etc.)
        textLayoutManager.drawBackground(forGlyphRange: glyphRange, at: CGPoint.zero)
        // Draw glyphs (text + link underlines)
        textLayoutManager.drawGlyphs(forGlyphRange: glyphRange, at: CGPoint.zero)
        // Draw blockquote bars
        drawBlockquoteBars(in: rect)
    }

    // MARK: - Layout

    override func layoutSubviews() {
        super.layoutSubviews()

        let currentWidth = textContainer.size.width
        if currentWidth > 0 && currentWidth != lastLayoutWidth {
            lastLayoutWidth = currentWidth
            if !attachmentViews.isEmpty {
                refreshAttachmentViews()
            } else if hasUnrenderedAttachments {
                updateAttachmentViews()
                invalidateIntrinsicContentSize()
            }
            return
        }

        // Reposition attachment views to match fresh glyph bounding rects.
        guard !attachmentViews.isEmpty else { return }
        let fullRange = NSRange(location: 0, length: textStorage.length)
        textStorage.enumerateAttribute(.attachment, in: fullRange, options: []) { value, range, _ in
            guard let attachment = value as? NSTextAttachment else { return }
            let attachId = ObjectIdentifier(attachment)
            guard let view = self.attachmentViewMap[attachId] else { return }
            let glyphRange = self.textLayoutManager.glyphRange(forCharacterRange: range, actualCharacterRange: nil)
            let boundingRect = self.textLayoutManager.boundingRect(forGlyphRange: glyphRange, in: self.textContainer)
            // [issue #117-4] Inline formulas position from the glyph origin.
            let target = self.inlineAttachmentOrigin(
                for: attachment, characterRange: range, glyphRange: glyphRange) ?? boundingRect.origin
            if view.frame.origin != target {
                view.frame.origin = target
            }
        }
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        if window == nil {
            layer.contents = nil
            for sub in attachmentViews {
                sub.layer.contents = nil
            }
        }
    }

    // MARK: - Cell Self-Sizing Invalidation

    func invalidateCellSizeIfNeeded() {
        guard textContainer.size.width > 1 else { return }
        let newHeight = sizeThatFits(CGSize(width: textContainer.size.width, height: .greatestFiniteMagnitude)).height
        let previousHeight = lastComputedHeight
        guard abs(newHeight - previousHeight) > 1 else { return }
        lastComputedHeight = newHeight
        guard previousHeight > 0 else { return }
        // Mark intrinsic size dirty so the hosting configuration picks up the new height
        // via preferredLayoutAttributesFitting. Do NOT call invalidateLayout() directly —
        // that forces a full layout cycle on ALL cells, causing width instability and
        // cascading height oscillations during streaming.
        invalidateIntrinsicContentSize()
    }

    // MARK: - Attachment Check

    var hasUnrenderedAttachments: Bool {
        guard attachmentViews.isEmpty else { return false }
        var found = false
        textStorage.enumerateAttribute(.attachment, in: NSRange(location: 0, length: textStorage.length), options: []) { value, _, stop in
            if value != nil { found = true; stop.pointee = true }
        }
        return found
    }

    var needsAttachmentRecovery: Bool {
        var expected = 0
        textStorage.enumerateAttribute(.attachment, in: NSRange(location: 0, length: textStorage.length), options: []) { value, _, _ in
            if value != nil { expected += 1 }
        }
        guard expected > 0 else { return false }
        if attachmentViews.count != expected { return true }
        if attachmentViews.contains(where: { $0.superview !== self }) { return true }
        return false
    }

    func resetAttachmentRecoveryState() {
        hasScheduledRecoveryForCurrentContent = false
    }

    /// Coalesce guard matching `SelectableMarkdownTextView.pendingMathRefresh`.
    /// Math attachments complete asynchronously via `MathRenderScheduler`;
    /// without coalescing, each completion would trigger a full layout pass.
    private var pendingMathRefresh = false

    func scheduleCoalescedMathRefresh() {
        guard !pendingMathRefresh else { return }
        pendingMathRefresh = true
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.pendingMathRefresh = false
            self.refreshAttachmentViews()
        }
    }

    // MARK: - Attachment View Management

    func clearAllAttachmentViews() {
        for view in attachmentViews { view.removeFromSuperview() }
        attachmentViews.removeAll()
        attachmentViewMap.removeAll()
        codeBlockViewCache.removeAll()
    }

    /// [issue #117-4] Glyph-derived origin for an inline formula overlay —
    /// same rationale and geometry as SelectableMarkdownView's namesake
    /// (boundingRect reports the LINE rect vertically, which floats small
    /// inline formulas above where TextKit typeset them). Both views drive a
    /// TextKit-1 `MinisLayoutManager`, so the computation is identical; nil
    /// for every non-inline-math attachment.
    private func inlineAttachmentOrigin(
        for attachment: NSTextAttachment,
        characterRange range: NSRange,
        glyphRange: NSRange
    ) -> CGPoint? {
        guard let mathAttach = attachment as? MathAttachment, !mathAttach.isBlock else { return nil }
        guard glyphRange.length > 0 else { return nil }
        let glyphIndex = glyphRange.location
        let lineFragment = textLayoutManager.lineFragmentRect(forGlyphAt: glyphIndex, effectiveRange: nil)
        guard lineFragment.height > 0 else { return nil }
        let glyphLocation = textLayoutManager.location(forGlyphAt: glyphIndex)
        let bounds = mathAttach.attachmentBounds(
            for: textContainer,
            proposedLineFragment: lineFragment,
            glyphPosition: glyphLocation,
            characterIndex: range.location
        )
        guard bounds.height > 0 else { return nil }
        // `location(forGlyphAt:)` returns an ATTACHMENT glyph's top-of-ascent
        // (= baseline − bounds.origin.y), not the baseline, so the top edge is
        // simply glyphLoc.y − height. Verified on-device; see the fuller note
        // on SelectableMarkdownView.inlineAttachmentOrigin.
        //
        // No textContainerInset term (unlike SelectableMarkdownView): this is a
        // plain UIView drawing its glyphs at origin .zero, so container and
        // view coordinates coincide.
        return CGPoint(
            x: lineFragment.minX + glyphLocation.x + bounds.origin.x,
            y: lineFragment.minY + glyphLocation.y - bounds.height
        )
    }

    func updateAttachmentViews() {
        let previousViewMap = attachmentViewMap
        var newViews: [UIView] = []
        var newViewMap: [ObjectIdentifier: UIView] = [:]
        var reusedIds: Set<ObjectIdentifier> = []

        let fullRange = NSRange(location: 0, length: textStorage.length)
        let containerWidth = textContainer.size.width
        guard containerWidth > 1 else { return }
        textStorage.enumerateAttribute(.attachment, in: fullRange, options: []) { value, range, _ in
            guard let attachment = value as? NSTextAttachment else { return }
            let glyphRange = self.textLayoutManager.glyphRange(forCharacterRange: range, actualCharacterRange: nil)
            var boundingRect = self.textLayoutManager.boundingRect(forGlyphRange: glyphRange, in: self.textContainer)
            // Clamp width to container width — prevents table/code block views
            // from being created wider than the container during layout transitions.
            if boundingRect.width < 1 || boundingRect.width > containerWidth {
                boundingRect.size.width = containerWidth
            }
            // [issue #117-4] Inline formulas position from the glyph origin.
            let inlineOrigin = self.inlineAttachmentOrigin(
                for: attachment, characterRange: range, glyphRange: glyphRange)

            let attachId = ObjectIdentifier(attachment)
            let view: UIView

            if let existingView = previousViewMap[attachId] {
                var stale = false
                if let imageAttach = attachment as? ImageAttachment {
                    imageAttach.onLoad = { [weak self] in
                        DispatchQueue.main.async { self?.refreshAttachmentViews() }
                    }
                    imageAttach.beginLoadingIfNeeded()
                    if imageAttach.loadedImage != nil {
                        stale = !existingView.subviews.contains(where: { $0 is UIImageView || ($0.subviews.contains(where: { $0 is UIImageView })) })
                    }
                } else if let videoAttach = attachment as? VideoAttachment {
                    videoAttach.onLoad = { [weak self] in
                        DispatchQueue.main.async { self?.refreshAttachmentViews() }
                    }
                    videoAttach.beginLoadingIfNeeded()
                    if videoAttach.thumbnail != nil {
                        stale = !existingView.subviews.contains(where: { $0 is UIImageView || ($0.subviews.contains(where: { $0 is UIImageView })) })
                    }
                } else if let mathAttach = attachment as? MathAttachment {
                    mathAttach.onLoad = { [weak self] in
                        self?.scheduleCoalescedMathRefresh()
                    }
                    mathAttach.beginRenderingIfNeeded()
                    if mathAttach.renderedImage != nil {
                        stale = !existingView.subviews.contains(where: { $0 is UIImageView || ($0.subviews.contains(where: { $0 is UIImageView })) })
                    }
                } else if let codeBlock = attachment as? CodeBlockAttachment {
                    self.codeBlockViewCache[codeBlock.blockIndex] = existingView
                }

                if stale {
                    existingView.removeFromSuperview()
                    if let imageAttach = attachment as? ImageAttachment {
                        view = imageAttach.makeView(width: boundingRect.width)
                    } else if let videoAttach = attachment as? VideoAttachment {
                        view = videoAttach.makeView(width: boundingRect.width)
                    } else if let mathAttach = attachment as? MathAttachment {
                        view = mathAttach.makeView(width: boundingRect.width)
                    } else {
                        view = existingView
                    }
                } else {
                    view = existingView
                }
                reusedIds.insert(attachId)
                view.frame = CGRect(origin: inlineOrigin ?? boundingRect.origin, size: view.frame.size)
            } else if let codeBlock = attachment as? CodeBlockAttachment {
                if let previousView = self.codeBlockViewCache[codeBlock.blockIndex] {
                    codeBlock.updateExistingView(previousView)
                    view = previousView
                    // Trust updateExistingView's height — TextKit's boundingRect
                    // can be stale during streaming and would collapse the view.
                    view.frame = CGRect(
                        origin: boundingRect.origin,
                        size: CGSize(width: boundingRect.width, height: view.frame.size.height)
                    )
                } else {
                    view = codeBlock.makeView(width: boundingRect.width)
                }
                self.codeBlockViewCache[codeBlock.blockIndex] = view
            } else if let table = attachment as? TableAttachment {
                if table.onOpenURL == nil {
                    table.onOpenURL = { [weak self] url in
                        self?.onOpenURL?(url)
                    }
                }
                view = table.makeView(width: boundingRect.width)
            } else if let thematicBreak = attachment as? ThematicBreakAttachment {
                view = thematicBreak.makeView(width: boundingRect.width)
            } else if let image = attachment as? ImageAttachment {
                view = image.makeView(width: boundingRect.width)
            } else if let video = attachment as? VideoAttachment {
                view = video.makeView(width: boundingRect.width)
            } else if let audio = attachment as? AudioAttachment {
                view = audio.makeView(width: boundingRect.width)
            } else if let math = attachment as? MathAttachment {
                math.onLoad = { [weak self] in
                    self?.scheduleCoalescedMathRefresh()
                }
                view = math.makeView(width: boundingRect.width)
            } else {
                // Unknown attachment type — create a placeholder
                view = UIView(frame: CGRect(origin: .zero, size: CGSize(width: boundingRect.width, height: boundingRect.height)))
            }

            view.frame.origin = inlineOrigin ?? boundingRect.origin
            if view.superview !== self {
                self.addSubview(view)
            }
            newViews.append(view)
            newViewMap[attachId] = view
        }

        // Remove views no longer present.
        let newViewSet = Set(newViewMap.values.map { ObjectIdentifier($0) })
        for (id, view) in previousViewMap where !reusedIds.contains(id) && newViewMap[id] == nil {
            if newViewSet.contains(ObjectIdentifier(view)) { continue }
            view.removeFromSuperview()
        }

        attachmentViews = newViews
        attachmentViewMap = newViewMap
        setNeedsDisplay()
    }

    private func refreshAttachmentViews() {
        guard window != nil else { return }
        textLayoutManager.invalidateLayout(forCharacterRange: NSRange(location: 0, length: textStorage.length), actualCharacterRange: nil)
        for view in attachmentViews { view.removeFromSuperview() }
        attachmentViews.removeAll()
        attachmentViewMap.removeAll()
        codeBlockViewCache.removeAll()
        updateAttachmentViews()
        invalidateIntrinsicContentSize()
    }

    // MARK: - Blockquote Bars

    private func drawBlockquoteBars(in rect: CGRect) {
        guard let context = UIGraphicsGetCurrentContext() else { return }
        let theme = SelectableMarkdownTheme()
        let fullRange = NSRange(location: 0, length: textStorage.length)

        struct DepthSpan { var depth: Int; var minY: CGFloat; var maxY: CGFloat }
        var spans: [DepthSpan] = []

        textStorage.enumerateAttribute(.blockquoteDepth, in: fullRange, options: []) { value, range, _ in
            guard let depth = value as? Int, depth > 0 else { return }
            let glyphRange = self.textLayoutManager.glyphRange(forCharacterRange: range, actualCharacterRange: nil)
            guard glyphRange.length > 0 else { return }

            // Use per-line-fragment usedRects so the span excludes trailing
            // paragraphSpacing — otherwise the bar overshoots into the next paragraph.
            var spanRect: CGRect = .null
            self.textLayoutManager.enumerateLineFragments(forGlyphRange: glyphRange) { _, usedRect, _, _, _ in
                spanRect = spanRect.isNull ? usedRect : spanRect.union(usedRect)
            }
            guard !spanRect.isNull, !spanRect.isEmpty else { return }

            if let last = spans.last, last.depth == depth, abs(spanRect.minY - last.maxY) < 2 {
                spans[spans.count - 1].maxY = spanRect.maxY
            } else {
                spans.append(DepthSpan(depth: depth, minY: spanRect.minY, maxY: spanRect.maxY))
            }
        }

        guard !spans.isEmpty else { return }

        // Draw each bar as one continuous run.
        //
        // This used to punch holes wherever an attachment view's frame
        // overlapped the span *on the Y axis only* — it never checked whether
        // the attachment actually intersected the bar in X (x=1, width 3).
        // That broke the bar for every attachment kind: code blocks indent by
        // `quoteDepth * 13` and never cover the bar at all, yet still cut it;
        // inline math/images punched a line-height gap nowhere near the bar;
        // a quote holding only a code block lost its bar entirely.
        // No clipping is needed: attachments are subviews and therefore
        // composite above `draw(_:)`, so wherever one is actually opaque over
        // the bar it hides it exactly as the punch-out did.
        for span in spans {
            guard span.maxY > span.minY else { continue }
            let barWidth: CGFloat = 3
            let barSpacing: CGFloat = 13

            context.saveGState()
            context.setFillColor(theme.blockquoteBarColor.cgColor)
            for d in 0..<span.depth {
                let x = barSpacing * CGFloat(d) + 1
                let barRect = CGRect(x: x, y: span.minY, width: barWidth, height: span.maxY - span.minY)
                context.addPath(UIBezierPath(roundedRect: barRect, cornerRadius: 2).cgPath)
            }
            context.fillPath()
            context.restoreGState()
        }
    }

    // MARK: - Gestures

    @objc private func handleTap(_ gesture: UITapGestureRecognizer) {
        guard gesture.state == .ended else { return }
        let point = gesture.location(in: self)
        let windowPoint = convert(point, to: nil)

        // Don't handle taps on attachment views.
        for subview in attachmentViews {
            if subview.frame.contains(point) { return }
        }

        guard textStorage.length > 0 else {
            onTapBlank?(windowPoint)
            return
        }

        var fraction: CGFloat = 0
        let charIndex = textLayoutManager.characterIndex(
            for: point,
            in: textContainer,
            fractionOfDistanceBetweenInsertionPoints: &fraction
        )

        let isBeyondText = charIndex >= textStorage.length
        let isInGlyphRect: Bool
        if !isBeyondText {
            let gi = textLayoutManager.glyphIndexForCharacter(at: charIndex)
            let lineRect = textLayoutManager.lineFragmentUsedRect(forGlyphAt: gi, effectiveRange: nil)
            isInGlyphRect = lineRect.contains(point)
        } else {
            isInGlyphRect = false
        }
        let isBlankArea = isBeyondText || !isInGlyphRect

        if isBlankArea {
            onTapBlank?(windowPoint)
            return
        }

        // Check for link tap
        if let url = textStorage.attribute(.link, at: charIndex, effectiveRange: nil) as? URL {
            onOpenURL?(url)
            return
        }
        if let urlString = textStorage.attribute(.link, at: charIndex, effectiveRange: nil) as? String,
           let url = URL(string: urlString) {
            onOpenURL?(url)
            return
        }

        // Check for inline code tap → copy to pasteboard
        if textStorage.attribute(.inlineCodeText, at: charIndex, effectiveRange: nil) != nil {
            var effectiveRange = NSRange()
            textStorage.attribute(.inlineCodeText, at: charIndex, effectiveRange: &effectiveRange)
            let codeText = (textStorage.string as NSString).substring(with: effectiveRange)
            UIPasteboard.general.string = codeText
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            showCopiedFeedback(at: charIndex, range: effectiveRange)
            return
        }

        // Plain text tap — no action (not blank area, not a link, not inline code).
    }

    private func showCopiedFeedback(at charIndex: Int, range: NSRange) {
        let glyphRange = textLayoutManager.glyphRange(forCharacterRange: range, actualCharacterRange: nil)
        let rect = textLayoutManager.boundingRect(forGlyphRange: glyphRange, in: textContainer)

        let flash = UIView(frame: rect.insetBy(dx: -2, dy: -1))
        flash.backgroundColor = UIColor.systemBlue.withAlphaComponent(0.18)
        flash.layer.cornerRadius = 4
        flash.isUserInteractionEnabled = false
        addSubview(flash)

        let toast = UILabel()
        toast.text = "Copied"
        toast.font = .systemFont(ofSize: 11, weight: .medium)
        toast.textColor = .white
        toast.backgroundColor = UIColor.black.withAlphaComponent(0.75)
        toast.textAlignment = .center
        toast.layer.cornerRadius = 4
        toast.clipsToBounds = true
        toast.sizeToFit()
        toast.frame.size.width += 12
        toast.frame.size.height += 4
        toast.center = CGPoint(x: rect.midX, y: rect.minY - toast.frame.height / 2 - 4)
        if toast.frame.minX < 0 { toast.frame.origin.x = 0 }
        if toast.frame.maxX > bounds.width { toast.frame.origin.x = bounds.width - toast.frame.width }
        toast.alpha = 0
        addSubview(toast)

        UIView.animate(withDuration: 0.15) { toast.alpha = 1 }
        UIView.animate(withDuration: 0.3, delay: 0.8, options: []) {
            flash.alpha = 0
            toast.alpha = 0
        } completion: { _ in
            flash.removeFromSuperview()
            toast.removeFromSuperview()
        }
    }

    // MARK: - Long-Press → Promote to UITextView

    @objc private func handleLongPress(_ gesture: UILongPressGestureRecognizer) {
        guard gesture.state == .began else { return }
        guard textStorage.length > 0 else { return }
        promoteToTextView(at: gesture.location(in: self))
    }

    private func promoteToTextView(at point: CGPoint) {
        guard activeTextView == nil else { return }

        let tv = SelectableMarkdownTextView()
        tv.attributedText = NSAttributedString(attributedString: textStorage)
        tv.rawMarkdown = rawMarkdown
        tv.onTapBlank = onTapBlank

        // Frame matches this view, with extra padding for selection handles
        let handlePadding: CGFloat = 12
        tv.frame = CGRect(
            x: 0,
            y: -handlePadding,
            width: bounds.width,
            height: bounds.height + handlePadding * 2
        )
        tv.textContainerInset = UIEdgeInsets(top: handlePadding, left: 0, bottom: handlePadding + 4, right: 0)
        tv.backgroundColor = .clear

        activeTextView = tv
        addSubview(tv)

        // Transfer attachment views to the promoted text view temporarily.
        // They need to be children of the UITextView for TextKit coordinate system.
        // We DON'T move them — the promoted UITextView overlays on top and
        // we just hide our own rendering.
        setNeedsDisplay()

        // Select all and show menu
        DispatchQueue.main.async { [weak tv] in
            guard let tv else { return }
            tv.becomeFirstResponder()

            // Find character at the long-press point
            let adjustedPoint = CGPoint(x: point.x, y: point.y + 12) // account for handle padding
            let charIndex = tv.layoutManager.characterIndex(
                for: adjustedPoint,
                in: tv.textContainer,
                fractionOfDistanceBetweenInsertionPoints: nil
            )

            // Select the word at the tap point
            if charIndex < tv.textStorage.length {
                // Use NSString word boundary detection
                let nsStr = tv.textStorage.string as NSString
                var start = charIndex
                var end = charIndex
                // Expand to word boundaries
                while start > 0 {
                    let c = nsStr.character(at: start - 1)
                    if CharacterSet.whitespacesAndNewlines.contains(Unicode.Scalar(c)!) ||
                       CharacterSet.punctuationCharacters.contains(Unicode.Scalar(c)!) { break }
                    start -= 1
                }
                while end < nsStr.length {
                    let c = nsStr.character(at: end)
                    if CharacterSet.whitespacesAndNewlines.contains(Unicode.Scalar(c)!) ||
                       CharacterSet.punctuationCharacters.contains(Unicode.Scalar(c)!) { break }
                    end += 1
                }
                tv.selectedRange = NSRange(location: start, length: end - start)
            }
        }

        // Install a notification observer to detect when the text view resigns first responder.
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(textViewDidResignFirstResponder(_:)),
            name: UIResponder.keyboardDidHideNotification,
            object: nil
        )

        // Also observe touch outside to demote
        let dismissTap = UITapGestureRecognizer(target: self, action: #selector(handleDismissTap(_:)))
        dismissTap.cancelsTouchesInView = false
        window?.addGestureRecognizer(dismissTap)
        objc_setAssociatedObject(tv, &AssociatedKeys.dismissTap, dismissTap, .OBJC_ASSOCIATION_RETAIN)
    }

    @objc private func handleDismissTap(_ gesture: UITapGestureRecognizer) {
        guard gesture.state == .ended else { return }
        guard let tv = activeTextView else { return }
        let point = gesture.location(in: tv)
        // If tap is outside the promoted text view, demote
        if !tv.bounds.contains(point) {
            demoteTextView()
        }
    }

    @objc private func textViewDidResignFirstResponder(_ notification: Notification) {
        // Delay slightly to check if the text view actually lost focus
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
            guard let self, let tv = self.activeTextView else { return }
            if !tv.isFirstResponder {
                self.demoteTextView()
            }
        }
    }

    private func demoteTextView() {
        guard let tv = activeTextView else { return }
        // Remove dismiss tap gesture from window
        if let dismissTap = objc_getAssociatedObject(tv, &AssociatedKeys.dismissTap) as? UIGestureRecognizer {
            dismissTap.view?.removeGestureRecognizer(dismissTap)
        }
        tv.resignFirstResponder()
        tv.removeFromSuperview()
        activeTextView = nil
        NotificationCenter.default.removeObserver(self, name: UIResponder.keyboardDidHideNotification, object: nil)
        setNeedsDisplay()
    }

    private struct AssociatedKeys {
        nonisolated(unsafe) static var dismissTap: UInt8 = 0
    }

    // MARK: - Gesture Delegate

    override func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        // If promoted UITextView is active, let it handle everything
        if activeTextView != nil { return false }

        if gestureRecognizer === tapGesture {
            let point = gestureRecognizer.location(in: self)
            // Don't handle taps on attachment views
            for subview in attachmentViews {
                if subview.frame.contains(point) { return false }
            }
            return true
        }
        if gestureRecognizer === longPressGesture {
            let point = gestureRecognizer.location(in: self)
            // Don't promote on long-press inside attachment views (code blocks handle their own)
            for subview in attachmentViews {
                if subview.frame.contains(point) { return false }
            }
            return true
        }
        return true
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRequireFailureOf otherGestureRecognizer: UIGestureRecognizer) -> Bool {
        // Tap must wait for long-press to fail
        if gestureRecognizer === tapGesture && otherGestureRecognizer === longPressGesture {
            return true
        }
        return false
    }

    // MARK: - Helpers

    private func findCollectionView() -> NoAnimationCollectionView? {
        var view: UIView? = superview
        while let v = view {
            if let cv = v as? NoAnimationCollectionView { return cv }
            view = v.superview
        }
        return nil
    }
}

