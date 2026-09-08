#if DEBUG
import UIKit
import ObjectiveC

/// Debug-only on-screen overlay that draws a semi-transparent rectangle +
/// type/address/frame label on top of every matching UIView. Useful for
/// visually inspecting margins, sizes, and stacking order without poking
/// the simulator's view debugger.
///
/// Driven by a 30fps display link so overlays follow their host view's frame
/// changes automatically — no swizzling required.
///
/// API (via RPC):
///   - `debug.debugOverlay.setEnabled` — start/stop
///   - `debug.debugOverlay.setMode`    — choose what to highlight
///
/// IMPORTANT: DEBUG-only. Compiled out of release builds.
final class DebugViewOverlay {
    static let shared = DebugViewOverlay()

    enum Mode {
        case all
        case byType(String)        // exact class name
        case byTypePrefix(String)  // class name has prefix
        case byAddress(String)     // hex address "0x..."
    }

    private var displayLink: CADisplayLink?
    private var mode: Mode = .all
    private(set) var isEnabled: Bool = false
    // Associate overlay layer to its target view via associated objects.
    private static var assocKey: UInt8 = 0

    // MARK: - Public toggles (called from the RPC handler on main actor)

    func setEnabled(_ enabled: Bool) {
        assert(Thread.isMainThread)
        if enabled == isEnabled { return }
        isEnabled = enabled
        if enabled {
            startDisplayLink()
        } else {
            stopDisplayLink()
            removeAllOverlays()
        }
    }

    func setMode(_ newMode: Mode) {
        assert(Thread.isMainThread)
        self.mode = newMode
        if isEnabled {
            // Force a full sweep on mode change so overlays for the previous
            // selector are removed and the new selector gets covered.
            removeAllOverlays()
        }
    }

    // MARK: - Display link

    private func startDisplayLink() {
        let link = CADisplayLink(target: self, selector: #selector(tick))
        // 30fps is plenty — overlay accuracy doesn't need 60.
        if #available(iOS 15.0, *) {
            link.preferredFrameRateRange = CAFrameRateRange(minimum: 15, maximum: 30, preferred: 30)
        }
        link.add(to: .main, forMode: .common)
        self.displayLink = link
    }

    private func stopDisplayLink() {
        displayLink?.invalidate()
        displayLink = nil
    }

    @objc private func tick() {
        guard isEnabled else { return }
        for scene in UIApplication.shared.connectedScenes {
            guard let ws = scene as? UIWindowScene else { continue }
            for w in ws.windows where !w.isHidden {
                visit(w)
            }
        }
    }

    // MARK: - Tree walk

    private func visit(_ view: UIView) {
        // Skip our own overlay layers' host views? We attach a CALayer not a
        // UIView, so no extra tracking needed — but skip windows themselves
        // (they cover the entire screen and a full-screen highlight is noise).
        if !(view is UIWindow), shouldHighlight(view) {
            updateOverlay(on: view)
        } else {
            // If this view used to be highlighted but no longer matches, peel.
            removeOverlay(from: view)
        }
        for sub in view.subviews { visit(sub) }
    }

    private func shouldHighlight(_ v: UIView) -> Bool {
        let typeName = String(describing: type(of: v))
        // Skip TextKit internals (they fill the entire textView and add noise).
        if typeName.hasPrefix("_UI") { return false }
        switch mode {
        case .all:
            return v.bounds.width > 0 && v.bounds.height > 0
        case .byType(let t):
            return typeName == t
        case .byTypePrefix(let t):
            return typeName.hasPrefix(t)
        case .byAddress(let addr):
            let myAddr = String(format: "%p", Int(bitPattern: Unmanaged.passUnretained(v).toOpaque()))
            return myAddr == addr
        }
    }

    // MARK: - Overlay layer attach/update/remove

