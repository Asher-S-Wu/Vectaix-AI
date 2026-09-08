//
//  SessionsOffload.m
//  MinisApp
//
//  Native offload handler for `minis-sessions-cli`.
//  Subcommands: list, search
//
//  list   — list recent sessions with metadata
//  search — search message content across sessions
//

#import <Foundation/Foundation.h>
#import "NativeOffloadUtils.h"
#include "kernel/native_offload.h"
#include <unistd.h>

// Swift bridge — generated header
#if __has_include("Minis-Swift.h")
#import "Minis-Swift.h"
#else
@interface SessionsOffloadBridge : NSObject
+ (NSDictionary * _Nonnull)querySessionsWithSessionIds:(NSArray<NSString *> * _Nullable)sessionIds
                                              keywords:(NSArray<NSString *> * _Nullable)keywords
                                             startDate:(NSDate * _Nullable)startDate
                                               endDate:(NSDate * _Nullable)endDate
                                                 limit:(NSInteger)limit;
+ (NSDictionary * _Nonnull)searchMessagesWithSessionIds:(NSArray<NSString *> * _Nullable)sessionIds
                                               keywords:(NSArray<NSString *> * _Nonnull)keywords
                                              startDate:(NSDate * _Nullable)startDate
                                                endDate:(NSDate * _Nullable)endDate
                                                  limit:(NSInteger)limit;
+ (NSDictionary * _Nonnull)loadMessagesWithSessionId:(NSString * _Nonnull)sessionId
                                              offset:(NSInteger)offset
                                               limit:(NSInteger)limit
                                                full:(BOOL)full;
+ (NSDictionary * _Nonnull)sendPromptWithSessionId:(NSString * _Nullable)sessionId
                                            prompt:(NSString * _Nonnull)prompt
                                   attachmentPaths:(NSArray<NSString *> * _Nonnull)attachmentPaths
                                      modelEntryId:(NSString * _Nullable)modelEntryId
                                            source:(NSString * _Nonnull)source;
+ (NSDictionary * _Nonnull)retryMessageWithSessionId:(NSString * _Nonnull)sessionId
                                           messageId:(NSString * _Nullable)messageId
                                     attachmentPaths:(NSArray<NSString *> * _Nonnull)attachmentPaths;
+ (NSDictionary * _Nonnull)getSessionStatusWithSessionId:(NSString * _Nonnull)sessionId;
+ (NSDictionary * _Nonnull)openSessionWithSessionId:(NSString * _Nonnull)sessionId;
@end
#endif

static NSString *const TOOL_NAME = @"minis-sessions-cli";

