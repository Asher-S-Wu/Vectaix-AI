#if DEBUG
import UIKit

@MainActor
final class DebugViewInspector {

    // MARK: - View Node

    struct ViewNode {
        let type: String
        let address: String
        let frame: CGRect
        let bounds: CGRect
        let identifier: String?
        let isHidden: Bool
        let alpha: CGFloat
        let clipsToBounds: Bool
        let backgroundColor: String?
        let intrinsicContentSize: CGSize
        let constraints: [[String: Any]]
        let superviewType: String?
        let children: [ViewNode]
    }

    // MARK: - Public API

    func buildTree(maxDepth: Int = 50) -> [[String: Any]] {
        var results: [[String: Any]] = []
        let budget = makeBudget()
        for window in walkableWindows() {
            results.append(nodeDict(for: window, depth: 0, maxDepth: maxDepth, budget: budget))
            if budget.aborted { break }
        }
        return results
    }

    func search(keyword: String, scope: String = "all") -> [[String: Any]] {
        var matches: [[String: Any]] = []
        let budget = makeBudget()
        for window in walkableWindows() {
            searchRecursive(view: window, depth: 0, keyword: keyword, scope: scope, matches: &matches, budget: budget)
            if budget.aborted { break }
        }
        return matches
    }

    func inspect(address: String) -> [String: Any]? {
        guard let view = findView(byAddress: address) else { return nil }
        return detailedDict(for: view)
    }

    func highlight(address: String, color: String = "red", duration: Double = 2.0) -> Bool {
        guard let view = findView(byAddress: address) else { return false }

        let uiColor = parseColor(color)
        let originalBorderColor = view.layer.borderColor
        let originalBorderWidth = view.layer.borderWidth

        view.layer.borderColor = uiColor.cgColor
        view.layer.borderWidth = 3.0

        DispatchQueue.main.asyncAfter(deadline: .now() + duration) {
            view.layer.borderColor = originalBorderColor
            view.layer.borderWidth = originalBorderWidth
        }

        return true
    }

    // MARK: - Private Helpers

    private func allWindows() -> [UIWindow] {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
    }

    private func nodeDict(for view: UIView, depth: Int, maxDepth: Int, budget: WalkBudget) -> [String: Any] {
        guard budget.step(view, depth: depth) else {
            return ["type": String(describing: type(of: view)),
                    "address": addressString(for: view),
                    "truncated": true]
        }
        var dict: [String: Any] = [
            "type": String(describing: type(of: view)),
            "address": addressString(for: view),
            "frame": frameDict(view.frame),
        ]

        if let identifier = view.accessibilityIdentifier, !identifier.isEmpty {
            dict["identifier"] = identifier
        }
        // SwiftUI content (Text/Button/Label) is invisible to a pure subviews
        // walk — it only surfaces via NSObject.accessibilityLabel. Include it
        // whenever it's set so /debug.search {scope:"text"} can find it.
        if let label = view.accessibilityLabel, !label.isEmpty {
            dict["label"] = label
        }
        if let value = view.accessibilityValue, !value.isEmpty {
            dict["value"] = value
        }
        // UIInteraction objects — drag, drop, context menus, pointer, text
        // interactions. These are NOT subviews and NOT gesture recognizers, so
        // a tree walk without them cannot answer the question that matters when
        // one of those features silently does nothing: "is the interaction
        // actually installed, and on WHICH view?" (SwiftUI in particular hoists
        // `.draggable` / `.dropDestination` / `.onDrop` off the view they were
        // written on and onto a shared container, which is invisible without
        // this.) Emitted only when non-empty so ordinary nodes stay compact.
        //
        // Drag interactions additionally report their enabled flag: an
        // interaction can be present but switched off (e.g. a collection view
        // with dragInteractionEnabled = false), and the class name alone would
        // read as "installed and working".
        let interactionNames = view.interactions.map { interaction -> String in
            let name = String(describing: type(of: interaction))
            if let drag = interaction as? UIDragInteraction {
                return name + (drag.isEnabled ? "(enabled)" : "(DISABLED)")
            }
            return name
        }
        if !interactionNames.isEmpty {
            dict["interactions"] = interactionNames
        }
        // Gesture recognizers, with the disabled ones marked. UIKit leaves
        // plenty of recognizers attached-but-disabled, and telling those apart
        // is the difference between "this gesture lost arbitration" and "this
        // gesture was never in the running".
        if let recognizers = view.gestureRecognizers, !recognizers.isEmpty {
            dict["gestures"] = recognizers.map { recognizer -> String in
                let name = String(describing: type(of: recognizer))
                return recognizer.isEnabled ? name : name + "(disabled)"
            }
        }
        if depth < maxDepth && shouldDescend(into: view) {
            // Merge the UIKit subview tree with any explicit accessibility
            // element children exposed by SwiftUI hosting views. Both flat
            // arrays and index-based accessibilityElement(at:) are supported.
            var combined: [[String: Any]] = []
            for sub in view.subviews {
                if budget.aborted { break }
                combined.append(nodeDict(for: sub, depth: depth + 1, maxDepth: maxDepth, budget: budget))
            }
            if !budget.aborted {
                let axNodes = accessibilityChildNodes(for: view, depth: depth + 1, maxDepth: maxDepth, budget: budget)
                combined.append(contentsOf: axNodes)
            }
            if !combined.isEmpty {
                dict["children"] = combined
            }
        }

        return dict
    }

