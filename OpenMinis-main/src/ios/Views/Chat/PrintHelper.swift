//
//  PrintHelper.swift
//  MinisApp
//
//  Shared wrappers around UIPrintInteractionController so every preview
//  surface (web/HTML, image gallery, text + markdown file previews)
//  presents the iOS system print dialog the same way. Centralizing this
//  keeps the print-info setup (job name, output type) consistent and
//  avoids duplicating the boilerplate at each call site.
//

import UIKit
import WebKit

enum PrintHelper {
    private static let logger = AppLogger(category: "Print")

    /// Print the rendered contents of a web view (HTML / web page preview).
    static func printWebView(_ webView: WKWebView, jobName: String) {
        present(jobName: jobName, outputType: .general) { controller in
            controller.printFormatter = webView.viewPrintFormatter()
        }
    }

    /// Print a single image (photo output type).
    static func printImage(_ image: UIImage, jobName: String) {
        present(jobName: jobName, outputType: .photo) { controller in
            controller.printingItem = image
        }
    }

    /// Print plain text via a simple text print formatter.
    static func printText(_ text: String, jobName: String) {
        present(jobName: jobName, outputType: .general) { controller in
            controller.printFormatter = UISimpleTextPrintFormatter(text: text)
        }
    }

    /// Shared presentation path. `configure` attaches whatever content the
    /// caller wants printed (formatter or printingItem) to the controller.
    private static func present(jobName: String,
                                outputType: UIPrintInfo.OutputType,
                                configure: (UIPrintInteractionController) -> Void) {
        let controller = UIPrintInteractionController.shared
        let info = UIPrintInfo.printInfo()
        info.outputType = outputType
        info.jobName = jobName.isEmpty ? "Minis" : jobName
        controller.printInfo = info
        configure(controller)
        controller.present(animated: true) { _, completed, error in
            if let error = error {
                logger.error("Print dialog failed: \(error.localizedDescription)")
            } else {
                logger.info("Print dialog completed=\(completed)")
            }
        }
    }
}
