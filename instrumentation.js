const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
const VIDEO_RECONCILE_INTERVAL_MS = 15 * 1000;
const MEDIAKIT_RECONCILE_INTERVAL_MS = 15 * 1000;

function safeErrorDetails(error) {
  const errorType = /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(error?.name || "")
    ? error.name
    : "Error";
  const code = /^[A-Z][A-Z0-9_]{0,63}$/.test(error?.code || "")
    ? error.code
    : "INTERNAL_ERROR";
  return { errorType, code };
}

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (globalThis.__vectaixStorageCleanupStarted) return;
  globalThis.__vectaixStorageCleanupStarted = true;

  try {
    const [
      { default: dbConnect },
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
      { ensureVideoEnhancementTaskIndexes },
      { ensureMediaKitUploadTicketIndexes },
    ] = await Promise.all([
      import("@/lib/db"),
      import("@/lib/server/storage/service"),
      import("@/lib/media/server/audioSourceUploads"),
      import("@/lib/media/server/voiceSampleCleanup"),
      import("@/lib/media/server/happyhorse/reconciler"),
      import("@/models/VideoGenerationTask"),
      import("@/lib/media/server/mediaKit/reconciler"),
      import("@/models/VideoEnhancementTask"),
      import("@/models/MediaKitUploadTicket"),
    ]);
    await dbConnect();
    await Promise.all([
      ensureHappyHorseVideoTaskIndexes(),
      ensureVideoEnhancementTaskIndexes(),
      ensureMediaKitUploadTicketIndexes(),
    ]);
    await ensureStorageReady();
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
  } catch (error) {
    delete globalThis.__vectaixStorageCleanupStarted;
    throw error;
  }
}
