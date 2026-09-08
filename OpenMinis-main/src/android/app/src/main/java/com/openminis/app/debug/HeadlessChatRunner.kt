package com.openminis.app.debug

import android.content.Context
import androidx.lifecycle.ViewModelProvider
import com.openminis.app.MinisApp
import com.openminis.app.data.model.ThinkingLevel
import com.openminis.app.ui.chat.ChatViewModel
import com.openminis.app.ui.chat.ChatViewModelStore
import com.openminis.app.ui.chat.InputAttachment
import com.openminis.app.ui.chat.addAttachment
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Headless wrapper around [ChatViewModel] for the debug RPC layer.
 *
 * Issues:
 *  - [ChatViewModel] is bound to a [ViewModelStore] (so `viewModelScope` works
 *    and the streaming Job survives across collectors). The UI binds it to a
 *    NavBackStackEntry; we bind it to a process-scoped store so RPC-driven
 *    sessions survive across calls.
 *  - The runner caches one VM per sessionId so a follow-up `chat.prompt` on
 *    the same id reuses the same `viewModelScope` (no double-starts).
 *
 * Concurrency: [ChatViewModel.sendMessage] auto-enqueues if `_isStreaming` is
 * true, but we still serialize per-session via the cache: a second `wait=true`
 * on the same session can collect the same `isStreaming` Flow.
 */
internal object HeadlessChatRunner {

    /** sessionId → ViewModelProvider that owns its single ChatViewModel. */
    private val providers = mutableMapOf<String, ViewModelProvider>()

    private fun app(context: Context): MinisApp =
        context.applicationContext as? MinisApp
            ?: throw RPCException(-32000, "MinisApp not initialized")

    @Synchronized
    private fun providerFor(context: Context, sessionId: String): ViewModelProvider {
        val cached = providers[sessionId]
        if (cached != null) return cached
        val app = app(context)
        // Share the process-wide ChatViewModelStore so the in-flight VM (with
        // its live streamJob + _isStreaming) is the same instance the UI's
        // ChatScreen will bind to when the user opens this session. Using a
        // private ViewModelStore here split headless and UI into two VMs, so
        // "run now" started streaming on the headless VM while the UI's VM
        // saw only a static snapshot — no thinking indicator, no live text.
        val owner = ChatViewModelStore.ownerFor(sessionId)
        val provider = ViewModelProvider(
            owner,
            ChatViewModel.factory(
                sessionId = sessionId,
                chatRepository = app.chatRepository,
                providerRepository = app.providerRepository,
                appContext = app.applicationContext,
                memoryRepository = app.memoryRepository,
                skillRepository = app.skillRepository,
                mcpRepository = app.mcpRepository,
            ),
        )
        providers[sessionId] = provider
        return provider
    }

    private fun viewModel(context: Context, sessionId: String): ChatViewModel =
        providerFor(context, sessionId)[ChatViewModel::class.java]

    /**
     * Ensure a session exists in the DB before binding a ViewModel. Mirrors
     * the in-app flow that creates a draft session lazily; for RPC-driven
     * automation we materialize it eagerly so subsequent reads can resolve
     * the id.
     */
    suspend fun ensureSession(context: Context, modelId: String? = null): String =
        withContext(Dispatchers.IO) {
            val app = app(context)
            val resolvedModel = modelId
                ?: app.providerRepository.allVisibleEntries().firstOrNull()?.baseModel?.id
                ?: "unknown"
            val s = app.chatRepository.createSession(modelId = resolvedModel, title = null)
            // Mark source so the UI session list shows it came from RPC.
            app.chatRepository.dao.updateSource(s.id, "debug")
            s.id
        }

