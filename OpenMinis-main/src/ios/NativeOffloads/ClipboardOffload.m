//
//  ClipboardOffload.m
//  MinisApp
//
//  Native offload handler for `apple-clipboard`.
//  Subcommands: get, set, clear, status
//

#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#import "NativeOffloadUtils.h"
#include "kernel/native_offload.h"
#include <unistd.h>

static NSString *const TOOL_NAME = @"apple-clipboard";

static NSString *const HELP_TEXT =
    @"apple-clipboard - Read and write the iOS clipboard\n"
     "\n"
     "USAGE:\n"
     "  apple-clipboard [command] [options]\n"
     "\n"
     "COMMANDS:\n"
     "  get       Read clipboard contents (default when no command given)\n"
     "  set       Write text to clipboard\n"
     "  clear     Clear the clipboard\n"
     "  status    Show clipboard content types\n"
     "\n"
     "OPTIONS:\n"
     "  --text <text>     Text to write (for 'set' command)\n"
     "  --image <path>    get: save clipboard image to <path>\n"
     "                    set: copy the image file at <path> to the clipboard\n"
     "  --help, -h        Show this help message\n"
     "  --compact         Minimize JSON output\n"
     "  -q, --quiet       Output only data field\n"
     "\n"
     "EXAMPLES:\n"
     "  apple-clipboard                 (same as: apple-clipboard get)\n"
     "  apple-clipboard get --image /var/minis/attachments/clipboard_image.png\n"
     "  apple-clipboard set --text \"Hello World\"\n"
     "  apple-clipboard set --image /var/minis/attachments/chart.png\n"
     "  echo \"piped text\" | apple-clipboard set\n"
     "  apple-clipboard clear\n"
     "  apple-clipboard status\n";

