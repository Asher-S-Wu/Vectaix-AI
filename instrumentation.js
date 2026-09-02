const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
const VIDEO_RECONCILE_INTERVAL_MS = 15 * 1000;
const MEDIAKIT_RECONCILE_INTERVAL_MS = 15 * 1000;
const MEDIAKIT_DELETION_RECONCILE_INTERVAL_MS = 15 * 1000;
const CREDIT_RECONCILE_INTERVAL_MS = 60 * 1000;

function safeErrorDetails(error) {
  const errorType = /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(error?.name || "")
    ? error.name
    : "Error";
  const code = /^[A-Z][A-Z0-9_]{0,63}$/.test(error?.code || "")
    ? error.code
    : "INTERNAL_ERROR";
  return { errorType, code };
}

function reportLegacyCleanupState(result) {
  if (!result || result.complete) return;
  console.warn("[Legacy Identity] cleanup pending", {
    pendingUsers: result.pendingUsers,
    activeUsers: result.activeUsers,
    deferredUsers: result.deferredUsers,
    deferredErrorCodes: result.deferredErrorCodes,
  });
}

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (globalThis.__vectaixStorageCleanupStarted) return;
  globalThis.__vectaixStorageCleanupStarted = true;

  try {
    // 先只加载无自动建索引副作用的管理员校验依赖，再打开其他模型。
    const [
      { default: dbConnect },
      { verifyConfiguredAdminAccounts },
    ] = await Promise.all([
      import("@/lib/db"),
      import("@/lib/admin"),
    ]);
    await dbConnect();
    await verifyConfiguredAdminAccounts();

    const [
      {
        cleanupExpiredTemporaryFiles,
        cleanupOrphanedStorageFiles,
        ensureStorageReady,
      },
      { cleanupExpiredAudioSourceUploads },
      { cleanupExpiredVoiceSamples },
      { reconcileHappyHorseVideoTasks },
      { ensureHappyHorseVideoTaskIndexes },
      { reconcileMediaKitVideoEnhancementTasks },
      { reconcileMediaKitVideoEnhancementTaskDeletions },
      { ensureVideoEnhancementTaskIndexes },
      { ensureMediaKitUploadTicketIndexes },
      { removeLegacyGuestData },
      { ensureUserIndexes },
      { ensureSessionIndexes },
      { runCreditMigration, reconcileUninitializedUserCredits },
      { reconcileCreditTransactions },
      { reconcileMinimaxUnlockClaims },
      { reconcileMinimaxVoiceCleanup },
      { ensureMinimaxVoiceIndexes },
      { reconcileResolvedMediaTaskBilling },
    ] = await Promise.all([
      import("@/lib/server/storage/service"),
      import("@/lib/media/server/audioSourceUploads"),
      import("@/lib/media/server/voiceSampleCleanup"),
      import("@/lib/media/server/happyhorse/reconciler"),
      import("@/models/VideoGenerationTask"),
      import("@/lib/media/server/mediaKit/reconciler"),
      import("@/lib/media/server/mediaKit/taskDeletion"),
      import("@/models/VideoEnhancementTask"),
      import("@/models/MediaKitUploadTicket"),
      import("@/lib/server/users/legacyIdentityCleanup"),
      import("@/models/User"),
      import("@/models/Session"),
      import("@/lib/server/credits/migration"),
      import("@/lib/server/credits/service"),
      import("@/lib/media/server/minimaxUnlockClaims"),
      import("@/lib/media/server/minimaxVoiceCleanup"),
      import("@/models/MinimaxVoice"),
      import("@/lib/media/server/billing"),
    ]);
    const legacyCleanup = await removeLegacyGuestData();
    reportLegacyCleanupState(legacyCleanup);
    if (legacyCleanup.complete) await ensureUserIndexes();
    await ensureSessionIndexes();
    await runCreditMigration();
    await reconcileCreditTransactions();
    await reconcileMinimaxUnlockClaims();
    await Promise.all([
      ensureHappyHorseVideoTaskIndexes(),
      ensureVideoEnhancementTaskIndexes(),
      ensureMediaKitUploadTicketIndexes(),
      ensureMinimaxVoiceIndexes(),
    ]);
    await reconcileResolvedMediaTaskBilling();
    await ensureStorageReady();
    await reconcileMinimaxVoiceCleanup();
    await Promise.all([
      cleanupExpiredTemporaryFiles(),
      cleanupOrphanedStorageFiles(),
      cleanupExpiredAudioSourceUploads(),
      cleanupExpiredVoiceSamples(),
    ]);

    let cleanupRunning = false;
    const cleanup = async () => {
      if (cleanupRunning) return;
      cleanupRunning = true;
      try {
        await dbConnect();
        await ensureStorageReady();
        await Promise.all([
          cleanupExpiredTemporaryFiles(),
          cleanupOrphanedStorageFiles(),
          cleanupExpiredAudioSourceUploads(),
          cleanupExpiredVoiceSamples(),
        ]);
      } catch (error) {
        console.error("[Storage] scheduled cleanup:", safeErrorDetails(error));
      } finally {
        cleanupRunning = false;
      }
    };
    const timer = setInterval(cleanup, CLEANUP_INTERVAL_MS);
    timer.unref?.();

    let videoReconcileRunning = false;
    const reconcileVideos = async () => {
      if (videoReconcileRunning) return;
      videoReconcileRunning = true;
      try {
        await reconcileHappyHorseVideoTasks();
      } catch (error) {
        console.error("[Media Video] scheduled reconcile:", error);
      } finally {
        videoReconcileRunning = false;
      }
    };
    const initialVideoReconcile = setTimeout(reconcileVideos, 0);
    initialVideoReconcile.unref?.();
    const videoTimer = setInterval(reconcileVideos, VIDEO_RECONCILE_INTERVAL_MS);
    videoTimer.unref?.();

    let mediaKitReconcileRunning = false;
    const reconcileMediaKitTasks = async () => {
      if (mediaKitReconcileRunning) return;
      mediaKitReconcileRunning = true;
      try {
        await reconcileMediaKitVideoEnhancementTasks();
      } catch (error) {
        console.error(
          "[AI MediaKit] scheduled reconcile failed",
          safeErrorDetails(error),
        );
      } finally {
        mediaKitReconcileRunning = false;
      }
    };
    const initialMediaKitReconcile = setTimeout(reconcileMediaKitTasks, 0);
    initialMediaKitReconcile.unref?.();
    const mediaKitTimer = setInterval(
      reconcileMediaKitTasks,
      MEDIAKIT_RECONCILE_INTERVAL_MS,
    );
    mediaKitTimer.unref?.();

    let mediaKitDeletionReconcileRunning = false;
    const reconcileMediaKitTaskDeletions = async () => {
      if (mediaKitDeletionReconcileRunning) return;
      mediaKitDeletionReconcileRunning = true;
      try {
        await reconcileMediaKitVideoEnhancementTaskDeletions();
      } catch (error) {
        console.error(
          "[AI MediaKit] scheduled deletion reconcile failed",
          safeErrorDetails(error),
        );
      } finally {
        mediaKitDeletionReconcileRunning = false;
      }
    };
    const initialMediaKitDeletionReconcile = setTimeout(
      reconcileMediaKitTaskDeletions,
      0,
    );
    initialMediaKitDeletionReconcile.unref?.();
    const mediaKitDeletionTimer = setInterval(
      reconcileMediaKitTaskDeletions,
      MEDIAKIT_DELETION_RECONCILE_INTERVAL_MS,
    );
    mediaKitDeletionTimer.unref?.();

    let creditReconcileRunning = false;
    const reconcileCredits = async () => {
      if (creditReconcileRunning) return;
      creditReconcileRunning = true;
      try {
        const legacyCleanup = await removeLegacyGuestData();
        reportLegacyCleanupState(legacyCleanup);
        if (legacyCleanup.complete) {
          await ensureUserIndexes();
          await ensureSessionIndexes();
        }
        await reconcileUninitializedUserCredits();
        await reconcileCreditTransactions();
        await reconcileMinimaxUnlockClaims();
        await reconcileMinimaxVoiceCleanup();
        await reconcileResolvedMediaTaskBilling();
      } catch (error) {
        console.error("[Credits] scheduled reconcile:", safeErrorDetails(error));
      } finally {
        creditReconcileRunning = false;
      }
    };
    const creditTimer = setInterval(reconcileCredits, CREDIT_RECONCILE_INTERVAL_MS);
    creditTimer.unref?.();
  } catch (error) {
    delete globalThis.__vectaixStorageCleanupStarted;
    throw error;
  }
}
