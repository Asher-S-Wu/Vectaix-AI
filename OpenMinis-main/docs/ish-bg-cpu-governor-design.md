# iSH Background CPU Governor — Design

> Status: **implemented & device-verified 2026-08-02** (see §7 Addendum for the
> critical actuation discovery made during verification)
> Evidence: 3 IPS reports from 2026-08-02 (iPhone18,1 / iOS 26.5.2 / 1.12 build 1),
> app log `minis-2026-08-02.log`, sysdiagnose RunningBoard trace.

---

## 1. The incident, quantified

| IPS report | Window | CPU measured | Limit applied | Action |
|---|---|---|---|---|
| 19:44:14–19:45:44 | foreground | 90s/90s = **100%** | 50% over 180s (= 90 CPU-s) | none (advisory) |
| 19:51:45–19:53:18 | foreground | 90s/93s = **96%** | 50% over 180s | none (advisory) |
| 19:57:24–19:58:16 | **background** | 48s/53s = **91%** | **80% over 60s (= 48 CPU-s)** | **Process killed** |

Cross-checked facts that anchor the design:

1. **The background observation window starts at the backgrounding moment.**
   The app log has the fg→bg transition at 19:57:23 and the fatal report's
   `Date/Time` is 19:57:24 — RunningBoard opened a fresh 60s budget window
   the moment we backgrounded. It killed us the instant cumulative CPU hit
   48 CPU-s (at 53s wall, before the 60s window even completed).
2. **The existing throttle was ON and still measured 91%.** The app log shows
   `[BKA] iSH CPU throttle ENABLED (background, 80%)` at the transition; the
   fatal report still measured 91% average. The current mechanism does not
   deliver its target, and its target is itself the kill threshold.
3. **Not memory**: MemMonitor showed `pressure=normal`, 4GB+ free throughout.
4. All three heaviest stacks are the same pthread run-loop path
   (`Minis + 37711624/37711236/37509848` — the iSH emulator task threads),
   i.e. one sustained CPU-bound guest workload spanning 19:44→19:58.

### iOS 26 limits (empirical, from these reports)

| State | Budget | Window | Enforcement |
|---|---|---|---|
| Foreground | 90 CPU-s | 180 s (50%) | log-only |
| Background | 48 CPU-s | 60 s (80%) | **kill** |

These are per-**process** CPU-seconds (all threads summed; 6 active cores
means the window can theoretically fill at 6 CPU-s per wall-second).

---

## 2. Why the current mechanism failed

Current implementation (located and reviewed):

- `BackgroundKeepAliveManager.swift:397` — on `didEnterBackground`:
  `enableCPUThrottle(withDutyCycle: 0.8)`; disabled on foreground. Fixed,
  open-loop, one value forever.
- `ISHKernel.m:1255-1352` — a timer-tick hook converts duty cycle into a
  per-thread sleep debt (`owed += elapsed * (1-d)/d`), sleeping every 10
  ticks, debt clamped at 100 ms.
- `deps/ish/kernel/calls.c:1194` — the hook fires **only on `INT_TIMER`
  inside `handle_interrupt`**, i.e. only for emulated guest threads while
  they are executing guest code.

Five independent defects, in decreasing order of impact:

1. **The target has zero safety margin.** Background limit is 80%; the duty
   target is 80%. Even a perfect throttle sits exactly on the kill line, and
   any accounting error lands on the wrong side of it. This alone is
   disqualifying.
2. **Open loop, per-thread, wrong scope.** iOS bills the *process*; the
   throttle shapes *individual emulated threads*. Host-side threads (SSE
   streaming, logging, fakefs/SQLite work done on behalf of guest syscalls,
   UI) are invisible to it. N busy guest threads each at 80% duty are N×0.8
   cores of process CPU — the actuator and the billed quantity aren't even
   the same unit.
3. **Actuation blind spot.** A guest thread that stays inside host code
   (long syscall, page-fault service, JIT) receives no `INT_TIMER`, hence no
   throttling for that whole stretch.
4. **Debt accounting bugs.** `elapsed` is measured wall-to-wall, so it
   *includes the previous cycle's own sleep* (inflating "worked" time), the
   debt is silently discarded above 100 ms and whenever `elapsed > 500 ms`,
   and sleeping only every 10th tick lets bursts run ahead of their debt.
5. **No awareness of the sliding window.** Even a correct fixed duty cycle
   wastes the budget's burst allowance (see §3.4) and cannot react when
   *other* threads eat the budget.

The 91% measurement is the sum of 2+3+4 riding on top of 1.

---

## 3. New design: closed-loop sliding-window governor

### 3.1 Principle

Stop trying to make the actuator accurate. Instead, **measure exactly what
iOS measures — process-wide CPU time — and drive the throttle strength as a
feedback controller against the same 60s sliding window RunningBoard uses.**
Actuator inaccuracy (defects 2–4) then no longer matters for safety: if the
window fills too fast, for whatever reason, the controller brakes harder.

