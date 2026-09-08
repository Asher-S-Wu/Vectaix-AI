//
//  NSTextContainerSetSizeGuard.m
//

#import "NSTextContainerSetSizeGuard.h"
#import <UIKit/UIKit.h>
#import <objc/runtime.h>
#import <objc/message.h>

// Associated-object key used to stash the per-container "last seen"
// state (last size + last tick + repeat count in this tick).
static const void *kGuardStateKey = &kGuardStateKey;

// Threshold: when the same container is asked to setSize: to the same
// value more than N times in a single runloop tick (after the first),
// short-circuit the rest. Picked to be > 1 so an initial legitimate
// duplicate (e.g. SwiftUI's two-axis probing) still flows through, but
// a reentrancy storm is broken.
static const NSInteger kRepeatThreshold = 2;

// Monotonic tick id, bumped from a runloop observer (BeforeWaiting).
// Two setSize: calls within the same tick share the same value here.
static uint64_t gRunloopTick = 0;

// Counter for analytics.
static uint64_t gShortCircuitCount = 0;

typedef struct {
    CGSize lastSize;
    uint64_t lastTick;
    NSInteger repeatCount;
    BOOL initialized;
} GuardState;

@interface _NSTextContainerGuardState : NSObject {
@public
    GuardState state;
}
@end

@implementation _NSTextContainerGuardState
@end

static IMP gOriginalSetSize = NULL;