    /// SwiftUI's hosting views expose the rendered `Text`/`Button`/`Label`
    /// content as UIAccessibilityElement objects — either via
    /// `accessibilityElements` (an array) or `accessibilityElementCount()` +
    /// `accessibilityElement(at:)`. Neither shows up in `view.subviews`, so a
    /// tree walk that doesn't include them misses everything a screen reader
    /// would see. This helper materialises those elements as pseudo-nodes.
    private func accessibilityChildNodes(for view: NSObject, depth: Int, maxDepth: Int, budget: WalkBudget) -> [[String: Any]] {
        var out: [[String: Any]] = []
        for el in accessibilityChildren(of: view, budget: budget) {
            if budget.aborted { break }
            out.append(accessibilityNodeDict(for: el, depth: depth, maxDepth: maxDepth, budget: budget))
        }
        return out
    }

    private func accessibilityNodeDict(for element: NSObject, depth: Int, maxDepth: Int, budget: WalkBudget) -> [String: Any] {
        guard budget.step(element, depth: depth) else {
            return ["type": "AX." + String(describing: type(of: element)),
                    "address": addressString(for: element),
                    "truncated": true]
        }
        var dict: [String: Any] = [
            "type": "AX." + String(describing: type(of: element)),
            "address": addressString(for: element),
        ]
        if let label = element.accessibilityLabel, !label.isEmpty { dict["label"] = label }
        if let value = element.accessibilityValue, !value.isEmpty { dict["value"] = value }
        if let identifier = axIdentifier(element), !identifier.isEmpty {
            dict["identifier"] = identifier
        }
        let frame = element.accessibilityFrame
        if frame != .zero { dict["frame"] = frameDict(frame) }
        let traits = element.accessibilityTraits
        if traits.rawValue != 0 { dict["traits"] = traitsString(traits) }
        // Leaf accessibility elements very rarely have further children in
        // practice; skipping keeps the walk fast and avoids a class of
        // SwiftUI hangs. Real containers (which ARE UIViews) still recurse.
        return dict
    }

    private func addressString(for object: NSObject) -> String {
        String(format: "0x%llx", UInt(bitPattern: ObjectIdentifier(object)))
    }

    /// accessibilityIdentifier is declared by the `UIAccessibilityIdentification`
    /// protocol, adopted by UIView and UIAccessibilityElement — but not by bare
    /// NSObject. Narrow via the protocol so the caller can pass either kind.
    private func axIdentifier(_ node: NSObject) -> String? {
        (node as? UIAccessibilityIdentification)?.accessibilityIdentifier
    }

    private func traitsString(_ traits: UIAccessibilityTraits) -> String {
        var parts: [String] = []
        if traits.contains(.button) { parts.append("button") }
        if traits.contains(.link) { parts.append("link") }
        if traits.contains(.header) { parts.append("header") }
        if traits.contains(.selected) { parts.append("selected") }
        if traits.contains(.staticText) { parts.append("staticText") }
        if traits.contains(.image) { parts.append("image") }
        if traits.contains(.searchField) { parts.append("searchField") }
        if traits.contains(.tabBar) { parts.append("tabBar") }
        if traits.contains(.updatesFrequently) { parts.append("updatesFrequently") }
        if traits.contains(.notEnabled) { parts.append("notEnabled") }
        return parts.joined(separator: "|")
    }

    private func searchRecursive(view: UIView, depth: Int, keyword: String, scope: String, matches: inout [[String: Any]], budget: WalkBudget) {
        guard budget.step(view, depth: depth) else { return }
        matchAndAppend(node: view, keyword: keyword, scope: scope, matches: &matches)
        guard shouldDescend(into: view) else { return }
        for subview in view.subviews {
            if budget.aborted { return }
            searchRecursive(view: subview, depth: depth + 1, keyword: keyword, scope: scope, matches: &matches, budget: budget)
        }
        // Follow the accessibility element tree too — SwiftUI Text/Button
        // content lives here, not under subviews. Only for real UIViews; the
        // element leaves themselves rarely have useful children.
        for el in accessibilityChildren(of: view, budget: budget) {
            if budget.aborted { return }
            guard budget.step(el, depth: depth + 1) else { return }
            matchAndAppend(node: el, keyword: keyword, scope: scope, matches: &matches)
        }
    }

