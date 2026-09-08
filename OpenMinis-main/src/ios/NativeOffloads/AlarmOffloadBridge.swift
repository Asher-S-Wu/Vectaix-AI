//
//  AlarmOffloadBridge.swift
//  MinisApp
//
//  Swift bridge for AlarmKit, called from AlarmOffload.m.
//  AlarmKit is Swift-only; this class exposes alarm operations as
//  NSDictionary for the ObjC handler to consume.
//

import Foundation
import SQLite3

#if canImport(AlarmKit)
import AlarmKit

/// Empty metadata conforming to AlarmMetadata for our alarms.
@available(iOS 26.0, *)
nonisolated struct MinisAlarmMetadata: AlarmMetadata {}

@available(iOS 26.0, *)
@objc public class AlarmOffloadBridge: NSObject {

    // MARK: - Label persistence
    //
    // AlarmKit's `Alarm` values delivered by `alarmUpdates` do not expose the
    // alert presentation title (the label) back to us, so `listAlarms()` cannot
    // recover the label the user/AI set at schedule time. We therefore persist
    // an id -> label map and look it up when listing. The store is kept in sync
    // on cancel / cancel-all so it doesn't grow unbounded. This is what makes
    // the label visible in the Minis AlarmListView (AlarmRowView already renders
    // `alarm.label` when non-empty).
    //
    // Backed by a tiny SQLite table (AlarmLabelStore) in the same MinisChat/
    // folder as the other native DBs — O(1) keyed reads/writes instead of
    // (de)serializing a whole UserDefaults dictionary on every mutate.

    private static func loadLabels() -> [String: String] {
        AlarmLabelStore.shared.allLabels()
    }

    private static func saveLabel(_ label: String, forId id: String) {
        guard !label.isEmpty else { return }
        AlarmLabelStore.shared.save(label: label, forId: id)
    }

    private static func removeLabel(forId id: String) {
        AlarmLabelStore.shared.remove(id: id)
    }

    /// Drop any persisted labels whose ids are no longer in [liveIds] so the
    /// store can't leak after alarms fire/expire outside our cancel path.
    private static func pruneLabels(keeping liveIds: Set<String>) {
        AlarmLabelStore.shared.prune(keeping: liveIds)
    }

    // MARK: - Authorization

    @objc public static func requestAuthorization(
        completion: @escaping (Bool, Error?) -> Void
    ) {
        Task {
            let manager = AlarmManager.shared
            switch manager.authorizationState {
            case .authorized:
                completion(true, nil)
            case .notDetermined:
                do {
                    let state = try await manager.requestAuthorization()
                    completion(state == .authorized, nil)
                } catch {
                    completion(false, error)
                }
            case .denied:
                completion(false, nil)
            @unknown default:
                completion(false, nil)
            }
        }
    }

    // MARK: - Schedule alarm (time-based)

