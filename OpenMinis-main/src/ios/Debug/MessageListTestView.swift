#if DEBUG
import SwiftUI
import Combine
import CoreGraphics

// MARK: - VisualDiffEngine

/// Computes visual difference between two CGImage frames.
/// Used for jitter detection: smooth scrolling produces predictable, small diffs;
/// jitter produces sudden large diffs that break the expected linear pattern.
enum VisualDiffEngine {

    /// Result of comparing two frames.
    struct FrameDiff {
        /// Fraction of pixels that changed beyond the noise threshold (0.0–1.0).
        let changedRatio: CGFloat
        /// Mean absolute pixel intensity difference across all pixels (0.0–255.0).
        let meanDelta: CGFloat
        /// Peak regional difference — the max diff in any 32×32 tile.
        let peakRegionDelta: CGFloat
    }

    /// Compare two RGBA images of the same size.
    /// Downscales to `maxDim` on the longest side for performance.
    static func diff(_ a: CGImage, _ b: CGImage, maxDim: Int = 200) -> FrameDiff? {
        // Downscale both to a common small size for fast comparison.
        let w = min(a.width, b.width, maxDim)
        let h = min(a.height, b.height, maxDim)
        guard w > 0, h > 0 else { return nil }

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
        var totalDelta: Int = 0
        var changedPixels: Int = 0
        let noiseThreshold: UInt8 = 8  // ignore sub-pixel rendering noise

        // Per-pixel comparison
        for i in 0..<count {
            let d = abs(Int(bufA[i]) - Int(bufB[i]))
            totalDelta += d
            if d > Int(noiseThreshold) { changedPixels += 1 }
        }

        let meanDelta = CGFloat(totalDelta) / CGFloat(count)
        let changedRatio = CGFloat(changedPixels) / CGFloat(count)

        // Peak regional diff: divide into tiles, find the max average diff tile
        let tileSize = 16
        var peakTileDelta: CGFloat = 0
        let tilesX = max(1, scaleW / tileSize)
        let tilesY = max(1, scaleH / tileSize)
        for ty in 0..<tilesY {
            for tx in 0..<tilesX {
                var tileSum: Int = 0
                var tileCount: Int = 0
                for py in (ty * tileSize)..<min((ty + 1) * tileSize, scaleH) {
                    for px in (tx * tileSize)..<min((tx + 1) * tileSize, scaleW) {
                        let idx = py * scaleW + px
                        tileSum += abs(Int(bufA[idx]) - Int(bufB[idx]))
                        tileCount += 1
                    }
                }
                if tileCount > 0 {
                    let avg = CGFloat(tileSum) / CGFloat(tileCount)
                    peakTileDelta = max(peakTileDelta, avg)
                }
            }
        }

        return FrameDiff(changedRatio: changedRatio, meanDelta: meanDelta, peakRegionDelta: peakTileDelta)
    }

    /// Render a CGImage to an 8-bit grayscale buffer at the given size.
    private static func renderToGray(_ image: CGImage, width: Int, height: Int) -> [UInt8]? {
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
}

// MARK: - VisualJitterReport

/// Result of visual jitter analysis over a series of screenshot frames.
struct VisualJitterReport {
    /// Number of frames captured.
    let frameCount: Int
    /// Number of frame transitions where the visual diff was abnormally large
    /// compared to the rolling baseline — indicating a sudden visible area change.
    let spikes: Int
    /// The peak diff ratio seen across all frame pairs.
    let peakDiffRatio: CGFloat
    /// The peak regional (tile-level) delta.
    let peakRegionDelta: CGFloat
    /// Mean diff ratio across all frame pairs (baseline "expected" change rate).
    let meanDiffRatio: CGFloat
    /// Details of each spike for debugging.
    let spikeDetails: [(frame: Int, diffRatio: CGFloat, regionDelta: CGFloat)]

    /// Composite score: 0 = silky smooth, higher = more jitter.
    /// Only spikes contribute — high diff ratio during fast scroll is normal.
    var score: CGFloat {
        guard frameCount >= 3 else { return 0 }
        return CGFloat(spikes) * 15.0
    }