    /**
     * Apply a model-entry / model-group override to a session before send.
     * - `modelEntryId`: bind to a specific entry (`binding=entry`).
     * - `modelGroupId`: bind to a group (`binding=group`); the picker uses
     *   the group's routing strategy at chat time.
     * Returns the human-friendly `modelName` for the response.
     */
    suspend fun applyModelOverride(
        context: Context,
        sessionId: String,
        modelEntryId: String?,
        modelGroupId: String?,
    ): String? = withContext(Dispatchers.IO) {
        if (modelEntryId != null && modelGroupId != null) {
            throw RPCException(-32602, "modelEntryId and modelGroupId are mutually exclusive")
        }
        val app = app(context)
        val cfg = app.providerRepository.config.value
        // No explicit model → bind to the user's default primary group (the
        // `isDefault: true` group in provider.groups.list), matching the in-app
        // "new chat, no model picked" path (ChatViewModel priority-3 fallback on
        // providerRepository.defaultPrimaryGroupId). Without this the session
        // kept whatever model ensureSession seeded — the first visible provider
        // entry (e.g. OpenRouter's aion-labs/aion-3.0-mini) — not the default group.
        val resolvedGroupId = modelGroupId ?: run {
            if (modelEntryId != null) return@run null
            cfg.defaultPrimaryGroupId?.takeIf { gid -> cfg.modelGroups.any { it.id == gid } }
        }
        if (modelEntryId == null && resolvedGroupId == null) return@withContext null
        if (modelEntryId != null) {
            val entry = cfg.modelEntries.firstOrNull { it.id == modelEntryId }
                ?: throw RPCException(-32602, "Entry not found: $modelEntryId")
            val instance = cfg.instances.firstOrNull { it.id == entry.providerInstanceId }
                ?: throw RPCException(-32602, "Provider instance for entry not found")
            if (!instance.isEnabled) throw RPCException(-32602, "Provider instance is disabled")
            // The binding column stores a JSON object the VM parses in
            // restoreFromBinding (ChatViewModel: {"type":"entry","entryId":…}).
            // Writing the bare literal "entry" left restoreFromBinding unable to
            // resolve the entry, so activeEntryId never flipped non-null, the
            // headless provider-resolve wait timed out, and sendMessage
            // early-returned with no LLM request — RPC-driven sessions produced
            // a lone user message and no assistant turn.
            val binding = """{"type":"entry","entryId":"${entry.id}"}"""
            app.chatRepository.updateSessionBinding(sessionId, binding, entry.baseModel.id)
            return@withContext entry.model.displayName
        }
        // modelGroupId (explicit) or the default primary group (implicit fallback)
        val group = cfg.modelGroups.firstOrNull { it.id == resolvedGroupId }
            ?: throw RPCException(-32602, "Group not found: $resolvedGroupId")
        val firstMemberId = group.memberEntryIds.firstOrNull()
        val firstMember = firstMemberId?.let { mid -> cfg.modelEntries.firstOrNull { it.id == mid } }
        val resolvedModelId = firstMember?.baseModel?.id ?: ""
        // Same JSON-object shape the VM expects for a group binding.
        val groupBinding = """{"type":"group","groupId":"${group.id}"}"""
        app.chatRepository.updateSessionBinding(sessionId, groupBinding, resolvedModelId)
        return@withContext group.name
    }

