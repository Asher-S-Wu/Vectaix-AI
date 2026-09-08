//
//  HangDetector.m
//

#import "HangDetector.h"

#import <CoreFoundation/CoreFoundation.h>
#import <mach/mach.h>
#import <mach/mach_time.h>
#import <mach/thread_act.h>
#import <os/lock.h>
#import <pthread.h>
#import <dlfcn.h>
#import <stdatomic.h>
#import <unistd.h>
#import <fcntl.h>
#import <string.h>

#if defined(__arm64__)
#import <pthread/stack_np.h>
#endif

#pragma mark - HangFrame / HangEvent

@implementation HangFrame
@end

@implementation HangEvent
@end

#pragma mark - State

static atomic_bool g_running = ATOMIC_VAR_INIT(false);
static atomic_uint_fast64_t g_lastBeat = ATOMIC_VAR_INIT(0);
static atomic_uint_fast32_t g_lastActivity = ATOMIC_VAR_INIT(0);
// Default 1500ms. Codex review 2026-05-13 showed that 1020ms hangs were
// dominated by detector quantization (threshold/4 polling), so we raise
// the threshold and tighten the poll period for finer granularity.
static double g_thresholdMs = 1500.0;
// TEMP(2026-05-14) — when a single hang has been pinned for >=
// kAllThreadsDumpThresholdMs continuously, capture every thread's stack
// once. Helps see what *other* threads (streaming queue, sync queue,
// writer queue) are doing while main is wedged. Only fires once per
// continuous-hang run thanks to g_allThreadsDumpedHash.
static const double kAllThreadsDumpThresholdMs = 3000.0;
static uint64_t g_allThreadsDumpedHash = 0;
// Fixed 100ms poll regardless of threshold — lets us re-sample throughout
// a 10s watchdog window instead of only once per second.
static const useconds_t kPollUs = 100 * 1000;
// Stack-hash de-dup: when the captured frame addresses match the last
// recorded event exactly, increment a counter on the last event instead
// of pushing a duplicate. Prevents a 10s spin from filling the ring with
// 100 identical entries.
static uint64_t g_lastStackHash = 0;
static uint32_t g_lastStackRepeats = 0;

static CFRunLoopObserverRef g_observer = NULL;
static pthread_t g_monitorThread = (pthread_t)NULL;
static pthread_t g_mainPthread = (pthread_t)NULL;

// [T-ios-mem-footprint-delta-logging] System memory-pressure level, updated by
// a process-wide dispatch memory-pressure source and read by the [MemMonitor]
// sampler. 0=normal, 1=warn, 2=critical. Atomic: source fires on a dispatch
// queue, sampler reads on the monitor thread.
static atomic_uint_fast32_t g_memPressureLevel = ATOMIC_VAR_INIT(0);
static dispatch_source_t g_memPressureSource = nil;

// Mach time -> ms conversion factor, computed once at first use.
static double g_machToMs = 0.0;
static void initMachTimebase(void) {
    if (g_machToMs != 0.0) return;
    mach_timebase_info_data_t tb;
    mach_timebase_info(&tb);
    // mach_continuous_time() returns ticks; ticks * (numer/denom) = nanoseconds.
    g_machToMs = ((double)tb.numer / (double)tb.denom) / 1.0e6;
}

// Ring buffer of captured events, protected by g_eventsLock.
// Capacity intentionally small so dumps are fast and we don't hoard memory.
#define HANG_RING_CAPACITY 64
static NSMutableArray<HangEvent *> *g_events = nil; // append-only ring; capped at HANG_RING_CAPACITY
static os_unfair_lock g_eventsLock = OS_UNFAIR_LOCK_INIT;

#pragma mark - Helpers

static inline double ticksToMs(uint64_t deltaTicks) {
    initMachTimebase();
    return (double)deltaTicks * g_machToMs;
}

