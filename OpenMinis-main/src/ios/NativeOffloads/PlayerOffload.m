//
//  PlayerOffload.m
//  MinisApp
//
//  Native offload handler for `apple-player`.
//  Subcommands: play, pause, resume, seek, status, stop, list
//

#import <Foundation/Foundation.h>
#import <AVFoundation/AVFoundation.h>
#import <UIKit/UIKit.h>
#import "NativeOffloadUtils.h"
#include "kernel/native_offload.h"
#include <unistd.h>

#import "Minis-Swift.h"

static NSString *const TOOL_NAME = @"apple-player";

static NSString *const HELP_TEXT =
    @"apple-player - Media playback using native AVPlayer\n"
     "\n"
     "USAGE:\n"
     "  apple-player <command> [options]\n"
     "\n"
     "COMMANDS:\n"
     "  play <file>               Open media file in native player\n"
     "  pause <session_id>        Pause playback\n"
     "  resume <session_id>       Resume playback\n"
     "  seek <session_id> <secs>  Seek to position in seconds\n"
     "  status <session_id>       Get current playback status\n"
     "  stop <session_id>         Stop playback and close player\n"
     "  list                      List active playback sessions\n"
     "\n"
     "COMMON OPTIONS:\n"
     "  --help, -h           Show this help message\n"
     "  --compact            Minimize JSON output\n"
     "  -q, --quiet          Output only data field\n"
     "\n"
     "EXAMPLES:\n"
     "  apple-player play /var/minis/workspace/video.mp4\n"
     "  apple-player pause abc123\n"
     "  apple-player seek abc123 30.5\n"
     "  apple-player status abc123\n"
     "  apple-player stop abc123\n"
     "  apple-player list\n";

// ── Subcommands ──

static int cmd_play(int argc, char **argv, int stdout_fd, int stderr_fd, BOOL compact, BOOL quiet) {
    NSArray<NSString *> *positional = noff_positional_args(argc, argv);
    if (positional.count < 1) {
        noff_emit_help(stderr_fd, HELP_TEXT);
        NSDictionary *err = noff_json_error(TOOL_NAME, @"play",
                                             NOFF_ERR_INVALID_ARGS,
                                             @"No file path provided. Usage: apple-player play <file>");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    NSString *guestPath = positional[0];

    // argv paths are already translated to host paths by native_offload_exec,
    // but we also handle guest paths that start with / for robustness.
    NSString *hostPath = nil;
    if ([guestPath hasPrefix:@"/var/minis/"] || [guestPath hasPrefix:@"/home/"] || [guestPath hasPrefix:@"/tmp/"]) {
        hostPath = noff_resolve_host_path(guestPath);
    } else {
        hostPath = guestPath;
    }

    if (!hostPath || ![[NSFileManager defaultManager] fileExistsAtPath:hostPath]) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"play",
                                             NOFF_ERR_INVALID_ARGS,
                                             [NSString stringWithFormat:@"File not found: %@", guestPath]);
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_ERROR;
    }

    NSURL *fileURL = [NSURL fileURLWithPath:hostPath];

    // Call Swift bridge on main thread
    __block NSDictionary *result = nil;
    __block NSString *errorMsg = nil;

    dispatch_semaphore_t sem = dispatch_semaphore_create(0);

    noff_dispatch_main_sync(^id{
        [PlayerOffloadBridge openPlayerWithUrl:fileURL
                                    guestPath:guestPath
                                   completion:^(NSDictionary *data, NSString *error) {
            result = data;
            errorMsg = error;
            dispatch_semaphore_signal(sem);
        }];
        return nil;
    });

    // Wait for the bridge to return session info (should be fast — just creates player)
    dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC));

    if (errorMsg) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"play",
                                             NOFF_ERR_INTERNAL_ERROR, errorMsg);
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_ERROR;
    }

    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"play", result ?: @{}), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

static int cmd_pause(int argc, char **argv, int stdout_fd, int stderr_fd, BOOL compact, BOOL quiet) {
    NSArray<NSString *> *positional = noff_positional_args(argc, argv);
    if (positional.count < 1) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"pause",
                                             NOFF_ERR_INVALID_ARGS,
                                             @"No session_id provided. Usage: apple-player pause <session_id>");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    NSString *sessionId = positional[0];
    __block NSDictionary *result = nil;
    __block NSString *errorMsg = nil;

    noff_dispatch_main_sync(^id{
        result = [PlayerOffloadBridge pauseSession:sessionId error:&errorMsg];
        return nil;
    });

    if (errorMsg) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"pause",
                                             NOFF_ERR_INVALID_ARGS, errorMsg);
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_ERROR;
    }

    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"pause", result ?: @{}), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

static int cmd_resume(int argc, char **argv, int stdout_fd, int stderr_fd, BOOL compact, BOOL quiet) {
    NSArray<NSString *> *positional = noff_positional_args(argc, argv);
    if (positional.count < 1) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"resume",
                                             NOFF_ERR_INVALID_ARGS,
                                             @"No session_id provided. Usage: apple-player resume <session_id>");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    NSString *sessionId = positional[0];
    __block NSDictionary *result = nil;
    __block NSString *errorMsg = nil;

    noff_dispatch_main_sync(^id{
        result = [PlayerOffloadBridge resumeSession:sessionId error:&errorMsg];
        return nil;
    });

    if (errorMsg) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"resume",
                                             NOFF_ERR_INVALID_ARGS, errorMsg);
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_ERROR;
    }

    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"resume", result ?: @{}), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

