package com.openminis.app.offload

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * [T-android-sui-support] (GH#110 / GH#97) Binder-first state resolution.
 *
 * [ShizukuBackend.decideState] is deliberately a pure function so the whole
 * decision table can be exercised on the JVM — no device, no root, and no
 * `rikka.shizuku.Shizuku` static singleton (which cannot be instantiated
 * off-device). The three inputs are exactly what the real [ShizukuBackend]
 * feeds it, so a green table here means the ordering fix is correct
 * regardless of WHICH provider supplied the binder.
 */
class ShizukuBackendStateTest {

    private fun decide(binder: Boolean, granted: Boolean, apk: Boolean) =
        ShizukuBackend.decideState(
            binderAlive = binder,
            permissionGranted = granted,
            managerApkInstalled = apk,
        )

    // ── The Sui regression this change exists for ────────────────────────

    @Test
    fun `sui - live authorized binder with NO manager apk is READY`() {
        // Sui ships as a Magisk/KernelSU module: no APK to find. Before the
        // binder-first fix the package scan short-circuited to NOT_INSTALLED
        // and pingBinder() was never even called — GH#110's exact symptom.
        assertEquals(
            ShizukuManager.State.READY,
            decide(binder = true, granted = true, apk = false),
        )
    }

    @Test
    fun `sui - live unauthorized binder with NO manager apk asks for permission`() {
        // Must be NEED_PERMISSION (an actionable "Authorize Minis" prompt),
        // never NOT_INSTALLED (a dead-end "go install something" screen).
        assertEquals(
            ShizukuManager.State.NEED_PERMISSION,
            decide(binder = true, granted = false, apk = false),
        )
    }

    // ── Existing Shizuku / AXManager paths must not regress ──────────────

    @Test
    fun `shizuku - authorized binder with manager apk is READY`() {
        assertEquals(
            ShizukuManager.State.READY,
            decide(binder = true, granted = true, apk = true),
        )
    }

    @Test
    fun `shizuku - unauthorized binder with manager apk needs permission`() {
        assertEquals(
            ShizukuManager.State.NEED_PERMISSION,
            decide(binder = true, granted = false, apk = true),
        )
    }

    @Test
    fun `manager apk installed but service not started is NOT_RUNNING`() {
        // The "installed Shizuku but never ran the ADB activation" case: we
        // can still point at the manager app, so keep that distinct hint.
        assertEquals(
            ShizukuManager.State.NOT_RUNNING,
            decide(binder = false, granted = false, apk = true),
        )
    }

    @Test
    fun `nothing available at all is NOT_INSTALLED`() {
        assertEquals(
            ShizukuManager.State.NOT_INSTALLED,
            decide(binder = false, granted = false, apk = false),
        )
    }

    // ── Ordering / invariants ───────────────────────────────────────────

    @Test
    fun `binder always wins over the package scan`() {
        // The entire fix in one assertion: with the binder up, the presence or
        // absence of a manager APK must not change the outcome. A regression
        // that reinstates a package-first check fails here.
        for (granted in listOf(true, false)) {
            assertEquals(
                "apk presence must not affect state when binder is alive (granted=$granted)",
                decide(binder = true, granted = granted, apk = true),
                decide(binder = true, granted = granted, apk = false),
            )
        }
    }

    @Test
    fun `a dead binder can never report READY`() {
        // Defensive: permissionGranted is only meaningful alongside a live
        // binder. Even if a caller passes a stale true, we must not claim
        // READY and then fail every runProcess with exit 126.
        assertEquals(
            ShizukuManager.State.NOT_RUNNING,
            decide(binder = false, granted = true, apk = true),
        )
        assertEquals(
            ShizukuManager.State.NOT_INSTALLED,
            decide(binder = false, granted = true, apk = false),
        )
    }

    @Test
    fun `full decision table is exhaustive and stable`() {
        // Locks all 8 input combinations so any future edit to the when-chain
        // has to consciously update this table.
        val table = listOf(
            Triple(true, true, true) to ShizukuManager.State.READY,
            Triple(true, true, false) to ShizukuManager.State.READY,
            Triple(true, false, true) to ShizukuManager.State.NEED_PERMISSION,
            Triple(true, false, false) to ShizukuManager.State.NEED_PERMISSION,
            Triple(false, true, true) to ShizukuManager.State.NOT_RUNNING,
            Triple(false, true, false) to ShizukuManager.State.NOT_INSTALLED,
            Triple(false, false, true) to ShizukuManager.State.NOT_RUNNING,
            Triple(false, false, false) to ShizukuManager.State.NOT_INSTALLED,
        )
        for ((input, expected) in table) {
            val (binder, granted, apk) = input
            assertEquals(
                "binder=$binder granted=$granted apk=$apk",
                expected,
                decide(binder, granted, apk),
            )
        }
    }
}