    @objc public static func scheduleAlarm(
        withId alarmId: String,
        fireDate: Date,
        label: String,
        repeatMode: String,
        completion: @escaping (NSDictionary?, Error?) -> Void
    ) {
        Task {
            do {
                let manager = AlarmManager.shared

                let stopButton = AlarmButton(
                    text: "Stop",
                    textColor: .white,
                    systemImageName: "stop.circle"
                )
                let alert = AlarmPresentation.Alert(
                    title: LocalizedStringResource(stringLiteral: label),
                    stopButton: stopButton
                )
                let attributes = AlarmAttributes<MinisAlarmMetadata>(
                    presentation: AlarmPresentation(alert: alert),
                    tintColor: .blue
                )

                let schedule: Alarm.Schedule
                if repeatMode == "daily" {
                    let cal = Calendar.current
                    let comps = cal.dateComponents([.hour, .minute], from: fireDate)
                    schedule = .relative(
                        Alarm.Schedule.Relative(
                            time: Alarm.Schedule.Relative.Time(
                                hour: comps.hour ?? 0,
                                minute: comps.minute ?? 0
                            ),
                            repeats: .weekly([.sunday, .monday, .tuesday, .wednesday, .thursday, .friday, .saturday])
                        )
                    )
                } else if repeatMode == "weekdays" {
                    let cal = Calendar.current
                    let comps = cal.dateComponents([.hour, .minute], from: fireDate)
                    schedule = .relative(
                        Alarm.Schedule.Relative(
                            time: Alarm.Schedule.Relative.Time(
                                hour: comps.hour ?? 0,
                                minute: comps.minute ?? 0
                            ),
                            repeats: .weekly([.monday, .tuesday, .wednesday, .thursday, .friday])
                        )
                    )
                } else {
                    schedule = .fixed(fireDate)
                }

                let config = AlarmManager.AlarmConfiguration(
                    schedule: schedule,
                    attributes: attributes
                )
                let alarm = try await manager.schedule(
                    id: UUID(uuidString: alarmId) ?? UUID(),
                    configuration: config
                )

                // Persist the label so listAlarms() can surface it in the UI
                // (AlarmKit doesn't hand the presentation title back to us).
                saveLabel(label, forId: alarm.id.uuidString)

                let result: NSDictionary = [
                    "id": alarm.id.uuidString,
                    "label": label,
                    "repeat": repeatMode,
                    "type": "schedule",
                ]
                completion(result, nil)
            } catch {
                completion(nil, error)
            }
        }
    }

    // MARK: - Schedule countdown timer

    @objc public static func scheduleTimer(
        withId timerId: String,
        duration: TimeInterval,
        label: String,
        completion: @escaping (NSDictionary?, Error?) -> Void
    ) {
        Task {
            do {
                let manager = AlarmManager.shared

                let stopButton = AlarmButton(
                    text: "Done",
                    textColor: .green,
                    systemImageName: "checkmark"
                )
                let alert = AlarmPresentation.Alert(
                    title: LocalizedStringResource(stringLiteral: label),
                    stopButton: stopButton
                )
                let attributes = AlarmAttributes<MinisAlarmMetadata>(
                    presentation: AlarmPresentation(alert: alert),
                    tintColor: .orange
                )

                let countdown = Alarm.CountdownDuration(preAlert: duration, postAlert: nil)
                let config = AlarmManager.AlarmConfiguration(
                    countdownDuration: countdown,
                    attributes: attributes
                )
                let alarm = try await manager.schedule(
                    id: UUID(uuidString: timerId) ?? UUID(),
                    configuration: config
                )

                // Persist the label so listAlarms() can surface it in the UI.
                saveLabel(label, forId: alarm.id.uuidString)

                let result: NSDictionary = [
                    "id": alarm.id.uuidString,
                    "duration_seconds": Int(duration),
                    "label": label,
                    "type": "timer",
                ]
                completion(result, nil)
            } catch {
                completion(nil, error)
            }
        }
    }

    // MARK: - List alarms

