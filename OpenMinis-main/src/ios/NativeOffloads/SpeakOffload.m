//
//  SpeakOffload.m
//  MinisApp
//
//  Native offload handler for `apple-speak`.
//  Subcommands: speak, voices, stop
//

#import <Foundation/Foundation.h>
#import <AVFoundation/AVFoundation.h>
#import <UIKit/UIKit.h>
#import "NativeOffloadUtils.h"
#include "kernel/native_offload.h"
#include <unistd.h>

static NSString *const TOOL_NAME = @"apple-speak";

static NSString *const HELP_TEXT =
    @"apple-speak - Text-to-speech using iOS AVSpeechSynthesizer\n"
     "\n"
     "USAGE:\n"
     "  apple-speak <command> [options]\n"
     "\n"
     "COMMANDS:\n"
     "  speak       Synthesize speech from text\n"
     "  voices      List available voices\n"
     "  stop        Stop current speech\n"
     "\n"
     "COMMON OPTIONS:\n"
     "  --help, -h           Show this help message\n"
     "  --compact            Minimize JSON output\n"
     "  -q, --quiet          Output only data field\n"
     "\n"
     "SPEAK OPTIONS:\n"
     "  --text <string>      Text to speak (or pipe via stdin)\n"
     "  --voice <lang>       BCP 47 language tag (default: en-US)\n"
     "  --rate <0.0-1.0>     Speech rate (default: 0.5)\n"
     "  --pitch <0.5-2.0>    Pitch multiplier (default: 1.0)\n"
     "  --volume <0.0-1.0>   Volume (default: 1.0)\n"
     "\n"
     "VOICES OPTIONS:\n"
     "  --language <prefix>  Filter by language prefix (e.g. \"en\")\n"
     "  --quality <level>    Filter by quality: default, enhanced, premium\n"
     "\n"
     "EXAMPLES:\n"
     "  apple-speak speak --text \"Hello world\"\n"
     "  echo \"Hello\" | apple-speak speak\n"
     "  apple-speak speak --text \"Bonjour\" --voice fr-FR --rate 0.3\n"
     "  apple-speak voices --language en\n"
     "  apple-speak stop\n";

// ── Delegate for tracking speech completion ──

@interface SpeakOffloadDelegate : NSObject <AVSpeechSynthesizerDelegate>
@property (nonatomic) dispatch_semaphore_t semaphore;
@property (nonatomic) BOOL finished;
@property (nonatomic) NSError *error;
@end

@implementation SpeakOffloadDelegate
- (instancetype)init {
    self = [super init];
    if (self) {
        _semaphore = dispatch_semaphore_create(0);
        _finished = NO;
    }
    return self;
}
- (void)speechSynthesizer:(AVSpeechSynthesizer *)synthesizer didFinishSpeechUtterance:(AVSpeechUtterance *)utterance {
    self.finished = YES;
    dispatch_semaphore_signal(self.semaphore);
}
- (void)speechSynthesizer:(AVSpeechSynthesizer *)synthesizer didCancelSpeechUtterance:(AVSpeechUtterance *)utterance {
    self.finished = YES;
    dispatch_semaphore_signal(self.semaphore);
}
@end

// ── Shared synthesizer singleton ──

static AVSpeechSynthesizer *_synthesizer = nil;
// Keep the delegate alive until the next speak call to prevent
// AVSpeechSynthesizer from accessing a deallocated delegate in its
// internal completion callback (iOS bug: crashes in objc_retain).
//
// [T-ios-tts-delegate-uaf] MUST only be read/written on speak_session_queue().
// It used to be assigned straight from the offload thread in cmd_speak while
// AVSpeechSynthesizer read its `delegate` from its own callback queue. Two
// concurrent `apple-speak speak` invocations then raced: the second assignment
// dropped the FIRST delegate's last strong reference, and ARC could free it
// while the synthesizer was still calling back into it — the reported
// `objc_retain` use-after-free inside CoreSynthesizer._speak (TestFlight 1.10
// build 37). Confining every access to the one serial queue that already owns
// all synthesizer/session calls makes the hand-off ordered: the previous
// delegate is released only from the same queue that installs the next one.
//
// Holding the PREVIOUS delegate one extra generation is deliberate — a callback
// already in flight for the old utterance still has a live object to message.
static SpeakOffloadDelegate *_activeDelegate = nil;
static SpeakOffloadDelegate *_retiredDelegate = nil;