static NSString *const HELP_TEXT =
    @"minis-sessions-cli - Query and send Minis chat sessions\n"
     "\n"
     "USAGE:\n"
     "  minis-sessions-cli <command> [options]\n"
     "\n"
     "COMMANDS:\n"
     "  list      List recent sessions (default: 50, max: 100)\n"
     "  search    Search message content across sessions (requires --keywords)\n"
     "  messages  Read messages from a specific session (requires --id)\n"
     "  send      Send a prompt (new session or follow-up an existing one)\n"
     "  retry     Re-run from a specific user message\n"
     "  status    Get current status of a session\n"
     "  open      Navigate the app UI to a session (positional <session_id>)\n"
     "\n"
     "QUERY OPTIONS:\n"
     "  --keywords <words>    Space-separated keywords (AND logic, required for search)\n"
     "  --ids <id1,id2,...>   Filter by comma-separated session IDs (list/search)\n"
     "  --id <session_id>     Session ID to read messages from (messages/status)\n"
     "  --offset <n>          Skip first n messages, 0-based (default: 0)\n"
     "  --start <YYYY-MM-DD>  Filter results after this date (inclusive)\n"
     "  --end <YYYY-MM-DD>    Filter results before this date (inclusive, end of day)\n"
     "  --limit <n>           Max results (default: 50, max: 100)\n"
     "  --full                (messages only) Return full message text up to 50000 chars\n"
     "                        per message instead of the 1000-char default.\n"
     "\n"
     "SEND OPTIONS:\n"
     "  --session <id>           Existing session to continue (omit for new session)\n"
     "  --attach <path>          File path to attach. Repeat for multiple attachments.\n"
     "  --model <entry_id>       Override model (default: follows Agent Loop default)\n"
     "  --source <tag>           Session source tag written to DB (default: \"cli\")\n"
     "  NOTE: Returns immediately with status \"Running\" once dispatched.\n"
     "        Poll with 'status --id <session_id>' to check for completion.\n"
     "\n"
     "RETRY OPTIONS:\n"
     "  --session <id>           Session to retry in (required)\n"
     "  --message <message_id>   Message ID to retry from (default: last user message)\n"
     "  --attach <path>          Replacement attachment(s). Omit to keep originals.\n"
     "  NOTE: Returns immediately with status \"Retrying\" once dispatched.\n"
     "        Poll with 'status --id <session_id>' to check for completion.\n"
     "\n"
     "STATUS OPTIONS:\n"
     "  --id <session_id>        Session ID to query (required)\n"
     "\n"
     "GLOBAL OPTIONS:\n"
     "  --help, -h               Show this help message\n"
     "  --compact                Minimize JSON output\n"
     "  -q, --quiet              Output only data field\n"
     "\n"
     "EXAMPLES:\n"
     "  minis-sessions-cli list\n"
     "  minis-sessions-cli search --keywords \"API error\"\n"
     "  minis-sessions-cli messages --id <session_id> --full\n"
     "  minis-sessions-cli send \"分析我的睡眠数据\"\n"
     "  minis-sessions-cli send \"继续\" --session <session_id>\n"
     "  minis-sessions-cli send \"这张图是什么?\" --attach /tmp/photo.png\n"
     "  minis-sessions-cli retry --session <session_id>\n"
     "  minis-sessions-cli status --id <session_id>\n"
     "  minis-sessions-cli open <session_id>\n";

// ── Parse helpers ──

static NSArray<NSString *> *parse_ids(int argc, char **argv) {
    NSString *raw = noff_find_arg(argc, argv, "--ids");
    if (!raw || raw.length == 0) return nil;
    NSArray *parts = [raw componentsSeparatedByString:@","];
    NSMutableArray *trimmed = [NSMutableArray arrayWithCapacity:parts.count];
    for (NSString *p in parts) {
        NSString *t = [p stringByTrimmingCharactersInSet:
                       [NSCharacterSet whitespaceCharacterSet]];
        if (t.length > 0) [trimmed addObject:t];
    }
    return trimmed.count > 0 ? trimmed : nil;
}

static NSArray<NSString *> *parse_keywords(int argc, char **argv) {
    NSString *raw = noff_find_arg(argc, argv, "--keywords");
    if (!raw || raw.length == 0) return nil;
    NSArray *parts = [raw componentsSeparatedByString:@" "];
    NSMutableArray *filtered = [NSMutableArray arrayWithCapacity:parts.count];
    for (NSString *p in parts) {
        if (p.length > 0) [filtered addObject:p];
    }
    return filtered.count > 0 ? filtered : nil;
}

static NSDate *parse_date_arg(int argc, char **argv, const char *name) {
    NSString *raw = noff_find_arg(argc, argv, name);
    if (!raw) return nil;
    return noff_parse_date(raw);
}

static int parse_limit(int argc, char **argv) {
    NSString *raw = noff_find_arg(argc, argv, "--limit");
    if (!raw) return 50;
    int val = [raw intValue];
    if (val < 1) return 50;
    if (val > 100) return 100;
    return val;
}

// ── Multi-value & positional helpers (used by send/retry) ──

/// Collect every occurrence of `--<name> <value>` (repeated flag style).
/// Returns an empty array when no occurrence is found.
static NSArray<NSString *> *parse_attachments(int argc, char **argv) {
    NSMutableArray<NSString *> *out = [NSMutableArray array];
    for (int i = 1; i < argc - 1; i++) {
        if (strcmp(argv[i], "--attach") == 0) {
            NSString *v = [NSString stringWithUTF8String:argv[i + 1]];
            if (v.length > 0) [out addObject:v];
            i++; // consume value
        }
    }
    return out;
}