/// Walk the frame pointer chain on ARM64. Caller must have suspended `thread`
/// already. Writes up to `maxFrames` PC values into `outFrames` (PC first,
/// then return addresses from the FP chain). Returns the count written.
///
/// SAFETY: this function must NOT call malloc / Objective-C / Foundation
/// APIs while the target thread is suspended — only mach calls + raw
/// pointer reads. Caller does the dladdr resolution after thread_resume.
#if defined(__arm64__)
static int captureFramesARM64(thread_t thread, uintptr_t *outFrames, int maxFrames) {
    arm_thread_state64_t state;
    mach_msg_type_number_t count = ARM_THREAD_STATE64_COUNT;
    kern_return_t kr = thread_get_state(thread, ARM_THREAD_STATE64,
                                        (thread_state_t)&state, &count);
    if (kr != KERN_SUCCESS) return 0;

    int n = 0;
    uintptr_t pc = (uintptr_t)__darwin_arm_thread_state64_get_pc(state);
    uintptr_t fp = (uintptr_t)__darwin_arm_thread_state64_get_fp(state);
    uintptr_t lr = (uintptr_t)__darwin_arm_thread_state64_get_lr(state);

    if (pc) outFrames[n++] = pc;
    // Some leaf functions don't push fp; include lr explicitly when available
    // and distinct from pc.
    if (lr && lr != pc && n < maxFrames) outFrames[n++] = lr;

    // Walk frame records: at *fp = saved fp, at fp+8 = saved lr.
    while (fp && n < maxFrames) {
        // Defensive sanity: an FP must be 16-byte aligned and non-degenerate.
        if (fp & 0xF) break;
        uintptr_t nextFp = *(uintptr_t *)fp;
        uintptr_t retAddr = *(uintptr_t *)(fp + sizeof(uintptr_t));
        if (retAddr == 0) break;
        outFrames[n++] = retAddr;
        if (nextFp == 0 || nextFp <= fp) break; // end of chain or corruption guard
        fp = nextFp;
    }
    return n;
}
#endif

// TEMP(2026-05-14) — dump every thread's stack to NSLog. Heavy: suspends
// each non-monitor thread briefly, samples up to 32 frames, resumes.
// Caller is responsible for de-duping (we only fire once per continuous
// main-hang run).
static void dumpAllThreadsToLog(thread_t monitorTid, double busyMs) {
    task_t task = mach_task_self();
    thread_act_array_t threads = NULL;
    mach_msg_type_number_t count = 0;
    if (task_threads(task, &threads, &count) != KERN_SUCCESS) return;

    NSMutableString *out = [NSMutableString stringWithFormat:
        @"[HangDetector] 🧵 ALL-THREADS DUMP busyMs=%.0f threads=%u",
        busyMs, (unsigned)count];

    for (mach_msg_type_number_t i = 0; i < count; i++) {
        thread_t t = threads[i];
        if (t == monitorTid) continue;

        // Try to get a name via pthread_t. Many threads have nothing.
        pthread_t pt = pthread_from_mach_thread_np(t);
        char nameBuf[64] = {0};
        if (pt) pthread_getname_np(pt, nameBuf, sizeof(nameBuf));

        kern_return_t kr = thread_suspend(t);
        if (kr != KERN_SUCCESS) continue;

        uintptr_t frames[32];
        int n = 0;
#if defined(__arm64__)
        n = captureFramesARM64(t, frames, 32);
#endif
        thread_resume(t);

        if (n <= 0) {
            [out appendFormat:@"\n  tid=0x%x name=\"%s\" (no frames)",
                (unsigned)t, nameBuf];
            continue;
        }

        [out appendFormat:@"\n  tid=0x%x name=\"%s\" frames=%d",
            (unsigned)t, nameBuf, n];
        int show = MIN(n, 8);
        for (int j = 0; j < show; j++) {
            Dl_info info;
            const char *img = "?";
            const char *sym = "?";
            uintptr_t off = 0;
            if (dladdr((const void *)frames[j], &info) != 0) {
                if (info.dli_fname) {
                    const char *slash = strrchr(info.dli_fname, '/');
                    img = slash ? slash + 1 : info.dli_fname;
                }
                if (info.dli_sname) sym = info.dli_sname;
                if (info.dli_fbase) off = frames[j] - (uintptr_t)info.dli_fbase;
            }
            [out appendFormat:@"\n    #%d %s + 0x%lx %s", j, img,
                (unsigned long)off, sym];
        }
    }

    // Release thread port array.
    vm_deallocate(task, (vm_address_t)threads, count * sizeof(thread_t));

    NSLog(@"%@", out);
}

