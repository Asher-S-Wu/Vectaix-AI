import XCTest

// MARK: - Visual Diff Jitter Detection

/// Result of visual jitter analysis: compares consecutive screenshots to detect
/// sudden large visible area changes that break smooth scrolling.
struct VisualJitterReport {
    /// Number of frames captured.
    let frameCount: Int
    /// Number of frame transitions where the visual diff spiked above the
    /// rolling baseline — indicating a sudden non-linear visible area change.
    let spikes: Int
    /// The peak diff ratio seen across all frame pairs (0.0–1.0).
    let peakDiffRatio: CGFloat
    /// Mean diff ratio across all frame pairs.
    let meanDiffRatio: CGFloat
    /// Details of each spike for debugging.
    let spikeDetails: [(frame: Int, diffRatio: CGFloat)]

    /// Composite score: 0 = silky smooth, higher = more jitter.
    /// Only spikes contribute — peakDiffRatio alone doesn't mean jitter
    /// since fast scrolling naturally produces high pixel diff.
    var score: CGFloat {
        guard frameCount >= 3 else { return 0 }
        return CGFloat(spikes) * 15.0
    }

    var isStable: Bool { spikes == 0 }
}

/// Compare two CGImages by converting to grayscale and computing pixel-level diff.
/// Returns the fraction of pixels that changed beyond the noise threshold.
func computeImageDiff(_ a: CGImage, _ b: CGImage, maxDim: Int = 160) -> CGFloat? {
    let scaleW: Int
    let scaleH: Int
    if a.width > a.height {
        scaleW = maxDim
        scaleH = max(1, a.height * maxDim / a.width)
    } else {
        scaleH = maxDim
        scaleW = max(1, a.width * maxDim / a.height)
    }

    guard let bufA = renderToGray(a, width: scaleW, height: scaleH),
          let bufB = renderToGray(b, width: scaleW, height: scaleH) else { return nil }

    let count = scaleW * scaleH
    var changedPixels = 0
    let noiseThreshold: UInt8 = 8

    for i in 0..<count {
        let d = abs(Int(bufA[i]) - Int(bufB[i]))
        if d > Int(noiseThreshold) { changedPixels += 1 }
    }

    return CGFloat(changedPixels) / CGFloat(count)
}

/// Render a CGImage to an 8-bit grayscale buffer at the given size.
private func renderToGray(_ image: CGImage, width: Int, height: Int) -> [UInt8]? {
    var pixels = [UInt8](repeating: 0, count: width * height)
    guard let ctx = CGContext(
        data: &pixels,
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: width,
        space: CGColorSpaceCreateDeviceGray(),
        bitmapInfo: CGImageAlphaInfo.none.rawValue
    ) else { return nil }
    ctx.interpolationQuality = .low
    ctx.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    return pixels
}

/// Capture screenshots every 0.1s and analyze frame-to-frame visual diffs.
/// Detects spikes where the diff is significantly larger than the rolling baseline,
/// indicating a sudden visible area change (jitter).
func captureAndAnalyzeVisualJitter(
    duration: TimeInterval = 2.0,
    interval: TimeInterval = 0.1
) -> VisualJitterReport {
    var frames: [CGImage] = []
    let deadline = Date().addingTimeInterval(duration)

    while Date() < deadline {
        let screenshot = XCUIScreen.main.screenshot()
        if let cgImage = screenshot.image.cgImage {
            frames.append(cgImage)
        }
        Thread.sleep(forTimeInterval: interval)
    }

    return analyzeFrames(frames)
}