/// First positional arg after the subcommand (for `send "<prompt>"`).
static NSString *first_positional(int argc, char **argv) {
    NSArray<NSString *> *positional = noff_positional_args(argc, argv);
    return positional.firstObject;
}

// ── Subcommand: send ──

static int cmd_send(int argc, char **argv, int stdout_fd, int stderr_fd,
                    BOOL compact, BOOL quiet) {
    NSString *prompt = first_positional(argc, argv);
    if (!prompt || prompt.length == 0) {
        noff_emit_help(stderr_fd, HELP_TEXT);
        NSDictionary *err = noff_json_error(TOOL_NAME, @"send",
                                             NOFF_ERR_INVALID_ARGS,
                                             @"send requires a prompt argument. "
                                              "Example: minis-sessions-cli send \"hello\"");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    NSString *sessionId = noff_find_arg(argc, argv, "--session");
    NSString *modelEntryId = noff_find_arg(argc, argv, "--model");
    NSString *sourceTag = noff_find_arg(argc, argv, "--source");
    if (!sourceTag || sourceTag.length == 0) sourceTag = @"cli";
    NSArray<NSString *> *attachments = parse_attachments(argc, argv);

    NSDictionary *data = [SessionsOffloadBridge sendPromptWithSessionId:sessionId
                                                                  prompt:prompt
                                                         attachmentPaths:attachments
                                                            modelEntryId:modelEntryId
                                                                  source:sourceTag];

    NSDictionary *result = noff_json_envelope(TOOL_NAME, @"send", data);
    noff_emit_json(stdout_fd, result, compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

// ── Subcommand: retry ──

static int cmd_retry(int argc, char **argv, int stdout_fd, int stderr_fd,
                     BOOL compact, BOOL quiet) {
    NSString *sessionId = noff_find_arg(argc, argv, "--session");
    if (!sessionId || sessionId.length == 0) {
        noff_emit_help(stderr_fd, HELP_TEXT);
        NSDictionary *err = noff_json_error(TOOL_NAME, @"retry",
                                             NOFF_ERR_INVALID_ARGS,
                                             @"--session <id> is required for retry. "
                                              "Use 'list' first to find a session ID.");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    NSString *messageId = noff_find_arg(argc, argv, "--message");
    NSArray<NSString *> *attachments = parse_attachments(argc, argv);

    NSDictionary *data = [SessionsOffloadBridge retryMessageWithSessionId:sessionId
                                                                messageId:messageId
                                                          attachmentPaths:attachments];

    NSDictionary *result = noff_json_envelope(TOOL_NAME, @"retry", data);
    noff_emit_json(stdout_fd, result, compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

// ── Subcommand: status ──

static int cmd_status(int argc, char **argv, int stdout_fd, int stderr_fd,
                      BOOL compact, BOOL quiet) {
    NSString *sessionId = noff_find_arg(argc, argv, "--id");
    if (!sessionId || sessionId.length == 0) {
        noff_emit_help(stderr_fd, HELP_TEXT);
        NSDictionary *err = noff_json_error(TOOL_NAME, @"status",
                                             NOFF_ERR_INVALID_ARGS,
                                             @"--id <session_id> is required for status.");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    NSDictionary *data = [SessionsOffloadBridge getSessionStatusWithSessionId:sessionId];
    NSDictionary *result = noff_json_envelope(TOOL_NAME, @"status", data);
    noff_emit_json(stdout_fd, result, compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

// ── Subcommand: open ──

static int cmd_open(int argc, char **argv, int stdout_fd, int stderr_fd,
                    BOOL compact, BOOL quiet) {
    // Accept either a positional `<session_id>` (preferred, matches the
    // spec command shape `minis-sessions-cli open <session_id>`) or an
    // explicit `--id <session_id>` for symmetry with `messages`/`status`.
    NSString *sessionId = first_positional(argc, argv);
    if (!sessionId || sessionId.length == 0) {
        sessionId = noff_find_arg(argc, argv, "--id");
    }
    if (!sessionId || sessionId.length == 0) {
        noff_emit_help(stderr_fd, HELP_TEXT);
        NSDictionary *err = noff_json_error(TOOL_NAME, @"open",
                                             NOFF_ERR_INVALID_ARGS,
                                             @"open requires a session id. "
                                              "Example: minis-sessions-cli open <session_id>");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    NSDictionary *data = [SessionsOffloadBridge openSessionWithSessionId:sessionId];
    NSDictionary *result = noff_json_envelope(TOOL_NAME, @"open", data);
    noff_emit_json(stdout_fd, result, compact, quiet);

    // Surface session_not_found as a non-zero exit so shell pipelines can
    // detect the failure without parsing JSON.
    NSNumber *ok = data[@"ok"];
    if (ok && ![ok boolValue]) return NOFF_EXIT_INVALID_ARGS;
    return NOFF_EXIT_SUCCESS;
}

// ── Subcommand: list ──

static int cmd_list(int argc, char **argv, int stdout_fd,
                    BOOL compact, BOOL quiet) {
    NSArray *ids = parse_ids(argc, argv);
    NSArray *keywords = parse_keywords(argc, argv);
    NSDate *startDate = parse_date_arg(argc, argv, "--start");
    NSDate *endDate = parse_date_arg(argc, argv, "--end");
    // For --end, adjust to end of day
    if (endDate) {
        NSCalendar *cal = [NSCalendar currentCalendar];
        endDate = [[cal dateByAddingUnit:NSCalendarUnitDay value:1 toDate:endDate options:0]
                   dateByAddingTimeInterval:-1];
    }
    int limit = parse_limit(argc, argv);

    // Call bridge directly from guest thread (bridge handles actor isolation internally)
    NSDictionary *data = [SessionsOffloadBridge querySessionsWithSessionIds:ids
                                                                  keywords:keywords
                                                                 startDate:startDate
                                                                   endDate:endDate
                                                                     limit:limit];

    NSDictionary *result = noff_json_envelope(TOOL_NAME, @"list", data);
    noff_emit_json(stdout_fd, result, compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

// ── Subcommand: search ──

static int cmd_search(int argc, char **argv, int stdout_fd, int stderr_fd,
                      BOOL compact, BOOL quiet) {
    NSArray *keywords = parse_keywords(argc, argv);
    if (!keywords || keywords.count == 0) {
        noff_emit_help(stderr_fd, HELP_TEXT);
        NSDictionary *err = noff_json_error(TOOL_NAME, @"search",
                                             NOFF_ERR_INVALID_ARGS,
                                             @"--keywords is required for search. "
                                              "Example: minis-sessions-cli search --keywords \"API error\"");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    NSArray *ids = parse_ids(argc, argv);
    NSDate *startDate = parse_date_arg(argc, argv, "--start");
    NSDate *endDate = parse_date_arg(argc, argv, "--end");
    if (endDate) {
        NSCalendar *cal = [NSCalendar currentCalendar];
        endDate = [[cal dateByAddingUnit:NSCalendarUnitDay value:1 toDate:endDate options:0]
                   dateByAddingTimeInterval:-1];
    }
    int limit = parse_limit(argc, argv);

    NSDictionary *data = [SessionsOffloadBridge searchMessagesWithSessionIds:ids
                                                                    keywords:keywords
                                                                   startDate:startDate
                                                                     endDate:endDate
                                                                       limit:limit];

    NSDictionary *result = noff_json_envelope(TOOL_NAME, @"search", data);
    noff_emit_json(stdout_fd, result, compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

// ── Subcommand: messages ──

static int cmd_messages(int argc, char **argv, int stdout_fd, int stderr_fd,
                        BOOL compact, BOOL quiet) {
    NSString *sessionId = noff_find_arg(argc, argv, "--id");
    if (!sessionId || sessionId.length == 0) {
        noff_emit_help(stderr_fd, HELP_TEXT);
        NSDictionary *err = noff_json_error(TOOL_NAME, @"messages",
                                             NOFF_ERR_INVALID_ARGS,
                                             @"--id <session_id> is required. "
                                              "Use 'list' first to find session IDs.");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    int limit = parse_limit(argc, argv);
    NSString *offsetRaw = noff_find_arg(argc, argv, "--offset");
    int offset = offsetRaw ? [offsetRaw intValue] : 0;
    if (offset < 0) offset = 0;
    BOOL full = noff_has_flag(argc, argv, "--full");

    // [T-sessions-cli-messages-date-filter] (GH#200) HELP_TEXT documents
    // --start/--end as "(messages only)", but this command never parsed them:
    // they were accepted, ignored, and the full session came back from offset
    // 0. Parsed here exactly as cmd_list/cmd_search do, including the
    // end-of-day adjustment that makes --end inclusive of its whole day.
    NSDate *startDate = parse_date_arg(argc, argv, "--start");
    NSDate *endDate = parse_date_arg(argc, argv, "--end");
    if (endDate) {
        NSCalendar *cal = [NSCalendar currentCalendar];
        endDate = [[cal dateByAddingUnit:NSCalendarUnitDay value:1 toDate:endDate options:0]
                   dateByAddingTimeInterval:-1];
    }

    NSDictionary *data = [SessionsOffloadBridge loadMessagesWithSessionId:sessionId
                                                                  offset:offset
                                                                   limit:limit
                                                                    full:full
                                                               startDate:startDate
                                                                 endDate:endDate];

    NSDictionary *result = noff_json_envelope(TOOL_NAME, @"messages", data);
    noff_emit_json(stdout_fd, result, compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

// ── Main handler ──

static int sessions_handler(int argc, char **argv,
                             int stdin_fd, int stdout_fd, int stderr_fd) {
    if (noff_has_flag(argc, argv, "--help") || noff_has_flag(argc, argv, "-h")) {
        noff_emit_help(stderr_fd, HELP_TEXT);
        return NOFF_EXIT_SUCCESS;
    }

    BOOL compact = noff_has_flag(argc, argv, "--compact");
    BOOL quiet = noff_has_flag(argc, argv, "-q") || noff_has_flag(argc, argv, "--quiet");

    NSString *subcmd = noff_get_subcommand(argc, argv);
    if (!subcmd) {
        // Default to list
        return cmd_list(argc, argv, stdout_fd, compact, quiet);
    }

    if ([subcmd isEqualToString:@"list"]) {
        return cmd_list(argc, argv, stdout_fd, compact, quiet);
    } else if ([subcmd isEqualToString:@"search"]) {
        return cmd_search(argc, argv, stdout_fd, stderr_fd, compact, quiet);
    } else if ([subcmd isEqualToString:@"messages"]) {
        return cmd_messages(argc, argv, stdout_fd, stderr_fd, compact, quiet);
    } else if ([subcmd isEqualToString:@"send"]) {
        return cmd_send(argc, argv, stdout_fd, stderr_fd, compact, quiet);
    } else if ([subcmd isEqualToString:@"retry"]) {
        return cmd_retry(argc, argv, stdout_fd, stderr_fd, compact, quiet);
    } else if ([subcmd isEqualToString:@"status"]) {
        return cmd_status(argc, argv, stdout_fd, stderr_fd, compact, quiet);
    } else if ([subcmd isEqualToString:@"open"]) {
        return cmd_open(argc, argv, stdout_fd, stderr_fd, compact, quiet);
    }

    noff_emit_help(stderr_fd, HELP_TEXT);
    NSDictionary *err = noff_json_error(TOOL_NAME, subcmd,
                                         NOFF_ERR_INVALID_ARGS,
                                         [NSString stringWithFormat:
                                          @"Unknown command '%@'. Valid commands: list, search, messages, send, retry, status, open. "
                                           "Use --help for details.", subcmd]);
    noff_emit_json(stdout_fd, err, compact, quiet);
    return NOFF_EXIT_INVALID_ARGS;
}

// ── Registration ──

void sessions_offload_register(void) {
    int err = native_offload_add_handler("minis-sessions-cli", sessions_handler);
    if (err == 0) {
        noff_ensure_guest_stub("/usr/local/bin/minis-sessions-cli");
        NSLog(@"NativeOffloads: minis-sessions-cli handler registered");
    } else {
        NSLog(@"NativeOffloads: failed to register minis-sessions-cli handler (err=%d)", err);
    }
}