    /// Match a UIView OR a UIAccessibilityElement against the keyword. `scope`
    /// widens progressively: type < identifier < text (label+value) < all.
    private func matchAndAppend(node: NSObject, keyword: String, scope: String, matches: inout [[String: Any]]) {
        let typeName = String(describing: type(of: node))
        let identifier = axIdentifier(node) ?? ""
        let label = node.accessibilityLabel ?? ""
        let value = node.accessibilityValue ?? ""
        // UILabel/UITextField/UITextView carry their real text on `text`, not
        // just accessibilityLabel — include it so a search for "MiniMax" hits.
        let text = (node as? UILabel)?.text
            ?? (node as? UITextField)?.text
            ?? (node as? UITextView)?.text
            ?? ""
        let lowerKeyword = keyword.lowercased()

        let hitType = typeName.lowercased().contains(lowerKeyword)
        let hitIdent = identifier.lowercased().contains(lowerKeyword)
        let hitText = label.lowercased().contains(lowerKeyword)
            || value.lowercased().contains(lowerKeyword)
            || text.lowercased().contains(lowerKeyword)

        let matched: Bool
        switch scope {
        case "type":       matched = hitType
        case "identifier": matched = hitIdent
        case "text":       matched = hitText
        default:           matched = hitType || hitIdent || hitText  // "all"
        }
        guard matched else { return }

        var dict: [String: Any] = [
            "type": typeName,
            "address": addressString(for: node),
        ]
        if let view = node as? UIView {
            dict["frame"] = frameDict(view.frame)
        } else {
            let frame = node.accessibilityFrame
            if frame != .zero { dict["frame"] = frameDict(frame) }
        }
        if !identifier.isEmpty { dict["identifier"] = identifier }
        if !label.isEmpty { dict["label"] = label }
        if !value.isEmpty { dict["value"] = value }
        if !text.isEmpty && text != label { dict["text"] = text }
        matches.append(dict)
    }

    func findView(byAddress address: String) -> UIView? {
        for window in allWindows() {
            if let found = findViewRecursive(view: window, address: address) {
                return found
            }
        }
        return nil
    }

    private func findViewRecursive(view: UIView, address: String) -> UIView? {
        if addressString(for: view) == address {
            return view
        }
        for subview in view.subviews {
            if let found = findViewRecursive(view: subview, address: address) {
                return found
            }
        }
        return nil
    }

    // MARK: - Tap-target resolution

    /// Result of an accessibility-based lookup. Either a live UIView (UIKit
    /// path) or a plain UIAccessibilityElement (SwiftUI path — has no view but
    /// carries a screen-space frame and can be activated).
    enum TapTarget {
        case view(UIView)
        case element(NSObject, frame: CGRect)

        /// Screen-space centre suitable for synthesising a touch.
        var screenPoint: CGPoint {
            switch self {
            case .view(let v):
                let bounds = v.bounds
                let centre = CGPoint(x: bounds.midX, y: bounds.midY)
                return v.convert(centre, to: nil)
            case .element(_, let frame):
                return CGPoint(x: frame.midX, y: frame.midY)
            }
        }
    }

    /// Bounded walk state carried through the recursion. Ensures no lookup
    /// can hang the main thread even if a SwiftUI hosting view's accessibility
    /// tree is degenerate (cycles, lazily-materialised subtrees that themselves
    /// hang, etc.).
    ///
    /// Why every one of these matters:
    ///   - `deadline` — reading `accessibilityElements` on some SwiftUI hosting
    ///     views forces the framework to lay out unmaterialised subtrees; that
    ///     can be arbitrarily slow. Hard-stop after the wall time budget.
    ///   - `remaining` — a runaway visit counter is the last line of defence
    ///     against unbounded traversal even when depth and visited both look
    ///     benign (e.g. a very wide, very shallow tree).
    ///   - `visited` — proxies returned by `accessibilityElement(at:)` are
    ///     sometimes the same NSObject as a container we already saw. Without
    ///     a visited set the recursion loops forever.
    ///   - `maxDepth` — cheap defence-in-depth for accidental cycles that
    ///     slip past the visited set (e.g. same address rewritten with a new
    ///     ObjectIdentifier bit pattern).
    private final class WalkBudget {
        let deadline: CFAbsoluteTime
        var remaining: Int
        var visited: Set<ObjectIdentifier> = []
        let maxDepth: Int
        init(timeout: CFTimeInterval, maxNodes: Int, maxDepth: Int) {
            self.deadline = CFAbsoluteTimeGetCurrent() + timeout
            self.remaining = maxNodes
            self.maxDepth = maxDepth
        }
        /// Returns true when we should stop walking. `aborted` sticks so a
        /// caller can distinguish "no match" from "budget exhausted".
        var aborted: Bool = false
        func step(_ node: NSObject, depth: Int) -> Bool {
            if aborted { return false }
            if depth > maxDepth { aborted = true; return false }
            if CFAbsoluteTimeGetCurrent() > deadline { aborted = true; return false }
            let id = ObjectIdentifier(node)
            if visited.contains(id) { return false }
            visited.insert(id)
            remaining -= 1
            if remaining <= 0 { aborted = true; return false }
            return true
        }
    }

    /// Default budget: 1.5s wall clock, 5000 nodes, depth 40. Empirically well
    /// clear of a real SwiftUI screen (a settings view is a few hundred nodes)
    /// but hard enough that even a pathological hosting view returns quickly.
    private func makeBudget() -> WalkBudget {
        WalkBudget(timeout: 1.5, maxNodes: 5000, maxDepth: 40)
    }

    /// Windows we're willing to walk. Restricts to foreground scenes and skips
    /// system-owned auxiliary windows (keyboards, remote views) whose
    /// accessibility subsystems are the most likely to stall.
    private func walkableWindows() -> [UIWindow] {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .filter { $0.activationState == .foregroundActive || $0.activationState == .foregroundInactive }
            .flatMap { $0.windows }
            .filter { $0.isKeyWindow || $0.isHidden == false }
    }

