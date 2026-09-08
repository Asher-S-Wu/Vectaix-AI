import Foundation

/// Type-erased view of a SyncTypeMetadata<T>. Stored in the registry so
/// SyncCore + transports can look up the schema for a record type at
/// runtime without knowing the concrete generic T.
///
/// Concrete behaviors (extract / apply / conflict resolution) are exposed
/// here as closures over `Any`. Callers downcast the inputs back to the
/// concrete type when they own one (the registry doesn't try to be clever
/// about that — the simplest correct surface).
struct AnySyncableTypeMetadata {
    let recordType: String
    let scope: AnySyncScope
    let version: Int
    let minimumCompatibleVersion: Int?

    /// Cloud keys this type knows about. Anything else that arrives on
    /// the wire is a "future" field and goes into PortableRecord.unknownFields.
    let knownCloudKeys: Set<String>

    /// True when this type's metadata declared a custom `cleanupOnDelete`.
    /// Diagnostic only; transports don't need it.
    let hasCleanupHook: Bool

    /// Field descriptors as opaque tuples — the transport uses
    /// `extractFields(from:)` rather than peeking inside.
    let fieldKinds: [(cloudKey: String, kind: FieldKind, isOptional: Bool)]

    /// Build a PortableRecord from a Syncable model instance.
    /// Returns nil if `model` isn't of the expected concrete type.
    let buildPortable: (_ model: Any) -> PortableRecord?

    /// Apply a remote PortableRecord onto a fresh model instance produced
    /// by `makeBlank` and return it. Returns nil if `makeBlank` is nil
    /// (some types are read-only on the local side; merging happens
    /// against the existing local DB row instead — see SyncCore).
    let applyPortableToBlank: ((PortableRecord) -> Any?)?

    /// Apply a remote PortableRecord onto an existing local model copy.
    /// Returns the updated copy or nil if the input wasn't the expected type.
    let applyPortableToExisting: (_ existing: Any, _ remote: PortableRecord) -> Any?

    /// Resolve a conflict between two model instances. Returns the merged
    /// model (could be either input or a brand-new value depending on
    /// policy). Returns nil if the inputs aren't the expected type.
    let resolveConflict: (_ local: Any, _ remote: Any) -> Any?

    /// Untyped scope description so transports can switch on scope without
    /// re-introducing the generic.
    enum AnySyncScope {
        case global
        case perObject
        case perParent(parentType: String)
    }
}

/// Singleton registry of every Syncable type the app supports. Populate
/// on startup before SyncCore begins processing dirty records.
///
/// Thread-safety: writes (`register`) happen at app launch under a serial
/// init path; reads happen from any actor. We use a plain dictionary +
/// an internal lock — the write-once pattern means contention is
/// effectively zero after startup.
final class SyncableTypeRegistry: @unchecked Sendable {
    static let shared = SyncableTypeRegistry()
    private init() {}

    private let lock = NSLock()
    private var byRecordType: [String: AnySyncableTypeMetadata] = [:]

    /// Register a Syncable type. Idempotent — registering the same type
    /// twice with the same metadata is a no-op; registering twice with
    /// different metadata is a programmer error and triggers an assertion
    /// failure in debug builds.
    func register<T: Syncable>(_ type: T.Type) {
        let m = T.syncMetadata
        let erased = Self.erase(m)
        lock.lock(); defer { lock.unlock() }
        if let existing = byRecordType[m.recordType] {
            assert(existing.version == erased.version, "[SyncableTypeRegistry] type \(m.recordType) re-registered with different version (\(existing.version) vs \(erased.version))")
            return
        }
        byRecordType[m.recordType] = erased
    }

    /// Look up a registered type by its wire `recordType` name.
    /// Returns nil for unknown types (caller should ignore the record;
    /// see §3.6.3 of the design).
    func metadata(for recordType: String) -> AnySyncableTypeMetadata? {
        lock.lock(); defer { lock.unlock() }
        return byRecordType[recordType]
    }