static int cmd_get(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    NSString *imageDest = noff_find_arg(argc, argv, "--image");
    __block NSDictionary *result;

    noff_dispatch_main_sync(^id{
        UIPasteboard *pb = [UIPasteboard generalPasteboard];
        NSMutableDictionary *data = [NSMutableDictionary dictionary];
        data[@"has_strings"] = @(pb.hasStrings);
        data[@"has_urls"] = @(pb.hasURLs);
        data[@"has_images"] = @(pb.hasImages);

        if (pb.hasStrings && pb.string) {
            data[@"text"] = pb.string;
        }
        if (pb.hasURLs && pb.URL) {
            data[@"url"] = pb.URL.absoluteString;
        }

        NSMutableArray *types = [NSMutableArray array];
        if (pb.hasStrings) [types addObject:@"public.utf8-plain-text"];
        if (pb.hasURLs) [types addObject:@"public.url"];
        if (pb.hasImages) [types addObject:@"public.image"];
        data[@"types"] = types;

        // --image <path>: save clipboard image to the given guest path
        if (imageDest && pb.hasImages && pb.image) {
            UIImage *img = pb.image;
            NSData *pngData = UIImagePNGRepresentation(img);
            if (pngData) {
                NSString *hostPath = noff_resolve_host_path(imageDest);
                if (hostPath) {
                    NSFileManager *fm = [NSFileManager defaultManager];
                    NSString *parentDir = [hostPath stringByDeletingLastPathComponent];
                    if (![fm fileExistsAtPath:parentDir]) {
                        [fm createDirectoryAtPath:parentDir
                      withIntermediateDirectories:YES
                                       attributes:nil
                                            error:nil];
                    }
                    NSError *writeErr = nil;
                    BOOL wrote = [pngData writeToFile:hostPath options:NSDataWritingAtomic error:&writeErr];
                    if (wrote) {
                        data[@"image_saved"] = imageDest;
                        data[@"image_size"] = @(pngData.length);
                        data[@"image_width"] = @((NSInteger)img.size.width);
                        data[@"image_height"] = @((NSInteger)img.size.height);
                    } else {
                        data[@"image_error"] = writeErr.localizedDescription ?: @"write failed";
                    }
                } else {
                    data[@"image_error"] = @"could not resolve host path";
                }
            } else {
                data[@"image_error"] = @"failed to encode image as PNG";
            }
        } else if (imageDest && (!pb.hasImages || !pb.image)) {
            data[@"image_error"] = @"no image in clipboard";
        }

        result = noff_json_envelope(TOOL_NAME, @"get", data);
        return nil;
    });

    noff_emit_json(stdout_fd, result, compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

/// Detect the pasteboard UTI for raw image bytes by magic number. Returns nil
/// for formats we don't recognize (caller falls back to PNG re-encode).
static NSString *noff_image_uti(NSData *data) {
    if (data.length < 12) return nil;
    const unsigned char *b = data.bytes;
    if (b[0] == 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G') return @"public.png";
    if (b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF) return @"public.jpeg";
    if (memcmp(b, "GIF8", 4) == 0) return @"com.compuserve.gif";
    return nil;
}

static int cmd_set_image(NSString *imagePath, NSString *text, int stdout_fd,
                          BOOL compact, BOOL quiet) {
    NSString *hostPath = noff_resolve_host_path(imagePath);
    // Attempt the read directly instead of a fileExistsAtPath pre-check —
    // this handler executes on an iSH emulation thread, and the read is the
    // one operation verified to work there (same convention as cmd_get's
    // write path, which never stats first).
    NSError *readErr = nil;
    NSData *raw = hostPath
        ? [NSData dataWithContentsOfFile:hostPath options:0 error:&readErr]
        : nil;
    if (!raw) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"set", NOFF_ERR_NO_DATA,
            [NSString stringWithFormat:@"Cannot read image file %@ (%@)",
             imagePath, readErr.localizedDescription ?: @"unresolvable path"]);
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }
    if (raw.length == 0) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"set", NOFF_ERR_NO_DATA,
            [NSString stringWithFormat:@"Image file is empty: %@", imagePath]);
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    UIImage *decoded = [UIImage imageWithData:raw];
    NSString *uti = noff_image_uti(raw);
    NSData *payload = raw;
    if (!uti) {
        // Unknown container (HEIC/WebP/BMP/...) — many paste targets only
        // accept png/jpeg items, so normalize through UIImage → PNG. If even
        // UIImage can't decode it, this is not an image we can copy.
        if (!decoded) {
            NSDictionary *err = noff_json_error(TOOL_NAME, @"set", NOFF_ERR_INVALID_ARGS,
                [NSString stringWithFormat:@"Not a decodable image (PNG/JPEG/GIF/HEIC/...): %@", imagePath]);
            noff_emit_json(stdout_fd, err, compact, quiet);
            return NOFF_EXIT_INVALID_ARGS;
        }
        payload = UIImagePNGRepresentation(decoded);
        if (payload.length == 0) {
            NSDictionary *err = noff_json_error(TOOL_NAME, @"set", NOFF_ERR_INTERNAL_ERROR,
                @"Failed to re-encode image as PNG");
            noff_emit_json(stdout_fd, err, compact, quiet);
            return NOFF_EXIT_ERROR;
        }
        uti = @"public.png";
    }

    // Single pasteboard item carrying the image bytes under their native UTI
    // (raw PNG/JPEG/GIF preserved verbatim — GIF keeps animation for targets
    // that accept com.compuserve.gif). Optional --text rides in the same item
    // as an additional representation.
    NSMutableDictionary *item = [NSMutableDictionary dictionary];
    item[uti] = payload;
    if (text.length > 0) {
        item[@"public.utf8-plain-text"] = text;
    }
    noff_dispatch_main_sync(^id{
        [UIPasteboard generalPasteboard].items = @[item];
        return nil;
    });

    NSMutableDictionary *data = [NSMutableDictionary dictionary];
    data[@"image"] = imagePath;
    data[@"uti"] = uti;
    data[@"bytes"] = @(payload.length);
    if (decoded) {
        data[@"width"] = @((NSInteger)decoded.size.width);
        data[@"height"] = @((NSInteger)decoded.size.height);
    }
    if (text.length > 0) data[@"text"] = text;
    NSDictionary *result = noff_json_envelope(TOOL_NAME, @"set", data);
    noff_emit_json(stdout_fd, result, compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

static int cmd_set(int argc, char **argv, int stdin_fd, int stdout_fd,
                    int stderr_fd, BOOL compact, BOOL quiet) {
    NSString *text = noff_find_arg(argc, argv, "--text");

    // set --image <path>: copy an image file to the clipboard. --text may
    // accompany it (both land in one pasteboard item); stdin is NOT consumed
    // in image mode.
    NSString *imagePath = noff_find_arg(argc, argv, "--image");
    if (imagePath) {
        return cmd_set_image(imagePath, text, stdout_fd, compact, quiet);
    }

    // If no --text, read from stdin
    if (!text) {
        text = noff_read_stdin(stdin_fd);
    }

    if (!text || text.length == 0) {
        noff_emit_help(stderr_fd, HELP_TEXT);
        NSDictionary *err = noff_json_error(TOOL_NAME, @"set",
                                             NOFF_ERR_INVALID_ARGS,
                                             @"No text provided. Use --text <text> or pipe via stdin.");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    noff_dispatch_main_sync(^id{
        [UIPasteboard generalPasteboard].string = text;
        return nil;
    });

    NSDictionary *data = @{
        @"text": text,
        @"length": @(text.length),
    };
    NSDictionary *result = noff_json_envelope(TOOL_NAME, @"set", data);
    noff_emit_json(stdout_fd, result, compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

static int cmd_clear(int stdout_fd, BOOL compact, BOOL quiet) {
    noff_dispatch_main_sync(^id{
        [UIPasteboard generalPasteboard].items = @[];
        return nil;
    });

    NSDictionary *data = @{@"cleared": @YES};
    NSDictionary *result = noff_json_envelope(TOOL_NAME, @"clear", data);
    noff_emit_json(stdout_fd, result, compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

static int cmd_status(int stdout_fd, BOOL compact, BOOL quiet) {
    __block NSDictionary *result;

    noff_dispatch_main_sync(^id{
        UIPasteboard *pb = [UIPasteboard generalPasteboard];
        NSMutableArray *types = [NSMutableArray array];
        if (pb.hasStrings) [types addObject:@"strings"];
        if (pb.hasURLs) [types addObject:@"urls"];
        if (pb.hasImages) [types addObject:@"images"];
        if (pb.hasColors) [types addObject:@"colors"];

        NSDictionary *data = @{
            @"has_content": @(pb.hasStrings || pb.hasURLs || pb.hasImages),
            @"types": types,
            @"item_count": @(pb.numberOfItems),
            @"change_count": @(pb.changeCount),
        };
        result = noff_json_envelope(TOOL_NAME, @"status", data);
        return nil;
    });

    noff_emit_json(stdout_fd, result, compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

static int clipboard_handler(int argc, char **argv,
                              int stdin_fd, int stdout_fd, int stderr_fd) {
    if (noff_has_flag(argc, argv, "--help") || noff_has_flag(argc, argv, "-h")) {
        noff_emit_help(stderr_fd, HELP_TEXT);
        return NOFF_EXIT_SUCCESS;
    }

    BOOL compact = noff_has_flag(argc, argv, "--compact");
    BOOL quiet = noff_has_flag(argc, argv, "-q") || noff_has_flag(argc, argv, "--quiet");

    NSString *subcmd = noff_get_subcommand(argc, argv);
    if (!subcmd) {
        // [T-offload-defaults-batch-ios] Bare `apple-clipboard` (including
        // flags-only invocations) defaults to `get` — same pattern as
        // apple-location: the common intent is "what's on the clipboard".
        subcmd = @"get";
    }

    if ([subcmd isEqualToString:@"get"]) {
        return cmd_get(argc, argv, stdout_fd, compact, quiet);
    } else if ([subcmd isEqualToString:@"set"]) {
        return cmd_set(argc, argv, stdin_fd, stdout_fd, stderr_fd, compact, quiet);
    } else if ([subcmd isEqualToString:@"clear"]) {
        return cmd_clear(stdout_fd, compact, quiet);
    } else if ([subcmd isEqualToString:@"status"]) {
        return cmd_status(stdout_fd, compact, quiet);
    }

    noff_emit_help(stderr_fd, HELP_TEXT);
    NSDictionary *err = noff_json_error(TOOL_NAME, subcmd,
                                         NOFF_ERR_INVALID_ARGS,
                                         [NSString stringWithFormat:@"Unknown command '%@'. Valid commands: get, set, clear, status. Use --help for details.", subcmd]);
    noff_emit_json(stdout_fd, err, compact, quiet);
    return NOFF_EXIT_INVALID_ARGS;
}

void clipboard_offload_register(void) {
    int err = native_offload_add_handler("apple-clipboard", clipboard_handler);
    if (err == 0) {
        noff_ensure_guest_stub("/usr/local/bin/apple-clipboard");
        NSLog(@"NativeOffloads: apple-clipboard handler registered");
    } else {
        NSLog(@"NativeOffloads: failed to register apple-clipboard handler (err=%d)", err);
    }
}
