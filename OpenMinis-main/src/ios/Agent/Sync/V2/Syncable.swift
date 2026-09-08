import Foundation

/// Scope describes how a Syncable type's records relate to other types.
/// Used by the transport to decide grouping (per-session zone keying,
/// resurrect cascades, etc.) and by SyncCore to walk parent/child trees
/// during full session re-pushes.
enum SyncScope<T> {
    /// One singleton record per app (e.g. ProviderConfig).
    case global
    /// One record per object, no parent (e.g. Session).
    case perObject(KeyPath<T, String>)
    /// Child of another type. The closure extracts the parent's id.
    case perParent(parentType: String, _ parentIdKeyPath: KeyPath<T, String>)
}

/// Asset upload threshold. Some types may want to keep small payloads
/// inline as a JSON string but offload large ones to a CKAsset / file
/// stream. The owning transport decides the actual mechanism.
enum AssetPolicy {
    case never                          // always inline
    case ifLargerThan(Int)              // bytes; below = inline string, above = asset
}

/// Conflict resolution policy. Picked at type registration time.
enum ConflictPolicy<T> {
    /// Compare a Date keypath; whichever side has the later timestamp wins
    /// the entire record. Simplest and the v2 default.
    case lastWriteWinsByField(KeyPath<T, Date>)

    /// Trust whatever the server returned (CloudKit etag is authoritative).
    /// Used for assets where field-level merging makes no sense.
    case lastWriteWinsByServerEtag

    /// Always accept the incoming record without comparison. Suitable for
    /// per-device records (SyncDevice heartbeats) where each device's row
    /// is naturally non-conflicting.
    case alwaysAccept

    /// Custom merge function. Use sparingly — keep the closure pure.
    case custom((_ local: T, _ remote: T) -> T)
}

/// Field type tag for FieldDescriptor. Defines the wire representation.
enum FieldKind {
    case string
    case int
    case double
    case bool
    case date
    case data
    case json(AssetPolicy = .never)        // serialize via JSONEncoder
    case asset                              // local file → transport-specific upload
}

/// Describes one synced field on a Syncable type. The closures capture
/// "how to read this field from a model" and "how to write a value back
/// into a mutable model copy".
struct FieldDescriptor<T> {
    let cloudKey: String                   // stable wire name
    let kind: FieldKind
    let isOptional: Bool
    /// Extract the field's portable value from a model instance.
    /// Returns `.null` for optional fields whose underlying value is nil
    /// (transports MUST NOT write a null literal — they should omit the
    /// key entirely, but that conversion lives in the transport, not here).
    let extract: (T) -> PortableFieldValue
    /// Assign a portable value back into a mutable model copy. Returns
    /// false if the value's tag is incompatible with this field's kind
    /// (caller can choose to log + skip).
    let apply: (inout T, PortableFieldValue) -> Bool

    // MARK: - Convenience builders for common kinds.

    static func string(
        _ key: String,
        _ kp: WritableKeyPath<T, String>,
        optional: Bool = false
    ) -> FieldDescriptor<T> {
        FieldDescriptor(
            cloudKey: key,
            kind: .string,
            isOptional: optional,
            extract: { .string($0[keyPath: kp]) },
            apply: { model, value in
                if case .string(let s) = value { model[keyPath: kp] = s; return true }
                return false
            }
        )
    }

    static func optionalString(
        _ key: String,
        _ kp: WritableKeyPath<T, String?>
    ) -> FieldDescriptor<T> {
        FieldDescriptor(
            cloudKey: key,
            kind: .string,
            isOptional: true,
            extract: {
                if let v = $0[keyPath: kp] { return .string(v) }
                return .null
            },
            apply: { model, value in
                switch value {
                case .null:           model[keyPath: kp] = nil; return true
                case .string(let s):  model[keyPath: kp] = s;   return true
                default:              return false
                }
            }
        )
    }

    static func int(
        _ key: String,
        _ kp: WritableKeyPath<T, Int>
    ) -> FieldDescriptor<T> {
        FieldDescriptor(
            cloudKey: key,
            kind: .int,
            isOptional: false,
            extract: { .int($0[keyPath: kp]) },
            apply: { model, value in
                if case .int(let i) = value { model[keyPath: kp] = i; return true }
                return false
            }
        )
    }