static AVSpeechSynthesizer *sharedSynthesizer(void) {
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        _synthesizer = [[AVSpeechSynthesizer alloc] init];
    });
    return _synthesizer;
}

// [T-audiosession-setactive-watchdog] Serial queue owning every blocking
// AVAudioSession / AVSpeechSynthesizer call in this tool. Serial so session
// setup and the speak/stop calls that depend on it cannot interleave or be
// reordered; off-main so a wedged mediaserverd stalls only this shell command
// instead of tripping the 10s scene-update watchdog and killing the app.
static dispatch_queue_t speak_session_queue(void) {
    static dispatch_queue_t q = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        q = dispatch_queue_create("com.openminis.speakoffload.session",
                                  DISPATCH_QUEUE_SERIAL);
    });
    return q;
}

// ── Subcommands ──

// Detect language from text: returns "zh-CN" if Chinese characters are present,
// otherwise "en-US".
static NSString *detectLanguage(NSString *text) {
    NSRange r = [text rangeOfString:@"\\p{Han}" options:NSRegularExpressionSearch];
    return (r.location != NSNotFound) ? @"zh-CN" : @"en-US";
}

// Resolve a voice for the given language, respecting user preferences stored
// in UserDefaults (speechVoiceZh / speechVoiceEn).  Falls back to the system
// default voice for the language.
static AVSpeechSynthesisVoice *resolveVoice(NSString *lang) {
    NSUserDefaults *ud = [NSUserDefaults standardUserDefaults];
    NSString *key = [lang hasPrefix:@"zh"] ? @"speechVoiceZh" : @"speechVoiceEn";
    NSString *identifier = [ud stringForKey:key];
    if (identifier.length > 0) {
        AVSpeechSynthesisVoice *v = [AVSpeechSynthesisVoice voiceWithIdentifier:identifier];
        if (v) return v;
    }
    return [AVSpeechSynthesisVoice voiceWithLanguage:lang];
}

