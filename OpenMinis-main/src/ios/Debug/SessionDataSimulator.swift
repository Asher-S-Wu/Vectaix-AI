#if DEBUG
import Foundation
import Combine

/// Replays session data (from "Copy Session Data" JSON) into an AIChatViewModel,
/// simulating streaming character-by-character for testing the message list.
@MainActor
final class SessionDataSimulator: ObservableObject {

    /// Playback state
    enum State: Equatable {
        case idle
        case playing
        case paused
        case finished
    }

    @Published var state: State = .idle
    @Published var progress: String = ""

    /// Characters per tick during text streaming simulation
    @Published var charsPerTick: Int = 20
    /// Tick interval in seconds
    @Published var tickInterval: TimeInterval = 0.03

    /// The view model being driven
    let vm: AIChatViewModel

    /// Parsed messages from session JSON
    private var parsedMessages: [ParsedMessage] = []
    /// Current position in replay
    private var currentMessageIndex: Int = 0
    private var currentBlockIndex: Int = 0
    private var currentCharIndex: Int = 0
    private var timer: Timer?

    init() {
        self.vm = AIChatViewModel()
    }

    // MARK: - Parsed Types

    struct ParsedMessage {
        let role: ChatMessageRole
        let blocks: [ParsedBlock]
        let usage: TokenUsage?
    }

    struct ParsedBlock {
        let kind: AssistantBlockKind
        let content: String
        let toolStatus: ToolBlockStatus?
    }

    // MARK: - Load Session Data

    /// Parse "Copy Session Data" JSON format into internal representation
    func loadSessionData(_ json: String) {
        guard let data = json.data(using: .utf8),
              let entries = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            progress = "Failed to parse JSON"
            return
        }

        parsedMessages = entries.compactMap { entry -> ParsedMessage? in
            guard let roleStr = entry["role"] as? String,
                  let parts = entry["parts"] as? [[String: Any]] else { return nil }

            let role: ChatMessageRole
            switch roleStr {
            case "user": role = .user
            case "assistant": role = .assistant
            default: return nil
            }

            var blocks: [ParsedBlock] = []
            for part in parts {
                guard let type = part["type"] as? String else { continue }
                switch type {
                case "text":
                    let text = part["text"] as? String ?? ""
                    if !text.isEmpty {
                        blocks.append(ParsedBlock(kind: .text, content: text, toolStatus: nil))
                    }
                case "tool_use":
                    let name = part["name"] as? String ?? "unknown"
                    let input = part["input"] as? [String: Any] ?? [:]
                    let block = parseToolUseBlock(name: name, input: input)
                    blocks.append(block)
                case "tool_result":
                    // Tool results are shown inline with the tool_use block, skip
                    break
                default:
                    break
                }
            }

            // Parse usage if present
            var usage: TokenUsage?
            if let usageDict = entry["usage"] as? [String: Any] {
                var u = TokenUsage()
                u.inputTokens = usageDict["input_tokens"] as? Int ?? 0
                u.outputTokens = usageDict["output_tokens"] as? Int ?? 0
                u.cacheCreationTokens = usageDict["cache_creation_tokens"] as? Int ?? 0
                u.cacheReadTokens = usageDict["cache_read_tokens"] as? Int ?? 0
                usage = u
            }

            if role == .user && blocks.isEmpty {
                // User messages: combine all text parts into content
                let content = parts.compactMap { ($0["type"] as? String == "text") ? $0["text"] as? String : nil }.joined(separator: "\n")
                blocks = [ParsedBlock(kind: .text, content: content, toolStatus: nil)]
            }

            return ParsedMessage(role: role, blocks: blocks, usage: usage)
        }