    static func optionalInt(
        _ key: String,
        _ kp: WritableKeyPath<T, Int?>
    ) -> FieldDescriptor<T> {
        FieldDescriptor(
            cloudKey: key,
            kind: .int,
            isOptional: true,
            extract: {
                if let v = $0[keyPath: kp] { return .int(v) }
                return .null
            },
            apply: { model, value in
                switch value {
                case .null:        model[keyPath: kp] = nil; return true
                case .int(let i):  model[keyPath: kp] = i;   return true
                default:           return false
                }
            }
        )
    }

    static func date(
        _ key: String,
        _ kp: WritableKeyPath<T, Date>
    ) -> FieldDescriptor<T> {
        FieldDescriptor(
            cloudKey: key,
            kind: .date,
            isOptional: false,
            extract: { .date($0[keyPath: kp]) },
            apply: { model, value in
                if case .date(let d) = value { model[keyPath: kp] = d; return true }
                return false
            }
        )
    }

    static func optionalDate(
        _ key: String,
        _ kp: WritableKeyPath<T, Date?>
    ) -> FieldDescriptor<T> {
        FieldDescriptor(
            cloudKey: key,
            kind: .date,
            isOptional: true,
            extract: {
                if let v = $0[keyPath: kp] { return .date(v) }
                return .null
            },
            apply: { model, value in
                switch value {
                case .null:        model[keyPath: kp] = nil; return true
                case .date(let d): model[keyPath: kp] = d;   return true
                default:           return false
                }
            }
        )
    }
}

/// Metadata that describes how to sync one Syncable type. Produced once at
/// registration time and consulted by SyncCore + every SyncTransport.
struct SyncTypeMetadata<T: Syncable> {
    let recordType: String                 // wire name, e.g. "MessageV2"
    let idKeyPath: KeyPath<T, String>
    let scope: SyncScope<T>
    let fields: [FieldDescriptor<T>]
    let conflictPolicy: ConflictPolicy<T>
    /// Bumped manually each time `fields` gains a new entry. Old readers
    /// see records carrying a higher version and know "expect unknown
    /// fields, don't truncate them on write-back".
    let version: Int
    /// Optional: if non-nil, written into PortableRecord.minimumCompatibleVersion
    /// on every outbound record of this type. Forces older clients to skip.
    let minimumCompatibleVersion: Int?

    /// Optional cleanup hook called when a record of this type is locally
    /// deleted (lets the type's owner clean up filesystem assets, caches,
    /// etc. that aren't covered by the SQLite delete).
    let cleanupOnDelete: ((T) -> Void)?

    init(
        recordType: String,
        idKeyPath: KeyPath<T, String>,
        scope: SyncScope<T>,
        fields: [FieldDescriptor<T>],
        conflictPolicy: ConflictPolicy<T>,
        version: Int = 1,
        minimumCompatibleVersion: Int? = nil,
        cleanupOnDelete: ((T) -> Void)? = nil
    ) {
        self.recordType = recordType
        self.idKeyPath = idKeyPath
        self.scope = scope
        self.fields = fields
        self.conflictPolicy = conflictPolicy
        self.version = version
        self.minimumCompatibleVersion = minimumCompatibleVersion
        self.cleanupOnDelete = cleanupOnDelete
    }

    /// The id of a given model instance.
    func id(of value: T) -> String { value[keyPath: idKeyPath] }

    /// If `scope` is per-parent, return the parent's id; nil for global / perObject.
    func parentId(of value: T) -> (parentType: String, parentId: String)? {
        if case .perParent(let parentType, let kp) = scope {
            return (parentType, value[keyPath: kp])
        }
        return nil
    }
}

/// Application types adopt this to declare themselves as syncable. The
/// metadata is the only contract — it carries the schema, the serializer,
/// the conflict policy, and (transitively) the wire format.
protocol Syncable {
    static var syncMetadata: SyncTypeMetadata<Self> { get }
}