static int cmd_speak(int argc, char **argv, int stdin_fd, int stdout_fd, int stderr_fd, BOOL compact, BOOL quiet) {
    // Get text from --text arg or stdin
    NSString *text = noff_find_arg(argc, argv, "--text");
    if (!text) {
        text = noff_read_stdin(stdin_fd);
    }
    if (!text || text.length == 0) {
        noff_emit_help(stderr_fd, HELP_TEXT);
        NSDictionary *err = noff_json_error(TOOL_NAME, @"speak",
                                             NOFF_ERR_INVALID_ARGS,
                                             @"No text provided. Use --text or pipe text via stdin.");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    // Read user defaults for speech settings (same keys as BackgroundKeepAliveManager)
    NSUserDefaults *ud = [NSUserDefaults standardUserDefaults];
    NSNumber *savedRate   = [ud objectForKey:@"speechRate"];
    NSNumber *savedPitch  = [ud objectForKey:@"speechPitch"];
    NSNumber *savedVolume = [ud objectForKey:@"speechVolume"];

    float defaultRate   = savedRate   ? [savedRate floatValue]   : AVSpeechUtteranceDefaultSpeechRate;
    float defaultPitch  = savedPitch  ? [savedPitch floatValue]  : 1.0f;
    float defaultVolume = savedVolume ? [savedVolume floatValue] : 1.0f;

    // CLI args override user settings
    NSString *rateStr   = noff_find_arg(argc, argv, "--rate");
    NSString *pitchStr  = noff_find_arg(argc, argv, "--pitch");
    NSString *volumeStr = noff_find_arg(argc, argv, "--volume");

    // --rate is 0-1 normalized; map to AVSpeechUtterance range
    float rate;
    if (rateStr) {
        float r = fmaxf(0.0f, fminf(1.0f, [rateStr floatValue]));
        rate = AVSpeechUtteranceMinimumSpeechRate +
            r * (AVSpeechUtteranceMaximumSpeechRate - AVSpeechUtteranceMinimumSpeechRate);
    } else {
        rate = defaultRate; // Already in AVSpeechUtterance range
    }

    float pitch  = pitchStr  ? fmaxf(0.5f, fminf(2.0f, [pitchStr floatValue]))  : defaultPitch;
    float volume = volumeStr ? fmaxf(0.0f, fminf(1.0f, [volumeStr floatValue])) : defaultVolume;

    // Resolve voice: --voice overrides, otherwise auto-detect language and
    // use user's preferred voice for that language.
    NSString *voiceArg = noff_find_arg(argc, argv, "--voice");
    NSString *lang = voiceArg ?: detectLanguage(text);
    AVSpeechSynthesisVoice *voice = voiceArg
        ? [AVSpeechSynthesisVoice voiceWithLanguage:voiceArg]
        : resolveVoice(lang);

    // Create utterance
    AVSpeechUtterance *utterance = [AVSpeechUtterance speechUtteranceWithString:text];
    utterance.voice = voice;
    utterance.rate = rate;
    utterance.pitchMultiplier = pitch;
    utterance.volume = volume;

    // Set up delegate — stored in static var to prevent premature dealloc
    // (AVSpeechSynthesizer holds an unsafe reference to its delegate).
    // [T-ios-tts-delegate-uaf] The local `delegate` keeps this invocation's
    // object alive for the whole of cmd_speak; publishing it into the shared
    // static happens on speak_session_queue below, never from this thread.
    SpeakOffloadDelegate *delegate = [[SpeakOffloadDelegate alloc] init];

    // [T-audiosession-setactive-watchdog] Configure the audio session and start
    // speaking on a dedicated serial queue — NOT the main thread.
    //
    // This block used to run under noff_dispatch_main_sync. `setCategory` /
    // `setActive` forward to mediaserverd over an NSXPCConnection and wait for a
    // SYNCHRONOUS reply; when that daemon is slow the caller is parked for the
    // whole round-trip. On the main thread that means the 10s scene-update
    // watchdog kills the app (0x8BADF00D) — the same crash shape reported
    // against AudioSessionCoordinator (incident EFB2E09B) and MediaOffload's
    // now-playing path (incident 7FAE5E8E). Neither AVAudioSession nor
    // AVSpeechSynthesizer is a UIKit view, so the main-thread hop was never
    // required; it only donated the app's liveness to a blocking IPC.
    //
    // Serial (not concurrent, not a bare global-queue async) so the ordering the
    // old code relied on still holds: category → active → speak, and successive
    // `apple-speak speak` invocations cannot interleave their session setup.
    // The wait below is what actually sequences the command, so dispatching
    // async here does not let the CLI return early.
    dispatch_async(speak_session_queue(), ^{
        // Activate audio session for playback (matches BackgroundKeepAliveManager)
        AVAudioSession *session = [AVAudioSession sharedInstance];
        NSError *sessionErr = nil;
        [session setCategory:AVAudioSessionCategoryPlayback
                        mode:AVAudioSessionModeDefault
                     options:AVAudioSessionCategoryOptionMixWithOthers
                       error:&sessionErr];
        if (sessionErr) {
            NSLog(@"apple-speak: failed to set audio session category: %@", sessionErr);
            sessionErr = nil;
        }
        [session setActive:YES error:&sessionErr];
        if (sessionErr) {
            NSLog(@"apple-speak: failed to activate audio session: %@", sessionErr);
        }

        // [T-ios-tts-delegate-uaf] Publish the delegate from THIS queue, so the
        // release of the one it replaces is ordered against every other
        // synthesizer access. Retiring the outgoing delegate one generation
        // (instead of dropping it here) leaves a live object for any callback
        // still in flight for the previous utterance.
        _retiredDelegate = _activeDelegate;
        _activeDelegate = delegate;

        // Must happen after the session is live, and before the semaphore wait
        // below can be satisfied — the delegate signals it from these callbacks.
        sharedSynthesizer().delegate = delegate;
        [sharedSynthesizer() speakUtterance:utterance];
    });

    // Wait for completion with 60 second timeout
    long result = dispatch_semaphore_wait(delegate.semaphore,
                                           dispatch_time(DISPATCH_TIME_NOW, 60 * NSEC_PER_SEC));

    NSString *status = (result == 0) ? @"completed" : @"timeout";

    // Truncate text for response
    NSString *truncatedText = text;
    if (text.length > 100) {
        truncatedText = [[text substringToIndex:100] stringByAppendingString:@"..."];
    }

    NSDictionary *data = @{
        @"text": truncatedText,
        @"voice": voice.language ?: lang,
        @"rate": @(rate),
        @"characters": @(text.length),
        @"status": status,
    };
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"speak", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

static int cmd_voices(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    NSString *languageFilter = noff_find_arg(argc, argv, "--language");
    NSString *qualityFilter = noff_find_arg(argc, argv, "--quality");

    NSArray<AVSpeechSynthesisVoice *> *allVoices = [AVSpeechSynthesisVoice speechVoices];
    NSMutableArray *items = [NSMutableArray array];

    for (AVSpeechSynthesisVoice *voice in allVoices) {
        // Filter by language prefix
        if (languageFilter && ![voice.language hasPrefix:languageFilter]) {
            continue;
        }

        // Map quality
        NSString *qualityStr;
        switch (voice.quality) {
            case AVSpeechSynthesisVoiceQualityEnhanced:
                qualityStr = @"enhanced";
                break;
            case AVSpeechSynthesisVoiceQualityPremium:
                qualityStr = @"premium";
                break;
            default:
                qualityStr = @"default";
                break;
        }

        // Filter by quality
        if (qualityFilter && ![qualityStr isEqualToString:qualityFilter]) {
            continue;
        }

        // Map gender
        NSString *genderStr;
        switch (voice.gender) {
            case AVSpeechSynthesisVoiceGenderMale:
                genderStr = @"male";
                break;
            case AVSpeechSynthesisVoiceGenderFemale:
                genderStr = @"female";
                break;
            default:
                genderStr = @"unspecified";
                break;
        }

        [items addObject:@{
            @"id": voice.identifier ?: @"",
            @"name": voice.name ?: @"",
            @"language": voice.language ?: @"",
            @"quality": qualityStr,
            @"gender": genderStr,
        }];
    }

    NSDictionary *data = @{
        @"voices": items,
        @"count": @(items.count),
    };
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"voices", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

static int cmd_stop(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    // Same serial queue as speak, so a stop issued while a speak is still
    // configuring its session runs after that setup rather than racing it.
    // Synchronous (unlike speak, which is sequenced by its own semaphore wait)
    // so the command does not report "stopped" before the synthesizer is told
    // to stop. This blocks the offload thread, never the main thread.
    dispatch_sync(speak_session_queue(), ^{
        [sharedSynthesizer() stopSpeakingAtBoundary:AVSpeechBoundaryImmediate];
    });

    NSDictionary *data = @{@"status": @"stopped"};
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"stop", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

// ── Main handler ──

static int speak_handler(int argc, char **argv,
                          int stdin_fd, int stdout_fd, int stderr_fd) {
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

    if ([subcmd isEqualToString:@"speak"])   return cmd_speak(argc, argv, stdin_fd, stdout_fd, stderr_fd, compact, quiet);
    if ([subcmd isEqualToString:@"voices"])  return cmd_voices(argc, argv, stdout_fd, compact, quiet);
    if ([subcmd isEqualToString:@"stop"])    return cmd_stop(argc, argv, stdout_fd, compact, quiet);

    noff_emit_help(stderr_fd, HELP_TEXT);
    NSDictionary *err = noff_json_error(TOOL_NAME, subcmd,
                                         NOFF_ERR_INVALID_ARGS,
                                         [NSString stringWithFormat:@"Unknown command '%@'. Valid commands: speak, stop, voices. Use --help for details.", subcmd]);
    noff_emit_json(stdout_fd, err, compact, quiet);
    return NOFF_EXIT_INVALID_ARGS;
}

// ── Registration ──

void speak_offload_register(void) {
    int err = native_offload_add_handler("apple-speak", speak_handler);
    if (err == 0) {
        noff_ensure_guest_stub("/usr/local/bin/apple-speak");
        NSLog(@"NativeOffloads: apple-speak handler registered");
    } else {
        NSLog(@"NativeOffloads: failed to register apple-speak handler (err=%d)", err);
    }
}