    @objc public static func listAlarms(
        completion: @escaping (NSArray?, Error?) -> Void
    ) {
        Task<Void, Never> {
            do {
                let manager = AlarmManager.shared
                var items: [[String: Any]] = []
                let labels = loadLabels()

                // alarmUpdates is an AsyncSequence; grab the first emission
                for await alarms in manager.alarmUpdates {
                    // Drop persisted labels for alarms that no longer exist
                    // (fired / expired without going through our cancel path).
                    pruneLabels(keeping: Set(alarms.map { $0.id.uuidString }))
                    for alarm in alarms {
                        var entry: [String: Any] = [
                            "id": alarm.id.uuidString,
                        ]

                        // Label (persisted at schedule time — AlarmKit doesn't
                        // expose the presentation title back to us). Non-empty
                        // only; AlarmRowView hides the label row when empty.
                        if let label = labels[alarm.id.uuidString], !label.isEmpty {
                            entry["label"] = label
                        }

                        // State
                        switch alarm.state {
                        case .countdown:
                            entry["state"] = "countdown"
                        case .alerting:
                            entry["state"] = "alerting"
                        case .scheduled:
                            entry["state"] = "scheduled"
                        @unknown default:
                            entry["state"] = "\(alarm.state)"
                        }

                        // Countdown duration if available
                        if let countdown = alarm.countdownDuration {
                            if let preAlert = countdown.preAlert {
                                entry["countdown_seconds"] = Int(preAlert)
                            }
                        }

                        // Schedule info
                        if let schedule = alarm.schedule {
                            switch schedule {
                            case .fixed(let date):
                                entry["schedule_type"] = "fixed"
                                let formatter = ISO8601DateFormatter()
                                entry["fire_date"] = formatter.string(from: date)
                            case .relative(let rel):
                                entry["schedule_type"] = "relative"
                                entry["time"] = String(format: "%02d:%02d", rel.time.hour, rel.time.minute)
                                if case .weekly(let days) = rel.repeats {
                                    var names: [String] = []
                                    if days.contains(.sunday) { names.append("Sun") }
                                    if days.contains(.monday) { names.append("Mon") }
                                    if days.contains(.tuesday) { names.append("Tue") }
                                    if days.contains(.wednesday) { names.append("Wed") }
                                    if days.contains(.thursday) { names.append("Thu") }
                                    if days.contains(.friday) { names.append("Fri") }
                                    if days.contains(.saturday) { names.append("Sat") }
                                    entry["repeat_days"] = names
                                }
                            @unknown default:
                                entry["schedule_type"] = "unknown"
                            }
                        } else if alarm.countdownDuration != nil {
                            // Timer-only alarm (no schedule, has countdown)
                            entry["schedule_type"] = "timer"
                        }

                        items.append(entry)
                    }
                    // Only take the first snapshot
                    break
                }

                completion(items as NSArray, nil)
            } catch {
                completion(nil, error)
            }
        }
    }

    // MARK: - Cancel alarm

    @objc public static func cancelAlarm(
        withId alarmId: String,
        completion: @escaping (Bool, Error?) -> Void
    ) {
        do {
            let manager = AlarmManager.shared
            if let uuid = UUID(uuidString: alarmId) {
                try manager.cancel(id: uuid)
                removeLabel(forId: uuid.uuidString)
                completion(true, nil)
            } else {
                completion(false, NSError(domain: "AlarmOffload", code: -1,
                    userInfo: [NSLocalizedDescriptionKey: "Invalid alarm ID"]))
            }
        } catch {
            completion(false, error)
        }
    }

    // MARK: - Cancel all alarms

    @objc public static func cancelAllAlarms(
        completion: @escaping (Int, Error?) -> Void
    ) {
        Task {
            do {
                let manager = AlarmManager.shared
                var count = 0

                // Get current alarms to count them
                for await alarms in manager.alarmUpdates {
                    count = alarms.count
                    for alarm in alarms {
                        try manager.cancel(id: alarm.id)
                        removeLabel(forId: alarm.id.uuidString)
                    }
                    break
                }

                completion(count, nil)
            } catch {
                completion(0, error)
            }
        }
    }
}

// MARK: - AlarmLabelStore (SQLite)

/// SQLite-backed `alarm_id -> label` store for AlarmKit alarms/timers.
///
/// AlarmKit doesn't hand the alert presentation title back when listing, so we
/// keep the label the user/AI set at schedule time here and re-attach it in
/// `AlarmOffloadBridge.listAlarms()`. Replaces an earlier UserDefaults
/// dictionary, which had to (de)serialize the whole map on every read/write.
///
/// Mirrors the native-SQLite style used by `ProviderConfigDB` / `ChatStore`:
/// raw `SQLite3` (no ORM), WAL journal, `synchronous = NORMAL`, in the shared
/// `Library/MinisChat/` folder. The connection is opened once with FULLMUTEX
/// (serialized threading) and reused; an `NSLock` additionally guards the
/// multi-statement prune transaction. Callers reach it via the process-wide
/// `shared` singleton.
private final class AlarmLabelStore {

    static let shared = AlarmLabelStore()

    private static let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

    private let lock = NSLock()
    private var db: OpaquePointer?