    /// Look for anything on screen whose accessibilityIdentifier equals
    /// `identifier`. Prefers exact match; walks both the UIView tree and the
    /// SwiftUI-exposed accessibility element tree, but never for longer than
    /// the walk budget.
    func findTarget(identifier: String) -> TapTarget? {
        let budget = makeBudget()
        for window in walkableWindows() {
            if let hit = findTargetIdentifierRecursive(node: window, depth: 0, identifier: identifier, budget: budget) {
                return hit
            }
            if budget.aborted { break }
        }
        return nil
    }

    private func findTargetIdentifierRecursive(node: NSObject, depth: Int, identifier: String, budget: WalkBudget) -> TapTarget? {
        guard budget.step(node, depth: depth) else { return nil }
        if (axIdentifier(node) ?? "") == identifier {
            return targetFor(node: node)
        }
        if let view = node as? UIView {
            guard shouldDescend(into: view) else { return nil }
            for sub in view.subviews {
                if let hit = findTargetIdentifierRecursive(node: sub, depth: depth + 1, identifier: identifier, budget: budget) { return hit }
                if budget.aborted { return nil }
            }
        }
        // UIAccessibilityElement leaves rarely have meaningful children of
        // their own; probing them is a common cause of accessibility-subsystem
        // stalls. Only descend into element containers that are UIViews.
        if node is UIView {
            for el in accessibilityChildren(of: node, budget: budget) {
                if let hit = findTargetIdentifierRecursive(node: el, depth: depth + 1, identifier: identifier, budget: budget) { return hit }
                if budget.aborted { return nil }
            }
        }
        return nil
    }

    /// Look for anything whose accessibilityLabel or (for UILabel-like views)
    /// text matches — exact when `partial == false`, substring otherwise.
    /// Returns the first match; you can pass `preferHittable == true` to skip
    /// nodes whose screen frame is zero or fully off-screen.
    func findTarget(text: String, partial: Bool, preferHittable: Bool = true) -> TapTarget? {
        let budget = makeBudget()
        var fallback: TapTarget?
        for window in walkableWindows() {
            if let hit = findTargetTextRecursive(node: window, depth: 0, text: text, partial: partial,
                                                 preferHittable: preferHittable, fallback: &fallback, budget: budget) {
                return hit
            }
            if budget.aborted { break }
        }
        return fallback
    }

    private func findTargetTextRecursive(node: NSObject, depth: Int, text: String, partial: Bool,
                                         preferHittable: Bool, fallback: inout TapTarget?, budget: WalkBudget) -> TapTarget? {
        guard budget.step(node, depth: depth) else { return nil }
        let needle = partial ? text.lowercased() : text
        let candidates: [String] = [
            node.accessibilityLabel ?? "",
            node.accessibilityValue ?? "",
            (node as? UILabel)?.text ?? "",
            (node as? UIButton)?.currentTitle ?? "",
            (node as? UITextField)?.text ?? "",
            (node as? UITextField)?.placeholder ?? "",
        ]
        let matched = candidates.contains { candidate in
            if candidate.isEmpty { return false }
            if partial { return candidate.lowercased().contains(needle) }
            return candidate == needle
        }
        if matched {
            let target = targetFor(node: node)
            if isHittable(target) {
                return target
            } else if !preferHittable {
                return target
            } else if fallback == nil {
                fallback = target
            }
        }
        if let view = node as? UIView {
            guard shouldDescend(into: view) else { return nil }
            for sub in view.subviews {
                if let hit = findTargetTextRecursive(node: sub, depth: depth + 1, text: text, partial: partial,
                                                    preferHittable: preferHittable, fallback: &fallback, budget: budget) {
                    return hit
                }
                if budget.aborted { return nil }
            }
        }
        if node is UIView {
            for el in accessibilityChildren(of: node, budget: budget) {
                if let hit = findTargetTextRecursive(node: el, depth: depth + 1, text: text, partial: partial,
                                                    preferHittable: preferHittable, fallback: &fallback, budget: budget) {
                    return hit
                }
                if budget.aborted { return nil }
            }
        }
        return nil
    }

    /// True when a UIView subtree is worth descending into. Skips fully hidden,
    /// transparent, or zero-sized branches — both to prune search work AND to
    /// avoid forcing SwiftUI's accessibility subsystem to lazily materialise
    /// content the user can't see (which is a common source of hangs).
    private func shouldDescend(into view: UIView) -> Bool {
        if view.isHidden { return false }
        if view.alpha < 0.01 { return false }
        // Very small / zero-sized subtrees can still be legitimate containers
        // that lay out inside a scroll view, so only skip when both dims are
        // exactly zero (uninitialised).
        if view.bounds.width == 0 && view.bounds.height == 0 && view.subviews.isEmpty { return false }
        return true
    }