    /**
     * Send a prompt into [sessionId]. When `wait` is true, suspend until
     * `isStreaming` flips back to false (or `timeoutMs` elapses) and return
     * the concatenated text of the last assistant message; otherwise return
     * immediately with `responseText=null`.
     */
    suspend fun prompt(
        context: Context,
        sessionId: String,
        text: String,
        attachments: List<InputAttachment> = emptyList(),
        thinkingLevel: ThinkingLevel? = null,
        wait: Boolean,
        timeoutMs: Long,
    ): PromptResult = withContext(Dispatchers.Main) {
        val vm = viewModel(context, sessionId)
        // Apply per-call thinking override BEFORE sendMessage so streamMessage
        // picks up the new level. Caller passes null to keep the VM's existing
        // setting (default OFF for a fresh VM, last user-set value otherwise).
        //
        // ChatViewModel.setThinkingLevel silently no-ops when the active model
        // hasn't resolved yet (currentModelSupportsReasoning checks
        // `currentModel?.supportsReasoning == true`, and `currentModel` is
        // populated on a viewModelScope coroutine). For a freshly-created VM
        // bound to a new session, the resolver may not have run by the time we
        // reach this line — wait until activeEntryId flips non-null so the
        // override actually applies.
        if (thinkingLevel != null) {
            // Wait off Main: ChatViewModel's init coroutine runs on viewModelScope
            // (Main.immediate), and Flow.first() suspends the calling dispatcher
            // until the value arrives. If we wait on Main here we deadlock — the
            // VM's loadSession() never gets to populate _activeEntryId. Hop to
            // Default for the wait, then come back to Main for setThinkingLevel.
            // setThinkingLevel itself silently no-ops on a model that doesn't
            // support reasoning — that gating is intentional UI parity, the
            // 3 s ceiling here just keeps us from blocking forever if the VM
            // never resolves a model (no provider configured, etc.).
            withContext(Dispatchers.Default) {
                withTimeoutOrNull(3000L) {
                    vm.activeEntryId.first { it != null }
                }
            }
            vm.setThinkingLevel(thinkingLevel)
        }
        // Wait for ChatViewModel.currentProvider to resolve before sendMessage.
        // The VM populates currentProvider on a viewModelScope (Main.immediate)
        // coroutine driven by providerRepository.config + the session's bound
        // entry. activeEntryId flips non-null in the SAME block that assigns
        // currentProvider (see ChatViewModel.kt ~L2030/2230/2265/2558), so we
        // use it as the readiness signal. Without this wait, sendMessage hits
        // its `currentProvider == null` early-return and the RPC returns
        // status:Completed responseText:null — the bug that blocked Step 2 e2e.
        //
        // Hop off Main for the wait: the VM's resolver runs on Main.immediate,
        // so suspending Main here would deadlock the resolver (same pattern as
        // the thinkingLevel wait above).
        val ready = withContext(Dispatchers.Default) {
            withTimeoutOrNull(5000L) {
                vm.activeEntryId.first { it != null }
            }
        }
        if (ready == null) {
            return@withContext PromptResult(
                status = "Error",
                responseText = "no_provider_resolved_in_5s",
                timedOut = false,
            )
        }
        for (att in attachments) vm.addAttachment(att)
        vm.sendMessage(text)
        if (!wait) return@withContext PromptResult(status = "Running", responseText = null, timedOut = false)

        // Wait for isStreaming to be false (sendMessage flips it true synchronously
        // before launching its coroutine; if it never flips true the message was
        // dropped — return immediately as Completed-but-empty).
        val started = vm.isStreaming.value
        if (!started) {
            // Either dropped (e.g. compacting in flight) or completed before we
            // returned to the suspension point — fall through to drain.
        }
        val finished = withTimeoutOrNull(timeoutMs) {
            // Skip the initial false (if we were called before sendMessage flipped true)
            if (vm.isStreaming.value) {
                // Wait for the next false transition.
                vm.isStreaming.first { !it }
            }
            true
        } ?: false

        // Best-effort: read the last assistant text from the DB so we don't
        // depend on the in-memory UI list (which may not have flushed yet).
        val app = app(context)
        val msgs = app.chatRepository.dao.loadMessages(sessionId)
        val lastAssistant = msgs.lastOrNull { it.role == "assistant" }
        val responseText = lastAssistant?.let { extractText(it.partsJson) }
        PromptResult(
            status = if (finished) "Completed" else "Timeout",
            responseText = responseText,
            timedOut = !finished,
        )
    }

    suspend fun retry(
        context: Context,
        sessionId: String,
        messageId: String?,
        wait: Boolean,
        timeoutMs: Long,
    ): PromptResult = withContext(Dispatchers.Main) {
        val app = app(context)
        val vm = viewModel(context, sessionId)
        val targetMsgId = messageId ?: run {
            val msgs = app.chatRepository.dao.loadMessages(sessionId)
            msgs.lastOrNull { it.role == "user" }?.id
                ?: throw RPCException(-32602, "Session has no user messages")
        }
        // Validate it points at a user message.
        val all = app.chatRepository.dao.loadMessages(sessionId)
        val target = all.firstOrNull { it.id == targetMsgId }
            ?: throw RPCException(-32602, "Message not found in session")
        if (target.role != "user") throw RPCException(-32602, "Target is not a user message")
        val deletedCount = all.size - all.indexOf(target) - 1

        // Same readiness gate as prompt() — retryFromMessage hits the same
        // currentProvider-null early-return if invoked before resolve.
        val ready = withContext(Dispatchers.Default) {
            withTimeoutOrNull(5000L) {
                vm.activeEntryId.first { it != null }
            }
        }
        if (ready == null) {
            return@withContext PromptResult(
                status = "Error",
                responseText = "no_provider_resolved_in_5s",
                timedOut = false,
                deletedMessageCount = deletedCount,
                retriedMessageId = targetMsgId,
            )
        }
        vm.retryFromMessage(targetMsgId)
        if (!wait) {
            return@withContext PromptResult(
                status = "Retrying",
                responseText = null,
                timedOut = false,
                deletedMessageCount = deletedCount,
                retriedMessageId = targetMsgId,
            )
        }
        val finished = withTimeoutOrNull(timeoutMs) {
            if (vm.isStreaming.value) {
                vm.isStreaming.first { !it }
            }
            true
        } ?: false
        val msgs = app.chatRepository.dao.loadMessages(sessionId)
        val lastAssistant = msgs.lastOrNull { it.role == "assistant" }
        val responseText = lastAssistant?.let { extractText(it.partsJson) }
        PromptResult(
            status = if (finished) "Completed" else "Timeout",
            responseText = responseText,
            timedOut = !finished,
            deletedMessageCount = deletedCount,
            retriedMessageId = targetMsgId,
        )
    }

