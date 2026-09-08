#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Wraps `setValue:forKey:` in @try/@catch so private KVC keys
/// that are removed in newer iOS versions don't crash the app.
@interface SafeKVCSetTrue : NSObject
+ (BOOL)apply:(NSObject *)obj key:(NSString *)key;
@end

NS_ASSUME_NONNULL_END
