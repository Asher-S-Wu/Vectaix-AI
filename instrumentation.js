const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
const VIDEO_RECONCILE_INTERVAL_MS = 15 * 1000;

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (globalThis.__vectaixStorageCleanupStarted) return;
  globalThis.__vectaixStorageCleanupStarted = true;

  try {
    const [
      { default: dbConnect },
      { cleanupExpiredTemporaryFiles, ensureStorageReady },
      { cleanupExpiredAudioSourceUploads },
      { cleanupExpiredVoiceSamples },
      { reconcileHappyHorseVideoTasks },
      { ensureHappyHorseVideoTaskIndexes },
    ] = await Promise.all([
      import("@/lib/db"),
      import("@/lib/server/storage/service"),
      import("@/lib/media/server/audioSourceUploads"),
      import("@/lib/media/server/voiceSampleCleanup"),
      import("@/lib/media/server/happyhorse/reconciler"),
      import("@/models/VideoGenerationTask"),
    ]);
    await dbConnect();
    await ensureHappyHorseVideoTaskIndexes();
    await ensureStorageReady();
    await Promise.all([
      cleanupExpiredTemporaryFiles(),
      cleanupExpiredAudioSourceUploads(),
      cleanupExpiredVoiceSamples(),
    ]);

    const cleanup = async () => {
      try {
        await dbConnect();
        await ensureStorageReady();
        await Promise.all([
          cleanupExpiredTemporaryFiles(),
          cleanupExpiredAudioSourceUploads(),
          cleanupExpiredVoiceSamples(),
        ]);
      } catch (error) {
        console.error("[Storage] scheduled cleanup:", error);
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
  } catch (error) {
    delete globalThis.__vectaixStorageCleanupStarted;
    throw error;
  }
}
