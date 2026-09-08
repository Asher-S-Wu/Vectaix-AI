//
//  AutoTouch.m
//  MinisApp
//
//  Simulates touch events using private UIKit APIs for debug/testing.
//

#import "AutoTouch.h"

#if TARGET_OS_IOS && DEBUG

// MARK: - Private API declarations

@interface UITouch (AutoTouchPrivate)
- (void)_setLocationInWindow:(CGPoint)location resetPrevious:(BOOL)resetPrevious;
- (void)setIsTap:(BOOL)isTap;
- (void)_setIsFirstTouchForView:(BOOL)isFirst;
- (void)setWindow:(UIWindow *)window;
- (void)setTimestamp:(NSTimeInterval)timestamp;
- (void)setPhase:(UITouchPhase)phase;
- (void)setTapCount:(NSUInteger)tapCount;
- (void)setView:(UIView *)view;
@end

@interface UIEvent (AutoTouchPrivate)
- (void)_clearTouches;
- (void)_addTouch:(UITouch *)touch forDelayedDelivery:(BOOL)delayed;
@end

@interface UIApplication (AutoTouchPrivate)
- (UIEvent *)_touchesEvent;
@end

// MARK: - Implementation

@implementation AutoTouch

#pragma mark - Touch Creation

+ (UITouch *)_createTouchAtPoint:(CGPoint)point inWindow:(UIWindow *)window {
    UITouch *touch = [[UITouch alloc] init];

    [touch setWindow:window];
    [touch setTimestamp:[[NSProcessInfo processInfo] systemUptime]];
    [touch setPhase:UITouchPhaseBegan];
    [touch setTapCount:1];

    if ([touch respondsToSelector:@selector(_setLocationInWindow:resetPrevious:)]) {
        [touch _setLocationInWindow:point resetPrevious:YES];
    }

    UIView *hitTestView = [window hitTest:point withEvent:nil];
    [touch setView:hitTestView];

    if ([touch respondsToSelector:@selector(setIsTap:)]) {
        [touch setIsTap:YES];
    }

    if ([touch respondsToSelector:@selector(_setIsFirstTouchForView:)]) {
        [touch _setIsFirstTouchForView:YES];
    }

    return touch;
}

+ (UIEvent *)_createEventWithTouches:(NSArray<UITouch *> *)touches {
    UIEvent *event = nil;

    UIApplication *app = [UIApplication sharedApplication];
    if ([app respondsToSelector:@selector(_touchesEvent)]) {
        event = [app _touchesEvent];
    }

    if (!event) {
        event = [[UIEvent alloc] init];
    }

    if ([event respondsToSelector:@selector(_clearTouches)]) {
        [event _clearTouches];
    }

    for (UITouch *touch in touches) {
        if ([event respondsToSelector:@selector(_addTouch:forDelayedDelivery:)]) {
            [event _addTouch:touch forDelayedDelivery:NO];
        }
    }

    return event;
}

#pragma mark - Tap Simulation

+ (void)simulateTapAtPoint:(CGPoint)point inWindow:(UIWindow *)window {
    if (!window) {
        window = [UIApplication sharedApplication].keyWindow;
    }
    if (!window) return;

    UITouch *touch = [self _createTouchAtPoint:point inWindow:window];
    UIEvent *beginEvent = [self _createEventWithTouches:@[touch]];
    [[UIApplication sharedApplication] sendEvent:beginEvent];

    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.05 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        [touch setTimestamp:[[NSProcessInfo processInfo] systemUptime]];
        [touch setPhase:UITouchPhaseEnded];

        UIEvent *endEvent = [self _createEventWithTouches:@[touch]];
        [[UIApplication sharedApplication] sendEvent:endEvent];
    });
}

+ (void)simulateTapAtPoint:(CGPoint)point inView:(UIView *)view {
    if (!view || !view.window) return;
    CGPoint windowPoint = [view.window convertPoint:point fromView:view];
    [self simulateTapAtPoint:windowPoint inWindow:view.window];
}

#pragma mark - Text Input