    /**
     * [T-android-rerun-from-tool-block-position] Drive
     * [ChatViewModel.rerunFromToolBlock] headlessly so automation / e2e can
     * exercise the block-boundary re-run (the in-app trigger is a tool-bubble
     * long-press). [assistantMessageId] is the UI assistant bubble id and
     * [blockId] is the tool block's id (== its tool_use id). Returns the same
     * [PromptResult] shape as [retry]; `responseText` is the latest assistant
     * text after the re-run settles (when [wait]).
     */
    suspend fun rerunFromToolBlock(
        context: Context,
        sessionId: String,
        assistantMessageId: String,
        blockId: String,
        wait: Boolean,
        timeoutMs: Long,
    ): PromptResult = withContext(Dispatchers.Main) {
        val app = app(context)
        val vm = viewModel(context, sessionId)
        val ready = withContext(Dispatchers.Default) {
            withTimeoutOrNull(5000L) { vm.activeEntryId.first { it != null } }
        }
        if (ready == null) {
            return@withContext PromptResult(
                status = "Error",
                responseText = "no_provider_resolved_in_5s",
                timedOut = false,
                deletedMessageCount = 0,
                retriedMessageId = assistantMessageId,
            )
        }
        val before = app.chatRepository.dao.loadMessages(sessionId).size
        // The in-memory assistant bubble id is a volatile `assistant_<ts>`
        // runtime id, not the DB row id a harness reads from chat.messages.list.
        // Resolve the live bubble that owns this tool block; fall back to the
        // caller-supplied id (covers a freshly-reloaded session whose bubble id
        // IS the DB row id).
        val liveAssistantId = vm.assistantMessageIdForToolBlock(blockId) ?: assistantMessageId
        val accepted = vm.rerunFromToolBlock(liveAssistantId, blockId)
        if (!accepted) {
            return@withContext PromptResult(
                status = "Error",
                responseText = "rerun_rejected (streaming / not_found / not_tool_block)",
                timedOut = false,
                deletedMessageCount = 0,
                retriedMessageId = assistantMessageId,
            )
        }
        if (!wait) {
            return@withContext PromptResult(
                status = "Rerunning",
                responseText = null,
                timedOut = false,
                deletedMessageCount = 0,
                retriedMessageId = assistantMessageId,
            )
        }
        val finished = withTimeoutOrNull(timeoutMs) {
            if (vm.isStreaming.value) vm.isStreaming.first { !it }
            true
        } ?: false
        val msgs = app.chatRepository.dao.loadMessages(sessionId)
        val lastAssistant = msgs.lastOrNull { it.role == "assistant" }
        PromptResult(
            status = if (finished) "Completed" else "Timeout",
            responseText = lastAssistant?.let { extractText(it.partsJson) },
            timedOut = !finished,
            deletedMessageCount = (before - msgs.size).coerceAtLeast(0),
            retriedMessageId = assistantMessageId,
        )
    }

