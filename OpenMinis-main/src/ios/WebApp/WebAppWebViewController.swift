import SwiftUI
import UIKit
import WebKit

private let webAppWebLogger = AppLogger(category: "WebAppWeb")

/// Fullscreen, immersive WKWebView host that renders one WebAppShortcut.
/// Hides the status bar and the host nav bar to give the HTML the entire
/// screen. Intentionally minimal — no tab strip, no URL bar, no JS bridge.
///
/// Security posture:
///   - Loads only via `loadFileURL(_:allowingReadAccessTo:)`. The supplied
///     scope root from `WebAppPathResolver` bounds what the page can pull in.
///   - Navigation policy rejects every non-`file:` / non-`about:` URL.
///     `http://`, `https://`, `data:`, and any custom scheme (including our
///     own `minis://`) are blocked so a hostile HTML can't escape into the
///     real browser or the host app.
///   - Persistent website data store, isolated per shortcut by its UUID
///     (iOS 17+ `WKWebsiteDataStore(forIdentifier:)`; `.default()` on older
///     OSes). Cookies / localStorage / sessionStorage carry over between
///     launches so logged-in shortcuts stay logged in, and each shortcut's
///     session is walled off from every other shortcut's.
///   - No `WKScriptMessageHandler` registered. `window.webkit` is unset.
final class WebAppWebViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private let shortcut: WebAppShortcut
    private let resolved: WebAppPathResolver.Resolved
    private var webView: WKWebView!
    private var dismissEdgeRecognizer: UIScreenEdgePanGestureRecognizer!

    init(shortcut: WebAppShortcut, resolved: WebAppPathResolver.Resolved) {
        self.shortcut = shortcut
        self.resolved = resolved
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .fullScreen
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { [.bottom] }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black

        let cfg = WKWebViewConfiguration()
        // Persistent, per-shortcut-isolated storage so cookies / localStorage /
        // sessionStorage survive across launches (no repeated logins). iOS 17+
        // gives each shortcut its own on-disk store keyed by its UUID, so two
        // shortcuts never share a session; older OSes fall back to the shared
        // default store (still persistent, but not isolated).
        if #available(iOS 17.0, *) {
            cfg.websiteDataStore = WKWebsiteDataStore(forIdentifier: UUID(uuidString: shortcut.id) ?? UUID())
        } else {
            cfg.websiteDataStore = .default()
        }
        cfg.suppressesIncrementalRendering = false
        cfg.allowsInlineMediaPlayback = true
        // No JS bridge: leave userContentController bare. Don't register
        // any WKScriptMessageHandler, don't inject a WKUserScript that
        // exposes native APIs.
        if #available(iOS 14.0, *) {
            cfg.defaultWebpagePreferences.allowsContentJavaScript = true
        }

        let wv = WKWebView(frame: view.bounds, configuration: cfg)
        wv.translatesAutoresizingMaskIntoConstraints = false
        wv.navigationDelegate = self
        wv.uiDelegate = self
        wv.isOpaque = false
        wv.backgroundColor = .black
        wv.scrollView.backgroundColor = .black
        wv.allowsBackForwardNavigationGestures = false
        // Don't let UIKit add safe-area insets on top of the WebView's
        // own viewport-fit=cover handling. Otherwise the status-bar slot
        // shows as a black bar at the top and the home-indicator slot
        // doubles up at the bottom (page already uses env(safe-area-…)).
        wv.scrollView.contentInsetAdjustmentBehavior = .never
        wv.scrollView.automaticallyAdjustsScrollIndicatorInsets = false
        view.addSubview(wv)
        NSLayoutConstraint.activate([
            wv.topAnchor.constraint(equalTo: view.topAnchor),
            wv.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            wv.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            wv.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        webView = wv

        // Left-edge swipe — iOS-canonical "go back" gesture. Kept as a
        // belt-and-braces escape hatch in case the user dismisses the
        // floating menu without picking Close.
        let r = UIScreenEdgePanGestureRecognizer(target: self, action: #selector(edgePanned(_:)))
        r.edges = .left
        view.addGestureRecognizer(r)
        dismissEdgeRecognizer = r

        // Always-on "…" floating menu in the bottom-right. Mirrors
        // MinisSafariView's bottom-right dot menu so the two immersive
        // paths feel the same. Without this the user has no visible
        // way out of a Home-Screen-launched WebApp.
        installMenuButton()

        webAppWebLogger.info("loading shortcut id=\(shortcut.id.prefix(8)) scope=\(shortcut.pathScope.rawValue) htmlURL=\(resolved.htmlURL.lastPathComponent) readRoot=\(resolved.readAccessRoot.lastPathComponent)")
        webView.loadFileURL(resolved.htmlURL, allowingReadAccessTo: resolved.readAccessRoot)
    }

    @objc private func edgePanned(_ r: UIScreenEdgePanGestureRecognizer) {
        guard r.state == .recognized else { return }
        dismiss(animated: true)
    }

    // MARK: - Floating menu

    private func installMenuButton() {
        // The button itself is just the menu host + hit target. The
        // visible "pill" is a separate UIVisualEffectView placed BEHIND
        // the button in the view hierarchy — putting the effect view
        // inside a UIButton's subviews turned out to render the glyph
        // beneath the blur on some iOS versions, leaving an empty grey
        // circle. Sibling layout instead.
        let container = UIView()
        container.translatesAutoresizingMaskIntoConstraints = false
        // Container itself owns the shadow so the blur view's
        // cornerRadius+masksToBounds doesn't clip it.
        container.layer.shadowColor = UIColor.black.cgColor
        container.layer.shadowOpacity = 0.3
        container.layer.shadowRadius = 12
        container.layer.shadowOffset = CGSize(width: 0, height: 4)

        let bg = UIVisualEffectView(effect: UIBlurEffect(style: .systemUltraThinMaterialDark))
        bg.translatesAutoresizingMaskIntoConstraints = false
        bg.isUserInteractionEnabled = false
        bg.layer.cornerRadius = 22
        bg.layer.masksToBounds = true
        bg.layer.borderWidth = 0.5
        bg.layer.borderColor = UIColor.white.withAlphaComponent(0.18).cgColor

        let button = UIButton(type: .custom)
        button.translatesAutoresizingMaskIntoConstraints = false
        let cfg = UIImage.SymbolConfiguration(pointSize: 20, weight: .bold)
        let glyph = UIImage(systemName: "ellipsis", withConfiguration: cfg)?
            .withTintColor(.white, renderingMode: .alwaysOriginal)
        button.setImage(glyph, for: .normal)
        button.imageView?.contentMode = .scaleAspectFit
        button.adjustsImageWhenHighlighted = false
        button.accessibilityLabel = NSLocalizedString("More", comment: "")
        button.backgroundColor = .clear
        button.menu = makeMenu()
        button.showsMenuAsPrimaryAction = true

        container.addSubview(bg)
        container.addSubview(button)
        view.addSubview(container)

        NSLayoutConstraint.activate([
            container.widthAnchor.constraint(equalToConstant: 44),
            container.heightAnchor.constraint(equalToConstant: 44),
            container.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -18),
            container.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -18),

            bg.topAnchor.constraint(equalTo: container.topAnchor),
            bg.bottomAnchor.constraint(equalTo: container.bottomAnchor),
            bg.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            bg.trailingAnchor.constraint(equalTo: container.trailingAnchor),

            button.topAnchor.constraint(equalTo: container.topAnchor),
            button.bottomAnchor.constraint(equalTo: container.bottomAnchor),
            button.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            button.trailingAnchor.constraint(equalTo: container.trailingAnchor),
        ])
    }

    private func makeMenu() -> UIMenu {
        let reload = UIAction(title: NSLocalizedString("Reload", comment: ""),
                              image: UIImage(systemName: "arrow.clockwise")) { [weak self] _ in
            self?.reload()
        }
        let share = UIAction(title: NSLocalizedString("Share", comment: ""),
                             image: UIImage(systemName: "square.and.arrow.up")) { [weak self] _ in
            self?.share()
        }
        let close = UIAction(title: NSLocalizedString("Close", comment: ""),
                             image: UIImage(systemName: "xmark"),
                             attributes: .destructive) { [weak self] _ in
            self?.dismiss(animated: true)
        }
        return UIMenu(children: [reload, share, close])
    }

    private func reload() {
        // Local file — re-grant read access via loadFileURL so the
        // in-place reload survives resource regeneration. Web URLs
        // (theoretically reachable here if a future entry point lets
        // them in) get plain reload().
        if resolved.htmlURL.isFileURL {
            webView.loadFileURL(resolved.htmlURL,
                                allowingReadAccessTo: resolved.readAccessRoot)
        } else {
            webView.reload()
        }
    }

    private func share() {
        let sheet = UIActivityViewController(activityItems: [resolved.htmlURL],
                                             applicationActivities: nil)
        // iPad popover anchor
        if let pop = sheet.popoverPresentationController {
            pop.sourceView = view
            pop.sourceRect = CGRect(x: view.bounds.maxX - 40,
                                    y: view.bounds.maxY - 40,
                                    width: 1, height: 1)
        }
        present(sheet, animated: true)
    }

    // MARK: - WKNavigationDelegate

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        let scheme = url.scheme?.lowercased() ?? ""
        // Allow file: navigations only when they remain inside our read-access
        // root. about:blank is allowed for iframes and anchor jumps.
        if scheme == "about" {
            decisionHandler(.allow)
            return
        }
        if scheme == "file" {
            let target = url.standardizedFileURL.path
            let root = resolved.readAccessRoot.standardizedFileURL.path
            if target.hasPrefix(root + "/") || target == root || target.hasPrefix(root) {
                decisionHandler(.allow)
                return
            }
            webAppWebLogger.warning("blocking file:// nav outside scope target=\(target) root=\(root)")
            decisionHandler(.cancel)
            return
        }
        // Block everything else — http(s), data:, custom schemes (incl.
        // minis://), tel:, mailto:, etc. The HTML stays sandboxed to its
        // own assets. A future enhancement could open external links in
        // SFSafariViewController on user confirmation.
        webAppWebLogger.info("blocking external nav scheme=\(scheme) url=\(url.absoluteString.prefix(120))")
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        webAppWebLogger.error("didFail: \(error.localizedDescription)")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        webAppWebLogger.error("didFailProvisional: \(error.localizedDescription)")
    }

    // MARK: - WKUIDelegate

    /// Block window.open / target="_blank" — they would route to the host
    /// browser. The WebApp stays single-frame.
    func webView(_ webView: WKWebView,
                 createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        return nil
    }
}

// MARK: - SwiftUI Bridge

/// SwiftUI wrapper presented full-screen. Hosts the WebView VC inside a
/// plain (no-nav) navigation container so the immersive look is preserved
/// regardless of how the surrounding app chrome is configured.
struct WebAppWebViewScreen: UIViewControllerRepresentable {
    let shortcut: WebAppShortcut
    let resolved: WebAppPathResolver.Resolved

    func makeUIViewController(context: Context) -> WebAppWebViewController {
        WebAppWebViewController(shortcut: shortcut, resolved: resolved)
    }

    func updateUIViewController(_ uiViewController: WebAppWebViewController, context: Context) {
        // No-op — the controller manages its own state.
    }
}
