package com.openminis.app.share

/**
 * [T-android-share-launch-crash] The retry ladder [ShareReceiverActivity] uses
 * to hand off to MainActivity, extracted so it can be unit-tested.
 *
 * ## Why this exists
 *
 * Field report (vivo V2352A / Android 14, Minis 0.20-preview): sharing into
 * Minis crashed the app immediately and repeatedly (HangDetector recorded
 * restartCount=50). The crash is raised inside `startActivity`:
 *
 *     RuntimeException: Unable to start activity …ShareReceiverActivity
 *     Caused by: NullPointerException … String.equals(Object) on null
 *       at android.os.Parcel.createExceptionOrNull(Parcel.java:3077)
 *       at IActivityTaskManager$Stub$Proxy.startActivity(…)
 *     Caused by: RemoteException: Remote stack trace:
 *       at VivoActivityStarterImpl.generateLaunchFreeFormOption(:2195)
 *
 * The fault is entirely in the OEM's freeform-window logic in system_server: it
 * NPEs, and the exception it marshals back has a null message, so
 * `Parcel.readException` NPEs again rebuilding it. Both land on our main thread,
 * so an unguarded call kills the app.
 *
 * The real Activity work (building Intents, calling `startActivity`) needs a
 * live Context and cannot run on the JVM. What CAN be tested is the decision
 * layer: how many attempts are made, in what order, and what happens when each
 * one throws. That is what [handOff] models — the caller supplies the attempts
 * as lambdas, so a test can make any of them throw on demand and assert the
 * outcome without a device.
 */
object ShareHandoffPolicy {

    /** What ultimately happened, for logging and for the caller's UI decision. */
    enum class Outcome {
        /** The primary attempt (NEW_TASK | CLEAR_TOP) succeeded. */
        LAUNCHED,

        /** The primary attempt threw; the NEW_TASK-only retry succeeded. */
        LAUNCHED_VIA_FALLBACK,

        /**
         * Every attempt threw. The caller must not crash: the share is already
         * persisted, so it tells the user to open the app manually.
         */
        FAILED,
    }

    /**
     * Run [primary], then [fallback] if the first throws, and report which
     * (if either) succeeded.
     *
     * Catches [Throwable] rather than [Exception] on purpose: the observed
     * top-level failure is a RuntimeException, but the Binder unwrap that
     * produces it can surface other Errors, and there is no failure mode in a
     * best-effort hand-off worth crashing the process over. This function
     * therefore never throws — that guarantee is the entire point, since it is
     * called from `onCreate`, where anything escaping becomes "Unable to start
     * activity" and takes the app down.
     *
     * @param onError invoked with each failure so the caller can log it; its
     *   own throws are swallowed too, so a broken logger cannot defeat the guard.
     */
    fun handOff(
        primary: () -> Unit,
        fallback: () -> Unit,
        onError: (stage: String, error: Throwable) -> Unit = { _, _ -> },
    ): Outcome {
        try {
            primary()
            return Outcome.LAUNCHED
        } catch (t: Throwable) {
            report(onError, "primary", t)
        }

        try {
            fallback()
            return Outcome.LAUNCHED_VIA_FALLBACK
        } catch (t: Throwable) {
            report(onError, "fallback", t)
        }

        return Outcome.FAILED
    }

    private fun report(onError: (String, Throwable) -> Unit, stage: String, t: Throwable) {
        try {
            onError(stage, t)
        } catch (_: Throwable) {
            // A logging failure must never turn into the crash we are preventing.
        }
    }
}