    /**
     * Trigger [ChatViewModel.runCompactNow] on the cached VM for [sessionId].
     * When [wait] is true, suspend until [ChatViewModel.isCompacting] flips
     * back to false (or [timeoutMs] elapses), then return the resulting
     * `summary` text alongside the timing flag.
     *
     * Behaviour parity with the in-app `/compact` slash command: if no turn
     * is in flight and history is non-empty, the VM emits a system-info
     * marker on completion. We do NOT surface that marker text — callers can
     * read `chat.messages.list` to see it. The `summary` returned here is
     * the freshly written compact_marker `summary` column.
     */
    suspend fun compact(
        context: Context,
        sessionId: String,
        wait: Boolean,
        timeoutMs: Long,
        messageId: String? = null,
        includesBoundary: Boolean = true,
    ): CompactResult = withContext(Dispatchers.Main) {
        val vm = viewModel(context, sessionId)
        // Same readiness wait as prompt(): compactAll() needs currentProvider
        // resolved before it can call provider.sendMessage for the summary.
        val ready = withContext(Dispatchers.Default) {
            withTimeoutOrNull(5000L) {
                vm.activeEntryId.first { it != null }
            }
        }
        if (ready == null) {
            return@withContext CompactResult(
                status = "Error",
                summary = null,
                timedOut = false,
                error = "no_provider_resolved_in_5s",
            )
        }
        if (vm.isStreaming.value) {
            return@withContext CompactResult(
                status = "Error",
                summary = null,
                timedOut = false,
                error = "stream_in_progress",
            )
        }
        if (vm.isCompacting.value) {
            return@withContext CompactResult(
                status = "Error",
                summary = null,
                timedOut = false,
                error = "compact_already_in_progress",
            )
        }
        // Snapshot prior summary so we can detect a no-op (e.g. nothing-to-
        // compact branch appends a system-info but leaves _compactSummary
        // untouched, never flipping _isCompacting true).
        val priorSummary = vm.compactSummary.value
        if (messageId != null) {
            vm.compactBefore(messageId, includesBoundary)
        } else {
            vm.runCompactNow()
        }
        if (!wait) {
            return@withContext CompactResult(
                status = "Running",
                summary = null,
                timedOut = false,
                error = null,
            )
        }
        // Wait for _isCompacting to flip true → false. If runCompactNow
        // early-returned (nothing to compact, no provider, etc.) it never
        // flipped true at all — give it a short grace window then bail.
        val flippedOn = withContext(Dispatchers.Default) {
            withTimeoutOrNull(2000L) {
                if (!vm.isCompacting.value) vm.isCompacting.first { it }
                true
            }
        }
        if (flippedOn != true) {
            return@withContext CompactResult(
                status = "NoOp",
                summary = vm.compactSummary.value,
                timedOut = false,
                error = "compact_skipped_no_change",
            )
        }
        val finished = withContext(Dispatchers.Default) {
            withTimeoutOrNull(timeoutMs) {
                vm.isCompacting.first { !it }
                true
            } ?: false
        }
        val newSummary = vm.compactSummary.value
        val changed = newSummary != priorSummary && !newSummary.isNullOrBlank()
        CompactResult(
            status = when {
                !finished -> "Timeout"
                changed -> "Completed"
                else -> "Completed"   // marker may have written even if string equal
            },
            summary = newSummary,
            timedOut = !finished,
            error = null,
        )
    }

    /**
     * Drive [ChatViewModel.revertCompact] on the cached VM. Returns when the
     * VM has finished the synchronous DB write — revert isn't gated by a
     * coroutine the way compact is.
     */
    suspend fun revertCompact(context: Context, sessionId: String) = withContext(Dispatchers.Main) {
        val vm = viewModel(context, sessionId)
        val ready = withContext(Dispatchers.Default) {
            withTimeoutOrNull(5000L) {
                vm.activeEntryId.first { it != null }
            }
        }
        if (ready == null) throw RPCException(-32000, "Session VM did not resolve a provider within 5s")
        vm.revertCompact()
    }

    suspend fun cancel(context: Context, sessionId: String): Boolean = withContext(Dispatchers.Main) {
        val cached = providers[sessionId] ?: return@withContext false
        val vm = cached[ChatViewModel::class.java]
        val wasRunning = vm.isStreaming.value
        if (wasRunning) vm.cancelStream()
        wasRunning
    }

    /**
     * [T-android-thinking-level-arch] Switch the LIVE session's bound model
     * mid-session — exactly what the in-app model picker does, by calling the
     * same [ChatViewModel.selectEntry]. Unlike passing a fresh `modelEntryId` to
     * chat.prompt (which only rewrites the DB binding and is ignored by the
     * already-loaded cached VM), this re-resolves `currentModel`/`currentProvider`
     * on the live VM. selectEntry deliberately leaves the thinking level
     * untouched, so this is the seam for verifying cross-model thinking-level
     * transfer. Returns (resolved model displayName, current thinking level
     * name) so callers can assert the transfer without a second round-trip.
     */
    suspend fun selectModel(context: Context, sessionId: String, entryId: String):
        Pair<String, String> = withContext(Dispatchers.Main) {
        val vm = viewModel(context, sessionId)
        vm.selectEntry(entryId)
        // selectEntry sets currentModel/_modelName synchronously.
        vm.modelName.value to vm.thinkingLevel.value.name
    }

    /** Drop the cached ViewModel for [sessionId] (used after delete). */
    @Synchronized
    fun forget(sessionId: String) {
        providers.remove(sessionId)
    }

    private fun extractText(partsJson: String): String? {
        return try {
            val arr = org.json.JSONArray(partsJson)
            val sb = StringBuilder()
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                if (o.optString("type") == "text") sb.append(o.optString("value", ""))
            }
            sb.toString().ifEmpty { null }
        } catch (_: Exception) { partsJson.ifEmpty { null } }
    }

    data class PromptResult(
        val status: String,
        val responseText: String?,
        val timedOut: Boolean,
        val deletedMessageCount: Int = 0,
        val retriedMessageId: String? = null,
    )

    data class CompactResult(
        val status: String,
        val summary: String?,
        val timedOut: Boolean,
        val error: String?,
    )
}