    var isStable: Bool { spikes == 0 }
}

// MARK: - JitterMonitor

/// Real-time visual jitter monitor that captures screenshots of the collection view
/// and computes frame-to-frame visual diffs to detect any sudden visible area change.
@MainActor
final class JitterMonitor: ObservableObject {
    /// Current test case number.
    @Published var caseNumber: Int = 0
    /// Current action within the session.
    @Published var actionNumber: Int = 0
    /// Description of current action.
    @Published var actionDesc: String = ""
    /// Live visual diff ratio (fraction of pixels changed between last two frames).
    @Published var liveDiffRatio: CGFloat = 0
    /// Number of visual spikes detected in current scroll action.
    @Published var liveSpikes: Int = 0
    /// Peak region delta in current scroll action.
    @Published var livePeakRegion: CGFloat = 0
    /// Composite jitter score for the last completed scroll action.
    @Published var actionScore: CGFloat = 0
    /// Whether the last action passed the jitter gate.
    @Published var actionPassed: Bool = true
    /// Human-readable status line.
    @Published var statusText: String = "Idle"
    /// ContentSize jumps during scrolling.
    @Published var contentSizeJumps: Int = 0

    private var contentSizeCancellable: AnyCancellable?
    private var offsetCancellable: AnyCancellable?

    /// The UIView to capture screenshots from.
    private weak var captureView: UIView?
    /// Timer for periodic screenshot capture during scrolling.
    private var captureTimer: Timer?
    /// Last captured frame for diff comparison.
    private var lastFrame: CGImage?
    /// Diff ratios collected during current scroll action.
    private var actionDiffs: [(diffRatio: CGFloat, regionDelta: CGFloat)] = []
    /// Frame index for spike tracking.
    private var frameIndex: Int = 0
    /// Spike details for current action.
    private var actionSpikeDetails: [(frame: Int, diffRatio: CGFloat, regionDelta: CGFloat)] = []

    /// Scroll state tracking.
    private var lastOffsetY: CGFloat = 0
    private var isScrolling = false
    private var idleTimer: Timer?

    /// Capture interval — ~15fps for balance of detection vs CPU cost.
    private let captureInterval: TimeInterval = 0.066

    func attach(to vm: AIChatViewModel, captureView: UIView) {
        self.captureView = captureView

        offsetCancellable = vm.contentOffsetYSignal
            .receive(on: DispatchQueue.main)
            .sink { [weak self] y in
                self?.trackScrollActivity(y)
            }
        contentSizeCancellable = vm.contentSizeDeltaSignal
            .receive(on: DispatchQueue.main)
            .sink { [weak self] delta in
                self?.reportContentSizeChange(delta)
            }
    }

