//
//  AttributeQueryRecorder.m
//

#import "AttributeQueryRecorder.h"
#import <objc/runtime.h>
#import <objc/message.h>
#import <stdatomic.h>

#define AQR_RING_CAP 10

// Ring buffer: lock-free single-writer (always main thread).
static AttributeQuerySample gRing[AQR_RING_CAP];

// Monotonically increasing slot counter. Slot index = counter % AQR_RING_CAP.
// Use atomic so a reader on another thread (drainSnapshot) sees a
// well-ordered count; the actual slot bytes may still tear under a
// concurrent read, which is acceptable for a diagnostic ring.
static _Atomic(uint64_t) gCallCount = 0;
static _Atomic(uint64_t) gShortCircuitCount = 0;

// Original IMPs, indexed in install-order so we can invoke per-class.
typedef NSObject *(*AttrQueryFn)(id, SEL, NSAttributedStringKey, NSUInteger, NSRangePointer);
static AttrQueryFn gOrigConcrete   = NULL;  // NSConcreteMutableAttributedString
static AttrQueryFn gOrigMutable    = NULL;  // NSMutableAttributedString
static AttrQueryFn gOrigBase       = NULL;  // NSAttributedString

static inline void recordSampleMainThread(id receiver, NSAttributedStringKey name, NSUInteger index, NSObject *returned) {
    // Compute slot before incrementing so the counter strictly leads the
    // most recently written index by 1.
    uint64_t slotIdx = atomic_fetch_add_explicit(&gCallCount, 1, memory_order_relaxed);
    AttributeQuerySample *s = &gRing[slotIdx % AQR_RING_CAP];

    // Bypass [receiver length] when receiver is nil (paranoia — should
    // never happen since we're called from a swizzled instance method).
    NSUInteger len = 0;
    if (receiver) {
        // length is O(1) on NSAttributedString backed by a UTF-16 buffer.
        len = ((NSUInteger (*)(id, SEL))objc_msgSend)(receiver, @selector(length));
    }

    s->timestamp     = CFAbsoluteTimeGetCurrent();
    s->receiver      = (__bridge void *)receiver;
    s->attrName      = (__bridge void *)name;
    s->index         = index;
    s->storageLen    = len;
    s->returnedClass = returned ? (__bridge void *)[returned class] : NULL;
}

#define DEFINE_HOOK(NAME, ORIG_VAR) \
    static NSObject *minis_attrQuery_##NAME(id self, SEL _cmd, NSAttributedStringKey name, NSUInteger index, NSRangePointer range) { \
        NSObject *result = ORIG_VAR(self, _cmd, name, index, range); \
        if ([NSThread isMainThread]) { \
            recordSampleMainThread(self, name, index, result); \
        } \
        return result; \
    }

DEFINE_HOOK(Concrete, gOrigConcrete)
DEFINE_HOOK(Mutable,  gOrigMutable)
DEFINE_HOOK(Base,     gOrigBase)

static AttrQueryFn swizzleOne(Class cls, IMP newImp) {
    if (!cls) return NULL;
    SEL sel = @selector(attribute:atIndex:effectiveRange:);
    Method m = class_getInstanceMethod(cls, sel);
    if (!m) return NULL;
    return (AttrQueryFn)method_setImplementation(m, newImp);
}

@implementation AttributeQueryRecorder

+ (void)install {
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        if (![NSThread isMainThread]) {
            dispatch_async(dispatch_get_main_queue(), ^{ [AttributeQueryRecorder install]; });
            return;
        }

        // Concrete classes ship the real implementation; the public
        // umbrella class methods are abstract dispatchers. We try all
        // three reachable variants in install order so whichever one the
        // typesetter resolves to is captured.
        Class concrete = NSClassFromString(@"NSConcreteMutableAttributedString");
        Class mutable  = NSClassFromString(@"NSMutableAttributedString");
        Class base     = NSClassFromString(@"NSAttributedString");

        gOrigConcrete = swizzleOne(concrete, (IMP)minis_attrQuery_Concrete);
        gOrigMutable  = swizzleOne(mutable,  (IMP)minis_attrQuery_Mutable);
        gOrigBase     = swizzleOne(base,     (IMP)minis_attrQuery_Base);

        memset(gRing, 0, sizeof(gRing));

        NSLog(@"[AttributeQueryRecorder] [INFO] installed concrete=%p mutable=%p base=%p cap=%d",
              gOrigConcrete, gOrigMutable, gOrigBase, AQR_RING_CAP);
    });
}

+ (uint64_t)totalCalls {
    return atomic_load_explicit(&gCallCount, memory_order_relaxed);
}

+ (uint64_t)totalShortCircuits {
    return atomic_load_explicit(&gShortCircuitCount, memory_order_relaxed);
}

+ (NSString *)drainSnapshot {
    uint64_t total = atomic_load_explicit(&gCallCount, memory_order_relaxed);
    if (total == 0) return nil;

    // Copy the ring under no lock — best-effort snapshot.
    AttributeQuerySample local[AQR_RING_CAP];
    memcpy(local, gRing, sizeof(local));

    // Walk samples in chronological order. If we've wrapped, the oldest
    // sample lives at slot `total % CAP` (about to be overwritten); the
    // newest lives at slot `(total - 1) % CAP`.
    NSUInteger count = total < AQR_RING_CAP ? (NSUInteger)total : AQR_RING_CAP;
    NSUInteger startSlot = total < AQR_RING_CAP ? 0 : (NSUInteger)(total % AQR_RING_CAP);

    NSMutableString *out = [NSMutableString stringWithCapacity:count * 160];
    [out appendFormat:@"[AttributeQuery] === recent %lu attribute:atIndex:effectiveRange: call(s), totalSeen=%llu ===\n",
                     (unsigned long)count, (unsigned long long)total];

    for (NSUInteger i = 0; i < count; i++) {
        AttributeQuerySample *s = &local[(startSlot + i) % AQR_RING_CAP];
        // Best-effort: render attrName/receiver/returnedClass as strings.
        // attrName is a const NSAttributedStringKey (NSString *) — safe to
        // describe since these are framework constants that outlive us.
        NSString *attrDesc;
        if (s->attrName) {
            // Defensive cast; should always be an NSString.
            @try {
                attrDesc = [(__bridge NSString *)s->attrName copy];
            } @catch (NSException *e) {
                attrDesc = @"<bad-attrName>";
            }
        } else {
            attrDesc = @"<nil>";
        }
        NSString *retClsName;
        if (s->returnedClass) {
            @try {
                retClsName = NSStringFromClass((__bridge Class)s->returnedClass);
            } @catch (NSException *e) {
                retClsName = @"<bad-class>";
            }
        } else {
            retClsName = @"<nil>";
        }
        [out appendFormat:@"[AttributeQuery]   [%lu] t=%.3f recv=%p attr=%@ idx=%lu storLen=%lu retCls=%@\n",
                          (unsigned long)i,
                          s->timestamp,
                          s->receiver,
                          attrDesc,
                          (unsigned long)s->index,
                          (unsigned long)s->storageLen,
                          retClsName];
    }
    return out;
}

@end
