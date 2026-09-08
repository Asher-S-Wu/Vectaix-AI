import Foundation
import SQLite3

private let logger = AppLogger(category: "VoiceCorrection")

/// SQLite store for voice-input smart correction (design §3, §11, §13).
///
/// Its own database file — deliberately NOT sharing minis.db / provider-config.db —
/// so "clear my voice-correction learning data" is a single file to wipe, and so a
/// corrupt learning DB can never take the rest of the app down with it (design §3.1, §7).
///
/// **Threading**: `actor`, mirroring `ProviderConfigDB`. Every DB call is therefore
/// off the MainActor by construction (design §12.6).
///
/// **Durability trade-off vs ProviderConfigDB** (design §11.3): provider config is
/// non-regenerable critical state, so it keeps a JSON snapshot beside SQLite. This
/// data is *regenerable learning data* — losing it degrades correction to "no
/// personalization", it does not break the app — so we skip the double-write (saving
/// an I/O on every capture) and instead guarantee **self-healing**: if the file can't
/// be opened, delete and recreate it empty rather than propagate an error (§11.3).
actor VoiceCorrectionDB {

    // MARK: - Singleton

    /// Shared instance. `nil` only if even the rebuild-empty fallback failed, in which
    /// case every caller degrades to "no correction" rather than crashing.
    static let shared: VoiceCorrectionDB? = {
        do { return try VoiceCorrectionDB() }
        catch {
            logger.error("[VoiceCorrection][DBHealth] unrecoverable open failure: \(error) — correction disabled")
            return nil
        }
    }()

    // MARK: - File locations

    /// Same MinisChat folder the other databases live in.
    static func defaultURL() -> URL {
        let library = FileManager.default
            .urls(for: .libraryDirectory, in: .userDomainMask)[0]
        let base = library.appendingPathComponent("MinisChat", isDirectory: true)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        return base.appendingPathComponent("voice-correction.db")
    }

    /// Bumped ONLY for versioned structural migrations. Additive columns go through
    /// `ensureIdempotentColumns` instead and do NOT require a bump — see the comment
    /// there for why that distinction is load-bearing (design §11.1/§11.4-rule-4).
    static let schemaVersion: Int32 = 1

    private let dbURL: URL
    private var db: OpaquePointer?

    // MARK: - Init / schema

    init(url: URL? = nil) throws {
        let resolvedURL = url ?? Self.defaultURL()
        self.dbURL = resolvedURL

        do {
            self.db = try Self.openAndPrepare(at: resolvedURL)
        } catch {
            // §11.3 self-heal: a corrupt/unreadable learning DB must never block the
            // app. Throw the file away and come back as a cold-start empty DB.
            let size = (try? FileManager.default
                .attributesOfItem(atPath: resolvedURL.path)[.size] as? Int) ?? nil
            logger.error("[VoiceCorrection][DBHealth] open_failed error=\(error) action=rebuilt_empty_db previousSizeBytes=\(size.map(String.init) ?? "unknown")")
            try? FileManager.default.removeItem(at: resolvedURL)
            // A WAL DB has sidecar files; leaving a stale -wal/-shm next to a fresh
            // main file is its own corruption source, so drop those too.
            try? FileManager.default.removeItem(at: URL(fileURLWithPath: resolvedURL.path + "-wal"))
            try? FileManager.default.removeItem(at: URL(fileURLWithPath: resolvedURL.path + "-shm"))
            self.db = try Self.openAndPrepare(at: resolvedURL)   // one retry; if this throws, `shared` degrades to nil
        }
        logger.info("[VoiceCorrection][DBHealth] opened at \(resolvedURL.path)")
    }

    // No `deinit { sqlite3_close(db) }`.
    //
    // Under Swift 6 strict concurrency a nonisolated `deinit` may not touch the actor's
    // non-Sendable state (`OpaquePointer?`), and it compiles only because most of the app
    // is on laxer settings — the strict-concurrency test target rejects it outright.
    //
    // Closing here would be near-pointless anyway: this is a process-lifetime singleton, so
    // its deinit runs at process exit (if ever), when the OS reclaims the handle regardless.
    // WAL data is already durable at that point; there is nothing to flush.

    private static func openAndPrepare(at url: URL) throws -> OpaquePointer {
        var handle: OpaquePointer?
        let flags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX
        let rc = sqlite3_open_v2(url.path, &handle, flags, nil)
        guard rc == SQLITE_OK, let handle else {
            sqlite3_close(handle)
            throw VoiceCorrectionDBError.openFailed(path: url.path, code: rc)
        }

        // auto_vacuum MUST be set before any table is created — SQLite ignores it
        // afterwards (design §13.4). INCREMENTAL (not FULL) so cleanup can reclaim
        // pages in bounded chunks via `PRAGMA incremental_vacuum(N)` instead of one
        // long blocking full VACUUM.
        exec(db: handle, "PRAGMA auto_vacuum = INCREMENTAL")
        // WAL: readers (the send-time retrieval on the critical path) must not block
        // on the background capture writer, and vice versa (design §12.4-rule-5).
        exec(db: handle, "PRAGMA journal_mode = WAL")
        exec(db: handle, "PRAGMA synchronous = NORMAL")

        try runMigrations(db: handle)
        return handle
    }

    // MARK: - Migrations

    /// Order is load-bearing and mirrors `ProviderConfigDB.runMigrations` (design §11.1):
    ///
    ///   1. `ensureIdempotentColumns` — runs on EVERY open, BEFORE the version gate.
    ///   2. versioned structural migrations — only when `current < schemaVersion`.
    ///   3. stamp `user_version`.
    ///
    /// Step 1 must precede the version gate. ProviderConfigDB learned this the hard
    /// way: `custom_user_agent` was added without bumping schemaVersion, so every
    /// already-current DB hit the early return, never gained the column, and the
    /// statements referencing it failed to prepare — silently wiping every provider
    /// from the UI. Running additive column repairs unconditionally makes a DB
    /// self-repairing regardless of what its `user_version` claims.
    private static func runMigrations(db: OpaquePointer) throws {
        let started = Date()

        var current: Int32 = 0
        var stmt: OpaquePointer?
        if sqlite3_prepare_v2(db, "PRAGMA user_version", -1, &stmt, nil) == SQLITE_OK,
           sqlite3_step(stmt) == SQLITE_ROW {
            current = sqlite3_column_int(stmt, 0)
        }
        sqlite3_finalize(stmt)

        let patched = ensureIdempotentColumns(db: db)

        // Downgrade safety (design §11.2): an OLD build's compiled-in schemaVersion is
        // lower than the `user_version` a NEWER build stamped. It takes this early
        // return, skips all migrations, and just reads the columns it knows about.
        // That works ONLY because every SELECT/INSERT below names its columns
        // explicitly (never `SELECT *`), so extra columns written by a newer build are
        // invisible rather than shifting column indices. See §11.4 rules 1–2.
        if current >= schemaVersion {
            if patched > 0 {
                logger.info("[VoiceCorrection][Migration] schema at \(current) (>= \(schemaVersion)) idempotent_columns_patched=\(patched)")
            }
            return
        }

        logger.info("[VoiceCorrection][Migration] schema \(current) → \(schemaVersion)")
        exec(db: db, "BEGIN IMMEDIATE")

        if current < 1 {
            // ── v1: initial schema (design §3.2, §3.3) ──
            // NOTE: `archived_at` (design §13.3) is part of the v1 CREATE TABLE *and*
            // of ensureIdempotentColumns. Both, deliberately: the CREATE covers fresh
            // installs, the ensure covers any DB created by a pre-archived_at build.
            // This is exactly the belt-and-braces the custom_user_agent incident calls for.
            exec(db: db, """
                CREATE TABLE IF NOT EXISTS confusion_dictionary (
                    id                      TEXT PRIMARY KEY,
                    original_phonetic_key   TEXT NOT NULL,
                    original_variants       TEXT NOT NULL,
                    corrected_term          TEXT NOT NULL,
                    locale                  TEXT NOT NULL,
                    frequency               INTEGER NOT NULL DEFAULT 1,
                    negative_feedback_count INTEGER NOT NULL DEFAULT 0,
                    confidence              REAL NOT NULL DEFAULT 0.5,
                    context_before_sample   TEXT,
                    asr_provider            TEXT NOT NULL DEFAULT '',
                    source                  TEXT NOT NULL DEFAULT 'asr_transcript',
                    last_seen               REAL NOT NULL,
                    archived_at             REAL DEFAULT NULL,
                    device_id               TEXT,
                    last_synced_at          REAL
                )
            """)
            exec(db: db, "CREATE INDEX IF NOT EXISTS idx_confusion_phonetic ON confusion_dictionary(original_phonetic_key)")
            exec(db: db, "CREATE INDEX IF NOT EXISTS idx_confusion_locale ON confusion_dictionary(locale)")
            exec(db: db, "CREATE INDEX IF NOT EXISTS idx_confusion_confidence ON confusion_dictionary(confidence DESC)")

            exec(db: db, """
                CREATE TABLE IF NOT EXISTS typed_vocabulary (
                    id              TEXT PRIMARY KEY,
                    term            TEXT NOT NULL,
                    phonetic_key    TEXT NOT NULL,
                    locale          TEXT NOT NULL,
                    pos_tag         TEXT,
                    frequency       INTEGER NOT NULL DEFAULT 1,
                    distinct_days   INTEGER NOT NULL DEFAULT 1,
                    background_rank INTEGER,
                    last_seen       REAL NOT NULL,
                    source          TEXT NOT NULL DEFAULT 'typed',
                    archived_at     REAL DEFAULT NULL
                )
            """)
            exec(db: db, "CREATE INDEX IF NOT EXISTS idx_vocab_phonetic ON typed_vocabulary(phonetic_key)")

            // Bookkeeping the engine/builder/cleanup need but that isn't user data:
            // the incremental-build cursor (§12.3), cleanup/vacuum timestamps (§13.2/§13.4),
            // and the correction outcome counters behind debug.voiceCorrection.metrics (§10.2d).
            exec(db: db, """
                CREATE TABLE IF NOT EXISTS correction_meta (
                    key   TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                )
            """)
            exec(db: db, """
                CREATE TABLE IF NOT EXISTS correction_events (
                    id             TEXT PRIMARY KEY,
                    created_at     REAL NOT NULL,
                    original       TEXT NOT NULL,
                    corrected      TEXT NOT NULL,
                    outcome        TEXT NOT NULL,
                    source_summary TEXT
                )
            """)
            exec(db: db, "CREATE INDEX IF NOT EXISTS idx_events_created ON correction_events(created_at DESC)")
        }

        exec(db: db, "PRAGMA user_version = \(schemaVersion)")
        exec(db: db, "COMMIT")

        let ms = Int(Date().timeIntervalSince(started) * 1000)
        logger.info("[VoiceCorrection][Migration] schema \(current)→\(schemaVersion) idempotent_columns_checked=\(patched) versioned_migrations_applied=1 durationMs=\(ms)")
    }

    /// Additive-only column repairs, run on every open regardless of `user_version`.
    /// Returns the number of columns actually added.
    ///
    /// §11.4 rule 4 — record, for each column, whether it bumped schemaVersion:
    ///   • `archived_at` (both tables): added by design §13.3. **No schemaVersion bump**,
    ///     because it also ships inside the v1 CREATE TABLE above; this entry exists to
    ///     repair any DB written by a build that predates it. Additive, DEFAULT NULL,
    ///     so old builds that never SELECT it are unaffected (§11.2).
    @discardableResult
    private static func ensureIdempotentColumns(db: OpaquePointer) -> Int {
        var added = 0
        func columns(of table: String) -> Set<String> {
            var existing = Set<String>()
            var stmt: OpaquePointer?
            if sqlite3_prepare_v2(db, "PRAGMA table_info(\(table))", -1, &stmt, nil) == SQLITE_OK {
                while sqlite3_step(stmt) == SQLITE_ROW {
                    if let c = sqlite3_column_text(stmt, 1) { existing.insert(String(cString: c)) }
                }
            }
            sqlite3_finalize(stmt)
            return existing
        }
        func ensure(_ table: String, _ column: String, _ ddl: String) {
            let existing = columns(of: table)
            // Empty = table not created yet (fresh DB, the v1 CREATE below will include
            // the column). Skip so we don't log a spurious "no such table".
            guard !existing.isEmpty, !existing.contains(column) else { return }
            exec(db: db, "ALTER TABLE \(table) ADD COLUMN \(ddl)")
            added += 1
            logger.info("[VoiceCorrection][Migration] schema repair: added \(table).\(column)")
        }
        ensure("confusion_dictionary", "archived_at", "archived_at REAL DEFAULT NULL")
        ensure("typed_vocabulary", "archived_at", "archived_at REAL DEFAULT NULL")
        // [T-text-input-correction-source] `source` distinguishes where a
        // confusion row was learned: 'asr_transcript' (voice edit) vs
        // 'text_input' (composer select-and-replace). Ships in the v1 CREATE
        // above AND here — same belt-and-braces as archived_at: the CREATE
        // covers fresh installs, this repairs any DB written by a build that
        // predates the column. Additive, DEFAULT 'asr_transcript' so existing
        // rows keep their (voice) origin and old builds ignoring the column
        // are unaffected — no schemaVersion bump (§11.4).
        ensure("confusion_dictionary", "source", "source TEXT NOT NULL DEFAULT 'asr_transcript'")
        return added
    }

    // MARK: - Confusion dictionary

    /// Upsert one learned ASR correction (design §3.2 write rule).
    /// Dedup key is (phonetic key, corrected term, locale): the same intent recorded
    /// via a different misspelling folds into one row and bumps `frequency`, which is
    /// the whole point of an aggregate table rather than an append-only log.
    func upsertConfusion(phoneticKey: String,
                         originalVariant: String,
                         correctedTerm: String,
                         locale: String,
                         contextSample: String?,
                         asrProvider: String,
                         source: String = "asr_transcript") {
        guard let db else { return }
        let now = Date().timeIntervalSince1970

        var existingId: String?
        var frequency: Int32 = 0
        var negative: Int32 = 0
        var variantsJSON = "[]"

        var stmt: OpaquePointer?
        let sel = """
            SELECT id, frequency, negative_feedback_count, original_variants
            FROM confusion_dictionary
            WHERE original_phonetic_key = ? AND corrected_term = ? AND locale = ?
            LIMIT 1
        """
        if sqlite3_prepare_v2(db, sel, -1, &stmt, nil) == SQLITE_OK {
            sqlite3_bind_text(stmt, 1, phoneticKey, -1, Self.SQLITE_TRANSIENT)
            sqlite3_bind_text(stmt, 2, correctedTerm, -1, Self.SQLITE_TRANSIENT)
            sqlite3_bind_text(stmt, 3, locale, -1, Self.SQLITE_TRANSIENT)
            if sqlite3_step(stmt) == SQLITE_ROW {
                existingId = sqlite3_column_text(stmt, 0).map { String(cString: $0) }
                frequency = sqlite3_column_int(stmt, 1)
                negative = sqlite3_column_int(stmt, 2)
                variantsJSON = sqlite3_column_text(stmt, 3).map { String(cString: $0) } ?? "[]"
            }
        }
        sqlite3_finalize(stmt)

        var variants = Self.decodeVariants(variantsJSON)
        if !variants.contains(originalVariant) { variants.append(originalVariant) }
        let encodedVariants = Self.encodeVariants(variants)

        if let existingId {
            let newFreq = frequency + 1
            let newConfidence = Self.confidence(frequency: newFreq, negative: negative)
            let upd = """
                UPDATE confusion_dictionary
                SET original_variants = ?, frequency = ?, confidence = ?,
                    last_seen = ?, context_before_sample = ?, archived_at = NULL
                WHERE id = ?
            """
            var u: OpaquePointer?
            if sqlite3_prepare_v2(db, upd, -1, &u, nil) == SQLITE_OK {
                sqlite3_bind_text(u, 1, encodedVariants, -1, Self.SQLITE_TRANSIENT)
                sqlite3_bind_int(u, 2, newFreq)
                sqlite3_bind_double(u, 3, newConfidence)
                sqlite3_bind_double(u, 4, now)
                if let contextSample {
                    sqlite3_bind_text(u, 5, contextSample, -1, Self.SQLITE_TRANSIENT)
                } else {
                    sqlite3_bind_null(u, 5)
                }
                sqlite3_bind_text(u, 6, existingId, -1, Self.SQLITE_TRANSIENT)
                sqlite3_step(u)
            }
            sqlite3_finalize(u)
            // [T-log-noise-privacy 2026-07-18] Lengths only — these pairs are
            // verbatim user speech; the DB row keeps the truth, the log
            // doesn't need it.
            logger.info("[VoiceCorrection][Record] upsert originalLen=\(originalVariant.count) correctedLen=\(correctedTerm.count) locale=\(locale) frequency=\(newFreq)(was \(frequency)) confidence=\(String(format: "%.2f", newConfidence)) revived=\(true)")
        } else {
            let newConfidence = Self.confidence(frequency: 1, negative: 0)
            let ins = """
                INSERT INTO confusion_dictionary
                    (id, original_phonetic_key, original_variants, corrected_term, locale,
                     frequency, negative_feedback_count, confidence, context_before_sample,
                     asr_provider, source, last_seen, archived_at, device_id, last_synced_at)
                VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?, ?, NULL, NULL, NULL)
            """
            var i: OpaquePointer?
            if sqlite3_prepare_v2(db, ins, -1, &i, nil) == SQLITE_OK {
                sqlite3_bind_text(i, 1, UUID().uuidString, -1, Self.SQLITE_TRANSIENT)
                sqlite3_bind_text(i, 2, phoneticKey, -1, Self.SQLITE_TRANSIENT)
                sqlite3_bind_text(i, 3, encodedVariants, -1, Self.SQLITE_TRANSIENT)
                sqlite3_bind_text(i, 4, correctedTerm, -1, Self.SQLITE_TRANSIENT)
                sqlite3_bind_text(i, 5, locale, -1, Self.SQLITE_TRANSIENT)
                sqlite3_bind_double(i, 6, newConfidence)
                if let contextSample {
                    sqlite3_bind_text(i, 7, contextSample, -1, Self.SQLITE_TRANSIENT)
                } else {
                    sqlite3_bind_null(i, 7)
                }
                sqlite3_bind_text(i, 8, asrProvider, -1, Self.SQLITE_TRANSIENT)
                sqlite3_bind_text(i, 9, source, -1, Self.SQLITE_TRANSIENT)
                sqlite3_bind_double(i, 10, now)
                sqlite3_step(i)
            }
            sqlite3_finalize(i)
            logger.info("[VoiceCorrection][Record] upsert originalLen=\(originalVariant.count) correctedLen=\(correctedTerm.count) locale=\(locale) frequency=1(new) confidence=\(String(format: "%.2f", newConfidence))")
        }
    }

    /// Negative feedback (design §3.2 closed loop, §15.3.4): the correction we proposed
    /// was rejected. Never write a *positive* row here for an accepted AI suggestion —
    /// that would feed the model's own output back as fresh evidence and inflate
    /// confidence in an echo chamber (design §15.3.4).
    func recordNegativeFeedback(phoneticKey: String, correctedTerm: String, locale: String) {
        guard let db else { return }
        var stmt: OpaquePointer?
        let sel = """
            SELECT id, frequency, negative_feedback_count, confidence
            FROM confusion_dictionary
            WHERE original_phonetic_key = ? AND corrected_term = ? AND locale = ?
            LIMIT 1
        """
        var id: String?
        var frequency: Int32 = 0
        var negative: Int32 = 0
        var oldConfidence: Double = 0
        if sqlite3_prepare_v2(db, sel, -1, &stmt, nil) == SQLITE_OK {
            sqlite3_bind_text(stmt, 1, phoneticKey, -1, Self.SQLITE_TRANSIENT)
            sqlite3_bind_text(stmt, 2, correctedTerm, -1, Self.SQLITE_TRANSIENT)
            sqlite3_bind_text(stmt, 3, locale, -1, Self.SQLITE_TRANSIENT)
            if sqlite3_step(stmt) == SQLITE_ROW {
                id = sqlite3_column_text(stmt, 0).map { String(cString: $0) }
                frequency = sqlite3_column_int(stmt, 1)
                negative = sqlite3_column_int(stmt, 2)
                oldConfidence = sqlite3_column_double(stmt, 3)
            }
        }
        sqlite3_finalize(stmt)
        guard let id else { return }

        let newNegative = negative + 1
        let newConfidence = Self.confidence(frequency: frequency, negative: newNegative)
        var u: OpaquePointer?
        if sqlite3_prepare_v2(db, "UPDATE confusion_dictionary SET negative_feedback_count = ?, confidence = ? WHERE id = ?", -1, &u, nil) == SQLITE_OK {
            sqlite3_bind_int(u, 1, newNegative)
            sqlite3_bind_double(u, 2, newConfidence)
            sqlite3_bind_text(u, 3, id, -1, Self.SQLITE_TRANSIENT)
            sqlite3_step(u)
        }
        sqlite3_finalize(u)
        logger.info("[VoiceCorrection][Feedback] reverted correctedLen=\(correctedTerm.count) negativeFeedbackCount=\(newNegative)(was \(negative)) confidence=\(String(format: "%.2f", newConfidence))(was \(String(format: "%.2f", oldConfidence)))")
    }

    /// confidence = frequency / (frequency + negative * 2) — design §3.2.
    /// Negative feedback is weighted 2× because a *disproven* rule is far more costly
    /// (it actively corrupts the user's text) than a merely unconfirmed one.
    static func confidence(frequency: Int32, negative: Int32) -> Double {
        let f = Double(max(frequency, 0))
        let n = Double(max(negative, 0))
        let denominator = f + n * 2.0
        guard denominator > 0 else { return 0.5 }
        return f / denominator
    }

    // MARK: - Retrieval (critical path — design §12.4)

    /// Batch lookup for many phonetic keys in ONE statement (design §12.4-rule-2):
    /// a 30-token transcript must not become 30 round-trips. Archived and
    /// low-confidence rows are excluded in SQL, not in Swift, so the index does the work.
    func lookupConfusion(phoneticKeys: [String], locale: String, minConfidence: Double, limit: Int) -> [ConfusionRow] {
        guard let db, !phoneticKeys.isEmpty else { return [] }
        let placeholders = Array(repeating: "?", count: phoneticKeys.count).joined(separator: ",")
        let sql = """
            SELECT id, original_phonetic_key, original_variants, corrected_term, locale,
                   frequency, negative_feedback_count, confidence, last_seen
            FROM confusion_dictionary
            WHERE original_phonetic_key IN (\(placeholders))
              AND locale = ?
              AND archived_at IS NULL
              AND confidence >= ?
            ORDER BY confidence DESC, frequency DESC
            LIMIT ?
        """
        var rows: [ConfusionRow] = []
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
            sqlite3_finalize(stmt); return []
        }
        var idx: Int32 = 1
        for key in phoneticKeys {
            sqlite3_bind_text(stmt, idx, key, -1, Self.SQLITE_TRANSIENT); idx += 1
        }
        sqlite3_bind_text(stmt, idx, locale, -1, Self.SQLITE_TRANSIENT); idx += 1
        sqlite3_bind_double(stmt, idx, minConfidence); idx += 1
        sqlite3_bind_int(stmt, idx, Int32(limit))
        while sqlite3_step(stmt) == SQLITE_ROW {
            rows.append(ConfusionRow(
                id: sqlite3_column_text(stmt, 0).map { String(cString: $0) } ?? "",
                phoneticKey: sqlite3_column_text(stmt, 1).map { String(cString: $0) } ?? "",
                variants: Self.decodeVariants(sqlite3_column_text(stmt, 2).map { String(cString: $0) } ?? "[]"),
                correctedTerm: sqlite3_column_text(stmt, 3).map { String(cString: $0) } ?? "",
                locale: sqlite3_column_text(stmt, 4).map { String(cString: $0) } ?? "",
                frequency: Int(sqlite3_column_int(stmt, 5)),
                negativeFeedbackCount: Int(sqlite3_column_int(stmt, 6)),
                confidence: sqlite3_column_double(stmt, 7),
                lastSeen: sqlite3_column_double(stmt, 8)))
        }
        sqlite3_finalize(stmt)
        return rows
    }

    func lookupVocabulary(phoneticKeys: [String], locale: String, limit: Int) -> [VocabularyRow] {
        guard let db, !phoneticKeys.isEmpty else { return [] }
        let placeholders = Array(repeating: "?", count: phoneticKeys.count).joined(separator: ",")
        let sql = """
            SELECT id, term, phonetic_key, locale, pos_tag, frequency, distinct_days,
                   background_rank, last_seen, source
            FROM typed_vocabulary
            WHERE phonetic_key IN (\(placeholders))
              AND locale = ?
              AND archived_at IS NULL
            ORDER BY frequency DESC
            LIMIT ?
        """
        var rows: [VocabularyRow] = []
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
            sqlite3_finalize(stmt); return []
        }
        var idx: Int32 = 1
        for key in phoneticKeys {
            sqlite3_bind_text(stmt, idx, key, -1, Self.SQLITE_TRANSIENT); idx += 1
        }
        sqlite3_bind_text(stmt, idx, locale, -1, Self.SQLITE_TRANSIENT); idx += 1
        sqlite3_bind_int(stmt, idx, Int32(limit))
        while sqlite3_step(stmt) == SQLITE_ROW {
            let rank = sqlite3_column_type(stmt, 7) == SQLITE_NULL ? nil : Int(sqlite3_column_int(stmt, 7))
            rows.append(VocabularyRow(
                id: sqlite3_column_text(stmt, 0).map { String(cString: $0) } ?? "",
                term: sqlite3_column_text(stmt, 1).map { String(cString: $0) } ?? "",
                phoneticKey: sqlite3_column_text(stmt, 2).map { String(cString: $0) } ?? "",
                locale: sqlite3_column_text(stmt, 3).map { String(cString: $0) } ?? "",
                posTag: sqlite3_column_text(stmt, 4).map { String(cString: $0) },
                frequency: Int(sqlite3_column_int(stmt, 5)),
                distinctDays: Int(sqlite3_column_int(stmt, 6)),
                backgroundRank: rank,
                lastSeen: sqlite3_column_double(stmt, 8),
                source: sqlite3_column_text(stmt, 9).map { String(cString: $0) } ?? "typed"))
        }
        sqlite3_finalize(stmt)
        return rows
    }

    // MARK: - Typed vocabulary write

    /// Upsert a vocabulary term. `distinct_days` only increments when the term is seen
    /// on a NEW calendar day — that's the whole point of the field (design §3.3 Layer 4):
    /// it separates a genuine habitual term from one topic burst that repeated a word.
    func upsertVocabulary(term: String,
                          phoneticKey: String,
                          locale: String,
                          posTag: String?,
                          backgroundRank: Int?,
                          occurrences: Int,
                          day: String) {
        guard let db else { return }
        let now = Date().timeIntervalSince1970

        var id: String?
        var frequency: Int32 = 0
        var distinctDays: Int32 = 0
        var lastSeen: Double = 0

        var stmt: OpaquePointer?
        let sel = "SELECT id, frequency, distinct_days, last_seen FROM typed_vocabulary WHERE term = ? AND locale = ? LIMIT 1"
        if sqlite3_prepare_v2(db, sel, -1, &stmt, nil) == SQLITE_OK {
            sqlite3_bind_text(stmt, 1, term, -1, Self.SQLITE_TRANSIENT)
            sqlite3_bind_text(stmt, 2, locale, -1, Self.SQLITE_TRANSIENT)
            if sqlite3_step(stmt) == SQLITE_ROW {
                id = sqlite3_column_text(stmt, 0).map { String(cString: $0) }
                frequency = sqlite3_column_int(stmt, 1)
                distinctDays = sqlite3_column_int(stmt, 2)
                lastSeen = sqlite3_column_double(stmt, 3)
            }
        }
        sqlite3_finalize(stmt)

        if let id {
            let previousDay = Self.dayKey(from: lastSeen)
            let newDistinctDays = (previousDay == day) ? distinctDays : distinctDays + 1
            var u: OpaquePointer?
            let upd = """
                UPDATE typed_vocabulary
                SET frequency = ?, distinct_days = ?, last_seen = ?, pos_tag = ?,
                    background_rank = ?, archived_at = NULL
                WHERE id = ?
            """
            if sqlite3_prepare_v2(db, upd, -1, &u, nil) == SQLITE_OK {
                sqlite3_bind_int(u, 1, frequency + Int32(occurrences))
                sqlite3_bind_int(u, 2, newDistinctDays)
                sqlite3_bind_double(u, 3, now)
                if let posTag { sqlite3_bind_text(u, 4, posTag, -1, Self.SQLITE_TRANSIENT) } else { sqlite3_bind_null(u, 4) }
                if let backgroundRank { sqlite3_bind_int(u, 5, Int32(backgroundRank)) } else { sqlite3_bind_null(u, 5) }
                sqlite3_bind_text(u, 6, id, -1, Self.SQLITE_TRANSIENT)
                sqlite3_step(u)
            }
            sqlite3_finalize(u)
        } else {
            var i: OpaquePointer?
            let ins = """
                INSERT INTO typed_vocabulary
                    (id, term, phonetic_key, locale, pos_tag, frequency, distinct_days,
                     background_rank, last_seen, source, archived_at)
                VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, 'typed', NULL)
            """
            if sqlite3_prepare_v2(db, ins, -1, &i, nil) == SQLITE_OK {
                sqlite3_bind_text(i, 1, UUID().uuidString, -1, Self.SQLITE_TRANSIENT)
                sqlite3_bind_text(i, 2, term, -1, Self.SQLITE_TRANSIENT)
                sqlite3_bind_text(i, 3, phoneticKey, -1, Self.SQLITE_TRANSIENT)
                sqlite3_bind_text(i, 4, locale, -1, Self.SQLITE_TRANSIENT)
                if let posTag { sqlite3_bind_text(i, 5, posTag, -1, Self.SQLITE_TRANSIENT) } else { sqlite3_bind_null(i, 5) }
                sqlite3_bind_int(i, 6, Int32(occurrences))
                if let backgroundRank { sqlite3_bind_int(i, 7, Int32(backgroundRank)) } else { sqlite3_bind_null(i, 7) }
                sqlite3_bind_double(i, 8, now)
                sqlite3_step(i)
            }
            sqlite3_finalize(i)
        }
    }

    static func dayKey(from timestamp: Double) -> String {
        guard timestamp > 0 else { return "" }
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: Date(timeIntervalSince1970: timestamp))
    }

    static func todayKey() -> String { dayKey(from: Date().timeIntervalSince1970) }

    // MARK: - Meta (cursors, timestamps)

    func metaValue(_ key: String) -> String? {
        guard let db else { return nil }
        var stmt: OpaquePointer?
        var value: String?
        if sqlite3_prepare_v2(db, "SELECT value FROM correction_meta WHERE key = ? LIMIT 1", -1, &stmt, nil) == SQLITE_OK {
            sqlite3_bind_text(stmt, 1, key, -1, Self.SQLITE_TRANSIENT)
            if sqlite3_step(stmt) == SQLITE_ROW {
                value = sqlite3_column_text(stmt, 0).map { String(cString: $0) }
            }
        }
        sqlite3_finalize(stmt)
        return value
    }

    func setMetaValue(_ key: String, _ value: String) {
        guard let db else { return }
        var stmt: OpaquePointer?
        if sqlite3_prepare_v2(db, "INSERT INTO correction_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", -1, &stmt, nil) == SQLITE_OK {
            sqlite3_bind_text(stmt, 1, key, -1, Self.SQLITE_TRANSIENT)
            sqlite3_bind_text(stmt, 2, value, -1, Self.SQLITE_TRANSIENT)
            sqlite3_step(stmt)
        }
        sqlite3_finalize(stmt)
    }

    // MARK: - Metrics (design §10.2d)

    /// One row per completed correction attempt. Accepted/reverted outcomes here are
    /// what `debug.voiceCorrection.metrics` reports — and, per §15.3.4, accepting an AI
    /// suggestion writes ONLY here, never back into confusion_dictionary.
    func recordCorrectionEvent(original: String, corrected: String, outcome: String, sourceSummary: String?) {
        guard let db else { return }
        var stmt: OpaquePointer?
        let ins = """
            INSERT INTO correction_events (id, created_at, original, corrected, outcome, source_summary)
            VALUES (?, ?, ?, ?, ?, ?)
        """
        if sqlite3_prepare_v2(db, ins, -1, &stmt, nil) == SQLITE_OK {
            sqlite3_bind_text(stmt, 1, UUID().uuidString, -1, Self.SQLITE_TRANSIENT)
            sqlite3_bind_double(stmt, 2, Date().timeIntervalSince1970)
            sqlite3_bind_text(stmt, 3, original, -1, Self.SQLITE_TRANSIENT)
            sqlite3_bind_text(stmt, 4, corrected, -1, Self.SQLITE_TRANSIENT)
            sqlite3_bind_text(stmt, 5, outcome, -1, Self.SQLITE_TRANSIENT)
            if let sourceSummary { sqlite3_bind_text(stmt, 6, sourceSummary, -1, Self.SQLITE_TRANSIENT) } else { sqlite3_bind_null(stmt, 6) }
            sqlite3_step(stmt)
        }
        sqlite3_finalize(stmt)
    }

    func correctionEventCounts(sinceDays: Int) -> [String: Int] {
        guard let db else { return [:] }
        let cutoff = Date().timeIntervalSince1970 - Double(sinceDays) * 86_400
        var counts: [String: Int] = [:]
        var stmt: OpaquePointer?
        if sqlite3_prepare_v2(db, "SELECT outcome, COUNT(*) FROM correction_events WHERE created_at >= ? GROUP BY outcome", -1, &stmt, nil) == SQLITE_OK {
            sqlite3_bind_double(stmt, 1, cutoff)
            while sqlite3_step(stmt) == SQLITE_ROW {
                let outcome = sqlite3_column_text(stmt, 0).map { String(cString: $0) } ?? "unknown"
                counts[outcome] = Int(sqlite3_column_int(stmt, 1))
            }
        }
        sqlite3_finalize(stmt)
        return counts
    }

    // MARK: - Debug / admin surface (design §10)

    func allConfusion(orderBy: String, locale: String?, limit: Int) -> [ConfusionRow] {
        guard let db else { return [] }
        // Whitelist the ORDER BY column — it is the one piece of this SQL that can't be
        // a bound parameter, so it must never be interpolated from unvalidated input.
        let column: String
        switch orderBy {
        case "frequency": column = "frequency"
        case "lastSeen", "last_seen": column = "last_seen"
        default: column = "confidence"
        }
        let localeClause = locale == nil ? "" : "WHERE locale = ?"
        let sql = """
            SELECT id, original_phonetic_key, original_variants, corrected_term, locale,
                   frequency, negative_feedback_count, confidence, last_seen, source
            FROM confusion_dictionary
            \(localeClause)
            ORDER BY \(column) DESC
            LIMIT ?
        """
        var rows: [ConfusionRow] = []
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
            sqlite3_finalize(stmt); return []
        }
        var idx: Int32 = 1
        if let locale { sqlite3_bind_text(stmt, idx, locale, -1, Self.SQLITE_TRANSIENT); idx += 1 }
        sqlite3_bind_int(stmt, idx, Int32(limit))
        while sqlite3_step(stmt) == SQLITE_ROW {
            rows.append(ConfusionRow(
                id: sqlite3_column_text(stmt, 0).map { String(cString: $0) } ?? "",
                phoneticKey: sqlite3_column_text(stmt, 1).map { String(cString: $0) } ?? "",
                variants: Self.decodeVariants(sqlite3_column_text(stmt, 2).map { String(cString: $0) } ?? "[]"),
                correctedTerm: sqlite3_column_text(stmt, 3).map { String(cString: $0) } ?? "",
                locale: sqlite3_column_text(stmt, 4).map { String(cString: $0) } ?? "",
                frequency: Int(sqlite3_column_int(stmt, 5)),
                negativeFeedbackCount: Int(sqlite3_column_int(stmt, 6)),
                confidence: sqlite3_column_double(stmt, 7),
                lastSeen: sqlite3_column_double(stmt, 8),
                source: sqlite3_column_text(stmt, 9).map { String(cString: $0) } ?? "asr_transcript"))
        }
        sqlite3_finalize(stmt)
        return rows
    }

    func allVocabulary(orderBy: String, limit: Int) -> [VocabularyRow] {
        guard let db else { return [] }
        let column = (orderBy == "lastSeen" || orderBy == "last_seen") ? "last_seen" : "frequency"
        let sql = """
            SELECT id, term, phonetic_key, locale, pos_tag, frequency, distinct_days,
                   background_rank, last_seen, source
            FROM typed_vocabulary
            ORDER BY \(column) DESC
            LIMIT ?
        """
        var rows: [VocabularyRow] = []
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
            sqlite3_finalize(stmt); return []
        }
        sqlite3_bind_int(stmt, 1, Int32(limit))
        while sqlite3_step(stmt) == SQLITE_ROW {
            let rank = sqlite3_column_type(stmt, 7) == SQLITE_NULL ? nil : Int(sqlite3_column_int(stmt, 7))
            rows.append(VocabularyRow(
                id: sqlite3_column_text(stmt, 0).map { String(cString: $0) } ?? "",
                term: sqlite3_column_text(stmt, 1).map { String(cString: $0) } ?? "",
                phoneticKey: sqlite3_column_text(stmt, 2).map { String(cString: $0) } ?? "",
                locale: sqlite3_column_text(stmt, 3).map { String(cString: $0) } ?? "",
                posTag: sqlite3_column_text(stmt, 4).map { String(cString: $0) },
                frequency: Int(sqlite3_column_int(stmt, 5)),
                distinctDays: Int(sqlite3_column_int(stmt, 6)),
                backgroundRank: rank,
                lastSeen: sqlite3_column_double(stmt, 8),
                source: sqlite3_column_text(stmt, 9).map { String(cString: $0) } ?? "typed"))
        }
        sqlite3_finalize(stmt)
        return rows
    }

    func rowCount(table: String) -> Int {
        guard let db else { return 0 }
        // Whitelisted table names only — never interpolate caller-supplied SQL.
        let allowed = ["confusion_dictionary", "typed_vocabulary", "correction_events"]
        guard allowed.contains(table) else { return 0 }
        var stmt: OpaquePointer?
        var count = 0
        if sqlite3_prepare_v2(db, "SELECT COUNT(*) FROM \(table)", -1, &stmt, nil) == SQLITE_OK,
           sqlite3_step(stmt) == SQLITE_ROW {
            count = Int(sqlite3_column_int(stmt, 0))
        }
        sqlite3_finalize(stmt)
        return count
    }

    func userVersion() -> Int32 {
        guard let db else { return -1 }
        var stmt: OpaquePointer?
        var v: Int32 = -1
        if sqlite3_prepare_v2(db, "PRAGMA user_version", -1, &stmt, nil) == SQLITE_OK,
           sqlite3_step(stmt) == SQLITE_ROW {
            v = sqlite3_column_int(stmt, 0)
        }
        sqlite3_finalize(stmt)
        return v
    }

    /// Whitelisted truncation for `debug.voiceCorrection.clearTable` and the user-facing
    /// "clear learning data" action (design §7).
    @discardableResult
    func clearTable(_ table: String) -> Bool {
        guard let db else { return false }
        let allowed = ["confusion_dictionary", "typed_vocabulary", "correction_events"]
        guard allowed.contains(table) else { return false }
        let rc = Self.exec(db: db, "DELETE FROM \(table)")
        logger.info("[VoiceCorrection][Cleanup] clearTable table=\(table) ok=\(rc == SQLITE_OK)")
        return rc == SQLITE_OK
    }

    func dbPath() -> String { dbURL.path }

    // MARK: - Helpers

    static func decodeVariants(_ json: String) -> [String] {
        guard let data = json.data(using: .utf8),
              let arr = try? JSONDecoder().decode([String].self, from: data) else { return [] }
        return arr
    }

    static func encodeVariants(_ variants: [String]) -> String {
        guard let data = try? JSONEncoder().encode(variants),
              let s = String(data: data, encoding: .utf8) else { return "[]" }
        return s
    }

    @discardableResult
    private static func exec(db: OpaquePointer, _ sql: String) -> Int32 {
        var err: UnsafeMutablePointer<CChar>?
        let rc = sqlite3_exec(db, sql, nil, nil, &err)
        if rc != SQLITE_OK {
            let msg = err.map { String(cString: $0) } ?? "unknown"
            logger.error("[VoiceCorrection] sqlite_exec failed (\(rc)): \(msg) — SQL: \(sql.prefix(120))")
            sqlite3_free(err)
        }
        return rc
    }

    private static let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
}

// MARK: - Row types

struct ConfusionRow: Sendable {
    let id: String
    let phoneticKey: String
    let variants: [String]
    let correctedTerm: String
    let locale: String
    let frequency: Int
    let negativeFeedbackCount: Int
    let confidence: Double
    let lastSeen: Double
    /// [T-text-input-correction-source] "asr_transcript" | "text_input".
    var source: String = "asr_transcript"
}

struct VocabularyRow: Sendable {
    let id: String
    let term: String
    let phoneticKey: String
    let locale: String
    let posTag: String?
    let frequency: Int
    let distinctDays: Int
    let backgroundRank: Int?
    let lastSeen: Double
    let source: String
}

enum VoiceCorrectionDBError: Error {
    case openFailed(path: String, code: Int32)
}