static void minis_NSTextContainer_setSize(id self, SEL _cmd, CGSize newSize) {
    if (![NSThread isMainThread]) {
        // Off-main calls (rare) bypass the guard entirely. Safer to
        // forward unconditionally than risk dropping a legit update.
        ((void (*)(id, SEL, CGSize))gOriginalSetSize)(self, _cmd, newSize);
        return;
    }

    // Sanitise obviously poisoned sizes that SwiftUI's measure path
    // occasionally leaks through (observed in Minis-2026-05-22-225827.ips
    // ViewGraphGeometryObservers crash logs: `408 x 1.79e308` from
    // Double.greatestFiniteMagnitude, and `-16 x 0` from a ViewGraph
    // arithmetic underflow). NSTextContainer reacts to setSize: by
    // invalidating its layout manager's typeset and re-entering the
    // _fillLayoutHole storm; that re-entry runs concurrently with
    // SwiftUI's AsyncRenderer thread mutating ViewGraphGeometryObservers,
    // which is exactly the FB13213926 race.
    //
    // Two classes of input:
    //
    //  (1) Structurally bad — NaN / inf / negative. NSTextContainer can't
    //      represent these meaningfully; hard-reject before TextKit sees
    //      them. The original setSize: never runs, the reentrant
    //      _fillLayoutHole cascade never fires.
    //
    //  (2) Legitimate "unbounded container" — code calls
    //      `tc.size = CGSize(width: w, height: .greatestFiniteMagnitude)`
    //      on purpose to disable height clamping during typesetting (used
    //      throughout SelectableMarkdownView for the live + measure
    //      textViews). The previous version rejected these outright as
    //      "> 1e7", which silently dropped the width too — leading to
    //      typesetter measuring against a 0×0 container, a wrong height,
    //      and the rightmost characters of the last visual line getting
    //      clipped (T-truncated-last-line, observed via STF-trace dump).
    //      Clamp instead of reject: 1e7 is still ~30× the tallest real
    //      chat bubble (6000pt CALayer ceiling), so the typesetter
    //      treats it as unbounded just like .greatestFiniteMagnitude
    //      would. dedup below still collapses repeat probes within the
    //      same runloop tick, preserving the race-mitigation effect.
    if (!isfinite(newSize.width) || !isfinite(newSize.height) ||
        newSize.width < 0 || newSize.height < 0) {
        gShortCircuitCount += 1;
        if ((gShortCircuitCount & 0x1F) == 1) {
            NSLog(@"[TextContainerGuard] [WARN] short-circuited setSize: "
                  @"REJECT-NAN-INF-NEG size=%.1fx%.1f total=%llu container=%p",
                  newSize.width, newSize.height,
                  (unsigned long long)gShortCircuitCount,
                  (__bridge void *)self);
        }
        return;
    }
    if (newSize.width > 1e7) newSize.width = 1e7;
    if (newSize.height > 1e7) newSize.height = 1e7;

    _NSTextContainerGuardState *holder = objc_getAssociatedObject(self, kGuardStateKey);
    if (!holder) {
        holder = [_NSTextContainerGuardState new];
        objc_setAssociatedObject(self, kGuardStateKey, holder, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    }

    GuardState *s = &holder->state;

    if (s->initialized && s->lastTick == gRunloopTick &&
        CGSizeEqualToSize(s->lastSize, newSize)) {
        // Same tick, same container, same target size — increment and
        // short-circuit once we cross the threshold.
        s->repeatCount += 1;
        if (s->repeatCount >= kRepeatThreshold) {
            gShortCircuitCount += 1;
            // Periodic warn log: every 16 short-circuits (≈ once per
            // visible reentrancy storm) to bound log volume.
            if ((gShortCircuitCount & 0xF) == 1) {
                NSLog(@"[TextContainerGuard] [WARN] short-circuited setSize: "
                      @"size=%.1fx%.1f tick=%llu repeatThisTick=%ld "
                      @"totalShortCircuits=%llu container=%p",
                      newSize.width, newSize.height,
                      (unsigned long long)gRunloopTick,
                      (long)s->repeatCount,
                      (unsigned long long)gShortCircuitCount,
                      (__bridge void *)self);
            }
            return; // skip forwarding to original setSize:
        }
    } else {
        // Different tick or different size — reset bookkeeping.
        s->lastSize = newSize;
        s->lastTick = gRunloopTick;
        s->repeatCount = 1;
        s->initialized = YES;
    }

    ((void (*)(id, SEL, CGSize))gOriginalSetSize)(self, _cmd, newSize);
}

static void bumpRunloopTick(CFRunLoopObserverRef obs, CFRunLoopActivity act, void *info) {
    (void)obs; (void)act; (void)info;
    // Increment per runloop pass. We bump on BOTH BeforeWaiting and
    // AfterWaiting so a runloop pass that doesn't sleep (e.g. a busy
    // scene-update commit) still rotates the tick. Wrapping uint64
    // is fine for this purpose.
    gRunloopTick += 1;
}

@implementation NSTextContainerSetSizeGuard

+ (void)install {
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        if (![NSThread isMainThread]) {
            NSLog(@"[TextContainerGuard] [WARN] install called off main; deferring");
            dispatch_async(dispatch_get_main_queue(), ^{ [NSTextContainerSetSizeGuard install]; });
            return;
        }

        Class cls = NSClassFromString(@"NSTextContainer");
        SEL sel = @selector(setSize:);
        Method m = class_getInstanceMethod(cls, sel);
        if (!m) {
            NSLog(@"[TextContainerGuard] [WARN] setSize: method not found on NSTextContainer");
            return;
        }
        gOriginalSetSize = method_setImplementation(m, (IMP)minis_NSTextContainer_setSize);

        // Runloop observer to rotate the tick id. Order 999_999 puts us
        // after typical layout observers; the exact value is not
        // critical because all we need is a monotonic-ish counter that
        // increases at least once per pass.
        CFRunLoopObserverRef obs = CFRunLoopObserverCreate(
            kCFAllocatorDefault,
            kCFRunLoopBeforeWaiting | kCFRunLoopAfterWaiting,
            true /* repeats */,
            999999 /* order */,
            bumpRunloopTick,
            NULL);
        if (obs) {
            CFRunLoopAddObserver(CFRunLoopGetMain(), obs, kCFRunLoopCommonModes);
            CFRelease(obs);
        }

        NSLog(@"[TextContainerGuard] [INFO] installed (threshold=%ld)", (long)kRepeatThreshold);
    });
}

+ (uint64_t)shortCircuitCount {
    return gShortCircuitCount;
}

@end
