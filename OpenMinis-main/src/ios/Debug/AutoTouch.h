//
//  AutoTouch.h
//  MinisApp
//
//  Simulates touch events, text input, and scroll gestures using private UIKit APIs.
//  DEBUG builds only — not for App Store submission.
//

#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

@interface AutoTouch : NSObject

/// Simulate a tap at a point in window coordinates.
+ (void)simulateTapAtPoint:(CGPoint)point inWindow:(nullable UIWindow *)window;

/// Simulate a tap at a point in a specific view's coordinate system.
+ (void)simulateTapAtPoint:(CGPoint)point inView:(UIView *)view;

/// Simulate typing text into the current first responder.
+ (BOOL)inputText:(NSString *)text;

/// Simulate a scroll (pan) gesture from startPoint by deltaX/deltaY in window coordinates.
+ (void)simulateScrollAtPoint:(CGPoint)startPoint deltaX:(CGFloat)deltaX deltaY:(CGFloat)deltaY inWindow:(nullable UIWindow *)window;

@end

NS_ASSUME_NONNULL_END