+ (BOOL)inputText:(NSString *)text {
    UIWindow *keyWindow = [UIApplication sharedApplication].keyWindow;
    if (!keyWindow) return NO;

    // Find the current first responder
    UIView *firstResponder = [self _findFirstResponderInView:keyWindow];
    if (!firstResponder) return NO;

    // Use UIKeyInput protocol if available
    if ([firstResponder conformsToProtocol:@protocol(UIKeyInput)]) {
        id<UIKeyInput> keyInput = (id<UIKeyInput>)firstResponder;
        for (NSUInteger i = 0; i < text.length; i++) {
            NSString *ch = [text substringWithRange:NSMakeRange(i, 1)];
            [keyInput insertText:ch];
        }
        return YES;
    }

    // Fallback: try setting text property directly
    if ([firstResponder isKindOfClass:[UITextField class]]) {
        UITextField *tf = (UITextField *)firstResponder;
        tf.text = [tf.text ?: @"" stringByAppendingString:text];
        [tf sendActionsForControlEvents:UIControlEventEditingChanged];
        return YES;
    }
    if ([firstResponder isKindOfClass:[UITextView class]]) {
        UITextView *tv = (UITextView *)firstResponder;
        tv.text = [tv.text ?: @"" stringByAppendingString:text];
        [[NSNotificationCenter defaultCenter] postNotificationName:UITextViewTextDidChangeNotification object:tv];
        return YES;
    }

    return NO;
}

+ (UIView *)_findFirstResponderInView:(UIView *)view {
    if ([view isFirstResponder]) return view;
    for (UIView *subview in view.subviews) {
        UIView *found = [self _findFirstResponderInView:subview];
        if (found) return found;
    }
    return nil;
}

#pragma mark - Scroll Simulation

+ (void)simulateScrollAtPoint:(CGPoint)startPoint deltaX:(CGFloat)deltaX deltaY:(CGFloat)deltaY inWindow:(UIWindow *)window {
    if (!window) {
        window = [UIApplication sharedApplication].keyWindow;
    }
    if (!window) return;

    // Number of intermediate move steps for a smooth scroll
    const int steps = 10;
    const NSTimeInterval stepInterval = 0.016; // ~60fps

    UITouch *touch = [self _createTouchAtPoint:startPoint inWindow:window];

    // Begin
    UIEvent *beginEvent = [self _createEventWithTouches:@[touch]];
    [[UIApplication sharedApplication] sendEvent:beginEvent];

    // Intermediate move steps
    for (int i = 1; i <= steps; i++) {
        CGFloat fraction = (CGFloat)i / (CGFloat)steps;
        CGPoint currentPoint = CGPointMake(startPoint.x + deltaX * fraction,
                                            startPoint.y + deltaY * fraction);
        NSTimeInterval delay = stepInterval * i;

        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(delay * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
            [touch setTimestamp:[[NSProcessInfo processInfo] systemUptime]];
            [touch setPhase:UITouchPhaseMoved];
            if ([touch respondsToSelector:@selector(setIsTap:)]) {
                [touch setIsTap:NO];
            }
            if ([touch respondsToSelector:@selector(_setLocationInWindow:resetPrevious:)]) {
                [touch _setLocationInWindow:currentPoint resetPrevious:NO];
            }

            UIEvent *moveEvent = [self _createEventWithTouches:@[touch]];
            [[UIApplication sharedApplication] sendEvent:moveEvent];
        });
    }

    // End
    NSTimeInterval endDelay = stepInterval * (steps + 1);
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(endDelay * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        CGPoint endPoint = CGPointMake(startPoint.x + deltaX, startPoint.y + deltaY);
        [touch setTimestamp:[[NSProcessInfo processInfo] systemUptime]];
        [touch setPhase:UITouchPhaseEnded];
        if ([touch respondsToSelector:@selector(_setLocationInWindow:resetPrevious:)]) {
            [touch _setLocationInWindow:endPoint resetPrevious:NO];
        }

        UIEvent *endEvent = [self _createEventWithTouches:@[touch]];
        [[UIApplication sharedApplication] sendEvent:endEvent];
    });
}

@end

#endif // TARGET_OS_IOS && DEBUG