```
           ┌─ every 250 ms ────────────────────────────────┐
           │ proc_pid_rusage() → ri_user_time+ri_system    │
           │ ring buffer → W = CPU-s consumed in last 60 s │
           │ R = dW/dt (burn rate, CPU-s per wall-s)       │
           └───────────────┬───────────────────────────────┘
                           ▼
             W + R·τ  vs. zone thresholds        (τ = 1 s reaction horizon)
                           ▼
        GREEN  W′ < 30s   → ratio = 0      (full speed, no throttle)
        YELLOW 30s ≤ W′ < 38s → duty 1.0→0.15 linear   (proportional brake)
        RED    W′ ≥ 38s   → duty 0.03     (hard brake until W < 32s)
                           ▼
           atomic_store(g_throttle_ratio_q16)   (existing knob, now dynamic)
```

Budget math: hard limit 48 CPU-s / 60 s. Governor ceiling **38 CPU-s
(≈ 63% average)** — a 10 CPU-s margin. Worst realistic overshoot between two
controller decisions: 6 cores × (0.25 s cadence + 1 s of nanosleep already
in flight) ≈ 7.5 CPU-s < 10 CPU-s margin, and the predictive term `R·τ`
brakes *before* the line when the burn rate is multi-core.

### 3.2 Sensor

`proc_pid_rusage(getpid(), RUSAGE_INFO_V4, …)` → `ri_user_time +
ri_system_time` (mach ns, monotonically increasing, includes **all**
threads). One call is a few µs; at 4 Hz the monitor's own cost is noise.
240-slot ring buffer (250 ms × 60 s); `W` = newest − oldest sample.
The monitor runs on a `DISPATCH_SOURCE_TYPE_TIMER` on a utility queue —
alive in background because BKA's background task / keep-alive already
covers exactly the periods where the governor must run.

### 3.3 Actuator (existing hook, corrected)

Keep the Q16 ratio + tick-hook mechanism as the brake — it is cheap and
already wired — but fix its accounting so the *shape* of braking is right:

- measure `elapsed` **excluding** the hook's own `nanosleep` (re-stamp
  `last_ts` after sleeping);
- raise the debt clamp 100 ms → 500 ms and sleep on **every** tick once debt
  exceeds ~20 ms (bursts can no longer run 10 ticks ahead);
- keep the `>500 ms elapsed` reset (it correctly detects "thread was
  blocked, owes nothing").

The controller compensates for what the actuator still can't reach (host
threads, blind spots): braking guest execution to 3% duty also collapses the
host-side work done *on behalf of* guest syscalls, which is where the
measured burn actually was (§1, identical stacks).

### 3.4 Why pulse-shaped beats any fixed duty cycle

The budget is an integral, not a rate — iOS allows 100% burst as long as the
60s integral stays under 48. The governor exploits this:

- **Short/medium tasks finish at full speed.** A task needing ≤ 30 CPU-s
  runs unthrottled start-to-finish (stays in GREEN) — vs 37.5 s under the
  old 80% duty, 50 s under a "safe" fixed 60%. This is also why **no
  task-type classification is needed**: short commands never leave GREEN,
  long tasks are exactly the ones the YELLOW/RED shaping is for. The
  differentiation the task brief asked about is emergent.
- **Long tasks converge to ~63% average** (38s/60s) — faster than any fixed
  duty that would be *safe* (a fixed cycle needs to sit well below 63% to
  absorb its own open-loop error; the governor can ride at 63% because it is
  closed-loop).
- **Worst case is still safe**: a pathological all-core burst is caught by
  the predictive term within one cadence tick and braked to near-zero.

### 3.5 fg→bg transition (the straw that broke this camel)

Evidence (§1 fact 1) says the OS window starts fresh at backgrounding, so no
foreground history carries in — the 19:44/19:51 foreground events did *not*
pre-fill the fatal window; they merely prove the workload was running hot
when the stricter regime began. Handling:

- Governor `begin()` runs **synchronously inside the existing
  `didEnterBackground` sink** (same place the fixed throttle is enabled
  today — that timing was already correct), starting with an empty window
  in GREEN. First controller decision within 250 ms.
- Defensive asymmetry: for the **first 2 s** after backgrounding, cap duty
  at 0.5 regardless of zone. If the OS window in some iOS version *does*
  start earlier than the transition, this absorbs it; cost is 2 s of
  half-speed, negligible.
- Foreground return: governor off, ratio = 0, exactly as today (the
  foreground 50%/180s limit is advisory-only; foreground work is
  user-driven and should not be shaped).

### 3.6 User-visible signal (optional, phase 2)

When RED engages for > 5 s cumulative, update the existing Live Activity
line (AgentLiveActivityManager) to "后台限速运行中…". No modal, no prompt to
stay foreground — the point of the governor is that backgrounding is safe.

---

## 4. Implementation sketch (for the follow-up task)

~150 lines, no new files needed beyond one:

