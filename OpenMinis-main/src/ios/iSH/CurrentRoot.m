//
//  CurrentRoot.m
//  Minis — adapted from iSH app/CurrentRoot.m
//
//  Applies rootfs overlay patches from RootfsPatch.bundle on boot.
//

#import "CurrentRoot.h"
#include "ish/kernel/calls.h"
#include "ish/fs/path.h"

static ssize_t read_file(const char *path, char *buf, size_t size) {
    struct fd *fd = generic_open(path, O_RDONLY_, 0);
    if (IS_ERR(fd))
        return PTR_ERR(fd);
    ssize_t n = fd->ops->read(fd, buf, size);
    fd_close(fd);
    if (n == size)
        return _ENAMETOOLONG;
    return n;
}

static ssize_t write_file(const char *path, const char *buf, size_t size) {
    struct fd *fd = generic_open(path, O_WRONLY_|O_CREAT_|O_TRUNC_, 0644);
    if (IS_ERR(fd))
        return PTR_ERR(fd);
    ssize_t n = fd->ops->write(fd, buf, size);
    fd_close(fd);
    return n;
}

void FsApplyOverlay(void) {
    // Locate RootfsPatch.bundle inside the app bundle
    NSBundle *patchBundle = [NSBundle bundleWithURL:
        [NSBundle.mainBundle URLForResource:@"RootfsPatch" withExtension:@"bundle"]];
    if (patchBundle == nil) {
        NSLog(@"[RootfsPatch] bundle not found, skipping overlay");
        return;
    }

    // Read manifest
    NSURL *manifestURL = [patchBundle URLForResource:@"manifest" withExtension:@"plist"];
    if (manifestURL == nil) {
        NSLog(@"[RootfsPatch] manifest.plist not found in bundle");
        return;
    }
    NSDictionary *manifest = [NSDictionary dictionaryWithContentsOfURL:manifestURL];
    if (manifest == nil) {
        NSLog(@"[RootfsPatch] failed to parse manifest.plist");
        return;
    }

    int patchVersion = [manifest[@"version"] intValue];
    if (patchVersion <= 0)
        return;

    // Check installed overlay version in guest fs
    char buf[100];
    int installedVersion = 0;
    ssize_t n = read_file("/ish/overlay-version", buf, sizeof(buf));
    if (n > 0) {
        buf[n] = '\0';
        installedVersion = atoi(buf);
    }
    if (installedVersion >= patchVersion) {
        NSLog(@"[RootfsPatch] v%d already installed (bundle v%d), skipping", installedVersion, patchVersion);
        return;
    }

    NSLog(@"[RootfsPatch] applying v%d (installed v%d)", patchVersion, installedVersion);

    // Apply each file from the manifest
    NSArray *files = manifest[@"files"];
    if (files == nil)
        return;

    int applied = 0, failed = 0;
    for (NSDictionary *entry in files) {
        NSString *src = entry[@"src"];
        NSString *dst = entry[@"dst"];
        if (src == nil || dst == nil)
            continue;

        // Ensure parent directories exist in guest fs
        NSString *parentDir = [dst stringByDeletingLastPathComponent];
        if (parentDir.length > 1)
            generic_mkdirat(AT_PWD, parentDir.UTF8String, 0755);

        // Read file from patch bundle
        NSURL *srcURL = [patchBundle.bundleURL URLByAppendingPathComponent:src];
        NSData *data = [NSData dataWithContentsOfURL:srcURL];
        if (data == nil) {
            NSLog(@"[RootfsPatch] SKIP %@ (not found in bundle)", src);
            failed++;
            continue;
        }

        ssize_t written = write_file(dst.UTF8String, data.bytes, data.length);
        if (written < 0) {
            NSLog(@"[RootfsPatch] FAIL %@ -> %@ (error %zd)", src, dst, written);
            failed++;
        } else {
            NSLog(@"[RootfsPatch] OK %@ -> %@ (%lu bytes)", src, dst, (unsigned long)data.length);
            applied++;
        }
    }

    // Record installed version
    generic_mkdirat(AT_PWD, "/ish", 0755);
    NSString *versionStr = [NSString stringWithFormat:@"%d\n", patchVersion];
    write_file("/ish/overlay-version", versionStr.UTF8String,
               [versionStr lengthOfBytesUsingEncoding:NSUTF8StringEncoding]);

    NSLog(@"[RootfsPatch] done: %d applied, %d failed, now at v%d", applied, failed, patchVersion);
}
