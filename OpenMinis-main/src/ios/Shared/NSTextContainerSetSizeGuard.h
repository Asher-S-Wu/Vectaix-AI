//
//  NSTextContainerSetSizeGuard.h
//  Minis
//
//  Reentrancy guard for -[NSTextContainer setSize:].
//
//  Background: NSTextContainer.setSize: triggers
//  -[NSLayoutManager textContainerChangedGeometry:] which calls
//  _invalidateLayoutForExtendedCharacterRange and re-enters
//  _fillLayoutHole. On iOS 26 TextKit1 with markdown tables hosted in
//  UITextView, a single SwiftUI geometry-commit can drive several
//  redundant setSize calls in the same runloop tick (same container,
//  same value), each of which retriggers the typesetter feedback loop.
//  Repeated enough times this exceeds the 10s scene-update watchdog
//  and the system kills the app with 0x8BADF00D.
//
//  This guard swizzles setSize: and short-circuits redundant calls in
//  the same runloop tick. It does NOT modify the size value itself,
//  it only skips the work when the new size equals the cached size
//  *and* the same container has already been hit in this tick.
//
//  Logs a warning when a short-circuit fires so we can monitor how
//  often this rescues us in production.

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface NSTextContainerSetSizeGuard : NSObject

/// Install the swizzle. Call once at app launch on the main thread.
+ (void)install;

/// Total number of short-circuited setSize: calls since install.
/// Visible for debugging and analytics; updated on main thread.
+ (uint64_t)shortCircuitCount;

@end

NS_ASSUME_NONNULL_END
