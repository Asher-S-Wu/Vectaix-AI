import UIKit

private let logger = AppLogger(category: "MathRenderSched")

/// Serial main-thread scheduler that renders LaTeX formulas in small batches
/// so a document with hundreds of equations doesn't block the main thread.
///
/// Rationale: `SwiftMathRenderer.render` is ~3–10 ms per formula (MTMathUILabel
/// layout + CALayer.render-to-bitmap). With 600–700 formulas the naïve eager
/// pass in `updateAttachmentViews` blocked the main thread for 3–7 s, which
/// the watchdog eventually killed. We keep rendering on the main thread
/// (MTMathUILabel isn't proven thread-safe and the bitmap must end up on the
/// main-queue UIImage anyway) but yield between small batches so gestures
/// and scroll still get runloop time.
///
/// Work items are submitted from `MathAttachment.beginRenderingIfNeeded()`.
/// Each item renders via `SwiftMathRenderer` and then fires the attachment's
/// `onLoad` to let the hosting view refresh layout. Hosting views should
/// coalesce those callbacks (`onLoad` fires frequently during a burst).
///
/// Thread model: `enqueue` may be called from any thread (typically main from
/// TextKit layout). All queue mutation and render work happens on the main
/// queue. Not marked @MainActor to keep call sites in nonisolated attachment
/// classes callable without an actor hop.
final class MathRenderScheduler {
    static let shared = MathRenderScheduler()

    /// Formulas processed per runloop tick before yielding. Empirically 4
    /// keeps each tick under ~30ms even on complex equations, which is
    /// below the 50ms watchdog threshold for "app hang" on iOS 18.
    private let batchSize = 4

    /// Queue of pending renders (weak so a stale attachment whose hosting
    /// view was torn down doesn't keep work alive).
    private var queue: [WeakBox] = []
    private var running = false

    /// Diagnostics for the current burst (reset when queue drains).
    private var burstStartTime: CFAbsoluteTime = 0
    private var burstTotalCount = 0
    private var burstRenderedCount = 0
    private var burstTotalRenderMs: Double = 0
    private var burstMaxRenderMs: Double = 0

    private init() {}

    func enqueue(_ attachment: MathAttachment) {
        let work = { [weak self] in
            guard let self else { return }
            if self.queue.isEmpty && !self.running {
                self.burstStartTime = CFAbsoluteTimeGetCurrent()
                self.burstTotalCount = 0
                self.burstRenderedCount = 0
                self.burstTotalRenderMs = 0
                self.burstMaxRenderMs = 0
                logger.info("[MathSched] burst begin first enqueue")
            }
            self.queue.append(WeakBox(attachment))
            self.burstTotalCount += 1
            if self.burstTotalCount <= 3 || self.burstTotalCount % 100 == 0 {
                logger.info("[MathSched] enqueue #\(self.burstTotalCount) queueLen=\(self.queue.count) running=\(self.running)")
            }
            if !self.running {
                self.running = true
                DispatchQueue.main.async { [weak self] in self?.drain() }
            }
        }
        if Thread.isMainThread {
            work()
        } else {
            DispatchQueue.main.async(execute: work)
        }
    }

    private func drain() {
        let tickStart = CFAbsoluteTimeGetCurrent()
        var processed = 0

        while processed < batchSize, !queue.isEmpty {
            let box = queue.removeFirst()
            guard let attachment = box.value else { continue }
            let t0 = CFAbsoluteTimeGetCurrent()
            attachment.performRender()
            let ms = (CFAbsoluteTimeGetCurrent() - t0) * 1000
            burstTotalRenderMs += ms
            burstMaxRenderMs = max(burstMaxRenderMs, ms)
            burstRenderedCount += 1
            processed += 1
        }

        let tickMs = (CFAbsoluteTimeGetCurrent() - tickStart) * 1000

        if queue.isEmpty {
            running = false
            let totalWallMs = (CFAbsoluteTimeGetCurrent() - burstStartTime) * 1000
            let avgMs = burstRenderedCount > 0 ? burstTotalRenderMs / Double(burstRenderedCount) : 0
            logger.info("[MathSched] burst done rendered=\(burstRenderedCount)/\(burstTotalCount) wallMs=\(String(format: "%.1f", totalWallMs)) cpuMs=\(String(format: "%.1f", burstTotalRenderMs)) avgMs=\(String(format: "%.2f", avgMs)) maxMs=\(String(format: "%.1f", burstMaxRenderMs)) lastTickMs=\(String(format: "%.1f", tickMs))")
        } else {
            // Yield to the runloop so pending touches / scroll / layout pass
            // get a chance before the next batch.
            DispatchQueue.main.async { [weak self] in self?.drain() }
        }
    }

    private struct WeakBox {
        weak var value: MathAttachment?
        init(_ v: MathAttachment) { self.value = v }
    }
}
