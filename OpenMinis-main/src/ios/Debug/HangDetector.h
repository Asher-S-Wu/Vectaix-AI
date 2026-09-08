//
//  HangDetector.h
//  MinisApp (Debug only)
//
//  Main-thread hang detector. Compiled in only for DEBUG builds.
//
//  Mechanism: a CFRunLoopObserver on the main runloop updates a heartbeat
//  timestamp on each pass. A background monitor thread polls every 50ms;
//  if the main thread has been in a non-waiting activity for longer than
//  the configured threshold, the monitor suspends it, walks the frame
//  pointer chain via mach APIs, resumes it, and records the captured
//  stack to a ring buffer.
//
//  Safety: while the main thread is suspended, the monitor only does mach
//  calls + raw pointer reads + dladdr. No malloc, no Objective-C, no
//  Foundation, no logging. After resume, the captured frames are queued
//  and any user-visible work (logging, formatting) happens on the
//  monitor thread without holding any lock the main thread might want.
//
//  Available in both Debug and Release. The opt-in is at runtime via
//  +start: (typically driven by AIChatViewModel.isProcessing through
//  StreamingHangLogger). When stopped, both threads are idle and the
//  observer is removed.
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// One captured frame in a hang stack.
@interface HangFrame : NSObject
/// Absolute PC / LR address.
@property (nonatomic, assign) uintptr_t address;
/// Image base name (e.g. "Minis", "UIKitCore"); nil if dladdr failed.
@property (nonatomic, copy, nullable) NSString *imageName;
/// Address relative to the image base (suitable for `atos -l 0x100000000 + offset`).
@property (nonatomic, assign) uintptr_t imageOffset;
/// Symbol name from dladdr if available (often missing for stripped binaries).
@property (nonatomic, copy, nullable) NSString *symbol;
@end

/// One recorded hang event.
@interface HangEvent : NSObject
/// Wall-clock time (Unix epoch, seconds with subsecond precision) when
/// the hang was detected.
@property (nonatomic, assign) NSTimeInterval timestamp;
/// How long the main thread had been busy when we captured (ms).
@property (nonatomic, assign) double durationMs;
/// Main-thread RunLoop activity flag at the moment of capture, raw value
/// from CFRunLoopActivity. Useful to distinguish "stuck before sources"
/// vs "stuck before timers" etc.
@property (nonatomic, assign) NSUInteger runLoopActivity;
/// Captured frames, oldest at the end (first frame is the leaf / PC).
@property (nonatomic, copy) NSArray<HangFrame *> *frames;
/// Number of consecutive samples that produced this identical stack
/// before something else (recovery or a different stack) ended the run.
/// 1 = single sample; N = identical PC frames observed N times in a row.
/// Refreshed in-place by the monitor while the run continues.
@property (nonatomic, assign) uint32_t repeatCount;
/// Wall-clock time (Unix epoch) of the LAST sample that matched this
/// stack. Lets a log reader see "this stack was still pinned at t=N".
@property (nonatomic, assign) NSTimeInterval lastSeenAt;
@end

@interface HangDetector : NSObject

/// Whether the detector is currently running.
@property (class, nonatomic, readonly) BOOL isRunning;

/// Current threshold in milliseconds. Default 100.
@property (class, nonatomic, readonly) double thresholdMs;

/// Number of events currently buffered.
@property (class, nonatomic, readonly) NSUInteger eventCount;

/// Start monitoring the main thread.
/// @param thresholdMs Hang threshold in milliseconds. Capped to [16, 5000].
/// @return YES if started; NO if already running.
+ (BOOL)startWithThresholdMs:(double)thresholdMs;

/// Stop monitoring. Existing buffered events are preserved.
+ (void)stop;

/// Snapshot the most recent events (newest last). Pass last=0 for all.
/// @param clear If YES, clear the buffer after returning the snapshot.
+ (NSArray<HangEvent *> *)dumpLast:(NSUInteger)last clear:(BOOL)clear;

/// Clear all buffered events without stopping the detector.
+ (void)clearEvents;

@end

NS_ASSUME_NONNULL_END