    private func trackScrollActivity(_ y: CGFloat) {
        let delta = y - lastOffsetY
        lastOffsetY = y
        if abs(delta) < 0.5 { return }

        // Transition from idle → scrolling = start capturing frames
        if !isScrolling {
            isScrolling = true
            actionNumber += 1
            contentSizeJumps = 0
            startCapturing()
        }

        let dir = delta > 0 ? 1 : -1
        actionDesc = dir > 0 ? "Scrolling Down ↓" : "Scrolling Up ↑"

        // Reset idle timer — fires 0.6s after last scroll event
        idleTimer?.invalidate()
        idleTimer = Timer.scheduledTimer(withTimeInterval: 0.6, repeats: false) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.isScrolling = false
                self.stopCapturing()
                self.finalizeAction()
            }
        }
    }

    private func startCapturing() {
        lastFrame = nil
        actionDiffs.removeAll()
        actionSpikeDetails.removeAll()
        frameIndex = 0
        liveSpikes = 0
        livePeakRegion = 0

        captureTimer?.invalidate()
        captureTimer = Timer.scheduledTimer(withTimeInterval: captureInterval, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.captureFrame()
            }
        }
    }

    private func stopCapturing() {
        captureTimer?.invalidate()
        captureTimer = nil
    }

    private func captureFrame() {
        guard let view = captureView else { return }

        // Render the view to a CGImage
        let renderer = UIGraphicsImageRenderer(bounds: view.bounds)
        let uiImage = renderer.image { ctx in
            view.drawHierarchy(in: view.bounds, afterScreenUpdates: false)
        }
        guard let currentFrame = uiImage.cgImage else { return }

        defer {
            lastFrame = currentFrame
            frameIndex += 1
        }

        guard let prev = lastFrame else { return }

        // Compute visual diff
        guard let diff = VisualDiffEngine.diff(prev, currentFrame) else { return }

        liveDiffRatio = diff.changedRatio
        actionDiffs.append((diffRatio: diff.changedRatio, regionDelta: diff.peakRegionDelta))

        // Detect spikes via diff velocity: a sudden increase in diff that breaks
        // the local trend. During normal scrolling, diff changes gradually.
        // Jitter = diff jumps UP sharply when it should be stable or decreasing.
        if actionDiffs.count >= 3 {
            let i = actionDiffs.count - 1
            let prevDiff = actionDiffs[i - 1].diffRatio
            let velocity = diff.changedRatio - prevDiff

            // Compute median absolute velocity from recent history
            let windowSize = 6
            let start = max(0, i - windowSize)
            if i - start >= 2 {
                var absVelocities: [CGFloat] = []
                for j in (start + 1)..<i {
                    absVelocities.append(abs(actionDiffs[j].diffRatio - actionDiffs[j-1].diffRatio))
                }
                let sorted = absVelocities.sorted()
                let medianV = sorted[sorted.count / 2]
                let threshold = max(medianV * 4.0, 0.03)

                // Only flag positive velocity (diff went UP) with significant diff
                if velocity > threshold && diff.changedRatio > 0.01 {
                    liveSpikes += 1
                    actionSpikeDetails.append((frame: frameIndex, diffRatio: diff.changedRatio, regionDelta: diff.peakRegionDelta))
                }
            }

            // Stutter detection: diff drops to near-zero then jumps back up
            if actionDiffs.count >= 3 {
                let prevPrev = actionDiffs[i - 2].diffRatio
                if prevPrev > 0.02 && prevDiff < 0.005 && diff.changedRatio > 0.02 {
                    liveSpikes += 1
                    actionSpikeDetails.append((frame: frameIndex, diffRatio: diff.changedRatio, regionDelta: diff.peakRegionDelta))
                }
            }
        }

        if diff.peakRegionDelta > livePeakRegion {
            livePeakRegion = diff.peakRegionDelta
        }
    }

    private func finalizeAction() {
        guard !actionDiffs.isEmpty else {
            actionDesc = "Idle"
            return
        }

        let report = buildReport()
        actionScore = report.score
        actionPassed = report.isStable
        statusText = actionPassed
            ? "PASS (score: \(String(format: "%.1f", report.score)))"
            : "FAIL (score: \(String(format: "%.1f", report.score)), spikes: \(report.spikes))"
        actionDesc = "Idle | \(statusText)"
    }

    private func buildReport() -> VisualJitterReport {
        let allRatios = actionDiffs.map { $0.diffRatio }
        let peakRatio = allRatios.max() ?? 0
        let meanRatio = allRatios.isEmpty ? 0 : allRatios.reduce(0, +) / CGFloat(allRatios.count)
        return VisualJitterReport(
            frameCount: actionDiffs.count + 1,
            spikes: liveSpikes,
            peakDiffRatio: peakRatio,
            peakRegionDelta: livePeakRegion,
            meanDiffRatio: meanRatio,
            spikeDetails: actionSpikeDetails
        )
    }

    func reportContentSizeChange(_ delta: CGFloat) {
        if isScrolling && abs(delta) > 2 {
            contentSizeJumps += 1
        }
    }
}

// MARK: - FPS Monitor

/// CADisplayLink-based FPS counter. Measures actual render frame rate during scroll.
/// Exposes live FPS, min/avg/max stats, and drop counts for UITest reporting.
@MainActor
final class FPSMonitor: ObservableObject {
    @Published var currentFPS: Int = 0
    @Published var isTracking = false

    private(set) var samples: [Int] = []
    private var displayLink: CADisplayLink?
    private var frameCount: Int = 0
    private var lastTimestamp: CFTimeInterval = 0
    private var windowStart: CFTimeInterval = 0

    var minFPS: Int { samples.min() ?? 0 }
    var maxFPS: Int { samples.max() ?? 0 }
    var avgFPS: Int {
        guard !samples.isEmpty else { return 0 }
        return samples.reduce(0, +) / samples.count
    }
    var dropCount: Int { samples.filter { $0 < 45 }.count }

    /// Summary string for UITest logging.
    var summary: String {
        "FPS: avg=\(avgFPS) min=\(minFPS) max=\(maxFPS) drops(<45)=\(dropCount) samples=\(samples.count)"
    }

