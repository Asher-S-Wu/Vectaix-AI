//
//  CurrentRoot.h
//  Minis — adapted from iSH app/CurrentRoot.h
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Apply rootfs patches from RootfsPatch.bundle on boot.
/// The bundle contains a manifest.plist with a version number and file list.
/// Files are written to guest fs when the bundle version exceeds /ish/overlay-version.
void FsApplyOverlay(void);

NS_ASSUME_NONNULL_END
