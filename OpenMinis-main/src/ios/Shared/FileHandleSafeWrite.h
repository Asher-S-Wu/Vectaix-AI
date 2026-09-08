//
//  FileHandleSafeWrite.h
//  MinisApp
//
//  NSFileHandle raises an ObjC `NSFileHandleOperationException` when a
//  write fails (disk full, pipe closed, fd invalidated mid-call) — Swift's
//  do/catch cannot catch those; an unhandled NSException reaches
//  `__cxa_throw` and the C++ terminate handler aborts the whole process.
//  LoggingManager.reader is particularly exposed: it runs on a background
//  thread with nothing else holding a try/catch above it, and any transient
//  write failure takes the app down.
//
//  This header exposes a thin Objective-C wrapper that takes the NSFileHandle
//  write under `@try/@catch` and returns a BOOL success flag instead.
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Writes `data` to `handle` inside an Objective-C @try/@catch. Returns YES
/// on success, NO if the write raised an NSException (e.g. pipe closed,
/// disk full, fd invalidated). The caller may also inspect `errorMessage`
/// (nullable) to get the exception reason for logging.
BOOL MinisFileHandleSafeWrite(NSFileHandle *handle, NSData *data, NSString *_Nullable *_Nullable errorMessage);

NS_ASSUME_NONNULL_END