    private func updateOverlay(on view: UIView) {
        let existing = objc_getAssociatedObject(view, &Self.assocKey) as? OverlayLayer
        let overlay = existing ?? makeOverlay(for: view)
        if existing == nil {
            // Newly attached.
            objc_setAssociatedObject(view, &Self.assocKey, overlay, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
            view.layer.addSublayer(overlay)
        }
        overlay.refresh(for: view)
        // Make sure overlay sits on top of any later-added sublayers each tick.
        overlay.zPosition = 9_999
    }

    private func removeOverlay(from view: UIView) {
        guard let overlay = objc_getAssociatedObject(view, &Self.assocKey) as? OverlayLayer else { return }
        overlay.removeFromSuperlayer()
        objc_setAssociatedObject(view, &Self.assocKey, nil, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
    }

    private func removeAllOverlays() {
        for scene in UIApplication.shared.connectedScenes {
            guard let ws = scene as? UIWindowScene else { continue }
            for w in ws.windows { peel(w) }
        }
    }

    private func peel(_ view: UIView) {
        removeOverlay(from: view)
        for sub in view.subviews { peel(sub) }
    }

    private func makeOverlay(for view: UIView) -> OverlayLayer {
        let layer = OverlayLayer()
        layer.color = Self.colorFor(typeName: String(describing: type(of: view)))
        return layer
    }

    // MARK: - Color hashing

    private static func colorFor(typeName: String) -> UIColor {
        // FNV-1a 32-bit
        var hash: UInt32 = 2166136261
        for b in typeName.utf8 {
            hash = (hash ^ UInt32(b)) &* 16777619
        }
        let hue = CGFloat(hash & 0xFFFF) / CGFloat(0xFFFF)
        return UIColor(hue: hue, saturation: 0.8, brightness: 1.0, alpha: 1.0)
    }
}

// MARK: - OverlayLayer

private final class OverlayLayer: CALayer {
    var color: UIColor = .systemPink {
        didSet { applyColor() }
    }
    private let textLayer = CATextLayer()

    override init() {
        super.init()
        commonInit()
    }
    override init(layer: Any) {
        super.init(layer: layer)
        commonInit()
    }
    required init?(coder: NSCoder) { fatalError() }

    private func commonInit() {
        // Don't animate frame updates — sticky overlays should snap instantly
        // to wherever the host view moved.
        actions = [
            "position": NSNull(),
            "bounds": NSNull(),
            "frame": NSNull(),
            "backgroundColor": NSNull(),
            "borderColor": NSNull(),
        ]
        borderWidth = 1
        textLayer.fontSize = 9
        textLayer.foregroundColor = UIColor.white.cgColor
        textLayer.alignmentMode = .left
        textLayer.contentsScale = UIScreen.main.scale
        textLayer.isWrapped = true
        textLayer.actions = ["position": NSNull(), "bounds": NSNull(), "string": NSNull()]
        addSublayer(textLayer)
        applyColor()
    }

    private func applyColor() {
        backgroundColor = color.withAlphaComponent(0.18).cgColor
        // Border a hair darker than the fill so the rectangle reads as a frame.
        borderColor = color.withAlphaComponent(0.85).cgColor
    }

    func refresh(for view: UIView) {
        // Overlay covers the host view's bounds, in the host's coordinate
        // system (we are a sublayer of view.layer).
        let b = view.bounds
        frame = b
        // Label content + position.
        let typeName = String(describing: type(of: view))
        let addr = String(format: "%p", Int(bitPattern: Unmanaged.passUnretained(view).toOpaque()))
        let f = view.frame
        let lines = [
            typeName,
            addr,
            String(format: "x=%.0f y=%.0f", f.origin.x, f.origin.y),
            String(format: "w=%.0f h=%.0f", f.size.width, f.size.height),
        ]
        textLayer.string = lines.joined(separator: "\n")
        // Anchor label to top-left with small padding; cap to view bounds.
        let labelW = min(b.width - 4, 120)
        let labelH = min(b.height - 4, 50)
        textLayer.frame = CGRect(x: 2, y: 2, width: max(0, labelW), height: max(0, labelH))
        // Backdrop for text legibility.
        textLayer.backgroundColor = UIColor.black.withAlphaComponent(0.6).cgColor
    }
}
#endif
