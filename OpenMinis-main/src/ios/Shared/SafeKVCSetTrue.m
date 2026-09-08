#import "SafeKVCSetTrue.h"

@implementation SafeKVCSetTrue

+ (BOOL)apply:(NSObject *)obj key:(NSString *)key {
    @try {
        [obj setValue:@YES forKey:key];
        return YES;
    } @catch (NSException *e) {
        NSLog(@"[SafeKVCSetTrue] key '%@' not supported on %@: %@",
              key, NSStringFromClass(obj.class), e.reason);
        return NO;
    }
}

@end
