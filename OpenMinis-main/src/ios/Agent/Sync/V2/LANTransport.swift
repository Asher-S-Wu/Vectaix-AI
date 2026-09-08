import Foundation

/// LAN transport — Bonjour-discovered peers + WebSocket push. v2 first
/// release ships only this skeleton: protocol conformance compiles and
/// the type can be referenced, but no method actually does work. SyncCore
/// must NOT register this transport into its broadcast list until a real
/// implementation lands.
///
/// Future implementation outline (left here so the next person picks up
/// the right shape):
///
///   1. start() — advertise `_minis-sync._tcp` via NWListener; concurrently
///      run an NWBrowser to discover peers, store WebSocket connections
///      in `peers`.
///   2. send() — encode the batch as JSON (PortableRecord is Codable),
///      broadcast to each peer connection. Asset fields multiplex over
///      the same connection using a length-prefixed binary frame.
///   3. observe() — store the handler; each inbound JSON frame deserializes
///      into a SyncInboundBatch and is dispatched to the handler.
///   4. fullFetch() — peers don't store history; LAN cannot satisfy
///      fullFetch in general. Return an empty batch and document that
///      callers must rely on iCloud for history.
///   5. fetchChanges() — best-effort: ask each peer for "anything since
///      lastSeen". Transports without persistence may return empty.
///   6. delete() — broadcast deletion records (PortableRecord with a
///      tombstone marker field) to all peers.
final class LANTransport: SyncTransport {
    let name = "LAN"

    /// Capability vector reflects what a fully-implemented LANTransport
    /// would offer. Notably absent: `.persistence` (no central store) and
    /// `.deltaFetch` (peer state is opaque).
    let capabilities: TransportCapabilities = [.pushObserve, .conflictDetect]

    /// Set to true once a real implementation lands. SyncCore checks this
    /// before adding the transport to its broadcast list.
    static let isImplemented: Bool = false

    func start() async throws {
        preconditionFailure("LANTransport not yet implemented (P2 skeleton — fill in P-LAN)")
    }

    func stop() async {
        // no-op
    }

    func send(_ batch: SyncOutboundBatch, trigger: SyncSendTrigger) async throws -> [SyncOutcome] {
        preconditionFailure("LANTransport not yet implemented")
    }

    func observe(handler: @escaping (SyncInboundBatch) -> Void) {
        // Real implementation stores `handler` and calls it on inbound frames.
        // Skeleton: drop the handler on the floor, since no frames will arrive.
        _ = handler
    }

    func fullFetch(trigger: SyncFetchTrigger) async throws -> SyncInboundBatch {
        preconditionFailure("LANTransport not yet implemented")
    }

    func fetchChanges(trigger: SyncFetchTrigger) async throws -> SyncInboundBatch {
        preconditionFailure("LANTransport not yet implemented")
    }

    func delete(_ ids: [SyncRecordID]) async throws -> [SyncOutcome] {
        preconditionFailure("LANTransport not yet implemented")
    }
}