/// Write the current hang stack to a persistent file so CrashReporter
/// can include it in the next-launch crash report even after SIGKILL.
/// Called from the monitor thread (main thread is hung, so this is safe).
/// Uses POSIX I/O (open/write/close) — no ObjC, no malloc after format.
static void persistHangStackToDisk(NSMutableArray<HangFrame *> *frames, double busyMs, uint32_t repeatCount) {
    static NSString *cachedPath = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        NSArray<NSString *> *dirs = NSSearchPathForDirectoriesInDomains(
            NSApplicationSupportDirectory, NSUserDomainMask, YES);
        if (dirs.count > 0) {
            cachedPath = [dirs[0] stringByAppendingPathComponent:@"last_hang_snapshot.txt"];
        }
    });
    if (!cachedPath) return;

    NSMutableString *out = [NSMutableString stringWithFormat:
        @"Hang: %.0fms repeat=%u\n", busyMs, repeatCount];
    NSUInteger limit = MIN(frames.count, (NSUInteger)30);
    for (NSUInteger i = 0; i < limit; i++) {
        HangFrame *f = frames[i];
        [out appendFormat:@"  #%lu %@ +0x%lx %@\n",
         (unsigned long)i,
         f.imageName ?: @"?",
         (unsigned long)f.imageOffset,
         f.symbol ?: @""];
    }

    int fd = open(cachedPath.fileSystemRepresentation, O_WRONLY | O_CREAT | O_TRUNC, 0644);
    if (fd >= 0) {
        const char *utf8 = out.UTF8String;
        write(fd, utf8, strlen(utf8));
        close(fd);
    }
}

#pragma mark - RunLoop observer

// TEMP(2026-05-14) — runloop activity ring buffer. The monitor dumps the
// most recent 30 activities + timestamps when a fresh hang is captured.
// Helps distinguish "stuck in source0 immediately after wakeup" from
// "stuck before timers" or "stuck after long beforeWaiting".
#define ACTIVITY_RING_CAPACITY 30
static struct {
    uint32_t activity;
    uint64_t mach_ts;
} g_activityRing[ACTIVITY_RING_CAPACITY] = {{0}};
static atomic_uint_fast32_t g_activityRingHead = 0;
static atomic_int g_activityRingFilled = 0;

static void runLoopObserverCallback(CFRunLoopObserverRef observer,
                                     CFRunLoopActivity activity,
                                     void *info) {
    initMachTimebase();
    uint64_t now = mach_continuous_time();
    atomic_store_explicit(&g_lastBeat, now, memory_order_relaxed);
    atomic_store_explicit(&g_lastActivity, (uint_fast32_t)activity, memory_order_relaxed);
    // Record into ring (single producer = main thread, multiple readers
    // = monitor thread; use relaxed atomic head + plain writes — small
    // race risk on read-side is acceptable for diagnostics).
    uint32_t head = atomic_fetch_add(&g_activityRingHead, 1) % ACTIVITY_RING_CAPACITY;
    g_activityRing[head].activity = (uint32_t)activity;
    g_activityRing[head].mach_ts = now;
    atomic_store_explicit(&g_activityRingFilled, 1, memory_order_relaxed);
}

#pragma mark - Monitor thread