| Piece | Where | Change |
|---|---|---|
| Monitor + controller | `ISHKernel.m` (Scheduler category) | new `beginBackgroundCPUGovernor` / `endBackgroundCPUGovernor`; dispatch timer; ring buffer; zone logic; writes `g_throttle_ratio_q16` |
| Actuator fixes | `ISHKernel.m` tick hook | re-stamp after sleep; clamp 500 ms; sleep-every-tick over 20 ms debt |
| Wiring | `BackgroundKeepAliveManager.swift:397/431` | replace the two fixed calls with begin/end |
| Logs | `[Governor]` category | 10s cadence: `W=…s zone=… duty=…% rate=…` |

`deps/ish` needs **no changes** (hook API is sufficient).

## 5. Verification plan (on device)

1. **Kill regression test**: start a pure CPU burner in iSH
   (`sh -c 'while :; do :; done'` or the actual image-generation workload),
   background the app, leave 5 min. Pass = no new `cpu_resource_fatal` IPS
   in Settings→Privacy→Analytics, agent loop not interrupted.
2. **Throughput test**: fixed workload needing ~40 CPU-s (e.g. `gzip` a
   fixed blob N times). Measure wall time backgrounded: expect ~64 s under
   the governor (38s full-speed + throttled tail) vs ~84 s+ under a
   hypothetically-correct fixed 60% duty; and *completion at all* vs today's
   kill at 53 s.
3. **Window telemetry**: read `[Governor]` lines via the debug server
   (`debug.logs.read`) and confirm W never exceeds 40 CPU-s in any 60s span.
4. **Blip test**: rapid bg→fg→bg cycling (the BKA debounce path) — governor
   must end/begin cleanly, no stuck ratio (verify `[Throttle] DISABLED` /
   ratio=0 after final foreground).

## 6. Residual risks

- **CPU burned by non-iSH app threads** (LLM SSE parsing, sync) counts
  toward the budget but can't be braked by the iSH knob. The governor
  *sees* it (process-wide sensor) and compensates by braking iSH harder;
  if iSH is idle and app threads alone approach the limit, the governor can
  only log — considered acceptable: streaming/sync are bursty and have never
  appeared in a cpu_resource report.
- **Monitor survival**: the timer only matters while BKA keep-alive holds
  the process runnable; if iOS suspends us outright, CPU is zero and no
  governor is needed. Aligned by construction.
- **iOS limit drift across versions**: thresholds (48/60) live in one
  constants block; the 10 CPU-s margin also absorbs moderate tightening
  (e.g. a future 70%/60s limit ⇒ 42 CPU-s, still above our 38 ceiling).

---

## 7. Addendum (2026-08-02, device verification): the tick hook was dead code

Round-2 on-device testing (iPhone 11 / iOS 26.6) falsified a load-bearing
assumption in §3.3: **`INT_TIMER` never fires for CPU-bound guest code.**
The governor's sensing and zone logic worked exactly as designed
(GREEN→YELLOW 42%→RED 3% on schedule), but measured burn stayed at R≈1.0
through RED and the process was killed at +48s — twice, reproducing the
production kill with the throttle nominally "enabled".

Root cause, from `deps/ish/asbestos/asbestos.c`: the dispatch loop's
1024-cycle `INT_TIMER` raiser only runs between *unchained* block
dispatches. A tight guest loop (`while :; do :; done`, image encoding, any
hot loop) gets **block-chained** and executes gadget-to-gadget inside
`fiber_enter` without ever returning to the dispatch loop. The only thing
that breaks chained execution is a **poke** (`cpu_poke` — the channel
signal delivery uses). This also retroactively explains the production
incident: the old fixed 80% duty cycle never actually throttled anything;
its "91% measured" was just unthrottled load minus scheduling noise.

Fix (round 3, verified): the governor tick doubles as the **brake driver** —
at 10 Hz, while `ratio > 0`, it sweeps the flat pid table under `pids_lock`
and pokes every live task's CPU (`gov_poke_all_tasks`). Each poked guest
drops out of chained execution at the next check, reaches
`handle_interrupt(INT_TIMER)`, and pays its sleep debt (clamped at 2 s,
slept in 100 ms slices that re-check `ratio` so foreground return is never
blocked more than one slice). GREEN sets `ratio = 0` and skips poking
entirely — zero overhead at full speed. Duty floor in RED ≈ 100 ms work /
2.1 s cycle ≈ 5%.

Verified telemetry (round 3, same burner that previously killed the app):
full speed to W=33 (+35s), proportional YELLOW braking with R tracking duty
(duty 61% → R 0.61), RED at the 38 ceiling with R crushed to 0.08–0.16,
then a stable limit cycle W ∈ [29, 39] as the window drains and refills —
peak W 38.9 CPU-s vs the 48 CPU-s kill budget, margin ≥ 9 CPU-s, no
`cpu_resource_fatal`. Long-task effective throughput ≈ 63% of full speed,
matching §3.4's prediction.