    /// Bounded version of `accessibilityChildren(of:)` used inside walks.
    /// Reads either `accessibilityElements` or `accessibilityElement(at:)`,
    /// but only when we still have budget — the `accessibilityElements` read
    /// itself is one of the calls that can be slow on SwiftUI hosting views.
    private func accessibilityChildren(of node: NSObject, budget: WalkBudget) -> [NSObject] {
        if budget.aborted { return [] }
        if CFAbsoluteTimeGetCurrent() > budget.deadline {
            budget.aborted = true; return []
        }
        if let arr = node.accessibilityElements as? [NSObject] { return arr }
        let count = node.accessibilityElementCount()
        guard count > 0 else { return [] }
        // Cap fan-out per level so a container that pretends to have millions
        // of children (rare but observed) can't stall us.
        let limit = min(count, 512)
        var out: [NSObject] = []
        out.reserveCapacity(limit)
        for i in 0..<limit {
            if budget.aborted { break }
            if let el = node.accessibilityElement(at: i) as? NSObject { out.append(el) }
        }
        return out
    }

    private func targetFor(node: NSObject) -> TapTarget {
        if let view = node as? UIView {
            return .view(view)
        }
        return .element(node, frame: node.accessibilityFrame)
    }

    private func isHittable(_ target: TapTarget) -> Bool {
        switch target {
        case .view(let v):
            guard v.window != nil, !v.isHidden, v.alpha > 0.01,
                  v.isUserInteractionEnabled else { return false }
            let bounds = v.bounds
            if bounds.width < 1 || bounds.height < 1 { return false }
            return true
        case .element(_, let frame):
            return frame.width > 1 && frame.height > 1
        }
    }

    private func accessibilityChildren(of node: NSObject) -> [NSObject] {
        if let arr = node.accessibilityElements as? [NSObject] { return arr }
        let count = node.accessibilityElementCount()
        return (0..<max(0, count)).compactMap { node.accessibilityElement(at: $0) as? NSObject }
    }

    // MARK: - Escalation from matched leaf → actionable ancestor

    /// A concrete, dispatchable action derived from a matched TapTarget.
    /// SwiftUI's rendered `Text` shows up in accessibility as a static-text
    /// node — activating it does nothing. Real interactivity lives on an
    /// ancestor (a UIControl, a UICollectionViewCell whose collection view
    /// runs delegate-driven selection, an accessibility node marked
    /// `.button`, etc.). This enum names what we can actually invoke.
    enum ActionableTarget {
        case control(UIControl)
        case collectionCell(UICollectionView, IndexPath, UICollectionViewCell)
        case tableCell(UITableView, IndexPath, UITableViewCell)
        case buttonElement(NSObject)                       // has .button trait
        case activatableView(UIView)                       // accessibilityActivate → true
        case coordinate(CGPoint)                           // synthetic-tap fallback

        var description: String {
            switch self {
            case .control(let c):                 return "control:\(type(of: c))"
            case .collectionCell(_, let ip, _):   return "collectionCell:\(ip.section)-\(ip.item)"
            case .tableCell(_, let ip, _):        return "tableCell:\(ip.section)-\(ip.row)"
            case .buttonElement(let n):           return "buttonElement:\(type(of: n))"
            case .activatableView(let v):         return "activatableView:\(type(of: v))"
            case .coordinate:                     return "coordinate"
            }
        }
    }

    /// Turn a matched TapTarget into an ActionableTarget by walking upward
    /// until we find something that will actually respond. Prefers, in order:
    ///   1. The matched view itself if it's a UIControl (button/switch/etc).
    ///   2. Any accessibility-trait `.button` on the matched element/view.
    ///   3. A UIControl ancestor.
    ///   4. A UICollectionViewCell / UITableViewCell ancestor (which we can
    ///      dispatch through the containing view's delegate).
    ///   5. A UIView ancestor whose `accessibilityActivate()` returns true.
    ///   6. Fall back to a synthetic coordinate tap at the target's centre.
    ///
    /// Ancestor walk covers BOTH `view.superview` chains AND — for accessibility
    /// elements that live outside the view tree — a hit-test at the element's
    /// on-screen centre followed by that view's superview chain.
    func resolveActionable(_ target: TapTarget) -> ActionableTarget {
        let point = target.screenPoint
        let baseView: UIView?
        switch target {
        case .view(let v):
            baseView = v
            if let control = v as? UIControl { return .control(control) }
            if v.accessibilityTraits.contains(.button) { return .activatableView(v) }
        case .element(let node, _):
            baseView = hitTestAtScreenPoint(point)
            if node.accessibilityTraits.contains(.button) { return .buttonElement(node) }
        }

        // Walk up from baseView (or the hit-tested view) looking for
        // controls, cells, or a nearby button-trait ancestor.
        var v: UIView? = baseView
        var depth = 0
        while let cur = v, depth < 24 {
            if let control = cur as? UIControl, control.isEnabled { return .control(control) }
            if let cell = cur as? UICollectionViewCell,
               let cv = enclosingCollectionView(cell),
               let ip = cv.indexPath(for: cell) {
                return .collectionCell(cv, ip, cell)
            }
            if let cell = cur as? UITableViewCell,
               let tv = enclosingTableView(cell),
               let ip = tv.indexPath(for: cell) {
                return .tableCell(tv, ip, cell)
            }
            if cur.accessibilityTraits.contains(.button) { return .activatableView(cur) }
            v = cur.superview
            depth += 1
        }
        return .coordinate(point)
    }

