import SwiftUI
import WebKit

struct BrowserManagementView: View {
    @ObservedObject var pool: BrowserTabPool
    @Environment(\.dismiss) private var dismiss

    @State private var cookieCount: Int = 0
    @State private var cookies: [HTTPCookie] = []
    @State private var showClearConfirm = false
    @State private var searchText: String = ""
    @State private var customUA: String = ""

    /// Draft viewport inputs. Kept as strings so the user can type freely;
    /// pushed into the pool on commit.
    @State private var viewportWidthText: String = ""
    @State private var viewportHeightText: String = ""
    /// Controls whether the width/height editor row is visible below the
    /// Custom selector. Initialized from the pool on appear.
    @State private var showCustomViewportEditor: Bool = false

    /// Unique domains derived from current cookies.
    private var domains: [DomainGroup] {
        let filtered = searchText.isEmpty
            ? cookies
            : cookies.filter { $0.domain.localizedCaseInsensitiveContains(searchText) }
        let grouped = Dictionary(grouping: filtered) { $0.domain }
        return grouped.map { DomainGroup(domain: $0.key, cookies: $0.value) }
            .sorted { $0.domain < $1.domain }
    }

    var body: some View {
        List {
            userAgentSection
            viewportSection
            cookiesSection
            domainListSection
        }
        .searchable(text: $searchText, prompt: "Filter by domain")
        .navigationTitle("Browser Settings")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Done") { dismiss() }
            }
        }
        .confirmationDialog("Clear All Cookies?", isPresented: $showClearConfirm, titleVisibility: .visible) {
            Button("Clear All", role: .destructive) {
                clearAllCookies()
            }
        } message: {
            Text("This will remove all cookies and website data from the Minis browser.")
        }
        .task {
            await loadCookies()
        }
    }

    // MARK: - User Agent Section

    private var userAgentSection: some View {
        Section {
            userAgentRow(.mobileSafari)
            userAgentRow(.desktopSafari)
            customUserAgentRow
        } header: {
            Text("User Agent")
        } footer: {
            let vp = pool.userAgentProfile.viewportSize
            Text("Viewport: \(vp.width)×\(vp.height)")
        }
    }

    private func displayUA(for profile: UserAgentProfile) -> String {
        switch profile {
        case .custom:
            return pool.customUserAgentString.isEmpty ? "Not set" : pool.customUserAgentString
        default:
            return profile.userAgentString ?? ""
        }
    }

    private func userAgentRow(_ profile: UserAgentProfile) -> some View {
        Button {
            pool.setUserAgentProfile(profile)
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Label(profile.displayName, systemImage: profile.icon)
                        .foregroundStyle(Color(UIColor.label))
                    Text(displayUA(for: profile))
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                Spacer()
                if pool.userAgentProfile == profile {
                    Image(systemName: "checkmark")
                        .foregroundStyle(Color.accentColor)
                }
            }
        }
        .contextMenu {
            Button {
                UIPasteboard.general.string = displayUA(for: profile)
            } label: {
                Label("Copy User Agent", systemImage: "doc.on.doc")
            }
        }
    }

    private var customUserAgentRow: some View {
        let isSelected = pool.userAgentProfile == .custom
        return VStack(alignment: .leading, spacing: 6) {
            Button {
                if !customUA.isEmpty {
                    pool.customUserAgentString = customUA
                    pool.setUserAgentProfile(.custom)
                }
            } label: {
                HStack {
                    Label("Custom", systemImage: "pencil.line")
                        .foregroundStyle(Color(UIColor.label))
                    Spacer()
                    if isSelected {
                        Image(systemName: "checkmark")
                            .foregroundStyle(Color.accentColor)
                    }
                }
            }
            TextField("Enter custom user agent...", text: $customUA, axis: .vertical)
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.secondary)
                .lineLimit(2...4)
                .onSubmit {
                    pool.customUserAgentString = customUA
                    pool.setUserAgentProfile(.custom)
                }
        }
        .onAppear {
            customUA = pool.customUserAgentString
        }
        .contextMenu {
            if !customUA.isEmpty {
                Button {
                    UIPasteboard.general.string = customUA
                } label: {
                    Label("Copy User Agent", systemImage: "doc.on.doc")
                }
            }
        }
    }

    // MARK: - Viewport Section

    private var viewportSection: some View {
        Section {
            defaultViewportRow
            customViewportRow
            if showCustomViewportEditor {
                customViewportEditor
            }
        } header: {
            Text("Web Viewport")
        } footer: {
            let vp = pool.resolvedViewportSize()
            if pool.customViewportWidth > 0 && pool.customViewportHeight > 0 {
                Text("Using custom viewport \(vp.width)×\(vp.height). Tap Default to revert to the UA default.")
            } else {
                Text("Using UA default \(vp.width)×\(vp.height). Set a custom size to override.")
            }
        }
        .onAppear {
            if pool.customViewportWidth > 0 {
                viewportWidthText = String(pool.customViewportWidth)
            }
            if pool.customViewportHeight > 0 {
                viewportHeightText = String(pool.customViewportHeight)
            }
            showCustomViewportEditor = isCustomViewportActive
        }
    }

    private var isCustomViewportActive: Bool {
        pool.customViewportWidth > 0 && pool.customViewportHeight > 0
    }

    private var defaultViewportRow: some View {
        Button {
            pool.setGlobalViewport(width: 0, height: 0)
            viewportWidthText = ""
            viewportHeightText = ""
            withAnimation { showCustomViewportEditor = false }
        } label: {
            HStack {
                Label("Default (auto by UA)", systemImage: "arrow.counterclockwise")
                    .foregroundStyle(Color(UIColor.label))
                Spacer()
                if !isCustomViewportActive {
                    Image(systemName: "checkmark")
                        .foregroundStyle(Color.accentColor)
                }
            }
        }
    }

    private var customViewportRow: some View {
        Button {
            withAnimation { showCustomViewportEditor = true }
            commitCustomViewport()
        } label: {
            HStack {
                Label("Custom", systemImage: "aspectratio")
                    .foregroundStyle(Color(UIColor.label))
                Spacer()
                if isCustomViewportActive {
                    Image(systemName: "checkmark")
                        .foregroundStyle(Color.accentColor)
                }
            }
        }
    }

    /// Common viewport presets shown under the editor. Mix of mobile and
    /// desktop sizes that roughly match what agents and users pick in
    /// practice.
    private static let viewportPresets: [(label: String, width: Int, height: Int)] = [
        ("iPhone",      390,  844),
        ("iPhone Pro",  430,  932),
        ("iPad",        820, 1180),
        ("Laptop",     1280,  800),
        ("Desktop",    1440,  900),
        ("Full HD",    1920, 1080),
    ]

    /// Expanded editor row shown only while the user is configuring a custom
    /// viewport. Visually distinct from the selector row above so the sizes
    /// read as a single value rather than a separate choice.
    private var customViewportEditor: some View {
        VStack(alignment: .center, spacing: 10) {
            HStack(spacing: 10) {
                Spacer()
                TextField("Width", text: $viewportWidthText)
                    .keyboardType(.numberPad)
                    .font(.system(size: 13, design: .monospaced))
                    .multilineTextAlignment(.center)
                    .frame(width: 72)
                    .onSubmit { commitCustomViewport() }
                Text("×").foregroundStyle(.secondary)
                TextField("Height", text: $viewportHeightText)
                    .keyboardType(.numberPad)
                    .font(.system(size: 13, design: .monospaced))
                    .multilineTextAlignment(.center)
                    .frame(width: 72)
                    .onSubmit { commitCustomViewport() }
                Spacer()
            }
            if let warning = viewportUAMismatchWarning {
                uaMismatchBanner(warning)
            }
            quickSetPresets
        }
    }

    /// Returns a warning message when the active viewport width crosses the
    /// mobile/desktop breakpoint for the current UA profile — sites using
    /// UA-sniffing (not just CSS media queries) will hand back layouts the
    /// other form factor can't render cleanly.
    private var viewportUAMismatchWarning: String? {
        // Prefer the staged text so the banner updates as the user types;
        // fall back to the committed pool value when fields are empty.
        let width: Int
        if let w = Int(viewportWidthText.trimmingCharacters(in: .whitespaces)), w > 0 {
            width = w
        } else if pool.customViewportWidth > 0 {
            width = pool.customViewportWidth
        } else {
            return nil
        }
        let breakpoint = 768
        switch pool.userAgentProfile {
        case .mobileSafari, .custom:
            if width >= breakpoint {
                return "Viewport ≥\(breakpoint)px while UA is Mobile — sites may serve a desktop layout that renders awkwardly. Consider switching UA to Desktop."
            }
        case .desktopSafari:
            if width < breakpoint {
                return "Viewport <\(breakpoint)px while UA is Desktop — sites may serve a mobile layout that renders awkwardly. Consider switching UA to Mobile."
            }
        }
        return nil
    }

    private func uaMismatchBanner(_ message: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.yellow)
            Text(message)
                .font(.caption)
                .foregroundStyle(Color(UIColor.label))
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(.vertical, 6)
    }

    private var quickSetPresets: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Quick Set")
                .font(.caption)
                .foregroundStyle(.secondary)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Self.viewportPresets, id: \.label) { preset in
                        Button {
                            viewportWidthText = String(preset.width)
                            viewportHeightText = String(preset.height)
                            pool.setGlobalViewport(width: preset.width, height: preset.height)
                        } label: {
                            VStack(spacing: 2) {
                                Text(preset.label)
                                    .font(.system(size: 12, weight: .medium))
                                Text("\(preset.width)×\(preset.height)")
                                    .font(.system(size: 10, design: .monospaced))
                                    .foregroundStyle(.secondary)
                            }
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(
                                isPresetActive(preset)
                                    ? Color.accentColor.opacity(0.18)
                                    : Color(UIColor.tertiarySystemFill)
                            )
                            .foregroundStyle(
                                isPresetActive(preset)
                                    ? Color.accentColor
                                    : Color(UIColor.label)
                            )
                            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private func isPresetActive(_ preset: (label: String, width: Int, height: Int)) -> Bool {
        pool.customViewportWidth == preset.width && pool.customViewportHeight == preset.height
    }

    private func commitCustomViewport() {
        guard let w = Int(viewportWidthText.trimmingCharacters(in: .whitespaces)),
              let h = Int(viewportHeightText.trimmingCharacters(in: .whitespaces)),
              w > 0, h > 0 else {
            return
        }
        pool.setGlobalViewport(width: w, height: h)
    }

    // MARK: - Cookies Section

    private var cookiesSection: some View {
        Section {
            HStack {
                Text("Cookies")
                Spacer()
                Text("\(cookieCount)")
                    .foregroundStyle(.secondary)
            }

            Button(role: .destructive) {
                showClearConfirm = true
            } label: {
                Label("Clear All Cookies", systemImage: "trash")
            }
            .disabled(cookieCount == 0)
        } header: {
            Text("Cookies & Data")
        } footer: {
            Text("Clearing cookies will sign you out of all websites in the Minis browser.")
        }
    }

    // MARK: - Domain List Section

    @ViewBuilder
    private var domainListSection: some View {
        if !domains.isEmpty {
            Section {
                ForEach(domains) { group in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(group.domain)
                                .font(.system(size: 14, weight: .medium))
                            Text("\(group.cookies.count) cookie\(group.cookies.count == 1 ? "" : "s")")
                                .font(.system(size: 12))
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                    }
                    .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                        Button(role: .destructive) {
                            clearCookies(for: group.domain)
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                }
            } header: {
                if searchText.isEmpty {
                    Text("Domains")
                } else {
                    Text("Results")
                }
            }
        }
    }

    // MARK: - Data

    /// All browser WKWebViews share `.default()` data store, so query it directly
    /// instead of going through activeManager (which may be nil).
    private var cookieStore: WKHTTPCookieStore {
        WKWebsiteDataStore.default().httpCookieStore
    }

    private func loadCookies() async {
        let all = await cookieStore.allCookies()
        cookies = all.sorted { $0.domain < $1.domain }
        cookieCount = all.count
    }

    private func clearAllCookies() {
        let dataStore = WKWebsiteDataStore.default()
        let dataTypes = WKWebsiteDataStore.allWebsiteDataTypes()
        dataStore.removeData(ofTypes: dataTypes, modifiedSince: .distantPast) {
            cookies = []
            cookieCount = 0
            // Also wipe the anti-ITP backup so nothing is restored on next sync.
            Task { await CookieBackupStore.shared.forgetAll() }
        }
    }

    private func clearCookies(for domain: String) {
        let store = cookieStore
        let toDelete = cookies.filter { $0.domain == domain }
        Task {
            for cookie in toDelete {
                await store.deleteCookie(cookie)
            }
            // Update local state directly instead of re-fetching from store,
            // which may return stale data before deletions are fully persisted.
            cookies.removeAll { $0.domain == domain }
            cookieCount = cookies.count
            // Reconcile the backup so the deleted cookies aren't resurrected
            // on the next sync (keeps any sibling-subdomain cookies still live).
            await CookieBackupStore.shared.reconcileDomainAfterUserEdit(domain)
        }
    }
}

// MARK: - Domain Group

private struct DomainGroup: Identifiable {
    let domain: String
    let cookies: [HTTPCookie]
    var id: String { domain }
}