        progress = "Loaded \(parsedMessages.count) messages"
        state = .idle
        currentMessageIndex = 0
    }

    private func parseToolUseBlock(name: String, input: [String: Any]) -> ParsedBlock {
        let inputJson = (try? JSONSerialization.data(withJSONObject: input, options: .sortedKeys))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "{}"

        let kind: AssistantBlockKind
        switch name {
        case "bash", "execute_command":
            let cmd = input["command"] as? String ?? inputJson
            kind = .shellTool(command: cmd)
        case "read_file":
            let path = input["path"] as? String ?? input["file_path"] as? String ?? "?"
            kind = .fileReadTool(path: path)
        case "write_file", "create_file":
            let path = input["path"] as? String ?? input["file_path"] as? String ?? "?"
            kind = .fileWriteTool(path: path)
        case "edit_file":
            let path = input["path"] as? String ?? input["file_path"] as? String ?? "?"
            kind = .fileEditTool(path: path)
        default:
            kind = .shellTool(command: name)
        }

        return ParsedBlock(kind: kind, content: inputJson, toolStatus: .success)
    }

    // MARK: - Load Built-in Sample

    /// Available test scenarios, selectable via UITEST_SCENARIO env var.
    enum Scenario: String {
        /// Default: mixed content with all block kinds (10 messages)
        case mixed
        /// Many short messages for fast-scroll stress testing (30 messages)
        case manyMessages
        /// Long single response with deeply nested markdown
        case longContent
        /// Tool-heavy session with all tool types and failures
        case toolHeavy
        /// Streaming-focused: many small text blocks for streaming tests
        case streaming
        /// Rich travel planning session with many tables, code blocks, emoji, CJK text
        case travelPlanning
        /// Health/sleep analysis session loaded from JSON test data
        case healthData
    }

    /// Load a built-in sample for the given scenario
    func loadBuiltinSample(scenario: Scenario = .mixed) {
        switch scenario {
        case .mixed:
            parsedMessages = Self.mixedScenario()
        case .manyMessages:
            parsedMessages = Self.manyMessagesScenario()
        case .longContent:
            parsedMessages = Self.longContentScenario()
        case .toolHeavy:
            parsedMessages = Self.toolHeavyScenario()
        case .streaming:
            parsedMessages = Self.streamingScenario()
        case .travelPlanning:
            parsedMessages = Self.travelPlanningScenario()
        case .healthData:
            loadJSONScenario(named: "test-data-health")
            return  // loadJSONScenario sets parsedMessages and progress internally
        }
        progress = "Loaded \(parsedMessages.count) messages (\(scenario.rawValue))"
        state = .idle
        currentMessageIndex = 0
    }

    // MARK: - JSON Scenario Loader

    /// Load a scenario from a bundled JSON test data file.
    private func loadJSONScenario(named name: String) {
        guard let url = Bundle.main.url(forResource: name, withExtension: "json"),
              let json = try? String(contentsOf: url, encoding: .utf8) else {
            parsedMessages = [Self.msg(.assistant, "Failed to load test data: \(name).json")]
            return
        }
        loadSessionData(json)
    }

    // MARK: - Scenario: Mixed (default)

    private static func mixedScenario() -> [ParsedMessage] {
        [
            // 1. User asks about project
            msg(.user, "Can you help me understand the project structure and fix the build error?"),

            // 2. Assistant explores with shell + file read + table + code
            ParsedMessage(role: .assistant, blocks: [
                tb("I'll explore the project structure and then look at the build error.\n\nFirst, let me examine the directory layout:"),
                ParsedBlock(kind: .shellTool(command: "find . -name '*.swift' | head -20"), content: "find . -name '*.swift' | head -20", toolStatus: .success),
                tb("""
                The project has the following structure:

                | Directory | Purpose | Files |
                |-----------|---------|-------|
                | `src/ios/Agent/` | Main chat agent UI | 15 |
                | `src/ios/Providers/` | LLM provider abstractions | 8 |
                | `src/ios/Shared/` | Common utilities | 12 |
                | `src/ios/Views/` | Top-level SwiftUI views | 10 |
                | `src/ios/Debug/` | Debug tools | 6 |

                Now let me read the build configuration:
                """),
                ParsedBlock(kind: .fileReadTool(path: "Package.swift"), content: "{\"path\": \"Package.swift\"}", toolStatus: .success),
                tb("""
                I found the issue! Here's the fix:

                ```swift
                // Before (broken)
                import SwiftAnthropic

                // After (fixed)
                import SwiftAnthropic
                import Foundation
                ```

                Let me apply the fix:
                """),
                ParsedBlock(kind: .fileEditTool(path: "src/ios/Providers/AnthropicProvider.swift"), content: "{\"path\": \"src/ios/Providers/AnthropicProvider.swift\"}", toolStatus: .success),
                tb("The build error should now be resolved."),
            ], usage: nil),

            // 3. User asks for more
            msg(.user, "Great, can you also add error handling and write a new test file?"),

            // 4. Assistant with file write + browser + memory tools
            ParsedMessage(role: .assistant, blocks: [
                tb("Sure! Let me check the existing test patterns first."),
                ParsedBlock(kind: .browserTool(action: "navigate"), content: "https://developer.apple.com/documentation/xctest", toolStatus: .success),
                tb("Good, I've reviewed the XCTest docs. Let me also check my memory for previous patterns:"),
                ParsedBlock(kind: .memoryTool(action: "recall"), content: "testing patterns", toolStatus: .success),
                tb("Now I'll create the test file:"),
                ParsedBlock(kind: .fileWriteTool(path: "Tests/ProviderTests.swift"), content: "{\"path\": \"Tests/ProviderTests.swift\"}", toolStatus: .success),
                tb("""
                ## Error Handling Implementation

                ```swift
                enum ProviderError: LocalizedError {
                    case networkError(underlying: Error)
                    case authenticationFailed(message: String)
                    case rateLimited(retryAfter: TimeInterval?)
                    case serverError(statusCode: Int, body: String?)
                    case parsingError(context: String)

                    var errorDescription: String? {
                        switch self {
                        case .networkError(let error):
                            return "Network error: \\(error.localizedDescription)"
                        case .authenticationFailed(let message):
                            return "Authentication failed: \\(message)"
                        case .rateLimited(let retryAfter):
                            if let seconds = retryAfter {
                                return "Rate limited. Retry after \\(Int(seconds))s"
                            }
                            return "Rate limited."
                        case .serverError(let code, let body):
                            return "Server error (\\(code)): \\(body ?? "unknown")"
                        case .parsingError(let context):
                            return "Parse error: \\(context)"
                        }
                    }
                }
                ```

                Test file and error handling are both complete.
                """),
            ], usage: nil),

            // 5. User asks about performance
            msg(.user, "How does the scroll performance look? Any concerns with large message lists?"),

            // 6. Assistant with long analysis (scroll test target)
            ParsedMessage(role: .assistant, blocks: [
                tb("""
                Great question! Let me analyze the scroll performance characteristics:

                ## Performance Analysis

                ### 1. Cell Recycling

                The V3 message list uses `UICollectionView` with cell-per-block architecture. Each block type has its own reuse identifier, enabling efficient recycling:

                - **Text blocks**: `SelfSizingCell` with `UIHostingConfiguration`
                - **Tool blocks**: Lightweight capsule views, minimal layout cost
                - **Headers/Footers**: Fixed-height, near-zero layout time

                ### 2. Height Estimation (3-tier)

                | Tier | Source | Accuracy | Cost |
                |------|--------|----------|------|
                | Cache | `preferredLayoutAttributesFitting` | Exact | Free (cached) |
                | Precalc | `NSAttributedString.boundingRect` | ~98% | Low (one-time) |
                | Estimate | Character count heuristic | ~80% | Negligible |

                ### 3. Scroll State Machine

                Only 2 states instead of V2's 6+:

                ```
                    user drags          near bottom after
                 ┌─────────────>  userBrowsing  ──────────────┐
                 │               not near bottom              v
                 │               after interaction     autoScrolling
                 │                    ^                       │
                 └────────────────────┴───────────────────────┘
                ```

                ### 4. Benchmarks

                On iPhone 11 (A13):
                - Initial render (50 messages): **~120ms**
                - Scroll to top: **60fps** sustained
                - Streaming append: **<2ms** per character batch
                - Memory: **~45MB** for 100 messages with mixed blocks

                ### 5. Known Limitations

                1. Very long code blocks (>500 lines) may cause initial sizing delay
                2. Rapid tool block insertion during streaming can cause brief layout passes
                3. Image blocks are not yet lazy-loaded (TODO)

                Overall the performance is solid for typical usage. The main bottleneck would be extremely long conversations (200+ messages), where we might want to consider virtualization of off-screen messages.
                """),
            ], usage: nil),

            // 7. User asks to run tests
            msg(.user, "Run the tests and show me the results"),

            // 8. Assistant with shell commands and results
            ParsedMessage(role: .assistant, blocks: [
                tb("I'll run the test suite:"),
                ParsedBlock(kind: .shellTool(command: "xcodebuild test -scheme Minis -destination 'platform=iOS Simulator,name=iPhone 15'"), content: "xcodebuild test ...", toolStatus: .success),
                tb("""
                All tests passed:

                ```
                Test Suite 'All tests' passed at 2026-03-22 14:30:00.
                     Executed 6 tests, with 0 failures (0 unexpected) in 45.231 (47.892) seconds
                ```

                | Test | Duration | Result |
                |------|----------|--------|
                | testStaticLongContentRendering | 3.2s | Pass |
                | testFastScrollingStability | 8.1s | Pass |
                | testStreamingAutoScroll | 12.4s | Pass |
                | testStreamingWithUserScrollHover | 15.3s | Pass |
                | testScrollDecelerationStability | 4.8s | Pass |
                | testResetAndReload | 1.4s | Pass |
                """),
            ], usage: nil),

            // 9. User wraps up
            msg(.user, "Perfect, thanks for all the help!"),

            // 10. Short closing response
            ParsedMessage(role: .assistant, blocks: [
                tb("You're welcome! The V3 message list is looking solid with proper error handling, comprehensive tests, and good scroll performance. Let me know if you need anything else."),
            ], usage: nil),
        ]
    }

    // MARK: - Scenario: Many Messages (50 messages for scroll/lazy-load stress)

    private static func manyMessagesScenario() -> [ParsedMessage] {
        var messages: [ParsedMessage] = []
        for i in 1...25 {
            messages.append(msg(.user, "Question \(i): How does feature \(i) work?"))
            messages.append(makeFeatureResponse(i))
        }
        return messages
    }

    private static func makeFeatureResponse(_ i: Int) -> ParsedMessage {
        let toolKind: AssistantBlockKind
        switch i % 5 {
        case 0: toolKind = .shellTool(command: "grep -r 'feature' src/")
        case 1: toolKind = .fileReadTool(path: "src/Feature.swift")
        case 2: toolKind = .fileEditTool(path: "src/Feature.swift")
        case 3: toolKind = .fileWriteTool(path: "src/NewFeature.swift")
        default: toolKind = .browserTool(action: "navigate")
        }
        let status: ToolBlockStatus = (i % 7 == 0) ? .failed(message: "Not found") : .success
        let text = "Feature \(i) uses layered architecture:\n\n1. **Presentation** — SwiftUI\n2. **Domain** — pure Swift\n3. **Data** — async/await\n\n```swift\nstruct FeatureView: View {\n    var body: some View { Text(\"Hello\") }\n}\n```"
        return ParsedMessage(role: .assistant, blocks: [
            tb("Looking at feature \(i)..."),
            ParsedBlock(kind: toolKind, content: "{}", toolStatus: status),
            tb(text),
        ], usage: nil)
    }

    // MARK: - Scenario: Long Content (deep markdown, long code)

    private static func longContentScenario() -> [ParsedMessage] {
        [
            msg(.user, "Give me a comprehensive guide to building a UICollectionView with compositional layout"),

            ParsedMessage(role: .assistant, blocks: [
                tb("""
                # Comprehensive Guide: UICollectionView with Compositional Layout

                ## Table of Contents

                1. [Overview](#overview)
                2. [Basic Setup](#basic-setup)
                3. [Layout Groups](#layout-groups)
                4. [Supplementary Views](#supplementary-views)
                5. [Diffable Data Source](#diffable-data-source)
                6. [Self-Sizing Cells](#self-sizing-cells)
                7. [Performance Tips](#performance-tips)

                ---

                ## 1. Overview

                `UICollectionViewCompositionalLayout` was introduced in iOS 13 and provides a **declarative API** for building complex, multi-section layouts. It replaces the need for custom `UICollectionViewLayout` subclasses in most cases.

                ### Key Concepts

                | Concept | Description | Analogous To |
                |---------|-------------|-------------|
                | `NSCollectionLayoutItem` | Single content element | Cell |
                | `NSCollectionLayoutGroup` | Container for items | Row/Column |
                | `NSCollectionLayoutSection` | Container for groups | Table section |
                | `NSCollectionLayoutSize` | Flexible sizing | Auto Layout constraint |
                | `NSCollectionLayoutBoundarySupplementaryItem` | Header/footer | Section header |

                ### Architecture Diagram

                ```
                ┌──────────────────────────────────────────┐
                │  UICollectionViewCompositionalLayout      │
                │  ┌────────────────────────────────────┐  │
                │  │  Section 0                          │  │
                │  │  ┌──────────────────────────────┐  │  │
                │  │  │  Group (horizontal)           │  │  │
                │  │  │  ┌──────┐ ┌──────┐ ┌──────┐  │  │  │
                │  │  │  │ Item │ │ Item │ │ Item │  │  │  │
                │  │  │  └──────┘ └──────┘ └──────┘  │  │  │
                │  │  └──────────────────────────────┘  │  │
                │  └────────────────────────────────────┘  │
                │  ┌────────────────────────────────────┐  │
                │  │  Section 1                          │  │
                │  │  ┌──────────────────────────────┐  │  │
                │  │  │  Group (vertical)             │  │  │
                │  │  │  ┌──────────────────────────┐│  │  │
                │  │  │  │ Item (full width)         ││  │  │
                │  │  │  └──────────────────────────┘│  │  │
                │  │  └──────────────────────────────┘  │  │
                │  └────────────────────────────────────┘  │
                └──────────────────────────────────────────┘
                ```

                ## 2. Basic Setup

                ```swift
                import UIKit

                class CollectionViewController: UIViewController {

                    private var collectionView: UICollectionView!
                    private var dataSource: UICollectionViewDiffableDataSource<Section, Item>!

                    enum Section: Int, CaseIterable {
                        case featured
                        case regular
                        case compact
                    }

                    struct Item: Hashable {
                        let id = UUID()
                        let title: String
                        let subtitle: String
                        let imageName: String
                    }

                    override func viewDidLoad() {
                        super.viewDidLoad()
                        configureCollectionView()
                        configureDataSource()
                        applyInitialSnapshot()
                    }

                    private func configureCollectionView() {
                        let layout = createLayout()
                        collectionView = UICollectionView(
                            frame: view.bounds,
                            collectionViewLayout: layout
                        )
                        collectionView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
                        collectionView.delegate = self
                        view.addSubview(collectionView)
                    }

                    private func createLayout() -> UICollectionViewCompositionalLayout {
                        UICollectionViewCompositionalLayout { sectionIndex, environment in
                            guard let section = Section(rawValue: sectionIndex) else { return nil }
                            switch section {
                            case .featured:
                                return self.createFeaturedSection(environment: environment)
                            case .regular:
                                return self.createRegularSection()
                            case .compact:
                                return self.createCompactSection()
                            }
                        }
                    }
                }
                ```

                ## 3. Layout Groups

                ### Horizontal Scrolling Section

                ```swift
                private func createFeaturedSection(
                    environment: NSCollectionLayoutEnvironment
                ) -> NSCollectionLayoutSection {
                    let itemSize = NSCollectionLayoutSize(
                        widthDimension: .fractionalWidth(1.0),
                        heightDimension: .fractionalHeight(1.0)
                    )
                    let item = NSCollectionLayoutItem(layoutSize: itemSize)
                    item.contentInsets = NSDirectionalEdgeInsets(
                        top: 8, leading: 8, bottom: 8, trailing: 8
                    )

                    let groupSize = NSCollectionLayoutSize(
                        widthDimension: .fractionalWidth(0.85),
                        heightDimension: .absolute(250)
                    )
                    let group = NSCollectionLayoutGroup.horizontal(
                        layoutSize: groupSize,
                        subitems: [item]
                    )

                    let section = NSCollectionLayoutSection(group: group)
                    section.orthogonalScrollingBehavior = .groupPagingCentered
                    section.contentInsets = NSDirectionalEdgeInsets(
                        top: 16, leading: 0, bottom: 16, trailing: 0
                    )

                    // Add header
                    let headerSize = NSCollectionLayoutSize(
                        widthDimension: .fractionalWidth(1.0),
                        heightDimension: .estimated(44)
                    )
                    let header = NSCollectionLayoutBoundarySupplementaryItem(
                        layoutSize: headerSize,
                        elementKind: UICollectionView.elementKindSectionHeader,
                        alignment: .top
                    )
                    section.boundarySupplementaryItems = [header]

                    return section
                }
                ```

                ### Grid Section

                ```swift
                private func createRegularSection() -> NSCollectionLayoutSection {
                    let itemSize = NSCollectionLayoutSize(
                        widthDimension: .fractionalWidth(0.5),
                        heightDimension: .estimated(200)
                    )
                    let item = NSCollectionLayoutItem(layoutSize: itemSize)
                    item.contentInsets = .init(top: 4, leading: 4, bottom: 4, trailing: 4)

                    let groupSize = NSCollectionLayoutSize(
                        widthDimension: .fractionalWidth(1.0),
                        heightDimension: .estimated(200)
                    )
                    let group = NSCollectionLayoutGroup.horizontal(
                        layoutSize: groupSize,
                        repeatingSubitem: item,
                        count: 2
                    )

                    let section = NSCollectionLayoutSection(group: group)
                    section.contentInsets = .init(top: 8, leading: 8, bottom: 8, trailing: 8)
                    return section
                }
                ```

                ## 4. Supplementary Views

                ```swift
                private func createCompactSection() -> NSCollectionLayoutSection {
                    let itemSize = NSCollectionLayoutSize(
                        widthDimension: .fractionalWidth(1.0),
                        heightDimension: .estimated(44)
                    )
                    let item = NSCollectionLayoutItem(layoutSize: itemSize)

                    let groupSize = NSCollectionLayoutSize(
                        widthDimension: .fractionalWidth(1.0),
                        heightDimension: .estimated(44)
                    )
                    let group = NSCollectionLayoutGroup.vertical(
                        layoutSize: groupSize,
                        subitems: [item]
                    )

                    let section = NSCollectionLayoutSection(group: group)

                    // Sticky header
                    let headerSize = NSCollectionLayoutSize(
                        widthDimension: .fractionalWidth(1.0),
                        heightDimension: .absolute(50)
                    )
                    let header = NSCollectionLayoutBoundarySupplementaryItem(
                        layoutSize: headerSize,
                        elementKind: UICollectionView.elementKindSectionHeader,
                        alignment: .top
                    )
                    header.pinToVisibleBounds = true
                    section.boundarySupplementaryItems = [header]

                    return section
                }
                ```

                ## 5. Diffable Data Source

                ```swift
                private func configureDataSource() {
                    let cellRegistration = UICollectionView.CellRegistration<UICollectionViewListCell, Item> {
                        cell, indexPath, item in
                        var config = cell.defaultContentConfiguration()
                        config.text = item.title
                        config.secondaryText = item.subtitle
                        config.image = UIImage(systemName: item.imageName)
                        cell.contentConfiguration = config
                    }

                    dataSource = UICollectionViewDiffableDataSource(
                        collectionView: collectionView
                    ) { collectionView, indexPath, item in
                        collectionView.dequeueConfiguredReusableCell(
                            using: cellRegistration,
                            for: indexPath,
                            item: item
                        )
                    }
                }

                private func applyInitialSnapshot() {
                    var snapshot = NSDiffableDataSourceSnapshot<Section, Item>()
                    snapshot.appendSections(Section.allCases)

                    snapshot.appendItems([
                        Item(title: "Featured 1", subtitle: "Description", imageName: "star"),
                        Item(title: "Featured 2", subtitle: "Description", imageName: "heart"),
                    ], toSection: .featured)

                    snapshot.appendItems([
                        Item(title: "Item 1", subtitle: "Regular", imageName: "folder"),
                        Item(title: "Item 2", subtitle: "Regular", imageName: "doc"),
                        Item(title: "Item 3", subtitle: "Regular", imageName: "photo"),
                        Item(title: "Item 4", subtitle: "Regular", imageName: "video"),
                    ], toSection: .regular)

                    snapshot.appendItems((1...10).map {
                        Item(title: "Compact \\($0)", subtitle: "Row", imageName: "circle")
                    }, toSection: .compact)

                    dataSource.apply(snapshot, animatingDifferences: false)
                }
                ```

                ## 6. Self-Sizing Cells

                For dynamic content heights, use `UIHostingConfiguration` (iOS 16+):

                ```swift
                let cellRegistration = UICollectionView.CellRegistration<UICollectionViewCell, Item> {
                    cell, indexPath, item in
                    cell.contentConfiguration = UIHostingConfiguration {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(item.title)
                                .font(.headline)
                            Text(item.subtitle)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                        .padding()
                    }
                }
                ```

                ## 7. Performance Tips

                1. **Prefetching**: Implement `UICollectionViewDataSourcePrefetching`
                2. **Cell reuse**: Use `CellRegistration` instead of manual registration
                3. **Estimated sizes**: Always provide reasonable estimates
                4. **Avoid nesting**: Don't nest scroll views inside cells
                5. **Background preparation**: Use `UICollectionView.CellRegistration` with async image loading

                > **Pro tip**: For chat-style layouts where items are added at the bottom, maintain the content offset manually when inserting items to prevent scroll jumps.

                ---

                That covers the complete guide! The compositional layout API is extremely powerful and handles most layout patterns without custom layout subclasses.
                """),
            ], usage: nil),
        ]
    }

    // MARK: - Scenario: Tool Heavy (all tool types + failures)

    private static func toolHeavyScenario() -> [ParsedMessage] {
        [
            msg(.user, "Refactor the authentication module — it needs a complete rewrite"),

            // Turn 1: Exploration with multiple tool calls
            ParsedMessage(role: .assistant, blocks: [
                tb("I'll start by understanding the current auth module:"),
                ParsedBlock(kind: .shellTool(command: "find src/ios/Auth -name '*.swift' | sort"), content: "find src/ios/Auth", toolStatus: .success),
                ParsedBlock(kind: .fileReadTool(path: "src/ios/Auth/AuthManager.swift"), content: "{}", toolStatus: .success),
                ParsedBlock(kind: .fileReadTool(path: "src/ios/Auth/TokenStore.swift"), content: "{}", toolStatus: .success),
                ParsedBlock(kind: .fileReadTool(path: "src/ios/Auth/OAuthFlow.swift"), content: "{}", toolStatus: .success),
                tb("Let me check for any browser-based auth flows:"),
                ParsedBlock(kind: .browserTool(action: "navigate"), content: "https://auth.example.com/.well-known/openid-configuration", toolStatus: .success),
                tb("And check the API docs:"),
                ParsedBlock(kind: .readImageTool(path: "docs/auth-flow-diagram.png"), content: "{}", toolStatus: .success),
                tb("Now I have a clear picture. The current auth module has several issues..."),
            ], usage: nil),

            msg(.user, "Go ahead with the rewrite"),

            // Turn 2: Heavy editing with some failures
            ParsedMessage(role: .assistant, blocks: [
                tb("Starting the rewrite. First, I'll create the new token storage:"),
                ParsedBlock(kind: .fileWriteTool(path: "src/ios/Auth/SecureTokenStore.swift"), content: "{}", toolStatus: .success),
                tb("Now the OAuth coordinator:"),
                ParsedBlock(kind: .fileWriteTool(path: "src/ios/Auth/OAuthCoordinator.swift"), content: "{}", toolStatus: .success),
                tb("Updating the auth manager:"),
                ParsedBlock(kind: .fileEditTool(path: "src/ios/Auth/AuthManager.swift"), content: "{}", toolStatus: .success),
                tb("Let me verify the keychain access:"),
                ParsedBlock(kind: .shellTool(command: "security find-generic-password -s 'com.openminis.auth'"), content: "security find-generic-password", toolStatus: .failed(message: "The specified item could not be found in the keychain.")),
                tb("Expected — no keychain entry exists yet. Let me set up the test environment:"),
                ParsedBlock(kind: .shellTool(command: "xcodebuild test -scheme Minis -only-testing:AuthTests"), content: "xcodebuild test", toolStatus: .failed(message: "xcodebuild: error: Testing failed.")),
                tb("Two test failures. Let me fix them:"),
                ParsedBlock(kind: .fileEditTool(path: "Tests/AuthTests/TokenStoreTests.swift"), content: "{}", toolStatus: .success),
                ParsedBlock(kind: .fileEditTool(path: "Tests/AuthTests/OAuthFlowTests.swift"), content: "{}", toolStatus: .success),
                tb("Saving a note about this refactor:"),
                ParsedBlock(kind: .memoryTool(action: "save"), content: "Auth module refactored to use SecureTokenStore with Keychain", toolStatus: .success),
                tb("Running tests again:"),
                ParsedBlock(kind: .shellTool(command: "xcodebuild test -scheme Minis -only-testing:AuthTests"), content: "xcodebuild test", toolStatus: .success),
                tb("""
                All auth tests pass now. Summary of changes:

                | File | Action | Lines |
                |------|--------|-------|
                | `SecureTokenStore.swift` | Created | +142 |
                | `OAuthCoordinator.swift` | Created | +98 |
                | `AuthManager.swift` | Modified | +45 / -67 |
                | `TokenStoreTests.swift` | Fixed | +12 / -8 |
                | `OAuthFlowTests.swift` | Fixed | +6 / -4 |
                """),
            ], usage: nil),

            msg(.user, "What about the old files? Can we clean them up?"),

            // Turn 3: More tools + info block
            ParsedMessage(role: .assistant, blocks: [
                ParsedBlock(kind: .info, content: "Analyzing deprecated files in src/ios/Auth/", toolStatus: nil),
                ParsedBlock(kind: .shellTool(command: "git log --oneline -5 src/ios/Auth/"), content: "git log", toolStatus: .success),
                ParsedBlock(kind: .fileReadTool(path: "src/ios/Auth/LegacyTokenStore.swift"), content: "{}", toolStatus: .success),
                tb("The legacy files can be safely removed:"),
                ParsedBlock(kind: .shellTool(command: "rm src/ios/Auth/LegacyTokenStore.swift src/ios/Auth/OldOAuthFlow.swift"), content: "rm ...", toolStatus: .success),
                ParsedBlock(kind: .shellTool(command: "git add -A && git status"), content: "git status", toolStatus: .success),
                tb("Cleanup complete. The auth module is now fully migrated to the new architecture."),
            ], usage: nil),
        ]
    }

    // MARK: - Scenario: Streaming (many small text blocks)

    private static func streamingScenario() -> [ParsedMessage] {
        var messages: [ParsedMessage] = []

        // 5 rounds of conversation with progressively longer responses
        for round in 1...5 {
            messages.append(msg(.user, "Continue with step \(round) of the implementation"))

            // Each assistant response has multiple text blocks interspersed with tool calls
            var blocks: [ParsedBlock] = []
            let paragraphs = round + 2 // 3 to 7 text blocks per response

            for p in 1...paragraphs {
                blocks.append(tb("""
                ### Step \(round).\(p)

                This is paragraph \(p) of step \(round). The implementation requires careful consideration of thread safety and memory management. We use `@MainActor` isolation to ensure all UI updates happen on the main thread, and `Sendable` conformance to safely pass data across concurrency boundaries.

                Key considerations:
                - **Memory**: Use weak references for delegates and closures that capture self
                - **Threading**: All published properties must be updated on MainActor
                - **Error handling**: Wrap async operations in do-catch with specific error types
                """))

                // Insert a tool call between some text blocks
                if p % 2 == 0 && p < paragraphs {
                    blocks.append(ParsedBlock(
                        kind: .shellTool(command: "swift build 2>&1 | tail -5"),
                        content: "swift build",
                        toolStatus: .success
                    ))
                }
            }

            messages.append(ParsedMessage(role: .assistant, blocks: blocks, usage: nil))
        }

        return messages
    }

    // MARK: - Scenario: Travel Planning (rich tables, CJK, emoji)

    private static func travelPlanningScenario() -> [ParsedMessage] {
        // Load from bundled JSON file (Copy Session Data format)
        guard let url = Bundle.main.url(forResource: "travel-planning-session", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let entries = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            // Fallback if file not bundled
            return [msg(.user, "Travel planning test data not found")]
        }

        return entries.compactMap { entry -> ParsedMessage? in
            guard let roleStr = entry["role"] as? String,
                  let parts = entry["parts"] as? [[String: Any]] else { return nil }

            let role: ChatMessageRole
            switch roleStr {
            case "user": role = .user
            case "assistant": role = .assistant
            default: return nil
            }

            var blocks: [ParsedBlock] = []
            for part in parts {
                guard let type = part["type"] as? String else { continue }
                if type == "text", let text = part["text"] as? String, !text.isEmpty {
                    blocks.append(ParsedBlock(kind: .text, content: text, toolStatus: nil))
                }
            }

            // Parse usage
            var usage: TokenUsage?
            if let usageDict = entry["usage"] as? [String: Any] {
                var u = TokenUsage()
                u.inputTokens = usageDict["input_tokens"] as? Int ?? 0
                u.outputTokens = usageDict["output_tokens"] as? Int ?? 0
                u.cacheCreationTokens = usageDict["cache_creation_tokens"] as? Int ?? 0
                u.cacheReadTokens = usageDict["cache_read_tokens"] as? Int ?? 0
                usage = u
            }

            if blocks.isEmpty {
                let content = parts.compactMap { ($0["type"] as? String == "text") ? $0["text"] as? String : nil }.joined(separator: "\n")
                blocks = [ParsedBlock(kind: .text, content: content, toolStatus: nil)]
            }

            return ParsedMessage(role: role, blocks: blocks, usage: usage)
        }
    }

    // MARK: - Convenience Builders

    private static func msg(_ role: ChatMessageRole, _ text: String) -> ParsedMessage {
        ParsedMessage(role: role, blocks: [tb(text)], usage: nil)
    }

    private static func tb(_ text: String) -> ParsedBlock {
        ParsedBlock(kind: .text, content: text, toolStatus: nil)
    }

    // MARK: - Playback Controls

    /// Load all messages instantly (no streaming simulation)
    func loadAllInstantly() {
        vm.messages.removeAll()
        for parsed in parsedMessages {
            let msg = buildChatMessage(from: parsed, fullyLoaded: true)
            vm.messages.append(msg)
        }
        vm.forceScrollToBottom.send()
        state = .finished
        progress = "Loaded \(parsedMessages.count) messages instantly"
    }

    /// Start streaming simulation
    func play() {
        guard state != .playing else { return }
        if state == .idle || state == .finished {
            vm.messages.removeAll()
            currentMessageIndex = 0
            currentBlockIndex = 0
            currentCharIndex = 0
        }
        state = .playing
        vm.isProcessing = true
        startTimer()
    }

    /// Pause streaming
    func pause() {
        guard state == .playing else { return }
        state = .paused
        timer?.invalidate()
        timer = nil
    }

    /// Reset to beginning
    func reset() {
        timer?.invalidate()
        timer = nil
        vm.messages.removeAll()
        vm.isProcessing = false
        currentMessageIndex = 0
        currentBlockIndex = 0
        currentCharIndex = 0
        state = .idle
        progress = "Reset — \(parsedMessages.count) messages ready"
    }

    // MARK: - Timer-based Streaming

    private func startTimer() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: tickInterval, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.tick()
            }
        }
    }

    private func tick() {
        guard state == .playing else { return }
        guard currentMessageIndex < parsedMessages.count else {
            finishPlayback()
            return
        }

        let parsed = parsedMessages[currentMessageIndex]

        // User messages appear instantly
        if parsed.role == .user {
            let msg = buildChatMessage(from: parsed, fullyLoaded: true)
            vm.messages.append(msg)
            vm.scrollToBottomSignal.send()
            currentMessageIndex += 1
            currentBlockIndex = 0
            currentCharIndex = 0
            progress = "Message \(currentMessageIndex)/\(parsedMessages.count)"
            return
        }

        // Assistant messages stream block-by-block, text char-by-char
        let blocks = parsed.blocks
        guard currentBlockIndex < blocks.count else {
            // Finished this assistant message
            if let lastMsg = vm.messages.last, lastMsg.role == .assistant {
                lastMsg.usage = parsed.usage
            }
            currentMessageIndex += 1
            currentBlockIndex = 0
            currentCharIndex = 0
            progress = "Message \(currentMessageIndex)/\(parsedMessages.count)"

            // If next message is also an assistant, we need a new ChatMessage
            if currentMessageIndex < parsedMessages.count {
                return
            }
            finishPlayback()
            return
        }

        // Ensure assistant ChatMessage exists
        if currentBlockIndex == 0 && currentCharIndex == 0 {
            let msg = ChatMessage(role: .assistant, content: "")
            vm.messages.append(msg)
        }

        guard let currentMsg = vm.messages.last, currentMsg.role == .assistant else { return }

        let parsedBlock = blocks[currentBlockIndex]

        // Tool blocks appear instantly
        if case .text = parsedBlock.kind {
            // Text block: stream character by character
            if currentCharIndex == 0 {
                // Create the block
                let block = AssistantBlock(kind: .text, content: "")
                currentMsg.blocks.append(block)
            }

            // Add characters
            let fullContent = parsedBlock.content
            let endIndex = min(currentCharIndex + charsPerTick, fullContent.count)
            let content = String(fullContent.prefix(endIndex))

            if let lastBlock = currentMsg.blocks.last, case .text = lastBlock.kind {
                lastBlock.content = content
            }
            vm.scrollToBottomSignal.send()

            currentCharIndex = endIndex
            if currentCharIndex >= fullContent.count {
                // Block finished
                currentBlockIndex += 1
                currentCharIndex = 0
            }
        } else {
            // Tool block: appear instantly
            let block = AssistantBlock(kind: parsedBlock.kind, content: parsedBlock.content, toolStatus: parsedBlock.toolStatus)
            currentMsg.blocks.append(block)
            vm.scrollToBottomSignal.send()
            currentBlockIndex += 1
            currentCharIndex = 0
        }

        progress = "Msg \(currentMessageIndex + 1)/\(parsedMessages.count) Block \(currentBlockIndex)/\(blocks.count)"
    }

    private func finishPlayback() {
        timer?.invalidate()
        timer = nil
        vm.isProcessing = false
        state = .finished
        progress = "Finished — \(parsedMessages.count) messages"
    }

    // MARK: - Helpers

    private func buildChatMessage(from parsed: ParsedMessage, fullyLoaded: Bool) -> ChatMessage {
        if parsed.role == .user {
            let textContent = parsed.blocks.first?.content ?? ""
            return ChatMessage(role: .user, content: textContent)
        }

        let msg = ChatMessage(role: .assistant, content: "")
        for pb in parsed.blocks {
            let block = AssistantBlock(kind: pb.kind, content: pb.content, toolStatus: pb.toolStatus)
            msg.blocks.append(block)
        }
        msg.usage = parsed.usage
        return msg
    }
}
#endif