/// Analyze a series of captured CGImage frames for visual jitter.
///
/// Normal scroll lifecycle: start → accelerate → cruise → decelerate → stop.
/// Diff curve is bell-shaped: low → rising → peak → falling → near-zero.
/// This is all expected — NOT jitter.
///
/// Jitter is detected by looking at the **diff velocity** (rate of change of diff).
/// During smooth scrolling, diff changes gradually. Jitter causes a sudden
/// *increase* in diff that breaks the local trend — the diff jumps UP when it
/// should be staying stable or decreasing.
///
/// We also detect "stutter frames" — frames where the diff drops to near-zero
/// (content froze) then jumps back up (content moved again), which indicates
/// a layout stall causing visible flicker.
func analyzeFrames(_ frames: [CGImage]) -> VisualJitterReport {
    guard frames.count >= 3 else {
        return VisualJitterReport(frameCount: frames.count, spikes: 0,
                                  peakDiffRatio: 0, meanDiffRatio: 0, spikeDetails: [])
    }

    // Compute diffs between consecutive frames
    var diffs: [CGFloat] = []
    for i in 1..<frames.count {
        if let diff = computeImageDiff(frames[i-1], frames[i]) {
            diffs.append(diff)
        }
    }

    guard diffs.count >= 3 else {
        return VisualJitterReport(frameCount: frames.count, spikes: 0,
                                  peakDiffRatio: 0, meanDiffRatio: 0, spikeDetails: [])
    }

    var spikes = 0
    var spikeDetails: [(frame: Int, diffRatio: CGFloat)] = []

    // Find the peak diff and the index where deceleration starts (after the peak).
    // Only analyze frames AFTER the peak — during deceleration, diff should
    // monotonically decrease. Any increase during deceleration = jitter.
    let peakIdx = diffs.enumerated().max(by: { $0.element < $1.element })?.offset ?? 0

    // Method 1: Deceleration phase anomalies.
    // After the peak, diff should decrease smoothly. Any frame where diff
    // increases significantly compared to a local window = jitter spike.
    if peakIdx + 2 < diffs.count {
        for i in (peakIdx + 1)..<diffs.count {
            let prevDiff = diffs[i - 1]
            let currDiff = diffs[i]
            // In deceleration, diff should be decreasing. If it increases by more
            // than 5% absolute AND the increase is more than 50% relative to prev,
            // that's a non-smooth reversal indicating jitter.
            let increase = currDiff - prevDiff
            if increase > 0.05 && prevDiff > 0.001 && increase / prevDiff > 0.5 {
                spikes += 1
                spikeDetails.append((frame: i + 1, diffRatio: currDiff))
            }
        }
    }

    // Method 2: Stutter detection during deceleration.
    // A frame where diff drops to near-zero (content froze for a frame)
    // then jumps back up = visible stutter/hitch.
    for i in (max(1, peakIdx))..<diffs.count {
        let prev = diffs[i - 1]
        let curr = diffs[i]
        if i + 1 < diffs.count {
            let next = diffs[i + 1]
            // Significant motion → freeze → motion = stutter
            if prev > 0.05 && curr < 0.005 && next > 0.03 {
                spikes += 1
                spikeDetails.append((frame: i + 1, diffRatio: curr))
            }
        }
    }

    let peakDiff = diffs.max() ?? 0
    let meanDiff = diffs.reduce(0, +) / CGFloat(diffs.count)

    return VisualJitterReport(frameCount: frames.count, spikes: spikes,
                              peakDiffRatio: peakDiff, meanDiffRatio: meanDiff,
                              spikeDetails: spikeDetails)
}

// MARK: - UI Tests

/// UI Tests for CollectionViewMessageListV3.
///
/// Core test scenarios:
/// 1. Long content + multiple message bundles render correctly
/// 2. 50 messages scroll/lazy-load correctness + visual jitter gate
/// 3. Streaming auto-scroll follows bottom + visual jitter gate
/// 4. Streaming + fling deceleration hover stability (visual jitter gate)
///
/// Jitter detection uses screenshot-based visual diff: captures frames at ~15fps,
/// computes pixel-level grayscale diff between consecutive frames, and flags
/// any sudden large visual change that breaks the expected smooth scroll trajectory.
@MainActor
final class MessageListV3UITests: XCTestCase {

    private var app: XCUIApplication!

    override func setUp() {
        super.setUp()
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments.append("--uitest-message-list")
    }

    // MARK: - Helpers

    private var currentCase: Int = 0
    private var currentStep: Int = 0
    private var currentAction: Int = 0

    private var cv: XCUIElement { app.collectionViews.firstMatch }

    /// Signal current action to the app overlay via UIPasteboard, then pause 3s for observation.
    private func action(_ desc: String, step: Int? = nil) {
        if let s = step {
            currentStep = s
            currentAction = 0
        }
        currentAction += 1
        let msg = "JITTER:case:\(currentCase),step:\(currentStep),action:\(currentAction),desc:\(desc)"
        UIPasteboard.general.string = msg
        sleep(3)
    }