    /// Screen-point hit test into whatever the current key window sees. Returns
    /// nil if no window is present or the point falls outside every window.
    private func hitTestAtScreenPoint(_ point: CGPoint) -> UIView? {
        for window in walkableWindows() {
            let local = window.convert(point, from: nil)
            if let hit = window.hitTest(local, with: nil) { return hit }
        }
        return nil
    }

    private func enclosingCollectionView(_ view: UIView) -> UICollectionView? {
        var v: UIView? = view.superview
        while let cur = v {
            if let cv = cur as? UICollectionView { return cv }
            v = cur.superview
        }
        return nil
    }

    private func enclosingTableView(_ view: UIView) -> UITableView? {
        var v: UIView? = view.superview
        while let cur = v {
            if let tv = cur as? UITableView { return tv }
            v = cur.superview
        }
        return nil
    }

    private func detailedDict(for view: UIView) -> [String: Any] {
        var dict: [String: Any] = [
            "type": String(describing: type(of: view)),
            "address": addressString(for: view),
            "frame": frameDict(view.frame),
            "bounds": frameDict(view.bounds),
            "intrinsicContentSize": sizeDict(view.intrinsicContentSize),
            "isHidden": view.isHidden,
            "alpha": view.alpha,
            "clipsToBounds": view.clipsToBounds,
            "isUserInteractionEnabled": view.isUserInteractionEnabled,
            "childCount": view.subviews.count,
        ]

        if let bg = view.backgroundColor {
            dict["backgroundColor"] = colorString(bg)
        }

        if let identifier = view.accessibilityIdentifier {
            dict["identifier"] = identifier
        }

        if let superview = view.superview {
            dict["superviewType"] = String(describing: type(of: superview))
            dict["superviewAddress"] = addressString(for: superview)
        }

        // Same interaction / gesture reporting as the tree walk — see the note
        // in `nodeDict`. `debug.inspect` is the "tell me everything about this
        // one view" call, so it would be odd for it to omit what the cheaper
        // tree dump already shows.
        let interactionNames = view.interactions.map { interaction -> String in
            let name = String(describing: type(of: interaction))
            if let drag = interaction as? UIDragInteraction {
                return name + (drag.isEnabled ? "(enabled)" : "(DISABLED)")
            }
            return name
        }
        if !interactionNames.isEmpty {
            dict["interactions"] = interactionNames
        }
        if let recognizers = view.gestureRecognizers, !recognizers.isEmpty {
            dict["gestures"] = recognizers.map { recognizer -> String in
                let name = String(describing: type(of: recognizer))
                return recognizer.isEnabled ? name : name + "(disabled)"
            }
        }

        // -- Transform (detect scaling / rotation / translation) --
        let t = view.transform
        if t != .identity {
            dict["transform"] = [
                "a": t.a, "b": t.b, "c": t.c, "d": t.d, "tx": t.tx, "ty": t.ty,
            ]
        }

        // -- Layer info --
        let layer = view.layer
        dict["cornerRadius"] = layer.cornerRadius
        if layer.borderWidth > 0 {
            dict["borderWidth"] = layer.borderWidth
            if let bc = layer.borderColor {
                dict["borderColor"] = colorString(UIColor(cgColor: bc))
            }
        }
        if layer.shadowOpacity > 0 {
            dict["shadow"] = [
                "opacity": layer.shadowOpacity,
                "radius": layer.shadowRadius,
                "offset": ["w": layer.shadowOffset.width, "h": layer.shadowOffset.height],
            ] as [String: Any]
        }
        if layer.mask != nil {
            dict["hasMask"] = true
        }
        if layer.opacity < 1.0 {
            dict["layerOpacity"] = layer.opacity
        }

        // -- Content mode --
        dict["contentMode"] = contentModeString(view.contentMode)

        // -- Safe area insets --
        let safeArea = view.safeAreaInsets
        if safeArea != .zero {
            dict["safeAreaInsets"] = insetsDict(safeArea)
        }

        // -- Layout margins --
        let margins = view.layoutMargins
        if margins != .zero {
            dict["layoutMargins"] = insetsDict(margins)
        }

        // -- UIScrollView properties --
        if let sv = view as? UIScrollView {
            dict["contentSize"] = sizeDict(sv.contentSize)
            dict["contentOffset"] = ["x": sv.contentOffset.x, "y": sv.contentOffset.y]
            dict["contentInset"] = insetsDict(sv.contentInset)
            dict["adjustedContentInset"] = insetsDict(sv.adjustedContentInset)
            dict["isScrollEnabled"] = sv.isScrollEnabled
            dict["isPagingEnabled"] = sv.isPagingEnabled
            dict["bounces"] = sv.bounces
            dict["alwaysBounceVertical"] = sv.alwaysBounceVertical
            dict["alwaysBounceHorizontal"] = sv.alwaysBounceHorizontal
            dict["showsVerticalScrollIndicator"] = sv.showsVerticalScrollIndicator
            dict["showsHorizontalScrollIndicator"] = sv.showsHorizontalScrollIndicator
            dict["isDragging"] = sv.isDragging
            dict["isDecelerating"] = sv.isDecelerating
            dict["isTracking"] = sv.isTracking
            dict["contentLayoutGuide"] = frameDict(sv.contentLayoutGuide.layoutFrame)
            dict["frameLayoutGuide"] = frameDict(sv.frameLayoutGuide.layoutFrame)
            if sv.contentSize.height > sv.bounds.height {
                let maxOffset = sv.contentSize.height + sv.adjustedContentInset.bottom - sv.bounds.height
                dict["scrollableHeight"] = maxOffset
                dict["scrollProgress"] = maxOffset > 0 ? sv.contentOffset.y / maxOffset : 0
            }
        }

        // -- UICollectionView properties --
        if let cv = view as? UICollectionView {
            dict["numberOfSections"] = cv.numberOfSections
            var sectionCounts: [Int] = []
            for s in 0..<cv.numberOfSections {
                sectionCounts.append(cv.numberOfItems(inSection: s))
            }
            dict["numberOfItemsPerSection"] = sectionCounts
            dict["visibleCells"] = cv.visibleCells.count
            dict["indexPathsForVisibleItems"] = cv.indexPathsForVisibleItems.map { "\($0.section)-\($0.item)" }
            if let layout = cv.collectionViewLayout as? UICollectionViewFlowLayout {
                dict["flowLayout"] = [
                    "scrollDirection": layout.scrollDirection == .vertical ? "vertical" : "horizontal",
                    "itemSize": sizeDict(layout.itemSize),
                    "minimumLineSpacing": layout.minimumLineSpacing,
                    "minimumInteritemSpacing": layout.minimumInteritemSpacing,
                    "sectionInset": insetsDict(layout.sectionInset),
                ]
            }
            dict["layoutType"] = String(describing: type(of: cv.collectionViewLayout))
        }

        // -- UITableView properties --
        if let tv = view as? UITableView {
            dict["numberOfSections"] = tv.numberOfSections
            var sectionCounts: [Int] = []
            for s in 0..<tv.numberOfSections {
                sectionCounts.append(tv.numberOfRows(inSection: s))
            }
            dict["numberOfRowsPerSection"] = sectionCounts
            dict["visibleCells"] = tv.visibleCells.count
            dict["rowHeight"] = tv.rowHeight
            dict["estimatedRowHeight"] = tv.estimatedRowHeight
            dict["style"] = tv.style == .plain ? "plain" : "grouped"
        }

        // -- UILabel properties --
        if let label = view as? UILabel {
            let text = label.text ?? ""
            dict["text"] = text.count > 200 ? String(text.prefix(200)) + "..." : text
            dict["font"] = "\(label.font.fontName) \(label.font.pointSize)"
            dict["textColor"] = colorString(label.textColor)
            dict["numberOfLines"] = label.numberOfLines
            dict["textAlignment"] = alignmentString(label.textAlignment)
            dict["lineBreakMode"] = lineBreakString(label.lineBreakMode)
        }

        // -- UIImageView properties --
        if let iv = view as? UIImageView {
            dict["hasImage"] = iv.image != nil
            if let img = iv.image {
                dict["imageSize"] = sizeDict(img.size)
                dict["imageScale"] = img.scale
            }
            dict["isAnimating"] = iv.isAnimating
        }

        // -- UIButton properties --
        if let btn = view as? UIButton {
            dict["isEnabled"] = btn.isEnabled
            dict["isSelected"] = btn.isSelected
            dict["isHighlighted"] = btn.isHighlighted
            if let title = btn.currentTitle {
                dict["title"] = title
            }
        }

        // -- UITextField / UITextView --
        if let tf = view as? UITextField {
            dict["text"] = tf.text ?? ""
            dict["placeholder"] = tf.placeholder ?? ""
            dict["isEditing"] = tf.isEditing
            dict["isFirstResponder"] = tf.isFirstResponder
            // [T-provider-label-keyboard] The keyboard a field will actually raise.
            // Without this, "does this field show a number pad?" was only answerable
            // by tapping it and eyeballing a screenshot — and a synthetic tap does
            // not reliably move SwiftUI focus, so it was effectively unverifiable.
            dict["keyboardType"] = Self.keyboardTypeName(tf.keyboardType)
            dict["textContentType"] = tf.textContentType?.rawValue ?? ""
            dict["autocapitalizationType"] = tf.autocapitalizationType.rawValue
            dict["isSecureTextEntry"] = tf.isSecureTextEntry
        }
        if let tv = view as? UITextView {
            let text = tv.text ?? ""
            dict["text"] = text.count > 200 ? String(text.prefix(200)) + "..." : text
            dict["isEditable"] = tv.isEditable
            dict["isSelectable"] = tv.isSelectable
            dict["isFirstResponder"] = tv.isFirstResponder
        }

        // -- UIStackView properties --
        if let sv = view as? UIStackView {
            dict["axis"] = sv.axis == .horizontal ? "horizontal" : "vertical"
            dict["distribution"] = stackDistributionString(sv.distribution)
            dict["alignment"] = stackAlignmentString(sv.alignment)
            dict["spacing"] = sv.spacing
        }

        // -- Constraints --
        let constraintsList = view.constraints.map { c -> [String: Any] in
            [
                "id": String(format: "0x%llx", UInt(bitPattern: ObjectIdentifier(c))),
                "constant": c.constant,
                "priority": c.priority.rawValue,
                "isActive": c.isActive,
                "description": c.description,
            ]
        }
        if !constraintsList.isEmpty {
            dict["constraints"] = constraintsList
        }

        // -- Ambiguous layout detection --
        if view.hasAmbiguousLayout {
            dict["hasAmbiguousLayout"] = true
        }

        // -- Gesture recognizers --
        if let grs = view.gestureRecognizers, !grs.isEmpty {
            dict["gestureRecognizers"] = grs.map { gr -> [String: Any] in
                [
                    "type": String(describing: type(of: gr)),
                    "isEnabled": gr.isEnabled,
                    "state": gestureStateString(gr.state),
                ]
            }
        }

        return dict
    }

