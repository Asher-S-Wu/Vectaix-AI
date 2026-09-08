import SwiftUI
import WebKit

/// UIViewRepresentable wrapper that displays a `BrowserUseManager`'s WKWebView.
struct BrowserWebView: UIViewRepresentable {
    let manager: BrowserUseManager

    func makeUIView(context: Context) -> WKWebView {
        manager.webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        // The manager owns the webView — nothing to update here.
    }
}