static void *monitorThreadMain(void *arg) {
    pthread_setname_np("com.minis.hangdetector.monitor");

    // Monitor cadence: 1/4 of the threshold, clamped. 50ms is a sane default
    // for a 100ms threshold — gives ~2 samples worth of headroom without
    // burning too much CPU on a thread that's mostly sleeping.
    while (atomic_load_explicit(&g_running, memory_order_relaxed)) {
        double thresholdMs = g_thresholdMs; // read once per loop
        usleep(kPollUs);

        if (!atomic_load_explicit(&g_running, memory_order_relaxed)) break;

        // ---- [MemMonitor] low-overhead memory footprint sampling ----
        // [T-ios-mem-footprint-delta-logging] Piggyback on this existing
        // background monitor thread (no new timer). Sample app memory ~once a
        // second (every 10 ticks at kPollUs=100ms) and log ONLY when the
        // footprint has moved >= 10MB since the last logged value (rise OR
        // fall), so the log stays quiet under steady memory. All state below is
        // monitor-thread-private (function-local statics) — no cross-thread
        // access, no atomics needed. This block is independent of the hang
        // detection below and must run every tick BEFORE the hang-path
        // `continue`s, so it sits here right after the g_running re-check.
        {
            static const int kMemSampleEvery = 10; // ~1s at 100ms ticks
            static const double kMemDeltaBytes = 10.0 * 1024.0 * 1024.0; // 10MB
            static int memSampleCounter = 0;
            static double lastLoggedFootprint = -1.0; // <0 = not yet baselined
            if (++memSampleCounter >= kMemSampleEvery) {
                memSampleCounter = 0;
                // phys_footprint via TASK_VM_INFO — the metric iOS uses for
                // memory-pressure / jetsam accounting, more representative than
                // resident_size. On task_info failure: skip silently (no log,
                // no lastLogged update), never affecting hang detection.
                task_vm_info_data_t vmInfo;
                mach_msg_type_number_t vmCount = TASK_VM_INFO_COUNT;
                kern_return_t mkr = task_info(mach_task_self(), TASK_VM_INFO,
                                              (task_info_t)&vmInfo, &vmCount);
                if (mkr == KERN_SUCCESS) {
                    double cur = (double)vmInfo.phys_footprint; // bytes
                    if (lastLoggedFootprint < 0.0 ||
                        fabs(cur - lastLoggedFootprint) >= kMemDeltaBytes) {
                        double curMB = cur / 1024.0 / 1024.0;
                        double lastMB = lastLoggedFootprint < 0.0 ? curMB
                                          : lastLoggedFootprint / 1024.0 / 1024.0;

                        // System-wide totals + free water-line via host_statistics64.
                        // Free ≈ (free + inactive) pages: inactive is reclaimable,
                        // so it counts as effectively available. All best-effort:
                        // on failure these stay 0 and we just print "-".
                        double totalMB = (double)[NSProcessInfo processInfo].physicalMemory / 1024.0 / 1024.0;
                        double freeMB = -1.0;
                        vm_statistics64_data_t vmStat;
                        mach_msg_type_number_t statCount = HOST_VM_INFO64_COUNT;
                        if (host_statistics64(mach_host_self(), HOST_VM_INFO64,
                                              (host_info64_t)&vmStat, &statCount) == KERN_SUCCESS) {
                            vm_size_t pageSize = 0;
                            if (host_page_size(mach_host_self(), &pageSize) != KERN_SUCCESS) pageSize = 16384;
                            double freeBytes = ((double)vmStat.free_count + (double)vmStat.inactive_count) * (double)pageSize;
                            freeMB = freeBytes / 1024.0 / 1024.0;
                        }

                        // App memory pressure water-line (per-process headroom
                        // before jetsam) + system pressure level from the source.
                        uint32_t plevel = (uint32_t)atomic_load_explicit(&g_memPressureLevel, memory_order_relaxed);
                        const char *pname = plevel >= 2 ? "CRITICAL" : (plevel == 1 ? "warn" : "normal");

                        if (freeMB >= 0.0) {
                            NSLog(@"[MemMonitor] 📈 footprint=%.1fMB (Δ%+.1fMB) | sys free=%.0f/%.0fMB (%.0f%%) | pressure=%s",
                                  curMB, curMB - lastMB, freeMB, totalMB,
                                  totalMB > 0 ? (freeMB / totalMB * 100.0) : 0.0, pname);
                        } else {
                            NSLog(@"[MemMonitor] 📈 footprint=%.1fMB (Δ%+.1fMB) | sys free=- /%.0fMB | pressure=%s",
                                  curMB, curMB - lastMB, totalMB, pname);
                        }
                        lastLoggedFootprint = cur;
                    }
                }
            }
        }

        uint64_t lastBeat = atomic_load_explicit(&g_lastBeat, memory_order_relaxed);
        if (lastBeat == 0) continue; // observer hasn't fired yet
        uint32_t activity = (uint32_t)atomic_load_explicit(&g_lastActivity, memory_order_relaxed);

        // BeforeWaiting = main thread idle, waiting for next event. Not a hang.
        if (activity == kCFRunLoopBeforeWaiting) {
            // TEMP(2026-05-14) — runloop fully drained → main thread is
            // healthy. Reset stack-hash de-dup state so the next hang
            // run starts fresh (different stack OR same stack treated as
            // a new event, with its own ALL-THREADS dump opportunity).
            if (g_lastStackRepeats > 0) {
                g_lastStackHash = 0;
                g_lastStackRepeats = 0;
                g_allThreadsDumpedHash = 0;
            }
            continue;
        }

        uint64_t now = mach_continuous_time();
        if (now <= lastBeat) continue;
        double busyMs = ticksToMs(now - lastBeat);
        if (busyMs < thresholdMs) continue;

        // ---- HANG DETECTED ----

        // Capture stack with the main thread suspended. Only mach calls +
        // pointer reads inside this critical section.
        thread_t mainMachThread = pthread_mach_thread_np(g_mainPthread);
        if (mainMachThread == MACH_PORT_NULL) continue;

        // Reject capturing the monitor itself (defensive — we never run on main).
        if (mach_thread_self() == mainMachThread) {
            mach_port_deallocate(mach_task_self(), mach_thread_self());
            continue;
        }
        // Drop the self-port allocated by mach_thread_self() to keep counts clean.
        mach_port_deallocate(mach_task_self(), mach_thread_self());

        kern_return_t kr = thread_suspend(mainMachThread);
        if (kr != KERN_SUCCESS) continue;

        uintptr_t frames[64];
        int frameCount = 0;
#if defined(__arm64__)
        frameCount = captureFramesARM64(mainMachThread, frames, 64);
#endif

        thread_resume(mainMachThread);

        if (frameCount <= 0) continue;

        // ---- POST-CAPTURE: now we can do whatever (no main lock contention). ----

        // First: idle filter. The main thread's RunLoop spends most of its
        // time blocked in mach_msg waiting for the next event — that is
        // not a hang. If the PC (frames[0]) lives inside
        // libsystem_kernel.dylib (any mach_msg* / __semwait_signal etc.)
        // and the immediate caller is CoreFoundation's runloop kernel, we
        // discard the event before it pollutes the ring buffer.
        //
        // We do this with dladdr on at most the first two frames so the
        // common "idle" case bails out before we allocate the full
        // resolved array.
        Dl_info leafInfo;
        if (dladdr((const void *)frames[0], &leafInfo) != 0 && leafInfo.dli_fname) {
            const char *base = strrchr(leafInfo.dli_fname, '/');
            base = base ? base + 1 : leafInfo.dli_fname;
            if (strstr(base, "libsystem_kernel") != NULL) {
                // Almost certainly RunLoop idle. Refresh the heartbeat so
                // we don't fire again next loop on the same wait.
                atomic_store_explicit(&g_lastBeat, mach_continuous_time(), memory_order_relaxed);
                continue;
            }
        }

        // Compute a fast 64-bit hash of the PC frames so we can de-dup
        // when the main thread is spinning on the same call site across
        // multiple samples (typical for a 10s watchdog wait — N samples
        // of the same fillLayoutHole frame). FNV-1a, plenty for this use.
        uint64_t hash = 0xcbf29ce484222325ULL;
        for (int i = 0; i < frameCount; i++) {
            uint64_t v = (uint64_t)frames[i];
            for (int b = 0; b < 8; b++) {
                hash ^= (v & 0xff);
                hash *= 0x100000001b3ULL;
                v >>= 8;
            }
        }

        NSTimeInterval nowSec = [[NSDate date] timeIntervalSince1970];

        // Same-stack repeat: bump the last event's counter + lastSeenAt
        // and log a single repeat line instead of a full dump.
        os_unfair_lock_lock(&g_eventsLock);
        BOOL coalesced = NO;
        HangEvent *coalesceTarget = nil;
        if (hash == g_lastStackHash && g_events.count > 0) {
            coalesceTarget = g_events.lastObject;
            coalesceTarget.repeatCount += 1;
            coalesceTarget.lastSeenAt = nowSec;
            coalesceTarget.durationMs = busyMs; // refresh to current busy time
            g_lastStackRepeats += 1;
            coalesced = YES;
        }
        os_unfair_lock_unlock(&g_eventsLock);

        if (coalesced) {
            // Emit a single short "still pinned" line per repeat. Avoids
            // duplicating 64 frame addresses every 100ms when nothing
            // has actually changed.
            NSLog(@"[HangDetector] ⏳ MAIN STILL PINNED %.0fms (activity=0x%x) repeat=%u",
                  busyMs, activity, g_lastStackRepeats);
            if (coalesceTarget) {
                persistHangStackToDisk(coalesceTarget.frames, busyMs, g_lastStackRepeats);
            }
            // TEMP(2026-05-14) — once per continuous main-hang run, when
            // the hang has been pinned >=3s, dump every thread's stack so
            // we can see what background queues are doing while main is
            // wedged. g_allThreadsDumpedHash gates re-fire until a new
            // stack hash takes over (i.e. main recovered and re-stuck on
            // something different).
            if (busyMs >= kAllThreadsDumpThresholdMs && g_allThreadsDumpedHash != hash) {
                g_allThreadsDumpedHash = hash;
                thread_t selfTid = mach_thread_self();
                dumpAllThreadsToLog(selfTid, busyMs);
                mach_port_deallocate(mach_task_self(), selfTid);
            }
            // DO NOT reset lastBeat — we want the next poll to still see
            // the main thread as hung if it hasn't recovered.
            continue;
        }

        // New stack — full resolve + log.
        g_lastStackHash = hash;
        g_lastStackRepeats = 1;

        NSMutableArray<HangFrame *> *resolved = [NSMutableArray arrayWithCapacity:frameCount];
        for (int i = 0; i < frameCount; i++) {
            HangFrame *f = [HangFrame new];
            f.address = frames[i];
            Dl_info info;
            if (dladdr((const void *)frames[i], &info) != 0) {
                if (info.dli_fname) {
                    NSString *path = [NSString stringWithUTF8String:info.dli_fname];
                    f.imageName = [path lastPathComponent];
                }
                if (info.dli_fbase) {
                    f.imageOffset = frames[i] - (uintptr_t)info.dli_fbase;
                }
                if (info.dli_sname) {
                    f.symbol = [NSString stringWithUTF8String:info.dli_sname];
                }
            }
            [resolved addObject:f];
        }

        HangEvent *event = [HangEvent new];
        event.timestamp = nowSec;
        event.lastSeenAt = nowSec;
        event.durationMs = busyMs;
        event.runLoopActivity = activity;
        event.frames = resolved;
        event.repeatCount = 1;

        os_unfair_lock_lock(&g_eventsLock);
        if (!g_events) g_events = [NSMutableArray arrayWithCapacity:HANG_RING_CAPACITY];
        if (g_events.count >= HANG_RING_CAPACITY) [g_events removeObjectAtIndex:0];
        [g_events addObject:event];
        NSUInteger total = g_events.count;
        os_unfair_lock_unlock(&g_eventsLock);

        // Surface the most-likely-relevant frames in the daily log so the
        // event is grep-able even without the structured dump RPC.
        NSMutableString *summary = [NSMutableString stringWithFormat:
            @"[HangDetector] ⚠️ MAIN HANG %.0fms (activity=0x%x) buffered=%lu",
            busyMs, activity, (unsigned long)total];
        NSUInteger logFrames = MIN(resolved.count, (NSUInteger)8);
        for (NSUInteger i = 0; i < logFrames; i++) {
            HangFrame *frame = resolved[i];
            [summary appendFormat:@"\n  #%lu %@ + 0x%lx %@",
             (unsigned long)i,
             frame.imageName ?: @"?",
             (unsigned long)frame.imageOffset,
             frame.symbol ?: @""];
        }
        NSLog(@"%@", summary);
        persistHangStackToDisk(resolved, busyMs, 1);

        // TEMP(2026-05-14) — emit recent runloop activity sequence so we
        // can see what the main thread was doing in the seconds leading
        // up to the hang. Walks the ring backwards from current head.
        if (atomic_load_explicit(&g_activityRingFilled, memory_order_relaxed)) {
            uint32_t head = atomic_load_explicit(&g_activityRingHead, memory_order_relaxed);
            NSMutableString *trail = [NSMutableString stringWithString:
                @"[HangDetector] runloop activity trail (newest→oldest, mach_continuous_time deltas):"];
            uint64_t now2 = mach_continuous_time();
            for (int i = 0; i < ACTIVITY_RING_CAPACITY; i++) {
                int idx = (int)((head + ACTIVITY_RING_CAPACITY - 1 - i) % ACTIVITY_RING_CAPACITY);
                uint64_t ts = g_activityRing[idx].mach_ts;
                if (ts == 0) break;
                uint32_t act = g_activityRing[idx].activity;
                double agoMs = ticksToMs(now2 - ts);
                // CFRunLoopActivity flag → short label.
                const char *name = "?";
                switch (act) {
                    case kCFRunLoopEntry:         name = "Entry"; break;
                    case kCFRunLoopBeforeTimers:  name = "BeforeTimers"; break;
                    case kCFRunLoopBeforeSources: name = "BeforeSources"; break;
                    case kCFRunLoopBeforeWaiting: name = "BeforeWaiting"; break;
                    case kCFRunLoopAfterWaiting:  name = "AfterWaiting"; break;
                    case kCFRunLoopExit:          name = "Exit"; break;
                    default: break;
                }
                [trail appendFormat:@" %s(-%.0fms)", name, agoMs];
            }
            NSLog(@"%@", trail);
        }

        // DO NOT reset lastBeat. If main thread is still stuck on the
        // next poll, the next iteration will hit "coalesce" path above
        // (cheap) and emit a repeat line. Only the natural runloop tick
        // (CFRunLoopObserver callback in observeRunLoop) updates
        // lastBeat — recovery is detected then.
    }
    return NULL;
}