    /// All registered record types. Used at startup by transports to know
    /// which CloudKit zones / record types to listen for.
    var allRecordTypes: [String] {
        lock.lock(); defer { lock.unlock() }
        return Array(byRecordType.keys).sorted()
    }

    var count: Int {
        lock.lock(); defer { lock.unlock() }
        return byRecordType.count
    }

    // MARK: - Erasure

    private static func erase<T: Syncable>(_ m: SyncTypeMetadata<T>) -> AnySyncableTypeMetadata {
        let scope: AnySyncableTypeMetadata.AnySyncScope = {
            switch m.scope {
            case .global: return .global
            case .perObject: return .perObject
            case .perParent(let pType, _): return .perParent(parentType: pType)
            }
        }()

        let knownKeys = Set(m.fields.map(\.cloudKey))
        let kinds = m.fields.map { ($0.cloudKey, $0.kind, $0.isOptional) }

        let buildPortable: (Any) -> PortableRecord? = { anyModel in
            guard let model = anyModel as? T else { return nil }
            var fields: [String: PortableFieldValue] = [:]
            for f in m.fields {
                fields[f.cloudKey] = f.extract(model)
            }
            // updatedAt is sourced from the conflict policy's keypath when
            // we have one; otherwise default to .now (records without a
            // dedicated updatedAt will still get a valid timestamp).
            let updatedAt: Date = {
                if case .lastWriteWinsByField(let kp) = m.conflictPolicy {
                    return model[keyPath: kp]
                }
                return Date()
            }()
            let recordId = m.id(of: model)
            return PortableRecord(
                id: SyncRecordID(type: m.recordType, id: recordId),
                fields: fields,
                assets: [:],   // assets are populated by transport-specific code
                schemaVersion: m.version,
                minimumCompatibleVersion: m.minimumCompatibleVersion,
                unknownFields: [:],
                updatedAt: updatedAt
            )
        }

        // Applying a record onto an existing local copy: walk known fields,
        // call apply(...) for each one. Fields not present in the record
        // are left as-is on the model (preserving local-only state).
        let applyPortableToExisting: (Any, PortableRecord) -> Any? = { existing, remote in
            guard var model = existing as? T else { return nil }
            for f in m.fields {
                if let value = remote.fields[f.cloudKey] {
                    _ = f.apply(&model, value)
                }
            }
            return model
        }

        // Applying onto a "blank" — only meaningful for types that can
        // synthesize a default-initialized instance. The Syncable protocol
        // doesn't require a default initializer, so this is left unset
        // here. Concrete types whose merge path needs blank application
        // can extend the registry later.
        let applyPortableToBlank: ((PortableRecord) -> Any?)? = nil

        let resolveConflict: (Any, Any) -> Any? = { local, remote in
            guard let lModel = local as? T, let rModel = remote as? T else { return nil }
            switch m.conflictPolicy {
            case .lastWriteWinsByField(let kp):
                return lModel[keyPath: kp] >= rModel[keyPath: kp] ? lModel : rModel
            case .lastWriteWinsByServerEtag:
                // Caller (transport) already preferred the server record
                // when this branch runs — pass through.
                return rModel
            case .alwaysAccept:
                return rModel
            case .custom(let merge):
                return merge(lModel, rModel)
            }
        }

        return AnySyncableTypeMetadata(
            recordType: m.recordType,
            scope: scope,
            version: m.version,
            minimumCompatibleVersion: m.minimumCompatibleVersion,
            knownCloudKeys: knownKeys,
            hasCleanupHook: m.cleanupOnDelete != nil,
            fieldKinds: kinds,
            buildPortable: buildPortable,
            applyPortableToBlank: applyPortableToBlank,
            applyPortableToExisting: applyPortableToExisting,
            resolveConflict: resolveConflict
        )
    }
}