    func start() {
        stop()
        samples.removeAll()
        frameCount = 0
        lastTimestamp = 0
        windowStart = 0
        isTracking = true

        let link = CADisplayLink(target: DisplayLinkTarget(monitor: self), selector: #selector(DisplayLinkTarget.tick(_:)))
        link.add(to: .main, forMode: .common)
        displayLink = link
    }

    func stop() {
        displayLink?.invalidate()
        displayLink = nil
        isTracking = false
    }

    func reset() {
        samples.removeAll()
        currentFPS = 0
    }

    fileprivate func handleTick(_ link: CADisplayLink) {
        if lastTimestamp == 0 {
            lastTimestamp = link.timestamp
            windowStart = link.timestamp
            frameCount = 0
            return
        }

        frameCount += 1
        let elapsed = link.timestamp - windowStart

        // Sample every 0.5 seconds
        if elapsed >= 0.5 {
            let fps = Int(Double(frameCount) / elapsed)
            currentFPS = fps
            samples.append(fps)
            frameCount = 0
            windowStart = link.timestamp
        }

        lastTimestamp = link.timestamp
    }

    /// Non-isolated target for CADisplayLink (avoids @objc MainActor issues).
    private class DisplayLinkTarget: NSObject {
        weak var monitor: FPSMonitor?
        init(monitor: FPSMonitor) { self.monitor = monitor }

        @objc func tick(_ link: CADisplayLink) {
            Task { @MainActor in
                self.monitor?.handleTick(link)
            }
        }
    }
}

// MARK: - MessageListTestView

/// Debug view for testing CollectionViewMessageListV3 with simulated data.
/// Accessible from the Debug menu in ContentView.
struct MessageListTestView: View {
    @StateObject private var simulator = SessionDataSimulator()
    @StateObject private var jitterMonitor = JitterMonitor()
    @StateObject private var fpsMonitor = FPSMonitor()
    @State private var showPasteSheet = false
    @State private var pastedJSON = ""

    /// When true, the view was launched via `--uitest-message-list` launch argument.
    private var isUITestMode: Bool {
        ProcessInfo.processInfo.arguments.contains("--uitest-message-list")
    }

    var body: some View {
        VStack(spacing: 0) {
            // Message list (V3) with jitter overlay
            ZStack(alignment: .topTrailing) {
                CollectionViewMessageListV3(
                    vm: simulator.vm,
                    inputFocused: false,
                    onRetryMessage: nil,
                    onRetryLast: nil,
                    onEdit: nil,
                    onWithdraw: nil,
                    onResume: nil,
                    onStop: nil,
                    onCompact: nil,
                    maxContentWidth: 0,
                    floatingBarHeight: 60,
                    inputBarHeight: 50
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityIdentifier("messageListCollectionView")
                .onAppear {
                    // Find the UICollectionView after it's added to the hierarchy
                    // and attach the jitter monitor's capture view.
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                        if let cv = findCollectionView() {
                            jitterMonitor.attach(to: simulator.vm, captureView: cv)
                        }
                    }
                }

                // Jitter monitoring overlay
                jitterOverlay
            }

            Divider()

            // Controls panel
            controlsPanel
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(.ultraThinMaterial)
        }
        .navigationTitle("Message List V3 Test")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showPasteSheet) {
            pasteSheet
        }
        .onAppear {
            // Read initial case from env
            if let caseStr = ProcessInfo.processInfo.environment["UITEST_CASE"],
               let caseNum = Int(caseStr) {
                jitterMonitor.caseNumber = caseNum
            }

            // Auto-load and auto-play for UITest mode
            if isUITestMode {
                let mode = ProcessInfo.processInfo.environment["UITEST_MODE"] ?? "instant"
                let scenarioName = ProcessInfo.processInfo.environment["UITEST_SCENARIO"] ?? "mixed"
                let scenario = SessionDataSimulator.Scenario(rawValue: scenarioName) ?? .mixed
                simulator.loadBuiltinSample(scenario: scenario)
                if mode == "stream" {
                    simulator.charsPerTick = 50
                    simulator.tickInterval = 0.02
                    simulator.play()
                } else {
                    simulator.loadAllInstantly()
                }
            }
        }
        .accessibilityIdentifier("messageListTestView")
        .onAppear { fpsMonitor.start() }
        .onDisappear { fpsMonitor.stop() }
        .overlay(alignment: .bottomLeading) {
            // Hidden element for UITest to read FPS data
            Text("FPS:\(fpsMonitor.avgFPS)/\(fpsMonitor.minFPS)/\(fpsMonitor.maxFPS)/\(fpsMonitor.dropCount)")
                .font(.system(size: 1))
                .foregroundStyle(.clear)
                .accessibilityIdentifier("fpsData")
                .accessibilityLabel("FPS:\(fpsMonitor.avgFPS)/\(fpsMonitor.minFPS)/\(fpsMonitor.maxFPS)/\(fpsMonitor.dropCount)")
        }
    }

