#import "ObjCExceptionCatcher.h"

BOOL MinisCatchObjCException(void (NS_NOESCAPE ^block)(void), NSString *_Nullable *_Nullable reason) {
    @try {
        block();
        return YES;
    } @catch (NSException *ex) {
        if (reason) {
            *reason = [NSString stringWithFormat:@"%@: %@", ex.name, ex.reason ?: @"(no reason)"];
        }
        return NO;
    }
}