    private func waitForCells(min n: Int = 1, timeout: TimeInterval = 10) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if cv.exists && cv.cells.count >= n { return true }
            Thread.sleep(forTimeInterval: 0.25)
        }
        return cv.exists && cv.cells.count >= n
    }

    private func waitForStableContent(timeout: TimeInterval = 30) -> Bool {
        var lastCount = 0
        var stableRounds = 0
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            Thread.sleep(forTimeInterval: 0.6)
            let c = cv.cells.count
            if c > 0 && c == lastCount {
                stableRounds += 1
                if stableRounds >= 4 { return true }
            } else {
                stableRounds = 0
                lastCount = c
            }
        }
        return false
    }

    private func launchInstant(scenario: String = "mixed", caseNumber: Int = 0) {
        app.launchEnvironment["UITEST_MODE"] = "instant"
        app.launchEnvironment["UITEST_SCENARIO"] = scenario
        app.launchEnvironment["UITEST_CASE"] = "\(caseNumber)"
        app.launchEnvironment["UITEST_STEP"] = "0"
        app.launch()
        XCTAssertTrue(app.otherElements["messageListTestView"].waitForExistence(timeout: 10))
        XCTAssertTrue(waitForCells(min: 1, timeout: 10), "Cells should appear after instant load")
    }

    private func launchStreaming(scenario: String = "mixed", caseNumber: Int = 0) {
        app.launchEnvironment["UITEST_MODE"] = "stream"
        app.launchEnvironment["UITEST_SCENARIO"] = scenario
        app.launchEnvironment["UITEST_CASE"] = "\(caseNumber)"
        app.launchEnvironment["UITEST_STEP"] = "0"
        app.launch()
        XCTAssertTrue(app.otherElements["messageListTestView"].waitForExistence(timeout: 10))
        XCTAssertTrue(waitForCells(min: 1, timeout: 10), "First cell should appear")
    }

    /// Swipe and capture screenshots from drag start through deceleration.
    @discardableResult
    private func swipeAndCapture(
        direction: String,
        captureDuration: TimeInterval = 2.0,
        context: String,
        file: StaticString = #file,
        line: UInt = #line
    ) -> VisualJitterReport {
        currentAction += 1

        let lock = NSLock()
        var frames: [CGImage] = []
        var capturing = true

        let captureThread = Thread {
            while true {
                lock.lock()
                let shouldContinue = capturing
                lock.unlock()
                guard shouldContinue else { break }

                let screenshot = XCUIScreen.main.screenshot()
                if let cgImage = screenshot.image.cgImage {
                    lock.lock()
                    frames.append(cgImage)
                    lock.unlock()
                }
                Thread.sleep(forTimeInterval: 0.1)
            }
        }
        captureThread.start()

        // Execute swipe
        switch direction {
        case "up": cv.swipeUp()
        case "down": cv.swipeDown()
        default: break
        }

        // Continue capturing during deceleration + 1s post-settle observation
        Thread.sleep(forTimeInterval: captureDuration + 1.0)

        lock.lock()
        capturing = false
        let capturedFrames = frames
        lock.unlock()

        let report = analyzeFrames(capturedFrames)
        assertNoVisualJitter(report, context: context, file: file, line: line)
        return report
    }

    private func fling(fromY: CGFloat, toY: CGFloat, velocity: XCUIGestureVelocity = .fast) {
        // Use dx: 0.05 (far left edge) to avoid gesture conflicts with code block horizontal scroll
        let s = cv.coordinate(withNormalizedOffset: CGVector(dx: 0.05, dy: fromY))
        let e = cv.coordinate(withNormalizedOffset: CGVector(dx: 0.05, dy: toY))
        s.press(forDuration: 0.01, thenDragTo: e, withVelocity: velocity, thenHoldForDuration: 0)
    }

    /// Fling and capture screenshots from the moment the drag starts, through
    /// deceleration, until settle. Covers the entire motion lifecycle.
    ///
    /// Uses a background thread to capture frames every 0.1s while the fling
    /// gesture executes on the main thread, then continues capturing during
    /// the deceleration phase after the gesture returns.
    @discardableResult
    private func flingAndCapture(
        fromY: CGFloat,
        toY: CGFloat,
        velocity: XCUIGestureVelocity = .fast,
        captureDuration: TimeInterval = 3.0,
        context: String,
        file: StaticString = #file,
        line: UInt = #line
    ) -> VisualJitterReport {
        currentAction += 1

        // Shared frame buffer — captured from a background thread
        let lock = NSLock()
        var frames: [CGImage] = []
        var capturing = true

        // Start background capture thread — captures every 0.1s
        let captureThread = Thread {
            while true {
                lock.lock()
                let shouldContinue = capturing
                lock.unlock()
                guard shouldContinue else { break }

                let screenshot = XCUIScreen.main.screenshot()
                if let cgImage = screenshot.image.cgImage {
                    lock.lock()
                    frames.append(cgImage)
                    lock.unlock()
                }
                Thread.sleep(forTimeInterval: 0.1)
            }
        }
        captureThread.start()

        // Execute fling gesture (blocks until drag completes, but deceleration
        // continues asynchronously after this returns)
        fling(fromY: fromY, toY: toY, velocity: velocity)

        // Continue capturing during deceleration + 1s post-settle observation
        Thread.sleep(forTimeInterval: captureDuration + 1.0)

        // Stop capture
        lock.lock()
        capturing = false
        let capturedFrames = frames
        lock.unlock()

        // Analyze
        let report = analyzeFrames(capturedFrames)
        assertNoVisualJitter(report, context: context, file: file, line: line)
        return report
    }

    /// Assert that a visual jitter report passes the quality gate.
    private func assertNoVisualJitter(
        _ report: VisualJitterReport,
        context: String,
        file: StaticString = #file,
        line: UInt = #line
    ) {
        let spikeDesc = report.spikeDetails.map { "frame#\($0.frame)=\(String(format: "%.1f%%", $0.diffRatio * 100))" }.joined(separator: ", ")
        XCTAssertTrue(report.isStable,
            "\(context): Visual jitter detected! score=\(String(format: "%.1f", report.score)) " +
            "spikes=\(report.spikes) peakDiff=\(String(format: "%.1f%%", report.peakDiffRatio * 100)) " +
            "meanDiff=\(String(format: "%.1f%%", report.meanDiffRatio * 100)) " +
            "frames=\(report.frameCount) [\(spikeDesc)]",
            file: file, line: line)
    }

    /// Read FPS stats from the in-app FPS monitor via accessibility label.
    /// Format: "FPS:avg/min/max/drops"
    private func readFPS() -> (avg: Int, min: Int, max: Int, drops: Int)? {
        let fpsEl = app.staticTexts["fpsData"]
        guard fpsEl.waitForExistence(timeout: 3) else { return nil }
        let label = fpsEl.label // "FPS:60/45/60/0"
        guard label.hasPrefix("FPS:") else { return nil }
        let parts = label.dropFirst(4).split(separator: "/").compactMap { Int($0) }
        guard parts.count == 4 else { return nil }
        return (avg: parts[0], min: parts[1], max: parts[2], drops: parts[3])
    }

    /// Print FPS report and assert minimum frame rate.
    private func reportFPS(context: String, file: StaticString = #file, line: UInt = #line) {
        sleep(1) // let FPS samples accumulate
        guard let fps = readFPS() else {
            print("⚠️ [\(context)] FPS: unable to read")
            return
        }
        let status = fps.min >= 30 ? "✅" : (fps.min >= 20 ? "⚠️" : "❌")
        print("\(status) [\(context)] FPS: avg=\(fps.avg) min=\(fps.min) max=\(fps.max) drops(<45)=\(fps.drops)")
        XCTAssertGreaterThanOrEqual(fps.avg, 25,
            "\(context): Average FPS too low (\(fps.avg))", file: file, line: line)
    }

    // MARK: - Test 1: Long Content + Multiple Message Bundle Rendering

    func testLongContentMultiBundleRendering() {
        currentCase = 1
        launchInstant(scenario: "mixed", caseNumber: 1)

        action("Verify initial render", step: 1)
        XCTAssertTrue(cv.exists)
        XCTAssertGreaterThan(cv.cells.count, 0)

        let headers = app.descendants(matching: .any).matching(identifier: "assistantHeader").count
        XCTAssertGreaterThanOrEqual(headers, 2, "Should have multiple assistant headers")
        let userMsgs = app.descendants(matching: .any).matching(identifier: "userMessage").count
        XCTAssertGreaterThanOrEqual(userMsgs, 1, "Should have user messages")
        let textBlocks = app.descendants(matching: .any).matching(identifier: "assistantTextBlock").count
        XCTAssertGreaterThan(textBlocks, 0, "Should have text blocks")

        // Scroll to top first
        cv.swipeDown(); cv.swipeDown()
        sleep(1)

        // Multi-speed scroll test with emphasis on fast/extreme velocities
        let speeds: [(String, XCUIGestureVelocity)] = [
            ("fast", .fast),
            ("veryFast", XCUIGestureVelocity(3500)),
            ("extreme", XCUIGestureVelocity(5000)),
            ("max", XCUIGestureVelocity(8000)),
        ]

        for (label, vel) in speeds {
            flingAndCapture(fromY: 0.9, toY: 0.1, velocity: vel,
                            context: "Down \(label)")
            XCTAssertGreaterThan(cv.cells.count, 0, "Cells must persist (\(label) down)")
        }

        for (label, vel) in speeds {
            flingAndCapture(fromY: 0.1, toY: 0.9, velocity: vel,
                            context: "Up \(label)")
            XCTAssertGreaterThan(cv.cells.count, 0, "Cells must persist (\(label) up)")
        }

        // Rapid alternating max-speed flings (worst case)
        for i in 0..<4 {
            flingAndCapture(fromY: 0.95, toY: 0.05, velocity: XCUIGestureVelocity(8000),
                            captureDuration: 2.0, context: "Rapid max down #\(i+1)")
            flingAndCapture(fromY: 0.05, toY: 0.95, velocity: XCUIGestureVelocity(8000),
                            captureDuration: 2.0, context: "Rapid max up #\(i+1)")
        }

        XCTAssertTrue(cv.exists)
        XCTAssertGreaterThan(cv.cells.count, 0)
    }

    // MARK: - Test 2: 50 Messages Scroll & Lazy-Load + Visual Jitter Gate

    func testManyMessagesScrollAndLazyLoad() {
        currentCase = 2
        launchInstant(scenario: "manyMessages", caseNumber: 2)

        action("Verify initial render", step: 1)
        XCTAssertTrue(cv.exists)
        XCTAssertGreaterThan(cv.cells.count, 0)

        // Scroll to top first
        cv.swipeDown(); cv.swipeDown()
        sleep(1)

        // High-speed fling stress test on 50 messages
        let speeds: [(String, XCUIGestureVelocity)] = [
            ("fast", .fast),
            ("veryFast", XCUIGestureVelocity(3500)),
            ("extreme", XCUIGestureVelocity(5000)),
            ("max", XCUIGestureVelocity(8000)),
        ]

        // Fling down at increasing speeds — full range swipe
        for (label, vel) in speeds {
            flingAndCapture(fromY: 0.95, toY: 0.05, velocity: vel, captureDuration: 3.0,
                            context: "Down \(label)")
            XCTAssertGreaterThan(cv.cells.count, 0, "Cells must persist (\(label) down)")
        }

        // Fling up at increasing speeds
        for (label, vel) in speeds {
            flingAndCapture(fromY: 0.05, toY: 0.95, velocity: vel, captureDuration: 3.0,
                            context: "Up \(label)")
            XCTAssertGreaterThan(cv.cells.count, 0, "Cells must persist (\(label) up)")
        }

        // Rapid alternating max-speed flings (worst case for jitter)
        for i in 0..<5 {
            flingAndCapture(fromY: 0.95, toY: 0.05, velocity: XCUIGestureVelocity(8000),
                            captureDuration: 2.0, context: "Rapid max down #\(i+1)")
            flingAndCapture(fromY: 0.05, toY: 0.95, velocity: XCUIGestureVelocity(8000),
                            captureDuration: 2.0, context: "Rapid max up #\(i+1)")
        }

        XCTAssertTrue(cv.exists)
    }

    // MARK: - Test 3: Streaming Auto-Scroll Follows Bottom + Visual Jitter Gate

    func testStreamingAutoScrollFollowsBottom() {
        currentCase = 3
        launchStreaming(scenario: "mixed", caseNumber: 3)
        XCTAssertTrue(cv.exists)

        // Visual jitter gate during streaming auto-scroll — capture while content streams in
        for i in 0..<4 {
            let report = captureAndAnalyzeVisualJitter(duration: 3.0)
            assertNoVisualJitter(report, context: "Streaming auto-scroll phase #\(i+1)")

            guard cv.exists else { continue }
            XCTAssertGreaterThan(cv.cells.count, 0, "Cells should exist during streaming")
        }

        // Check bottom tracking
        if cv.exists {
            let cellCount = cv.cells.count
            if cellCount > 0 {
                let lastCell = cv.cells.element(boundBy: cellCount - 1)
                if lastCell.exists {
                    let gap = cv.frame.maxY - lastCell.frame.maxY
                    XCTAssertLessThan(gap, 300,
                        "Last cell should be near bottom during auto-scroll (gap: \(gap)pt)")
                }
            }
        }

        action("Wait for streaming finish", step: 2)
        XCTAssertTrue(waitForStableContent(timeout: 40), "Streaming should complete")
        XCTAssertGreaterThan(cv.cells.count, 0)
    }

    // MARK: - Test 4: Streaming + Fling Deceleration Hover Stability (Visual Jitter Gate)

    func testStreamingFlingHoverStability() {
        currentCase = 4
        launchStreaming(scenario: "mixed", caseNumber: 4)
        XCTAssertTrue(cv.exists)

        action("Wait for streaming content", step: 1)
        XCTAssertGreaterThan(cv.cells.count, 0)

        // Fling up during streaming at escalating speeds
        let streamingSpeeds: [(String, XCUIGestureVelocity)] = [
            ("fast", .fast),
            ("veryFast", XCUIGestureVelocity(3500)),
            ("extreme", XCUIGestureVelocity(5000)),
            ("max", XCUIGestureVelocity(8000)),
        ]

        for (label, vel) in streamingSpeeds {
            flingAndCapture(fromY: 0.1, toY: 0.9, velocity: vel, captureDuration: 3.0,
                            context: "\(label) fling up during streaming")

            let hover = captureAndAnalyzeVisualJitter(duration: 2.0)
            assertNoVisualJitter(hover, context: "Hover after \(label) fling during streaming")
        }

        // Max-speed alternating flings during streaming (absolute worst case)
        for i in 0..<2 {
            flingAndCapture(fromY: 0.95, toY: 0.05, velocity: XCUIGestureVelocity(8000),
                            captureDuration: 2.0, context: "Streaming rapid max down #\(i+1)")
            flingAndCapture(fromY: 0.05, toY: 0.95, velocity: XCUIGestureVelocity(8000),
                            captureDuration: 2.0, context: "Streaming rapid max up #\(i+1)")
        }

        // Return to bottom
        let btn = app.buttons["scrollToBottomButton"]
        if btn.exists && btn.isHittable { btn.tap() }

        action("Wait for streaming finish", step: 2)
        XCTAssertTrue(waitForStableContent(timeout: 45), "Streaming should complete")
        XCTAssertGreaterThan(cv.cells.count, 0)
    }

    // MARK: - Test 5: Travel Planning (Rich Tables + CJK + Emoji) Visual Jitter Gate

    func testTravelPlanningScrollStability() {
        currentCase = 5
        launchInstant(scenario: "travelPlanning", caseNumber: 5)

        action("Verify initial render", step: 1)
        XCTAssertTrue(cv.exists)
        XCTAssertGreaterThan(cv.cells.count, 0, "Travel planning messages should render")

        // Scroll to top first
        cv.swipeDown(); cv.swipeDown(); cv.swipeDown()
        sleep(1)

        // High-speed flings through table-heavy travel content — the critical test
        // for the boundingRect + attachment height fix
        let speeds: [(String, XCUIGestureVelocity)] = [
            ("fast", .fast),
            ("veryFast", XCUIGestureVelocity(3500)),
            ("extreme", XCUIGestureVelocity(5000)),
            ("max", XCUIGestureVelocity(8000)),
        ]

        for (label, vel) in speeds {
            flingAndCapture(fromY: 0.95, toY: 0.05, velocity: vel, captureDuration: 3.0,
                            context: "Travel down \(label)")
            XCTAssertGreaterThan(cv.cells.count, 0, "Cells must persist (\(label) down)")
        }

        for (label, vel) in speeds {
            flingAndCapture(fromY: 0.05, toY: 0.95, velocity: vel, captureDuration: 3.0,
                            context: "Travel up \(label)")
            XCTAssertGreaterThan(cv.cells.count, 0, "Cells must persist (\(label) up)")
        }

        // Rapid alternating max-speed flings through table content (worst case)
        for i in 0..<5 {
            flingAndCapture(fromY: 0.95, toY: 0.05, velocity: XCUIGestureVelocity(8000),
                            captureDuration: 2.0, context: "Travel rapid max down #\(i+1)")
            flingAndCapture(fromY: 0.05, toY: 0.95, velocity: XCUIGestureVelocity(8000),
                            captureDuration: 2.0, context: "Travel rapid max up #\(i+1)")
        }

        XCTAssertTrue(cv.exists)
    }

    // MARK: - Test 6: Health Data Scroll Stability

    func testHealthDataScrollStability() {
        currentCase = 6
        launchInstant(scenario: "healthData", caseNumber: 6)

        action("Verify initial render", step: 1)
        XCTAssertTrue(cv.exists)
        XCTAssertGreaterThan(cv.cells.count, 0, "Health data messages should render")

        // Scroll to top first
        cv.swipeDown(); cv.swipeDown(); cv.swipeDown()
        sleep(1)

        // Multi-speed fling test with FPS reporting
        let speeds: [(String, XCUIGestureVelocity)] = [
            ("fast", .fast),
            ("veryFast", XCUIGestureVelocity(3500)),
            ("extreme", XCUIGestureVelocity(5000)),
            ("max", XCUIGestureVelocity(8000)),
        ]

        for (label, vel) in speeds {
            flingAndCapture(fromY: 0.95, toY: 0.05, velocity: vel, captureDuration: 3.0,
                            context: "Health down \(label)")
            reportFPS(context: "Health down \(label)")
            XCTAssertGreaterThan(cv.cells.count, 0, "Cells must persist (\(label) down)")
        }

        for (label, vel) in speeds {
            flingAndCapture(fromY: 0.05, toY: 0.95, velocity: vel, captureDuration: 3.0,
                            context: "Health up \(label)")
            reportFPS(context: "Health up \(label)")
            XCTAssertGreaterThan(cv.cells.count, 0, "Cells must persist (\(label) up)")
        }

        // Rapid alternating max-speed flings
        for i in 0..<5 {
            flingAndCapture(fromY: 0.95, toY: 0.05, velocity: XCUIGestureVelocity(8000),
                            captureDuration: 2.0, context: "Health rapid max down #\(i+1)")
            flingAndCapture(fromY: 0.05, toY: 0.95, velocity: XCUIGestureVelocity(8000),
                            captureDuration: 2.0, context: "Health rapid max up #\(i+1)")
        }
        reportFPS(context: "Health rapid flings complete")

        XCTAssertTrue(cv.exists)
    }

    // MARK: - Test 7: Travel Planning Streaming + Jitter Gate

    func testTravelPlanningStreamingJitter() {
        currentCase = 7
        launchStreaming(scenario: "travelPlanning", caseNumber: 6)
        XCTAssertTrue(cv.exists)

        // Capture jitter during streaming of large table-rich content
        for i in 0..<6 {
            let report = captureAndAnalyzeVisualJitter(duration: 3.0)
            assertNoVisualJitter(report, context: "Travel streaming phase #\(i+1)")

            guard cv.exists else { continue }
            XCTAssertGreaterThan(cv.cells.count, 0)
        }

        // High-speed flings during streaming of table-rich content
        let streamingSpeeds: [(String, XCUIGestureVelocity)] = [
            ("fast", .fast),
            ("extreme", XCUIGestureVelocity(5000)),
            ("max", XCUIGestureVelocity(8000)),
        ]

        for (label, vel) in streamingSpeeds {
            flingAndCapture(fromY: 0.05, toY: 0.95, velocity: vel, captureDuration: 3.0,
                            context: "Travel \(label) fling up during streaming")

            let hoverReport = captureAndAnalyzeVisualJitter(duration: 2.0)
            assertNoVisualJitter(hoverReport, context: "Travel hover after \(label) fling during streaming")
        }

        // Rapid max-speed flings during streaming (worst case)
        for i in 0..<2 {
            flingAndCapture(fromY: 0.95, toY: 0.05, velocity: XCUIGestureVelocity(8000),
                            captureDuration: 2.0, context: "Travel streaming rapid max down #\(i+1)")
            flingAndCapture(fromY: 0.05, toY: 0.95, velocity: XCUIGestureVelocity(8000),
                            captureDuration: 2.0, context: "Travel streaming rapid max up #\(i+1)")
        }

        action("Wait for streaming finish", step: 2)
        XCTAssertTrue(waitForStableContent(timeout: 60), "Travel streaming should complete")
        XCTAssertGreaterThan(cv.cells.count, 0)
    }
}
