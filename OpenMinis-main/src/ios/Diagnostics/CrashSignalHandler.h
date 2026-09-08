#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Installs signal handlers for SIGABRT, SIGSEGV, SIGBUS, SIGTRAP, SIGFPE,
/// SIGILL and an NSUncaughtExceptionHandler. On crash, walks the crashing
/// thread's frame-pointer chain and writes the stack to a file at
/// `last_crash_stack.txt` inside Application Support, using only
/// async-signal-safe calls (open/write/close, no malloc/ObjC).
///
/// CrashReporter reads this file on the next launch and includes it in the
/// crash report. The file is deleted after reading.
@interface CrashSignalHandler : NSObject

/// Install handlers. Safe to call once at app launch.
+ (void)install;

/// Path to the crash stack file. Same directory as CrashReporter.hangSnapshotURL.
+ (NSString *)crashStackPath;

@end

NS_ASSUME_NONNULL_END
