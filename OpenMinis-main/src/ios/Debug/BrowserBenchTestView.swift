#if DEBUG
import SwiftUI

private let logger = AppLogger(category: "BrowserBench")

// MARK: - Log Entry

struct BenchLogEntry: Identifiable {
    let id = UUID()
    let timestamp: Date
    let command: String
    let duration: TimeInterval
    let result: String
    let isError: Bool
}

// MARK: - ViewModel

@MainActor
final class BrowserBenchTestViewModel: ObservableObject {
    @Published var isRunning = false
    @Published var logs: [BenchLogEntry] = []

    private let browser = BrowserUseManager()
    private var benchTask: Task<Void, Never>?

    private let testURL = "https://example.com"
    private let testJS = "document.title + ' | ' + document.body.innerText.substring(0, 200)"

    func start() {
        guard !isRunning else { return }
        isRunning = true
        logs.removeAll()
        logger.info("Bench started")

        benchTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }

                // Navigate
                let navStart = CFAbsoluteTimeGetCurrent()
                let navInput = BrowserActionInput(
                    action: .navigate, url: testURL, selector: nil, text: nil,
                    coordinateX: nil, coordinateY: nil, direction: nil,
                    amount: nil, script: nil, userAgent: nil, maxDepth: nil, tabId: nil
                )
                let navResult: BrowserActionResult
                do {
                    navResult = try await browser.execute(action: navInput)
                } catch {
                    navResult = BrowserActionResult(text: error.localizedDescription, success: false)
                }
                let navDuration = CFAbsoluteTimeGetCurrent() - navStart

                let navEntry = BenchLogEntry(
                    timestamp: Date(),
                    command: "navigate",
                    duration: navDuration,
                    result: String(navResult.text.prefix(300)),
                    isError: !navResult.success
                )
                self.logs.append(navEntry)
                logger.info("navigate \(String(format: "%.0f", navDuration * 1000))ms success=\(navResult.success)")

                if Task.isCancelled { break }

                // Execute JS
                let jsStart = CFAbsoluteTimeGetCurrent()
                let jsInput = BrowserActionInput(
                    action: .executeJS, url: nil, selector: nil, text: nil,
                    coordinateX: nil, coordinateY: nil, direction: nil,
                    amount: nil, script: testJS, userAgent: nil, maxDepth: nil, tabId: nil
                )
                let jsResult: BrowserActionResult
                do {
                    jsResult = try await browser.execute(action: jsInput)
                } catch {
                    jsResult = BrowserActionResult(text: error.localizedDescription, success: false)
                }
                let jsDuration = CFAbsoluteTimeGetCurrent() - jsStart

                let jsEntry = BenchLogEntry(
                    timestamp: Date(),
                    command: "executeJS",
                    duration: jsDuration,
                    result: String(jsResult.text.prefix(300)),
                    isError: !jsResult.success
                )
                self.logs.append(jsEntry)
                logger.info("executeJS \(String(format: "%.0f", jsDuration * 1000))ms success=\(jsResult.success)")

                if Task.isCancelled { break }

                // Wait 3 seconds
                try? await Task.sleep(nanoseconds: 3_000_000_000)
            }
        }
    }

    func stop() {
        benchTask?.cancel()
        benchTask = nil
        isRunning = false
        logger.info("Bench stopped")
    }
}

// MARK: - View

struct BrowserBenchTestView: View {
    @StateObject private var vm = BrowserBenchTestViewModel()
    @Environment(\.dismiss) private var dismiss

    private let timeFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss.SSS"
        return f
    }()

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                List {
                    ForEach(vm.logs) { entry in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(timeFormatter.string(from: entry.timestamp))
                                    .font(.system(size: 12, design: .monospaced))
                                    .foregroundStyle(.secondary)
                                Spacer()
                                Text(String(format: "%.0fms", entry.duration * 1000))
                                    .font(.system(size: 12, weight: .medium, design: .monospaced))
                                    .foregroundStyle(entry.isError ? .red : .primary)
                            }
                            Text(entry.command)
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(entry.isError ? .red : .primary)
                            Text(entry.result)
                                .font(.system(size: 12, design: .monospaced))
                                .foregroundStyle(entry.isError ? .red : .secondary)
                                .lineLimit(3)
                        }
                        .padding(.vertical, 4)
                        .id(entry.id)
                    }
                }
                .listStyle(.plain)
                .onChange(of: vm.logs.count) { _ in
                    if let last = vm.logs.last {
                        withAnimation {
                            proxy.scrollTo(last.id, anchor: .bottom)
                        }
                    }
                }
            }
            .navigationTitle("Browser Bench Test")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Done") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button(vm.isRunning ? "Stop" : "Start") {
                        if vm.isRunning {
                            vm.stop()
                        } else {
                            vm.start()
                        }
                    }
                    .foregroundStyle(vm.isRunning ? .red : .accentColor)
                }
            }
        }
    }
}
#endif
