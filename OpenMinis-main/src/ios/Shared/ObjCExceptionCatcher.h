//
//  ObjCExceptionCatcher.h
//  MinisApp
//
//  Generic @try/@catch bridge for Swift call sites that invoke
//  Objective-C machinery capable of raising NSExceptions Swift cannot
//  catch (perform(_:), accessibility activation, KVC, NSInvocation…).
//  An uncaught NSException reaches __cxa_throw and the C++ terminate
//  handler aborts the whole process — for best-effort paths (debug
//  automation, diagnostics) that trade is never worth it.
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Runs `block` inside an Objective-C @try/@catch. Returns YES when the
/// block completed normally, NO when it raised — `reason` (nullable out)
/// then carries "<name>: <reason>" for logging.
BOOL MinisCatchObjCException(void (NS_NOESCAPE ^block)(void), NSString *_Nullable *_Nullable reason);

NS_ASSUME_NONNULL_END
