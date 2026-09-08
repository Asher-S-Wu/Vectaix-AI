package com.openminis.app.data

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.UUID

/**
 * @-mention file index for the chat composer. Mirrors iOS `FileMentionIndex`:
 * a 3-layer scanner that publishes candidates to the UI **as each layer
 * finishes** so the user sees session-local files immediately, then shared
 * roots, then (if mounts are attached) external mounts.
 *
 * ### Layers
 *   1. **Session roots** — `workspace/<sid>` + `attachments/<sid>`.
 *   2. **Shared roots** — `shared/`, `skills/`, `memory/`.
 *   3. **Mount roots** — each entry in [mountsProvider] (e.g. SAF-attached
 *      folders). Each mount always gets a self-entry so `@<mountName>` works.
 *
 * ### Scoring (for [matches])
 *   - basename equals query → 1000
 *   - basename starts with query → 800
 *   - basename contains query → 600
 *   - any path component contains → 400
 *   - full path contains → 200
 *   - else → filtered out
 *
 * Adjustments: `.mount` scope loses 10 points (prefer session-local), top-level
 * scope roots gain 50 points. Ties broken by `modifiedAt` descending, capped
 * at [DEFAULT_MATCH_LIMIT].
 */
class FileMentionIndex(
    private val filesDir: File,
    private val mountsProvider: () -> List<MountEntry> = { emptyList() },
    private val cacheTtlMs: Long = DEFAULT_CACHE_TTL_MS,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO),
) {
    constructor(context: Context) : this(File(context.filesDir, "minis-global"))

    /**
     * Scope priorities — `order` doubles as the empty-query default sort key
     * (lower wins) AND drives `rankBoost`'s scope tiebreaker on top of the
     * name-match score. The case order here mirrors the iOS counterpart in
     * `FileMentionIndex.swift`:
     *   skills > attachments > mount > shared > workspace > memory.
     *
     * `rankBoost` is added to the per-name score with a max delta (600) that
     * is smaller than the gap between adjacent name-match tiers (1000), so a
     * stronger name match in *any* scope still beats a weak match in a
     * higher-priority scope.
     */
    enum class Scope(val displayLabel: String, val order: Int, val rankBoost: Int) {
        SKILLS("skills", 0, 600),
        ATTACHMENTS("attachments", 1, 500),
        MOUNT("mount", 2, 400),
        SHARED("shared", 3, 300),
        WORKSPACE("workspace", 4, 200),
        MEMORY("memory", 5, 100),
    }

    data class MountEntry(val name: String, val root: File)

    data class Entry(
        /** Linux-visible path (what gets inserted into the composer). */
        val linuxPath: String,
        val scope: Scope,
        val mountName: String?,
        val modifiedAt: Long,
        val isDirectory: Boolean,
    ) {
        val basename: String get() = linuxPath.substringAfterLast('/').ifEmpty { linuxPath }
        val displayPath: String get() = linuxPath.removePrefix("/var/minis/")
    }

    private val _entries = MutableStateFlow<List<Entry>>(emptyList())
    val entries: StateFlow<List<Entry>> = _entries.asStateFlow()

    private val _isScanning = MutableStateFlow(false)
    val isScanning: StateFlow<Boolean> = _isScanning.asStateFlow()

    private var lastScanSessionId: String? = null
    private var lastScanAt: Long = 0
    private var currentScanToken: UUID = UUID.randomUUID()
    private var currentJob: Job? = null

    /** Rescan if the session changed or the cache went stale. Idempotent. */
    fun refreshIfNeeded(sessionId: String) {
        val now = System.currentTimeMillis()
        val sameSession = lastScanSessionId == sessionId
        val fresh = now - lastScanAt < cacheTtlMs
        if (sameSession && fresh && _entries.value.isNotEmpty()) return

        lastScanSessionId = sessionId
        lastScanAt = now
        val token = UUID.randomUUID()
        currentScanToken = token
        currentJob?.cancel()
        currentJob = scope.launch { scan(sessionId, token) }
    }

    /** Force a rescan regardless of cache. */
    fun refresh(sessionId: String) {
        lastScanAt = 0
        refreshIfNeeded(sessionId)
    }

    private suspend fun scan(sessionId: String, token: UUID) {
        _isScanning.value = true
        val collected = mutableListOf<Entry>()
        try {
            // Layer 1: session-local roots.
            layerEntries(
                sessionId = sessionId,
                layers = listOf(
                    File(filesDir, "workspace/$sessionId") to Scope.WORKSPACE,
                    File(filesDir, "attachments/$sessionId") to Scope.ATTACHMENTS,
                ),
                linuxRootFor = { scope -> "/var/minis/${scope.displayLabel}/$sessionId" },
            ).let { newBatch ->
                collected += newBatch
                publish(token, collected)
            }

            // Layer 2: shared roots.
            layerEntries(
                sessionId = sessionId,
                layers = listOf(
                    File(filesDir, "shared") to Scope.SHARED,
                    File(filesDir, "skills") to Scope.SKILLS,
                    File(filesDir, "memory") to Scope.MEMORY,
                ),
                linuxRootFor = { scope -> "/var/minis/${scope.displayLabel}" },
            ).let { newBatch ->
                collected += newBatch
                publish(token, collected)
            }

            // Layer 3: mounts (each published individually so one slow mount
            // doesn't block the rest).
            var budget = GLOBAL_SCAN_BUDGET - collected.size
            for (mount in mountsProvider()) {
                if (currentScanToken != token) return
                // T219: align with PRoot bind path + iOS prompt wording.
                // Each mount lives under /var/minis/mounts/<name> inside the
                // sandbox; inserting that exact path keeps the agent's mental
                // model coherent across @-mention, prompt copy, and shell.
                val mountLinuxRoot = "/var/minis/mounts/${mount.name}"
                // Always inject the mount root so `@<name>` works even when budget is gone.
                collected += Entry(
                    linuxPath = mountLinuxRoot,
                    scope = Scope.MOUNT,
                    mountName = mount.name,
                    modifiedAt = mount.root.lastModified(),
                    isDirectory = true,
                )
                if (budget > 0) {
                    val mountBatch = scanDir(
                        root = mount.root,
                        linuxRoot = mountLinuxRoot,
                        scope = Scope.MOUNT,
                        mountName = mount.name,
                        maxDepth = MOUNT_SCAN_MAX_DEPTH,
                        budget = budget,
                    )
                    collected += mountBatch
                    budget -= mountBatch.size
                }
                publish(token, collected)
            }
        } finally {
            _isScanning.value = false
        }
    }

    private fun layerEntries(
        sessionId: String,
        layers: List<Pair<File, Scope>>,
        linuxRootFor: (Scope) -> String,
    ): List<Entry> {
        val out = mutableListOf<Entry>()
        for ((dir, scope) in layers) {
            if (!dir.isDirectory) continue
            val linuxRoot = linuxRootFor(scope)
            // Always include the root itself so `@workspace` / `@shared` can be referenced.
            out += Entry(
                linuxPath = linuxRoot,
                scope = scope,
                mountName = null,
                modifiedAt = dir.lastModified(),
                isDirectory = true,
            )
            out += scanDir(
                root = dir,
                linuxRoot = linuxRoot,
                scope = scope,
                mountName = null,
                maxDepth = Int.MAX_VALUE,
                budget = GLOBAL_SCAN_BUDGET,
            )
        }
        return out
    }

    private fun scanDir(
        root: File,
        linuxRoot: String,
        scope: Scope,
        mountName: String?,
        maxDepth: Int,
        budget: Int,
    ): List<Entry> {
        val out = ArrayList<Entry>()
        val rootPath = root.absolutePath
        val queue = ArrayDeque<Pair<File, Int>>()
        queue.addLast(root to 0)
        while (queue.isNotEmpty() && out.size < budget) {
            val (dir, depth) = queue.removeFirst()
            if (depth > maxDepth) continue
            val children = dir.listFiles() ?: continue
            for (child in children) {
                if (out.size >= budget) break
                if (child.name.startsWith(".")) continue
                if (child.isDirectory && child.name in SKIP_DIR_NAMES) continue
                val relative = child.absolutePath.removePrefix(rootPath).removePrefix("/")
                if (relative.isEmpty()) continue
                val linuxPath = "$linuxRoot/$relative"
                out += Entry(
                    linuxPath = linuxPath,
                    scope = scope,
                    mountName = mountName,
                    modifiedAt = child.lastModified(),
                    isDirectory = child.isDirectory,
                )
                if (child.isDirectory && depth + 1 <= maxDepth) {
                    queue.addLast(child to depth + 1)
                }
            }
        }
        return out
    }

    private suspend fun publish(token: UUID, collected: List<Entry>) {
        if (currentScanToken != token) return
        // Deduplicate by linuxPath (later scans may revisit) and sort per defaultOrdering.
        val deduped = collected.associateBy { it.linuxPath }.values
        val sorted = deduped.sortedWith(defaultOrdering)
        withContext(Dispatchers.Main) {
            if (currentScanToken != token) return@withContext
            _entries.value = sorted
        }
    }

    /**
     * Rank entries against [query]. Empty query returns the freshest entries
     * in `defaultOrdering` (already applied to `_entries.value`).
     *
     * Score components (added together, biggest first):
     *   • name-match tier (0 / 1000 … 10000) — drives the primary order
     *   • Scope.rankBoost (0–600) — secondary preference between scopes
     *   • top-level scope-root bonus (0 / 50) — keeps a whole skill or
     *     mount above its children
     *   • recency micro-bonus (0–80) — newer wins on otherwise-equal items
     *
     * The smallest gap between adjacent name tiers (1000) is greater than
     * the maximum sum of all secondary signals (600 + 50 + 80 = 730), so a
     * stronger name match always wins regardless of scope.
     */
    fun matches(query: String, limit: Int = DEFAULT_MATCH_LIMIT): List<Entry> {
        val all = _entries.value
        if (query.isBlank()) return all.take(limit)
        val q = query.lowercase()

        val now = System.currentTimeMillis()
        val recencyDayCapMs: Long = 56L * 24 * 60 * 60 * 1000 // 8 weeks → 0..80

        val scored = mutableListOf<Pair<Int, Entry>>()
        for (entry in all) {
            val base = entry.basename.lowercase()
            val path = entry.linuxPath.lowercase()
            val stem = base.substringBeforeLast('.', missingDelimiterValue = base)

            // Tier-based name match — pick the strongest applicable tier.
            val nameScore = when {
                base == q -> 10_000                                        // exact full name
                stem.isNotEmpty() && stem == q -> 9_000                    // exact stem (basename minus ext)
                base.startsWith(q) -> 7_000                                // prefix match
                basenameWordBoundaryContains(base, q) -> 6_000             // word-boundary contains
                q in base -> 4_000                                         // generic contains in basename
                anyPathComponentMatches(path, q) -> 2_000                  // ancestor directory contains
                q in path -> 1_000                                         // anywhere in full path
                else -> 0
            }
            if (nameScore == 0) continue

            // Scope priority (max 600 — well below the 1000 tier gap).
            val scopeScore = entry.scope.rankBoost

            // Top-level scope-root bonus: typing `@codex` should surface the
            // whole `skills/codex-image` directory above its children.
            val topLevelBonus = if (isTopLevelScopeRoot(entry)) 50 else 0

            // Recency micro-bonus (≤ 80). Linear decay over 8 weeks.
            val ageMs = (now - entry.modifiedAt).coerceAtLeast(0L)
            val recencyBonus = (80.0 *
                (1.0 - (ageMs.toDouble() / recencyDayCapMs.toDouble()).coerceIn(0.0, 1.0)))
                .toInt()
                .coerceAtLeast(0)

            scored += (nameScore + scopeScore + topLevelBonus + recencyBonus) to entry
        }
        return scored
            .sortedWith(
                compareByDescending<Pair<Int, Entry>> { it.first }
                    // Tiebreak: prefer higher-priority scope, then fresher,
                    // then shorter path (a "closer" file).
                    .thenBy { it.second.scope.order }
                    .thenByDescending { it.second.modifiedAt }
                    .thenBy { it.second.linuxPath.length }
            )
            .take(limit)
            .map { it.second }
    }

    /**
     * Word-boundary substring match for the basename. Returns true if
     * `query` appears at the start of a word fragment delimited by
     * `_`, `-`, ` `, `.`, `/` (e.g. matches `parser` in `markdown_parser.py`,
     * `web` in `image-web-search.md`). Helps elevate the kind of partial
     * match users intuitively expect over arbitrary-position substrings.
     */
    private fun basenameWordBoundaryContains(base: String, query: String): Boolean {
        if (query.isEmpty() || base.isEmpty()) return false
        val separators = setOf('_', '-', ' ', '.', '/')
        var i = 0
        while (i < base.length) {
            if (base.startsWith(query, startIndex = i)) return true
            // Advance to the next word boundary.
            val sep = (i until base.length).firstOrNull { separators.contains(base[it]) }
                ?: return false
            i = sep + 1
        }
        return false
    }

    /**
     * Substring search across path components — the same path may match
     * even when the basename doesn't (e.g. typing `@mounts` finds files
     * inside `/var/minis/mounts/...`).
     */
    private fun anyPathComponentMatches(path: String, query: String): Boolean {
        return path.split('/').any { it.contains(query) }
    }

    /**
     * Is this entry the immediate child of a scope root? e.g.
     * `/var/minis/skills/foo`, `/var/minis/mounts/bar`,
     * `/var/minis/shared/baz`. These first-class `@`-targets get a +50
     * ranking bonus so typing `@foo` surfaces the whole skill directory
     * above its individual files (mirrors iOS).
     */
    private fun isTopLevelScopeRoot(entry: Entry): Boolean {
        if (!entry.isDirectory) return false
        val tops = listOf(
            "/var/minis/skills/",
            "/var/minis/mounts/",
            "/var/minis/shared/",
        )
        for (top in tops) {
            if (entry.linuxPath.startsWith(top)) {
                val rest = entry.linuxPath.removePrefix(top)
                // First-level child only — must not contain a further '/'.
                return rest.isNotEmpty() && '/' !in rest
            }
        }
        return false
    }

    private val defaultOrdering: Comparator<Entry> = compareBy<Entry> { it.scope.order }
        .thenByDescending { isTopLevelScopeRoot(it) }
        .thenBy { it.isDirectory }
        .thenByDescending { it.modifiedAt }

    companion object {
        const val DEFAULT_CACHE_TTL_MS = 10L * 60 * 1000
        const val DEFAULT_MATCH_LIMIT = 100
        const val GLOBAL_SCAN_BUDGET = 5000
        const val MOUNT_SCAN_MAX_DEPTH = 3

        private val SKIP_DIR_NAMES = setOf(
            ".git", ".svn", ".hg",
            "node_modules", ".venv", "venv", "__pycache__",
            ".build", ".gradle", ".idea", ".tox",
            ".mypy_cache", ".pytest_cache", ".ruff_cache",
        )
    }
}
