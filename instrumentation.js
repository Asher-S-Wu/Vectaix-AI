const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (globalThis.__vectaixStorageCleanupStarted) return;
  globalThis.__vectaixStorageCleanupStarted = true;

  const [{ default: dbConnect }, { cleanupExpiredTemporaryFiles, ensureStorageReady }] = await Promise.all([
    import("@/lib/db"),
    import("@/lib/server/storage/service"),
  ]);
  await dbConnect();
  await ensureStorageReady();
  await cleanupExpiredTemporaryFiles();

  const cleanup = async () => {
    try {
      await dbConnect();
      await ensureStorageReady();
      await cleanupExpiredTemporaryFiles();
    } catch (error) {
      console.error("[Storage] scheduled cleanup:", error);
    }
  };
  const timer = setInterval(cleanup, CLEANUP_INTERVAL_MS);
  timer.unref?.();
}
