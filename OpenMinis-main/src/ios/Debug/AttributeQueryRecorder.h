//
//  AttributeQueryRecorder.h
//  Minis
//
//  Swizzle `-[NSConcreteMutableAttributedString attribute:atIndex:effectiveRange:]`
//  (and the corresponding NSAttributedString/NSMutableAttributedString class
//  pair as fallbacks) so we can record the last N calls into a tiny ring
//  buffer with no allocation on the hot path.
//
//  When HangDetector dumps a stall, Swift can call `+drainSnapshot` to
//  serialize the ring into the same log file. This gives a frame-accurate
//  list of which (attrName, charIndex) the typesetter was asking about at
//  the moment the main thread froze inside fillLayoutHole.
//
//  Cap: AQR_RING_CAP = 10 (per user request).
//  Recording is gated to the main thread; off-main calls are passed
//  through to the original implementation untouched.

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// One captured invocation. All fields are POD so the structure can be
/// snapshotted with a single memcpy under no lock.
typedef struct AttributeQuerySample {
    double  timestamp;       // CFAbsoluteTimeGetCurrent at call entry
    void   *receiver;        // raw NSAttributedString pointer (do NOT deref)
    void   *attrName;        // NSAttributedStringKey is a const NSString *
    NSUInteger index;
    NSUInteger storageLen;   // [receiver length] at call entry
    void   *returnedClass;   // Class of returned value (or NULL)
} AttributeQuerySample;

@interface AttributeQueryRecorder : NSObject

/// Install the swizzle. Call once at app launch on the main thread.
+ (void)install;

/// Number of attribute: calls observed since install. Monotonic. Useful
/// for sanity checking that the hot path is actually wired in.
+ (uint64_t)totalCalls;

/// Number of times the recorder short-circuited a same-tick same-args
/// duplicate (currently 0 — we always record). Reserved for future tuning.
+ (uint64_t)totalShortCircuits;

/// Build a string snapshot of the most recent up-to-AQR_RING_CAP calls in
/// chronological order. Safe to call from any thread; the snapshot races
/// the writer but the worst case is partially-overwritten samples (the
/// timestamps will reveal that). One line per sample, NUL-terminated.
///
/// Returns nil only if the recorder hasn't been installed or no calls
/// have been seen yet.
+ (nullable NSString *)drainSnapshot;

@end

NS_ASSUME_NONNULL_END
