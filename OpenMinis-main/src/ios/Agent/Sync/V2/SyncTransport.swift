import Foundation

/// Capabilities a transport advertises so SyncCore can route operations
/// appropriately. New caps can be added without changing existing
/// implementations.
struct TransportCapabilities: OptionSet {
    let rawValue: Int
    init(rawValue: Int) { self.rawValue = rawValue }

    /// Transport can call its observe(handler:) callback when remote
    /// changes arrive *without* the app polling. CloudKit silent push
    /// would qualify (we don't subscribe yet — see §10.3 of the design).
    /// LAN transports inherently push observe.
    static let pushObserve   = TransportCapabilities(rawValue: 1 << 0)
    /// Supports incremental fetch via change tokens (CloudKit yes,
    /// stateless LAN no).
    static let deltaFetch    = TransportCapabilities(rawValue: 1 << 1)
    /// Supports first-class file/asset payloads (CKAsset for CloudKit;
    /// LAN would need to multiplex file streams).
    static let assets        = TransportCapabilities(rawValue: 1 << 2)
    /// Records survive even when no client is online (durable storage).
    /// CloudKit yes, LAN no.
    static let persistence   = TransportCapabilities(rawValue: 1 << 3)
    /// Detects and surfaces conflicts (etag-style); SyncCore will route
    /// failed writes through the conflict path. LAN may opt out.
    static let conflictDetect = TransportCapabilities(rawValue: 1 << 4)
}

/// Why was this fetch invoked? Useful in logs and for transports that
/// behave differently for periodic vs. on-demand requests.
enum SyncFetchTrigger: String {
    case startup
    case foregroundTimer
    case manual
    case retry
    case migration
}

/// Why was this send invoked?
enum SyncSendTrigger: String {
    case scheduledDebounce
    case manual
    case migration
    case retry
    case foregroundTimer
}

/// A SyncTransport is the boundary between SyncCore (which knows about
/// records, dirty rows, and merging) and the actual networking surface
/// (CloudKit / LAN / future). Multiple transports can be installed and
/// SyncCore will broadcast to all of them.
///
/// Implementations are free to be actor-isolated or class-based; SyncCore
/// only ever calls the methods declared here.
protocol SyncTransport: AnyObject {
    /// Stable identifier ("iCloud", "LAN") — used in logs and to filter
    /// per-record `transports` allowlists declared in SyncTypeMetadata.
    var name: String { get }

    var capabilities: TransportCapabilities { get }

    /// Server-issued throttle gate. When non-nil and in the future, SyncCore
    /// must defer sends until this time (CloudKit's HTTP 429 retry-after).
    /// Default protocol implementation returns nil for transports that
    /// don't surface a throttle signal.
    var retryAfter: Date? { get }

    /// Boot the transport. Idempotent: calling start twice is a no-op
    /// after the first successful start.
    func start() async throws

    /// Tear the transport down. Cancels in-flight operations.
    func stop() async

    /// Push a batch. Returns one outcome per record (in arbitrary order).
    func send(_ batch: SyncOutboundBatch, trigger: SyncSendTrigger) async throws -> [SyncOutcome]

    /// Subscribe to remote changes. The handler may be invoked any time
    /// after `start` and before `stop`. Implementations should call it
    /// with non-empty batches only.
    func observe(handler: @escaping (SyncInboundBatch) -> Void)

    /// Full-fetch every record the transport currently has. Used by
    /// fresh installs and forceFullSync. May be expensive.
    func fullFetch(trigger: SyncFetchTrigger) async throws -> SyncInboundBatch

    /// Best-effort incremental fetch using whatever change-tracking the
    /// transport provides (CloudKit changeTokens, etc.). Transports
    /// without `.deltaFetch` should fall back to fullFetch.
    func fetchChanges(trigger: SyncFetchTrigger) async throws -> SyncInboundBatch

    /// Hard delete a set of records by id. Returns one outcome per id.
    func delete(_ ids: [SyncRecordID]) async throws -> [SyncOutcome]
}

extension SyncTransport {
    /// Default: no throttle signal. CloudKit transport overrides.
    var retryAfter: Date? { nil }
}
