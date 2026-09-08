package com.openminis.app.data

import android.content.Context
import com.openminis.app.data.repository.ChatRepository
import com.openminis.app.data.repository.SkillRepository
import com.openminis.app.logging.AppLogger
import java.io.File

/**
 * Clone a session (or its skill/memory artifacts) into a fresh local session.
 * Mirrors iOS `SessionForkManager`. Android MVP only implements the **local**
 * branch of the iOS API — `forkSession` (from iCloud-mirrored remote devices)
 * is deferred until we ship a cross-device sync layer; see spec §7.8.
 *
 * The returned session carries "(Copy)" suffix and entirely new message ids,
 * so the duplicate and its source are independent. Compact markers ARE cloned
 * (T-session-duplicate-compact-marker-android, iOS parity e8ac8b82) with their
 * message-id references remapped onto the duplicated messages, so the compact
 * divider/shadow is preserved on the copy.
 */
class SessionForkManager(
    private val chatRepository: ChatRepository,
    private val skillRepository: SkillRepository? = null,
    private val filesDir: File,
) {
    companion object {
        private const val TAG = "SessionForkManager"
    }

    /**
     * Deep-copy a local session: creates a new session with the same model id
     * and copies every message's payload. Returns the new session's id or
     * null if [sessionId] doesn't exist.
     *
     * Carries over user-meaningful session metadata so the duplicate looks
     * and behaves like the source:
     *   - `category` — drives the session-list icon + colour swatch (see
     *     SessionListScreen.categoryStyle). The bug that motivated this fix:
     *     a "Coding" session duplicated as a generic uncategorised chat with
     *     a default icon. iOS duplicateSession copies this too.
     *   - `modelBinding` — user-pinned model override; if the source session
     *     was pinned to a specific model, the copy should keep it pinned.
     *   - `memoryEnabled` — user-toggled per-session; expectation is that
     *     the copy inherits the source's memory setting rather than
     *     defaulting to on.
     *
     * Deliberately NOT copied (the duplicate is a new session at creation
     * time, not a clone of the source's lifecycle):
     *   - `pinnedAt` (the copy starts unpinned)
     *   - `source` (origin tag like "shortcut" — the copy was made via the
     *     duplicate button, not via the original entry point)
     *   - `editCount` (starts at 0)
     *   - `lastMessage` (createSession seeds it; refreshed by appendMessage)
     *   - `id` / `createdAt` / `updatedAt` (new identity, current timestamps)
     */
    suspend fun duplicateSession(sessionId: String): String? {
        val source = chatRepository.getSession(sessionId) ?: run {
            AppLogger.warning(TAG, "duplicateSession: $sessionId not found")
            return null
        }
        val messages = chatRepository.loadMessages(sessionId)
        val dupTitle = "${source.title ?: "Chat"} (Copy)"
        val new = chatRepository.createSession(
            modelId = source.modelId,
            title = dupTitle,
        )
        // Mirror iOS: carry over the source's category onto the copy so the
        // session-list icon + colour stay consistent with the original.
        if (source.category != null) {
            chatRepository.updateSessionTitleAndCategory(new.id, dupTitle, source.category)
        }
        // Carry over the user's per-session model binding (the "pinned model"
        // override) so duplicating a coding session pinned to GPT-5 stays
        // pinned to GPT-5 in the copy.
        if (source.modelBinding != null) {
            chatRepository.updateSessionBinding(new.id, source.modelBinding, source.modelId)
        }
        // Carry over the per-session memory toggle. Sessions default
        // memoryEnabled=1, so we only need to push the disabled state through;
        // the matching state is already in place from createSession.
        if (source.memoryEnabled == 0) {
            chatRepository.dao.updateMemoryEnabled(new.id, 0)
        }
        // T239: carry over the per-session thinking-mode override so a
        // duplicate of a "tuned to MEDIUM" session opens at MEDIUM rather
        // than reverting to the default (parity with memoryEnabled).
        source.thinkingOverride?.let { override ->
            chatRepository.dao.updateThinkingOverride(new.id, override)
        }
        // [T-session-duplicate-compact-marker-android] Track old→new message id
        // and old→new sort_order so copied compact markers (which reference DB
        // message ids + legacy sort_orders) can be remapped onto the freshly
        // minted duplicate messages. appendMessage returns the new MessageEntity
        // (id + sortOrder), so no re-query is needed. Aligns iOS e8ac8b82.
        val oldToNewId = HashMap<String, String>()
        val oldToNewSort = HashMap<String, Int>()
        for (msg in messages) {
            val newMsg = chatRepository.appendMessage(
                sessionId = new.id,
                role = msg.role,
                partsJson = msg.partsJson,
                tokenUsage = msg.tokenUsage,
                reasoningContent = msg.reasoningContent,
            )
            oldToNewId[msg.id] = newMsg.id
            oldToNewSort[msg.id] = newMsg.sortOrder
        }

        // [T-session-duplicate-compact-marker-android] Copy compact markers
        // AFTER all messages are appended (so the new sort_orders exist). A
        // session with zero markers makes this a clean no-op — the normal
        // duplicate path is untouched. Each marker is remapped independently so
        // multi-compact sessions copy all dividers, in created_at order
        // (listCompactMarkers returns ASC by created_at).
        val markers = chatRepository.dao.listCompactMarkers(sessionId)
        if (markers.isNotEmpty()) {
            // Remap a referenced message id through the copy map. null → null.
            fun remapId(id: String?): String? = id?.let { oldToNewId[it] }
            // Resolve a legacy sort_order fallback to the NEW message's
            // sort_order via the referenced id; keep the original when the id
            // is null or can't be resolved (legacy markers without ids).
            fun remapSort(messageId: String?, original: Int): Int =
                messageId?.let { oldToNewSort[it] } ?: original
            var copied = 0
            for (marker in markers) {
                // All source messages are copied, so every non-null id field
                // MUST resolve. If one doesn't, the source marker is already
                // dangling — skip it rather than write a dangling copy.
                val firstKeptNew = remapId(marker.firstKeptMessageId)
                val lastCompactedNew = remapId(marker.lastCompactedMessageId)
                val boundaryNew = remapId(marker.boundaryMessageId)
                if ((marker.firstKeptMessageId != null && firstKeptNew == null) ||
                    (marker.lastCompactedMessageId != null && lastCompactedNew == null) ||
                    (marker.boundaryMessageId != null && boundaryNew == null)
                ) {
                    AppLogger.warning(
                        TAG,
                        "duplicateSession: skipping compact marker ${marker.id} — a referenced message id is not in the copy map (dangling source marker)",
                    )
                    continue
                }
                val copy = marker.copy(
                    id = java.util.UUID.randomUUID().toString(),
                    sessionId = new.id,
                    firstKeptSortOrder = remapSort(marker.firstKeptMessageId, marker.firstKeptSortOrder),
                    uiBoundarySortOrder = marker.uiBoundarySortOrder?.let {
                        remapSort(marker.boundaryMessageId, it)
                    },
                    boundaryMessageId = boundaryNew,
                    firstKeptMessageId = firstKeptNew,
                    lastCompactedMessageId = lastCompactedNew,
                    // summary / compactedCount / createdAt / version verbatim.
                )
                chatRepository.dao.insertCompactMarker(copy)
                copied++
            }
            AppLogger.info(TAG, "duplicateSession: copied $copied/${markers.size} compact marker(s) to ${new.id}")
        }

        AppLogger.info(
            TAG,
            "duplicated session $sessionId → ${new.id} (${messages.size} msgs, " +
                "category=${source.category}, modelBinding=${source.modelBinding}, " +
                "memoryEnabled=${source.memoryEnabled})",
        )
        return new.id
    }

    /**
     * Clone a skill into the local library. When [skillRepository] is wired,
     * reuses `importFromContent` so the skill lands in DB + `SKILL.md` just
     * like a fresh import. Returns whether the import succeeded.
     */
    fun copySkill(content: String, source: SkillRepository.ImportSource = SkillRepository.ImportSource.FILE): Boolean {
        val repo = skillRepository ?: run {
            AppLogger.warning(TAG, "copySkill: SkillRepository not injected")
            return false
        }
        return repo.importFromContent(content, source) != null
    }

    /**
     * Persist a memory note (plain Markdown / text) under
     * `<filesDir>/minis-global/memory/<fileName>`. Mirrors iOS
     * `SessionForkManager.copyRemoteMemory` which writes under
     * `minisMemoryPersistentDir`. Overwrites if the file already exists.
     */
    fun copyMemory(fileName: String, content: String): Boolean {
        if (fileName.contains("/") || fileName.contains("..")) {
            AppLogger.warning(TAG, "copyMemory: rejecting unsafe fileName '$fileName'")
            return false
        }
        val dir = File(filesDir, "minis-global/memory").apply { mkdirs() }
        return try {
            File(dir, fileName).writeText(content)
            true
        } catch (e: Exception) {
            AppLogger.warning(TAG, "copyMemory: write failed: ${e.message}")
            false
        }
    }
}

/** Convenience: default-wire against application context. */
fun SessionForkManager(
    context: Context,
    chatRepository: ChatRepository,
    skillRepository: SkillRepository? = null,
): SessionForkManager = SessionForkManager(
    chatRepository = chatRepository,
    skillRepository = skillRepository,
    filesDir = context.filesDir,
)