    private static func defaultURL() -> URL {
        let library = FileManager.default
            .urls(for: .libraryDirectory, in: .userDomainMask)[0]
        let base = library.appendingPathComponent("MinisChat", isDirectory: true)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        return base.appendingPathComponent("alarm-labels.db")
    }

    private init() {
        let url = Self.defaultURL()
        var handle: OpaquePointer?
        let flags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX
        guard sqlite3_open_v2(url.path, &handle, flags, nil) == SQLITE_OK, let handle else {
            sqlite3_close(handle)
            return
        }
        db = handle
        exec("PRAGMA journal_mode = WAL")
        exec("PRAGMA synchronous = NORMAL")
        exec("""
            CREATE TABLE IF NOT EXISTS alarm_labels (
                alarm_id    TEXT PRIMARY KEY,
                label       TEXT NOT NULL,
                created_at  INTEGER
            )
        """)
    }

    deinit {
        if let db { sqlite3_close(db) }
    }

    @discardableResult
    private func exec(_ sql: String) -> Int32 {
        guard let db else { return SQLITE_ERROR }
        return sqlite3_exec(db, sql, nil, nil, nil)
    }

    /// Whole `id -> label` snapshot (one query, used by the list pass).
    func allLabels() -> [String: String] {
        lock.lock(); defer { lock.unlock() }
        guard let db else { return [:] }
        var stmt: OpaquePointer?
        defer { sqlite3_finalize(stmt) }
        guard sqlite3_prepare_v2(db, "SELECT alarm_id, label FROM alarm_labels", -1, &stmt, nil) == SQLITE_OK else {
            return [:]
        }
        var out: [String: String] = [:]
        while sqlite3_step(stmt) == SQLITE_ROW {
            guard let idC = sqlite3_column_text(stmt, 0),
                  let labelC = sqlite3_column_text(stmt, 1) else { continue }
            out[String(cString: idC)] = String(cString: labelC)
        }
        return out
    }

    func save(label: String, forId id: String) {
        lock.lock(); defer { lock.unlock() }
        guard let db else { return }
        var stmt: OpaquePointer?
        defer { sqlite3_finalize(stmt) }
        let sql = "INSERT OR REPLACE INTO alarm_labels (alarm_id, label, created_at) VALUES (?, ?, ?)"
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return }
        sqlite3_bind_text(stmt, 1, id, -1, Self.SQLITE_TRANSIENT)
        sqlite3_bind_text(stmt, 2, label, -1, Self.SQLITE_TRANSIENT)
        sqlite3_bind_int64(stmt, 3, Int64(Date().timeIntervalSince1970))
        sqlite3_step(stmt)
    }

    func remove(id: String) {
        lock.lock(); defer { lock.unlock() }
        guard let db else { return }
        var stmt: OpaquePointer?
        defer { sqlite3_finalize(stmt) }
        guard sqlite3_prepare_v2(db, "DELETE FROM alarm_labels WHERE alarm_id = ?", -1, &stmt, nil) == SQLITE_OK else { return }
        sqlite3_bind_text(stmt, 1, id, -1, Self.SQLITE_TRANSIENT)
        sqlite3_step(stmt)
    }

    /// Delete every row whose id is not in [liveIds]. Empty set wipes the table.
    func prune(keeping liveIds: Set<String>) {
        lock.lock(); defer { lock.unlock() }
        guard let db else { return }
        if liveIds.isEmpty {
            exec("DELETE FROM alarm_labels")
            return
        }
        // Parameterized NOT IN (?, ?, …) so ids are never string-interpolated.
        let placeholders = Array(repeating: "?", count: liveIds.count).joined(separator: ", ")
        let sql = "DELETE FROM alarm_labels WHERE alarm_id NOT IN (\(placeholders))"
        var stmt: OpaquePointer?
        defer { sqlite3_finalize(stmt) }
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return }
        for (idx, id) in liveIds.enumerated() {
            sqlite3_bind_text(stmt, Int32(idx + 1), id, -1, Self.SQLITE_TRANSIENT)
        }
        sqlite3_step(stmt)
    }
}

#endif // canImport(AlarmKit)