#pragma mark - HangDetector class

@implementation HangDetector

+ (BOOL)isRunning {
    return atomic_load_explicit(&g_running, memory_order_relaxed);
}

+ (double)thresholdMs {
    return g_thresholdMs;
}

+ (NSUInteger)eventCount {
    os_unfair_lock_lock(&g_eventsLock);
    NSUInteger n = g_events.count;
    os_unfair_lock_unlock(&g_eventsLock);
    return n;
}

+ (BOOL)startWithThresholdMs:(double)thresholdMs {
    if (atomic_load_explicit(&g_running, memory_order_relaxed)) return NO;

    // Clamp.
    if (thresholdMs < 16.0) thresholdMs = 16.0;
    if (thresholdMs > 5000.0) thresholdMs = 5000.0;
    g_thresholdMs = thresholdMs;

    // Capture the main pthread for cross-thread suspends. We rely on the
    // monitor only running while the main thread is alive (i.e. for the
    // app's whole lifetime).
    g_mainPthread = pthread_from_mach_thread_np(pthread_mach_thread_np(pthread_self()));
    // If we're not on the main thread when start is called, look up main
    // via NSThread's main thread directly.
    if (![NSThread isMainThread]) {
        // Run a no-op block on main to capture the main pthread reliably.
        dispatch_sync(dispatch_get_main_queue(), ^{
            g_mainPthread = pthread_self();
        });
    } else {
        g_mainPthread = pthread_self();
    }
    if (!g_mainPthread) return NO;

    initMachTimebase();
    atomic_store_explicit(&g_lastBeat, mach_continuous_time(), memory_order_relaxed);
    atomic_store_explicit(&g_lastActivity, (uint_fast32_t)kCFRunLoopBeforeSources, memory_order_relaxed);
    atomic_store_explicit(&g_running, true, memory_order_release);

    // Install observer on main runloop, all common modes.
    CFRunLoopObserverContext ctx = {0};
    g_observer = CFRunLoopObserverCreate(
        NULL,
        kCFRunLoopAllActivities,
        true, // repeats
        0,
        runLoopObserverCallback,
        &ctx);
    CFRunLoopAddObserver(CFRunLoopGetMain(), g_observer, kCFRunLoopCommonModes);

    // Spin the monitor thread.
    pthread_attr_t attr;
    pthread_attr_init(&attr);
    pthread_attr_setdetachstate(&attr, PTHREAD_CREATE_DETACHED);
    int err = pthread_create(&g_monitorThread, &attr, monitorThreadMain, NULL);
    pthread_attr_destroy(&attr);
    if (err != 0) {
        atomic_store_explicit(&g_running, false, memory_order_release);
        if (g_observer) {
            CFRunLoopRemoveObserver(CFRunLoopGetMain(), g_observer, kCFRunLoopCommonModes);
            CFRelease(g_observer);
            g_observer = NULL;
        }
        return NO;
    }

    // [T-ios-mem-footprint-delta-logging] Process-wide memory-pressure source:
    // updates g_memPressureLevel so the [MemMonitor] sampler can report the
    // system pressure water-line. Event-driven (no polling cost); the handler
    // also logs transitions immediately since a pressure change is significant.
    if (g_memPressureSource == nil) {
        unsigned long mask = DISPATCH_MEMORYPRESSURE_NORMAL |
                             DISPATCH_MEMORYPRESSURE_WARN |
                             DISPATCH_MEMORYPRESSURE_CRITICAL;
        g_memPressureSource = dispatch_source_create(
            DISPATCH_SOURCE_TYPE_MEMORYPRESSURE, 0, mask,
            dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_BACKGROUND, 0));
        if (g_memPressureSource) {
            dispatch_source_set_event_handler(g_memPressureSource, ^{
                unsigned long flags = dispatch_source_get_data(g_memPressureSource);
                uint32_t level = 0;
                const char *name = "normal";
                if (flags & DISPATCH_MEMORYPRESSURE_CRITICAL) { level = 2; name = "CRITICAL"; }
                else if (flags & DISPATCH_MEMORYPRESSURE_WARN) { level = 1; name = "warn"; }
                atomic_store_explicit(&g_memPressureLevel, level, memory_order_relaxed);
                NSLog(@"[MemMonitor] ⚠️ memory pressure → %s", name);
            });
            dispatch_resume(g_memPressureSource);
        }
    }

    NSLog(@"[HangDetector] started thresholdMs=%.0f", thresholdMs);
    return YES;
}