    // MARK: - Formatting Helpers

    private func insetsDict(_ insets: UIEdgeInsets) -> [String: CGFloat] {
        ["top": insets.top, "left": insets.left, "bottom": insets.bottom, "right": insets.right]
    }

    private func contentModeString(_ mode: UIView.ContentMode) -> String {
        switch mode {
        case .scaleToFill: return "scaleToFill"
        case .scaleAspectFit: return "scaleAspectFit"
        case .scaleAspectFill: return "scaleAspectFill"
        case .redraw: return "redraw"
        case .center: return "center"
        case .top: return "top"
        case .bottom: return "bottom"
        case .left: return "left"
        case .right: return "right"
        case .topLeft: return "topLeft"
        case .topRight: return "topRight"
        case .bottomLeft: return "bottomLeft"
        case .bottomRight: return "bottomRight"
        @unknown default: return "unknown(\(mode.rawValue))"
        }
    }

    private func alignmentString(_ alignment: NSTextAlignment) -> String {
        switch alignment {
        case .left: return "left"
        case .center: return "center"
        case .right: return "right"
        case .justified: return "justified"
        case .natural: return "natural"
        @unknown default: return "unknown"
        }
    }

    private func lineBreakString(_ mode: NSLineBreakMode) -> String {
        switch mode {
        case .byWordWrapping: return "wordWrap"
        case .byCharWrapping: return "charWrap"
        case .byClipping: return "clip"
        case .byTruncatingHead: return "truncHead"
        case .byTruncatingTail: return "truncTail"
        case .byTruncatingMiddle: return "truncMiddle"
        @unknown default: return "unknown"
        }
    }