static int cmd_seek(int argc, char **argv, int stdout_fd, int stderr_fd, BOOL compact, BOOL quiet) {
    NSArray<NSString *> *positional = noff_positional_args(argc, argv);
    if (positional.count < 2) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"seek",
                                             NOFF_ERR_INVALID_ARGS,
                                             @"Usage: apple-player seek <session_id> <seconds>");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    NSString *sessionId = positional[0];
    double seconds = [positional[1] doubleValue];
    __block NSDictionary *result = nil;
    __block NSString *errorMsg = nil;

    noff_dispatch_main_sync(^id{
        result = [PlayerOffloadBridge seekSession:sessionId toSeconds:seconds error:&errorMsg];
        return nil;
    });

    if (errorMsg) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"seek",
                                             NOFF_ERR_INVALID_ARGS, errorMsg);
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_ERROR;
    }

    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"seek", result ?: @{}), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

static int cmd_status(int argc, char **argv, int stdout_fd, int stderr_fd, BOOL compact, BOOL quiet) {
    NSArray<NSString *> *positional = noff_positional_args(argc, argv);
    if (positional.count < 1) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"status",
                                             NOFF_ERR_INVALID_ARGS,
                                             @"No session_id provided. Usage: apple-player status <session_id>");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    NSString *sessionId = positional[0];
    __block NSDictionary *result = nil;
    __block NSString *errorMsg = nil;

    noff_dispatch_main_sync(^id{
        result = [PlayerOffloadBridge statusForSession:sessionId error:&errorMsg];
        return nil;
    });

    if (errorMsg) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"status",
                                             NOFF_ERR_INVALID_ARGS, errorMsg);
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_ERROR;
    }

    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"status", result ?: @{}), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

static int cmd_stop(int argc, char **argv, int stdout_fd, int stderr_fd, BOOL compact, BOOL quiet) {
    NSArray<NSString *> *positional = noff_positional_args(argc, argv);
    if (positional.count < 1) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"stop",
                                             NOFF_ERR_INVALID_ARGS,
                                             @"No session_id provided. Usage: apple-player stop <session_id>");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    NSString *sessionId = positional[0];
    __block NSDictionary *result = nil;
    __block NSString *errorMsg = nil;

    noff_dispatch_main_sync(^id{
        result = [PlayerOffloadBridge stopSession:sessionId error:&errorMsg];
        return nil;
    });

    if (errorMsg) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"stop",
                                             NOFF_ERR_INVALID_ARGS, errorMsg);
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_ERROR;
    }

    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"stop", result ?: @{}), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

static int cmd_list(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    __block NSDictionary *result = nil;

    noff_dispatch_main_sync(^id{
        result = [PlayerOffloadBridge listSessions];
        return nil;
    });

    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"list", result ?: @{}), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

// ── Main handler ──

static int player_handler(int argc, char **argv,
                           int stdin_fd, int stdout_fd, int stderr_fd) {
    @autoreleasepool {
        if (noff_has_flag(argc, argv, "--help") || noff_has_flag(argc, argv, "-h")) {
            noff_emit_help(stderr_fd, HELP_TEXT);
            return NOFF_EXIT_SUCCESS;
        }

        BOOL compact = noff_has_flag(argc, argv, "--compact");
        BOOL quiet = noff_has_flag(argc, argv, "-q") || noff_has_flag(argc, argv, "--quiet");

        NSString *subcmd = noff_get_subcommand(argc, argv);
        if (!subcmd) {
            noff_emit_help(stderr_fd, HELP_TEXT);
            NSDictionary *err = noff_json_error(TOOL_NAME, @"unknown",
                                                 NOFF_ERR_INVALID_ARGS,
                                                 @"No command specified. Use --help for usage.");
            noff_emit_json(stdout_fd, err, compact, quiet);
            return NOFF_EXIT_INVALID_ARGS;
        }

        if ([subcmd isEqualToString:@"play"])    return cmd_play(argc, argv, stdout_fd, stderr_fd, compact, quiet);
        if ([subcmd isEqualToString:@"pause"])   return cmd_pause(argc, argv, stdout_fd, stderr_fd, compact, quiet);
        if ([subcmd isEqualToString:@"resume"])  return cmd_resume(argc, argv, stdout_fd, stderr_fd, compact, quiet);
        if ([subcmd isEqualToString:@"seek"])    return cmd_seek(argc, argv, stdout_fd, stderr_fd, compact, quiet);
        if ([subcmd isEqualToString:@"status"])  return cmd_status(argc, argv, stdout_fd, stderr_fd, compact, quiet);
        if ([subcmd isEqualToString:@"stop"])    return cmd_stop(argc, argv, stdout_fd, stderr_fd, compact, quiet);
        if ([subcmd isEqualToString:@"list"])    return cmd_list(argc, argv, stdout_fd, compact, quiet);

        noff_emit_help(stderr_fd, HELP_TEXT);
        NSDictionary *err = noff_json_error(TOOL_NAME, subcmd,
                                             NOFF_ERR_INVALID_ARGS,
                                             [NSString stringWithFormat:@"Unknown command '%@'. Valid commands: play, pause, resume, stop, seek, status, list. Use --help for details.", subcmd]);
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }
}

// ── Registration ──

void player_offload_register(void) {
    int err = native_offload_add_handler("apple-player", player_handler);
    if (err == 0) {
        noff_ensure_guest_stub("/usr/local/bin/apple-player");
        NSLog(@"NativeOffloads: apple-player handler registered");
    } else {
        NSLog(@"NativeOffloads: failed to register apple-player handler (err=%d)", err);
    }
}