+ (void)stop {
    if (!atomic_load_explicit(&g_running, memory_order_relaxed)) return;
    atomic_store_explicit(&g_running, false, memory_order_release);

    if (g_observer) {
        CFRunLoopRemoveObserver(CFRunLoopGetMain(), g_observer, kCFRunLoopCommonModes);
        CFRelease(g_observer);
        g_observer = NULL;
    }
    // [T-ios-mem-footprint-delta-logging] Tear down the memory-pressure source.
    if (g_memPressureSource) {
        dispatch_source_cancel(g_memPressureSource);
        g_memPressureSource = nil;
    }
    // Monitor thread is detached; it will exit on its next loop check.
    g_monitorThread = (pthread_t)NULL;
    NSLog(@"[HangDetector] stopped");
}

+ (NSArray<HangEvent *> *)dumpLast:(NSUInteger)last clear:(BOOL)clear {
    os_unfair_lock_lock(&g_eventsLock);
    NSArray<HangEvent *> *snapshot;
    if (last == 0 || last >= g_events.count) {
        snapshot = [g_events copy] ?: @[];
    } else {
        NSRange r = NSMakeRange(g_events.count - last, last);
        snapshot = [g_events subarrayWithRange:r];
    }
    if (clear && g_events.count > 0) {
        [g_events removeAllObjects];
    }
    os_unfair_lock_unlock(&g_eventsLock);
    return snapshot;
}

+ (void)clearEvents {
    os_unfair_lock_lock(&g_eventsLock);
    [g_events removeAllObjects];
    os_unfair_lock_unlock(&g_eventsLock);
}

@end