    /// Walk the view hierarchy to find the UICollectionView hosted by V3.
    private func findCollectionView() -> UICollectionView? {
        guard let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
              let window = windowScene.windows.first else { return nil }
        return findCollectionViewIn(window)
    }

    private func findCollectionViewIn(_ view: UIView) -> UICollectionView? {
        if let cv = view as? UICollectionView { return cv }
        for sub in view.subviews {
            if let found = findCollectionViewIn(sub) { return found }
        }
        return nil
    }

    // MARK: - Jitter Overlay

    private var jitterOverlay: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text("Case #\(jitterMonitor.caseNumber)")
                    .font(.system(.caption, design: .monospaced).weight(.bold))
                Text("Action #\(jitterMonitor.actionNumber)")
                    .font(.system(.caption, design: .monospaced).weight(.bold))
                    .foregroundStyle(.cyan)
            }
            if !jitterMonitor.actionDesc.isEmpty {
                Text(jitterMonitor.actionDesc)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(.primary)
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
            }
            HStack(spacing: 6) {
                Text("Diff:")
                    .font(.system(.caption, design: .monospaced))
                Text(String(format: "%.1f%%", jitterMonitor.liveDiffRatio * 100))
                    .font(.system(.caption, design: .monospaced).weight(.bold))
                    .foregroundStyle(jitterMonitor.liveDiffRatio < 0.02 ? .green :
                                     jitterMonitor.liveDiffRatio < 0.05 ? .yellow : .red)
                Text("Spk:")
                    .font(.system(.caption, design: .monospaced))
                Text("\(jitterMonitor.liveSpikes)")
                    .font(.system(.caption, design: .monospaced).weight(.bold))
                    .foregroundStyle(jitterMonitor.liveSpikes == 0 ? .green : .red)
            }
            HStack(spacing: 6) {
                Text("Peak:")
                    .font(.system(.caption, design: .monospaced))
                Text(String(format: "%.0f", jitterMonitor.livePeakRegion))
                    .font(.system(.caption, design: .monospaced).weight(.bold))
                    .foregroundStyle(jitterMonitor.livePeakRegion < 20 ? .green :
                                     jitterMonitor.livePeakRegion < 40 ? .yellow : .red)
                Text("CSJ:")
                    .font(.system(.caption, design: .monospaced))
                Text("\(jitterMonitor.contentSizeJumps)")
                    .font(.system(.caption, design: .monospaced).weight(.bold))
                    .foregroundStyle(jitterMonitor.contentSizeJumps == 0 ? .green : .red)
            }
            HStack(spacing: 6) {
                Text("Act:")
                    .font(.system(.caption, design: .monospaced))
                Text(String(format: "%.1f", jitterMonitor.actionScore))
                    .font(.system(.caption, design: .monospaced).weight(.bold))
                    .foregroundStyle(jitterMonitor.actionPassed ? .green : .red)
                Text(jitterMonitor.actionPassed ? "PASS" : "FAIL")
                    .font(.system(.caption, design: .monospaced).weight(.heavy))
                    .foregroundStyle(jitterMonitor.actionPassed ? .green : .red)
            }
            // FPS monitor
            HStack(spacing: 6) {
                Text("FPS:")
                    .font(.system(.caption, design: .monospaced))
                Text("\(fpsMonitor.currentFPS)")
                    .font(.system(.caption, design: .monospaced).weight(.bold))
                    .foregroundStyle(fpsMonitor.currentFPS >= 55 ? .green :
                                     fpsMonitor.currentFPS >= 30 ? .yellow : .red)
                if !fpsMonitor.samples.isEmpty {
                    Text("avg=\(fpsMonitor.avgFPS) min=\(fpsMonitor.minFPS)")
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(10)
        .frame(maxWidth: 280)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 10))
        .padding(.trailing, 8)
        .padding(.top, 8)
        .accessibilityIdentifier("jitterOverlay")
        .allowsHitTesting(false)
    }

    // MARK: - Controls

    private var controlsPanel: some View {
        VStack(spacing: 10) {
            // Status
            HStack {
                Circle()
                    .fill(statusColor)
                    .frame(width: 8, height: 8)
                Text(simulator.progress)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Spacer()
                Text(simulator.state == .playing ? "PLAYING" :
                     simulator.state == .paused ? "PAUSED" :
                     simulator.state == .finished ? "DONE" : "IDLE")
                    .font(.caption2.weight(.bold).monospaced())
                    .foregroundStyle(statusColor)
                    .accessibilityIdentifier("simulatorState")
            }

            // Speed controls
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Speed: \(simulator.charsPerTick) ch/tick")
                        .font(.caption2).foregroundStyle(.secondary)
                    Slider(value: Binding(
                        get: { Double(simulator.charsPerTick) },
                        set: { simulator.charsPerTick = Int($0) }
                    ), in: 1...100, step: 1)
                }

                VStack(alignment: .leading, spacing: 2) {
                    Text("Interval: \(String(format: "%.0f", simulator.tickInterval * 1000))ms")
                        .font(.caption2).foregroundStyle(.secondary)
                    Slider(value: $simulator.tickInterval, in: 0.01...0.2, step: 0.01)
                }
            }

            // Action buttons
            HStack(spacing: 10) {
                // Load data
                Menu {
                    Menu {
                        ForEach([
                            SessionDataSimulator.Scenario.mixed,
                            .manyMessages,
                            .longContent,
                            .toolHeavy,
                            .streaming,
                            .travelPlanning,
                        ], id: \.rawValue) { scenario in
                            Button(scenario.rawValue) {
                                simulator.loadBuiltinSample(scenario: scenario)
                            }
                        }
                    } label: {
                        Label("Built-in Sample", systemImage: "doc.text")
                    }
                    Button {
                        showPasteSheet = true
                    } label: {
                        Label("Paste Session JSON", systemImage: "doc.on.clipboard")
                    }
                    Button {
                        if let str = UIPasteboard.general.string {
                            simulator.loadSessionData(str)
                        }
                    } label: {
                        Label("From Clipboard", systemImage: "arrow.down.doc")
                    }
                } label: {
                    Label("Load", systemImage: "tray.and.arrow.down")
                        .font(.caption.weight(.semibold))
                        .padding(.horizontal, 12).padding(.vertical, 6)
                        .background(Color.blue.opacity(0.15)).clipShape(Capsule())
                }

                // Playback controls
                if simulator.state == .playing {
                    Button { simulator.pause() } label: {
                        Image(systemName: "pause.fill")
                    }
                    .accessibilityIdentifier("pauseButton")
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .background(Color.secondary.opacity(0.12)).clipShape(Capsule())
                } else {
                    Button { simulator.play() } label: {
                        Image(systemName: "play.fill")
                    }
                    .accessibilityIdentifier("playButton")
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .background(Color.secondary.opacity(0.12)).clipShape(Capsule())
                }

                Button { simulator.loadAllInstantly() } label: {
                    Image(systemName: "forward.end.fill")
                }
                .accessibilityIdentifier("loadAllButton")
                .font(.caption.weight(.semibold))
                .padding(.horizontal, 10).padding(.vertical, 6)
                .background(Color.secondary.opacity(0.12)).clipShape(Capsule())

                Button { simulator.reset() } label: {
                    Image(systemName: "arrow.counterclockwise")
                }
                .accessibilityIdentifier("resetButton")
                .font(.caption.weight(.semibold))
                .padding(.horizontal, 10).padding(.vertical, 6)
                .background(Color.secondary.opacity(0.12)).clipShape(Capsule())

                Spacer()

                // Force scroll
                Button {
                    simulator.vm.forceScrollToBottom.send()
                } label: {
                    Image(systemName: "arrow.down.to.line")
                        .font(.caption.weight(.semibold))
                        .padding(.horizontal, 10).padding(.vertical, 6)
                        .background(Color.orange.opacity(0.15)).clipShape(Capsule())
                }
                .accessibilityIdentifier("scrollToBottomButton")
            }
        }
    }

    private var statusColor: Color {
        switch simulator.state {
        case .idle: return .gray
        case .playing: return .green
        case .paused: return .orange
        case .finished: return .blue
        }
    }

    // MARK: - Paste Sheet

    private var pasteSheet: some View {
        NavigationStack {
            VStack(spacing: 12) {
                Text("Paste session JSON from \"Copy Session Data\"")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                TextEditor(text: $pastedJSON)
                    .font(.system(.caption, design: .monospaced))
                    .border(Color.secondary.opacity(0.3))
                    .frame(maxHeight: .infinity)
            }
            .padding()
            .navigationTitle("Paste Session Data")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showPasteSheet = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Load") {
                        simulator.loadSessionData(pastedJSON)
                        pastedJSON = ""
                        showPasteSheet = false
                    }
                }
            }
        }
    }
}
#endif