    private func stackDistributionString(_ d: UIStackView.Distribution) -> String {
        switch d {
        case .fill: return "fill"
        case .fillEqually: return "fillEqually"
        case .fillProportionally: return "fillProportionally"
        case .equalSpacing: return "equalSpacing"
        case .equalCentering: return "equalCentering"
        @unknown default: return "unknown"
        }
    }

    private func stackAlignmentString(_ a: UIStackView.Alignment) -> String {
        switch a {
        case .fill: return "fill"
        case .leading: return "leading"
        case .firstBaseline: return "firstBaseline"
        case .center: return "center"
        case .trailing: return "trailing"
        case .lastBaseline: return "lastBaseline"
        @unknown default: return "unknown"
        }
    }

    private func gestureStateString(_ state: UIGestureRecognizer.State) -> String {
        switch state {
        case .possible: return "possible"
        case .began: return "began"
        case .changed: return "changed"
        case .ended: return "ended"
        case .cancelled: return "cancelled"
        case .failed: return "failed"
        @unknown default: return "unknown"
        }
    }

    private func frameDict(_ rect: CGRect) -> [String: CGFloat] {
        ["x": rect.origin.x, "y": rect.origin.y, "w": rect.size.width, "h": rect.size.height]
    }

    private func sizeDict(_ size: CGSize) -> [String: CGFloat] {
        ["w": size.width, "h": size.height]
    }

    private func colorString(_ color: UIColor) -> String {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        color.getRed(&r, green: &g, blue: &b, alpha: &a)
        return String(format: "rgba(%.0f,%.0f,%.0f,%.2f)", r * 255, g * 255, b * 255, a)
    }

    /// [T-provider-label-keyboard] Readable name for a `UIKeyboardType`, so a
    /// caller can assert "this field is `.default`, not `.numberPad`" without
    /// decoding a raw Int.
    static func keyboardTypeName(_ t: UIKeyboardType) -> String {
        switch t {
        case .default: return "default"
        case .asciiCapable: return "asciiCapable"
        case .numbersAndPunctuation: return "numbersAndPunctuation"
        case .URL: return "URL"
        case .numberPad: return "numberPad"
        case .phonePad: return "phonePad"
        case .namePhonePad: return "namePhonePad"
        case .emailAddress: return "emailAddress"
        case .decimalPad: return "decimalPad"
        case .twitter: return "twitter"
        case .webSearch: return "webSearch"
        case .asciiCapableNumberPad: return "asciiCapableNumberPad"
        @unknown default: return "unknown(\(t.rawValue))"
        }
    }

    private func parseColor(_ name: String) -> UIColor {
        switch name.lowercased() {
        case "red": return .systemRed
        case "green": return .systemGreen
        case "blue": return .systemBlue
        case "yellow": return .systemYellow
        case "orange": return .systemOrange
        case "purple": return .systemPurple
        case "cyan": return .systemCyan
        default: return .systemRed
        }
    }
}
#endif
