const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (globalThis.__vectaixStorageCleanupStarted) return;
  globalThis.__vectaixStorageCleanupStarted = true;

  const [
    { default: dbConnect },
    { cleanupExpiredTemporaryFiles, ensureStorageReady },
    { cleanupExpiredVoiceSamples },
  ] = await Promise.all([
    import("@/lib/db"),
    import("@/lib/server/storage/service"),
    import("@/lib/media/server/voiceSampleCleanup"),
  ]);
  await dbConnect();
  await ensureStorageReady();
  await Promise.all([
    cleanupExpiredTemporaryFiles(),
    cleanupExpiredVoiceSamples(),
  ]);

  const cleanup = async () => {
    try {
      await dbConnect();
      await ensureStorageReady();
      await Promise.all([
        cleanupExpiredTemporaryFiles(),
        cleanupExpiredVoiceSamples(),
      ]);
    } catch (error) {
      console.error("[Storage] scheduled cleanup:", error);
    }
  };
  const timer = setInterval(cleanup, CLEANUP_INTERVAL_MS);
  timer.unref?.();
}
