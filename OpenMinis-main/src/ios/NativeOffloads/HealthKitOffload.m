//
//  HealthKitOffload.m
//  MinisApp
//
//  Native offload handler for `apple-healthkit`.
//  Subcommands: steps, heart-rate, resting-heart-rate, vo2-max, sleep,
//               workouts, weight, blood-oxygen, hrv, nutrition, summary,
//               types, log
//

#import <Foundation/Foundation.h>
#import <HealthKit/HealthKit.h>
#import <UIKit/UIKit.h>
#import "NativeOffloadUtils.h"
#include "kernel/native_offload.h"
#include <unistd.h>
#include <pthread.h>

static NSString *const TOOL_NAME = @"apple-healthkit";
static const NSUInteger DEFAULT_LIMIT = 100;

// Round a sample value to 4 decimal places for JSON output. Keeps the payload
// free of double-representation noise (23.456700000000001) without destroying
// precision — metrics like body-fat need 3-4 significant decimals (GH#66);
// the old per-site round-to-1/2-decimals truncated them.
static inline double noff_round4(double v) {
    return round(v * 10000.0) / 10000.0;
}

// Forward declarations for lookup table functions
static NSDictionary *logQuantityTypeInfo(NSString *name);
static NSArray<NSString *> *allQuantityTypeNames(void);
static NSDictionary *logCategoryTypeInfo(NSString *name);
static NSArray<NSString *> *allCategoryTypeNames(void);

static NSString *const HELP_TEXT =
    @"apple-healthkit - Query and log iOS HealthKit data\n"
     "\n"
     "USAGE:\n"
     "  apple-healthkit <command> [options]\n"
     "\n"
     "COMMANDS:\n"
     "  steps         Query step count (daily buckets)\n"
     "  basal-energy  Query basal (resting) energy burned (daily buckets, kcal)\n"
     "  heart-rate    Query heart rate samples\n"
     "  resting-heart-rate Query resting heart rate samples (bpm)\n"
     "  vo2-max       Query VO2 max samples (mL/(kg·min)) — usually from Apple Watch\n"
     "  sleep         Query sleep analysis\n"
     "  workouts      Query workouts (with metadata: elevation, weather, etc.)\n"
     "  cadence       Query walking speed and step length\n"
     "  elevation     Query flights climbed / elevation (daily buckets)\n"
     "  weight        Query body mass samples\n"
     "  blood-oxygen  Query SpO2 samples\n"
     "  blood-glucose Query blood glucose samples (mg/dL, mmol/L)\n"
     "  hrv           Query heart rate variability (SDNN)\n"
     "  nutrition     Query nutrition data (calories, protein, etc.)\n"
     "  summary       Activity summary (rings)\n"
     "  characteristic Read user profile (sex, DOB, blood type, skin type, wheelchair, move-mode)\n"
     "  ecg           Read electrocardiogram samples (iOS 14+, Apple Watch)\n"
     "  audiogram     Read hearing test samples (iOS 13+)\n"
     "  vision-rx     Read vision prescriptions — glasses/contacts (iOS 16+)\n"
     "  assessment    Read GAD-7 / PHQ-9 mental-health scored assessments (iOS 18+)\n"
     "  state-of-mind Read mood / emotion log (iOS 18+)\n"
     "  types         List ALL available HealthKit data types WITH descriptions —\n"
     "                use this to pick the right --type name for log / delete /\n"
     "                read commands. Output groups: quantity_types, category_types,\n"
     "                characteristic_types, special_types.\n"
     "  batch         Read MULTIPLE metrics in one call — pass --types t1,t2,...\n"
     "                Subcommand names work as aliases (hrv → hrv-sdnn,\n"
     "                blood-oxygen → oxygen-saturation); results are keyed by the\n"
     "                name you asked for.\n"
     "                One authorization prompt covers every requested type;\n"
     "                returns each metric's data over the same date range in a\n"
     "                single envelope. Cumulative metrics (steps, distance,\n"
     "                energy, water, ...) are summed; others return latest N\n"
     "                samples. Prefer this over multiple subcommand calls.\n"
     "  log           Write a sample to HealthKit\n"
     "  log-blood-pressure  Write a blood-pressure reading (systolic + diastolic).\n"
     "                Required because the Health app only renders blood pressure as\n"
     "                a correlation; isolated systolic/diastolic writes via `log`\n"
     "                save successfully but never appear in the Blood Pressure card.\n"
     "  delete        Delete samples written by this app (by UUID or date range)\n"
     "\n"
     "COMMON OPTIONS:\n"
     "  --help, -h           Show this help message\n"
     "  --compact            Minimize JSON output\n"
     "  -q, --quiet          Output only data field\n"
     "\n"
     "DATE OPTIONS:\n"
     "  --start <datetime>   Start time (ISO 8601 or relative: -7d, -2h)\n"
     "  --end <datetime>     End time\n"
     "  --days <N>           Last N days\n"
     "  --today              Equivalent to --days 1\n"
     "  --limit <N>          Maximum number of results (default: 100; batch applies\n"
     "                       it PER TYPE and defaults to 20). Truncated results carry\n"
     "                       a _warning and total_available.\n"
     "\n"
     "NUTRITION OPTIONS:\n"
     "  --type <type>        calories, protein, carbs, fat, water, caffeine, sugar, fiber\n"
     "\n"
     "WORKOUTS OPTIONS:\n"
     "  --type <name>        Filter by workout type name\n"
     "\n"
     "LOG OPTIONS:\n"
     "  --type <type>        Type name (see below)\n"
     "  --value <number|str> Value to log (required)\n"
     "  --date <datetime>    Date for point-in-time samples (default: now)\n"
     "  --start <datetime>   Start time (for duration-based category types)\n"
     "  --end <datetime>     End time (for duration-based category types)\n"
     "  NOTE: blood-pressure-systolic / blood-pressure-diastolic are rejected\n"
     "        here; use `log-blood-pressure` instead so the entry shows up in\n"
     "        the Health app.\n"
     "\n"
     "LOG-BLOOD-PRESSURE OPTIONS:\n"
     "  --systolic <mmHg>    Systolic value (top number, required)\n"
     "  --diastolic <mmHg>   Diastolic value (bottom number, required)\n"
     "  --date <datetime>    Measurement time (default: now)\n"
     "  Example: apple-healthkit log-blood-pressure --systolic 120 --diastolic 80\n"
     "\n"
     "DELETE OPTIONS:\n"
     "  --type <type>        Type name (required; same names as log)\n"
     "  --id <uuid>          Delete a single sample by UUID\n"
     "  --today              Delete all matching samples from today\n"
     "  --days <N>           Delete matching samples from the last N days\n"
     "  --start/--end        Explicit date range\n"
     "  Note: only samples written by this app can be deleted.\n"
     "\n"
     "DISCOVERING TYPES (recommended for LLMs):\n"
     "  Run `apple-healthkit types` to list every supported quantity / category /\n"
     "  characteristic type with a one-line description and unit. Use the `desc`\n"
     "  field to pick the type that best matches the user's question, then pass\n"
     "  `name` as --type to log / delete / read commands.\n"
     "\n"
     "QUANTITY TYPE GROUPS (subset — run `types` for full list with descriptions):\n"
     "  Body:        weight, height, bmi, body-fat, lean-body-mass, waist-circumference\n"
     "  Vitals:      heart-rate, blood-pressure-{systolic,diastolic}, body-temperature,\n"
     "               oxygen-saturation, respiratory-rate, blood-glucose, blood-alcohol,\n"
     "               electrodermal-activity, peripheral-perfusion-index,\n"
     "               atrial-fibrillation-burden\n"
     "  Cardio fit:  resting-heart-rate, walking-heart-rate-average,\n"
     "               heart-rate-recovery, vo2-max, hrv-sdnn\n"
     "  Activity:    steps, distance-* (walking-running, cycling, swimming, wheelchair,\n"
     "               downhill-snow, cross-country-skiing, paddle-sports, rowing, skating-sports),\n"
     "               active-energy, basal-energy, flights-climbed, push-count,\n"
     "               swimming-strokes, apple-{exercise,move,stand}-time, physical-effort\n"
     "  Mobility:    walking-{speed,step-length,asymmetry,double-support,steadiness},\n"
     "               stair-{ascent,descent}-speed, six-minute-walk-test,\n"
     "               running-{speed,power,stride-length,vertical-oscillation,ground-contact-time}\n"
     "  Sleep:       sleeping-wrist-temperature, sleeping-breathing-disturbances\n"
     "  Hearing:     environmental-audio-exposure, environmental-sound-reduction,\n"
     "               headphone-audio-exposure\n"
     "  Environment: time-in-daylight, underwater-depth, water-temperature, uv-exposure\n"
     "  Workout:     workout-effort, estimated-workout-effort\n"
     "  Cycling:     cycling-{power,cadence,speed,ftp} (iOS 17+)\n"
     "  Nutrition:   calories, protein, carbs, fat[+saturated/mono/poly], cholesterol,\n"
     "               sugar, fiber, sodium, water, caffeine, calcium, iron, potassium,\n"
     "               magnesium, zinc, selenium, copper, manganese, chromium, molybdenum,\n"
     "               phosphorus, iodine, chloride, biotin, folate, niacin,\n"
     "               pantothenic-acid, riboflavin, thiamin, vitamin-{a,b6,b12,c,d,e,k}\n"
     "  Other:       insulin-delivery, alcoholic-beverages, number-of-times-fallen\n"
     "\n"
     "CATEGORY TYPE GROUPS (subset — run `types` for full list with descriptions):\n"
     "  Symptoms (severity 0-3 / not-present|mild|moderate|severe):\n"
     "    acne, headache, constipation, heartburn, hot-flashes, bladder-incontinence,\n"
     "    loss-of-{taste,smell}, nausea, vomiting, diarrhea, abdominal-cramps, bloating,\n"
     "    fatigue, fever, chills, dizziness, chest-tightness, coughing, sore-throat,\n"
     "    runny-nose, sinus-congestion, shortness-of-breath, wheezing, appetite-changes,\n"
     "    sleep-changes, mood-changes, hair-loss, dry-skin, night-sweats, pelvic-pain,\n"
     "    lower-back-pain, breast-pain, memory-lapse, rapid-pounding-heartbeat,\n"
     "    skipped-heartbeat, vaginal-dryness, fainting, generalized-body-ache\n"
     "  Reproductive (enum --value, see `types` for valid values):\n"
     "    menstrual-flow, intermenstrual-bleeding, persistent-intermenstrual-bleeding,\n"
     "    prolonged-menstrual-periods, infrequent-menstrual-cycles, irregular-menstrual-cycles,\n"
     "    ovulation-test, progesterone-test, cervical-mucus, sexual-activity,\n"
     "    pregnancy, pregnancy-test, bleeding-during-pregnancy, bleeding-after-pregnancy,\n"
     "    contraceptive, lactation\n"
     "  Duration-based (use --start/--end instead of --date):\n"
     "    sleep (inBed|asleep|awake|rem|core|deep), mindful-session, toothbrushing,\n"
     "    handwashing, sleep-apnea-event\n"
     "  Cardio events:\n"
     "    high-heart-rate-event, low-heart-rate-event, irregular-heart-rhythm-event,\n"
     "    low-cardio-fitness-event, hypertension-event\n"
     "  Audio events:\n"
     "    audio-exposure-event, environmental-audio-exposure-event,\n"
     "    headphone-audio-exposure-event\n"
     "  Other:\n"
     "    apple-stand-hour (idle|stood), walking-steadiness-event\n"
     "\n"
     "CHARACTERISTIC TYPES (read-only, via `characteristic` subcommand):\n"
     "  biological-sex, date-of-birth, blood-type, fitzpatrick-skin-type,\n"
     "  wheelchair-use, activity-move-mode\n"
     "\n"
     "EXAMPLES:\n"
     "  apple-healthkit steps --today\n"
     "  apple-healthkit heart-rate --days 1 --limit 10\n"
     "  apple-healthkit resting-heart-rate --days 30\n"
     "  apple-healthkit vo2-max --days 90\n"
     "  apple-healthkit sleep --days 7 --compact -q\n"
     "  apple-healthkit workouts --days 30 --type Running\n"
     "  apple-healthkit weight --days 90\n"
     "  apple-healthkit blood-oxygen --days 7\n"
     "  apple-healthkit blood-glucose --days 7\n"
     "  apple-healthkit hrv --days 7\n"
     "  apple-healthkit nutrition --days 7 --type protein\n"
     "  apple-healthkit summary --days 7\n"
     "  apple-healthkit batch --types steps,active-energy,heart-rate,sleep --days 1\n"
     "  apple-healthkit types\n"
     "  apple-healthkit log --type weight --value 75.5\n"
     "  apple-healthkit log --type water --value 500\n"
     "  apple-healthkit log --type heart-rate --value 72\n"
     "  apple-healthkit log --type headache --value moderate\n"
     "  apple-healthkit log --type sleep --value deep --start 2024-01-01T23:00 --end 2024-01-02T07:00\n"
     "  apple-healthkit delete --type folate --today\n"
     "  apple-healthkit delete --type water --days 1\n"
     "  apple-healthkit delete --type headache --id 12345678-1234-1234-1234-123456789abc\n";

// ── Shared HKHealthStore ──

static HKHealthStore *_healthStore = nil;
static NSObject *_healthStoreLock = nil;
__attribute__((constructor)) static void initHealthStoreLock(void) {
    _healthStoreLock = [[NSObject alloc] init];
}
static HKHealthStore *healthStore(void) {
    @synchronized(_healthStoreLock) {
        if (!_healthStore) {
            _healthStore = [[HKHealthStore alloc] init];
        }
        return _healthStore;
    }
}

// Discard the cached HKHealthStore so the next healthStore() call builds a
// fresh instance. Used after a save fails with an authorization error — iOS
// sometimes caches the old "denied" state on the existing instance even
// after the user toggles the permission on in Settings; rebuilding the
// store forces a clean read of the current authorization state.
static void resetHealthStore(void) {
    @synchronized(_healthStoreLock) {
        _healthStore = nil;
    }
}

// ── Authorization helper ──
// Each `apple-healthkit` invocation runs as a separate guest thread in the
// same host process.  iOS only presents ONE HealthKit permission dialog at a
// time; overlapping requestAuthorization calls silently fail / get denied.
//
// We use a serial NSOperationQueue (maxConcurrentOperationCount=1) so that
// concurrent handler threads queue up and each gets its turn to present the
// authorization dialog.  The calling thread blocks until its operation
// completes (including any user interaction with the permission sheet).

static NSOperationQueue *authQueue(void) {
    static NSOperationQueue *q = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        q = [[NSOperationQueue alloc] init];
        q.maxConcurrentOperationCount = 1;
        q.name = @"com.openminis.healthkit.auth";
    });
    return q;
}

// [T-ios-healthkit-share-types-auth-crash] Drop types that HealthKit never
// permits as *share* (write) types, so they don't reach
// requestAuthorizationToShareTypes: and trip
// -_throwIfAuthorizationDisallowedForSharing: (which raises an uncaught ObjC
// exception → SIGABRT on iOS 26.5). The structurally read-only classes are
// HKCharacteristicType (biological sex, blood type, DOB, …) and
// HKActivitySummaryType (the activity rings) — these can only ever be read.
// Any further per-version restriction is still backstopped by the @try/@catch
// around the request call. Returns nil if nothing remains shareable.
static NSSet<HKSampleType *> *sanitizeShareTypes(NSSet<HKSampleType *> *shareTypes) {
    if (shareTypes.count == 0) return shareTypes;
    NSMutableSet<HKSampleType *> *filtered = [NSMutableSet setWithCapacity:shareTypes.count];
    for (HKSampleType *t in shareTypes) {
        if ([t isKindOfClass:[HKCharacteristicType class]] ||
            [t isKindOfClass:[HKActivitySummaryType class]]) {
            NSLog(@"[healthkit/auth] dropping non-shareable (read-only) type from shareTypes: %@",
                  t.identifier);
            continue;
        }
        [filtered addObject:t];
    }
    return filtered.count > 0 ? [filtered copy] : nil;
}

static BOOL requestHealthKitAccess(NSSet<HKObjectType *> *readTypes,
                                    NSSet<HKSampleType *> *shareTypes,
                                    NSString **outError) {
    if (![HKHealthStore isHealthDataAvailable]) {
        if (outError) *outError = @"HealthKit is not available on this device";
        return NO;
    }

    // Strip structurally read-only types before they can reach
    // requestAuthorizationToShareTypes: and raise an uncaught exception.
    shareTypes = sanitizeShareTypes(shareTypes);

    uint64_t tid = 0;
    pthread_threadid_np(NULL, &tid);

    NSLog(@"[healthkit/auth] [tid=%llu] enqueuing auth request (read=%lu share=%lu types)",
          tid,
          (unsigned long)readTypes.count,
          (unsigned long)(shareTypes ? shareTypes.count : 0));

    __block BOOL granted = NO;
    __block NSError *authError = nil;

    // Create a blocking operation that runs on the serial auth queue.
    // The operation itself dispatches to main for the actual HK call,
    // then waits for the completion before marking itself finished.
    //
    // IMPORTANT: After each authorization completes, we must wait briefly
    // for iOS to dismiss the HKHealthPrivacyHostAuthorizationViewController.
    // Without this delay, the next requestAuthorization call tries to present
    // on a VC "whose view is not in the window hierarchy" and silently fails
    // (completion callback never fires → semaphore hangs forever).
    NSBlockOperation *op = [NSBlockOperation blockOperationWithBlock:^{
        NSLog(@"[healthkit/auth] [tid=%llu] auth operation started, dispatching to main", tid);

        dispatch_semaphore_t sem = dispatch_semaphore_create(0);

        dispatch_async(dispatch_get_main_queue(), ^{
            NSLog(@"[healthkit/auth] [tid=%llu] on main thread, calling requestAuthorization", tid);
            // [T-ios-healthkit-share-types-auth-crash] Defensive @try/@catch.
            // On iOS 26.5, HealthKit's -_throwIfAuthorizationDisallowedForSharing:
            // raises an UNCAUGHT ObjC exception (→ SIGABRT, crashing the app)
            // *synchronously* during validation when shareTypes contains a type
            // that is not allowed for writing on this OS version — before the
            // completion block ever runs. requestAuthorizationToShareTypes: is a
            // throwing validation path, so wrap it: on exception, log and route
            // to the failure callback instead of letting it terminate the process.
            // shareTypes is also pre-filtered (see sanitizeShareTypes below) to
            // drop read-only types, but this catch is the hard backstop for any
            // type Apple newly restricts in a future point release.
            @try {
                [healthStore() requestAuthorizationToShareTypes:shareTypes
                                                      readTypes:readTypes
                                                     completion:^(BOOL success, NSError *err) {
                    NSLog(@"[healthkit/auth] [tid=%llu] authorization completed: success=%d error=%@",
                          tid, success, err.localizedDescription ?: @"(none)");
                    granted = success;
                    authError = err;
                    dispatch_semaphore_signal(sem);
                }];
            } @catch (NSException *ex) {
                NSLog(@"[healthkit/auth] [tid=%llu] EXCEPTION from requestAuthorizationToShareTypes "
                       "(likely a share type disallowed for writing on this iOS version): %@ — %@",
                      tid, ex.name, ex.reason ?: @"(no reason)");
                granted = NO;
                authError = [NSError errorWithDomain:HKErrorDomain
                                                code:HKErrorAuthorizationDenied
                                            userInfo:@{NSLocalizedDescriptionKey:
                    [NSString stringWithFormat:@"HealthKit rejected the authorization request: %@",
                        ex.reason ?: ex.name]}];
                dispatch_semaphore_signal(sem);
            }
        });

        long waitResult = dispatch_semaphore_wait(sem,
            dispatch_time(DISPATCH_TIME_NOW, 120 * NSEC_PER_SEC));
        if (waitResult != 0) {
            NSLog(@"[healthkit/auth] [tid=%llu] ERROR authorization timed out after 120s", tid);
        }

        // Give iOS time to tear down the HealthPrivacy VC before the next
        // authorization request tries to present a new one.
        dispatch_semaphore_t cooldown = dispatch_semaphore_create(0);
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.5 * NSEC_PER_SEC)),
                       dispatch_get_main_queue(), ^{
            dispatch_semaphore_signal(cooldown);
        });
        dispatch_semaphore_wait(cooldown, dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC));

        NSLog(@"[healthkit/auth] [tid=%llu] auth operation finished (granted=%d)", tid, granted);
    }];

    // Add to serial queue and wait — this blocks the calling guest thread
    // until all prior auth operations complete and this one finishes.
    [authQueue() addOperations:@[op] waitUntilFinished:YES];

    NSLog(@"[healthkit/auth] [tid=%llu] auth queue returned (granted=%d)", tid, granted);

    if (!granted && outError) {
        NSString *reason = authError.localizedDescription ?: @"HealthKit access not granted";
        *outError = [NSString stringWithFormat:
            @"%@. To grant access, open Settings > Health > Data Access & Devices > Minis "
             "and enable the required categories.", reason];
    }
    return granted;
}

// Detect HealthKit authorization errors returned by saveObject. HealthKit
// surfaces these via NSError (not via requestAuthorization) when the user
// denied write permission for a specific type.
static BOOL isHealthKitAuthError(NSError *err) {
    if (!err) return NO;
    if (![err.domain isEqualToString:HKErrorDomain]) return NO;
    return err.code == HKErrorAuthorizationDenied
        || err.code == HKErrorAuthorizationNotDetermined;
}

// Save an HKObject with a one-shot retry path for authorization errors.
// If the first save fails with an HKError auth code, we rebuild the
// HKHealthStore singleton (to clear any cached "denied" state inside the
// old instance), re-run requestAuthorization, and try saving again. This
// matches what users expect after toggling a permission on in Settings.
static BOOL saveWithAuthRetry(HKObject *sample,
                               HKSampleType *type,
                               NSError **outError) {
    __block BOOL success = NO;
    __block NSError *saveErr = nil;
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);
    [healthStore() saveObject:sample withCompletion:^(BOOL ok, NSError *err) {
        success = ok;
        saveErr = err;
        dispatch_semaphore_signal(sem);
    }];
    dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 15 * NSEC_PER_SEC));

    if (success) return YES;

    if (!isHealthKitAuthError(saveErr)) {
        if (outError) *outError = saveErr;
        return NO;
    }

    NSLog(@"[healthkit/auth] save failed with auth error — rebuilding HKHealthStore and retrying");
    resetHealthStore();
    NSString *authErr = nil;
    if (!requestHealthKitAccess([NSSet setWithObject:type],
                                 [NSSet setWithObject:type], &authErr)) {
        if (outError) {
            *outError = [NSError errorWithDomain:HKErrorDomain
                                            code:HKErrorAuthorizationDenied
                                        userInfo:@{NSLocalizedDescriptionKey: authErr ?: @"Authorization denied"}];
        }
        return NO;
    }

    success = NO;
    saveErr = nil;
    dispatch_semaphore_t sem2 = dispatch_semaphore_create(0);
    [healthStore() saveObject:sample withCompletion:^(BOOL ok, NSError *err) {
        success = ok;
        saveErr = err;
        dispatch_semaphore_signal(sem2);
    }];
    dispatch_semaphore_wait(sem2, dispatch_time(DISPATCH_TIME_NOW, 15 * NSEC_PER_SEC));

    if (!success && outError) *outError = saveErr;
    return success;
}

// ── Read-failure plumbing (GH#128) ──
//
// Every read helper below used to drop the `NSError` its results handler was
// handed and return an empty array / zero. That made three very different
// outcomes indistinguishable at the CLI: the query succeeded and the user
// genuinely has no samples; the query failed; or the query never came back
// before the 15s semaphore timeout. All three printed `ok:true` with zero rows.
//
// The case that made this actively harmful: Shortcuts can trigger an agent in
// the background (e.g. a 7am briefing) while the device is still locked, and
// Apple documents that the HealthKit store is encrypted and unreadable then
// ("your app may not be able to read data from the store when it runs in the
// background"). Every read fails with HKErrorDatabaseInaccessible, the CLI
// reported `ok:true` + no data for every metric, and the agent concluded the
// user had no health data — or that permission had been revoked — and told
// them so. Reads now get the same error treatment writes already had via
// isHealthKitAuthError/saveWithAuthRetry.
//
// Timeouts are reported separately from query failures: a timeout means we
// never heard back at all, which is a different diagnosis (store busy/wedged)
// than an error the store actively returned.

// Error domain for conditions this file synthesizes rather than receives.
static NSString *const kHKOffloadErrorDomain = @"MinisHealthKitOffload";
typedef NS_ENUM(NSInteger, HKOffloadErrorCode) {
    HKOffloadErrorQueryTimeout = 1,
};

static NSError *hkTimeoutError(NSString *what) {
    return [NSError errorWithDomain:kHKOffloadErrorDomain
                               code:HKOffloadErrorQueryTimeout
                           userInfo:@{NSLocalizedDescriptionKey:
        [NSString stringWithFormat:
            @"HealthKit %@ query did not return within 15s. The store may be "
             "locked (reads are blocked while the device is locked, including "
             "Shortcuts-triggered background runs) or busy.", what ?: @"sample"]}];
}

// Map an NSError from a read into the CLI's error-code vocabulary so the caller
// picks the right envelope code + exit status.
static NSString *hkReadErrorCode(NSError *err) {
    if (!err) return NOFF_ERR_INTERNAL_ERROR;
    if ([err.domain isEqualToString:kHKOffloadErrorDomain]
        && err.code == HKOffloadErrorQueryTimeout) {
        return @"query_timeout";
    }
    if (isHealthKitAuthError(err)) return NOFF_ERR_AUTHORIZATION_DENIED;
    return NOFF_ERR_INTERNAL_ERROR;
}

static int hkReadErrorExitCode(NSError *err) {
    if (err && isHealthKitAuthError(err)) return NOFF_EXIT_AUTH_DENIED;
    return NOFF_EXIT_ERROR;
}

// Human-readable detail carrying the raw domain/code so an agent (or a bug
// report) can tell HKErrorDatabaseInaccessible from a denial or a timeout.
static NSString *hkReadErrorMessage(NSError *err, NSString *what) {
    if (!err) {
        return [NSString stringWithFormat:@"HealthKit %@ query failed for an unknown reason.", what ?: @"sample"];
    }
    return [NSString stringWithFormat:@"HealthKit %@ query failed: %@ (domain=%@ code=%ld)",
            what ?: @"sample", err.localizedDescription ?: @"unknown error",
            err.domain, (long)err.code];
}

// Emit the standard failure envelope for a read that errored or timed out, and
// return the exit code the command should propagate.
static int hkEmitReadError(int stdout_fd, NSString *action, NSString *what,
                            NSError *err, BOOL compact, BOOL quiet) {
    NSLog(@"[healthkit/read] %@ failed: domain=%@ code=%ld desc=%@",
          action, err.domain, (long)err.code, err.localizedDescription);
    noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, action,
                   hkReadErrorCode(err), hkReadErrorMessage(err, what)),
                   compact, quiet);
    return hkReadErrorExitCode(err);
}

// ── Generic sample query helper ──
//
// `outError` is optional so the ~20 existing call sites that don't yet
// distinguish failure keep compiling unchanged; pass it to get the real
// outcome. On failure the return value is still an empty array, so a caller
// that ignores the error behaves exactly as before.
static NSArray<__kindof HKSample *> *querySamplesWithError(HKSampleType *sampleType,
                                                             NSPredicate *predicate,
                                                             NSUInteger limit,
                                                             NSArray<NSSortDescriptor *> *sortDescriptors,
                                                             NSError **outError) {
    __block NSArray *results = nil;
    __block NSError *queryErr = nil;
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);

    HKSampleQuery *query = [[HKSampleQuery alloc]
        initWithSampleType:sampleType
                 predicate:predicate
                     limit:limit
           sortDescriptors:sortDescriptors
            resultsHandler:^(HKSampleQuery *q, NSArray *samples, NSError *err) {
        results = samples;
        queryErr = err;
        dispatch_semaphore_signal(sem);
    }];
    [healthStore() executeQuery:query];
    long waitResult = dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 15 * NSEC_PER_SEC));

    if (waitResult != 0) {
        // Timed out: the handler may still fire later and write `results` /
        // `queryErr`, so do not read them here — report the timeout itself.
        if (outError) *outError = hkTimeoutError(sampleType.identifier);
        return @[];
    }
    if (queryErr) {
        if (outError) *outError = queryErr;
        return @[];
    }
    // Success. `samples` may legitimately be an empty array — that is the one
    // case that should still read as ok:true with zero rows.
    if (outError) *outError = nil;
    return results ?: @[];
}

// NOTE: the old error-dropping `querySamples()` wrapper was deliberately
// removed rather than kept for convenience — every caller now passes an
// out-error. Re-adding a wrapper that discards the NSError would silently
// reintroduce GH#128 (locked store reported as "no data").

// ── Statistics-collection query helper ──
//
// [GH#128 follow-up] The `HKStatisticsCollectionQuery` + semaphore + enumerate
// dance was open-coded in four commands. The first round of #128 fixes patched
// `cmd_steps` in place, and the remaining three (elevation, basal_energy,
// nutrition) kept the original error-dropping shape:
//
//     initialResultsHandler = ^(q, result, err) {     // err ignored
//         [result enumerateStatisticsFromDate:...];   // result may be nil
//     };
//     dispatch_semaphore_wait(sem, ...);              // waitResult discarded
//
// A nil collection enumerates zero times without complaint, so a locked or
// failed store produced a full range of legitimate-looking zeros under
// `ok:true` — the exact symptom #128 reported, just via different subcommands.
//
// Centralising it here means the next command that needs daily statistics
// cannot reintroduce the bug by copy-paste: there is no error-dropping variant
// to copy. Returns nil (never an empty array) on failure so callers cannot
// confuse "read failed" with "no samples in range" — an empty NON-nil array is
// a genuine empty range.
static NSArray<HKStatistics *> *statisticsCollectionWithError(HKQuantityType *quantityType,
                                                               NSPredicate *predicate,
                                                               HKStatisticsOptions options,
                                                               NSDate *anchorDate,
                                                               NSDateComponents *interval,
                                                               NSDate *start,
                                                               NSDate *end,
                                                               NSError **outError) {
    __block NSArray<HKStatistics *> *dailyStats = nil;
    __block NSError *queryErr = nil;
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);

    HKStatisticsCollectionQuery *query = [[HKStatisticsCollectionQuery alloc]
        initWithQuantityType:quantityType
         quantitySamplePredicate:predicate
                         options:options
                      anchorDate:anchorDate
              intervalComponents:interval];

    query.initialResultsHandler = ^(HKStatisticsCollectionQuery *q,
                                     HKStatisticsCollection *result,
                                     NSError *err) {
        if (err) {
            queryErr = err;
            dispatch_semaphore_signal(sem);
            return;
        }
        // Defensive: HealthKit should not hand back (nil, nil), but a nil
        // collection here is precisely what produced the silent zeros.
        if (!result) {
            queryErr = [NSError errorWithDomain:kHKOffloadErrorDomain
                                           code:HKOffloadErrorQueryTimeout
                                       userInfo:@{NSLocalizedDescriptionKey:
                @"HealthKit returned no statistics collection and no error. The "
                 "store may be locked or unavailable."}];
            dispatch_semaphore_signal(sem);
            return;
        }
        NSMutableArray *stats = [NSMutableArray array];
        [result enumerateStatisticsFromDate:start toDate:end
            withBlock:^(HKStatistics *s, BOOL *stop) {
                [stats addObject:s];
            }];
        dailyStats = stats;
        dispatch_semaphore_signal(sem);
    };

    [healthStore() executeQuery:query];
    long waitResult = dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 15 * NSEC_PER_SEC));

    // Timed out: the handler may still fire later, so do NOT read dailyStats or
    // queryErr — same discipline as querySamplesWithError.
    if (waitResult != 0) {
        if (outError) *outError = hkTimeoutError(quantityType.identifier);
        return nil;
    }
    if (queryErr) {
        if (outError) *outError = queryErr;
        return nil;
    }
    if (outError) *outError = nil;
    return dailyStats;
}

// ── Count query helper ──
//
// Returns NSNotFound on failure/timeout so a failed count can't masquerade as
// a real zero (which would silently suppress the truncation warning).
static NSUInteger countSamplesWithError(HKSampleType *sampleType,
                                         NSPredicate *predicate,
                                         NSError **outError) {
    __block NSArray *results = nil;
    __block NSError *queryErr = nil;
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);

    HKSampleQuery *query = [[HKSampleQuery alloc]
        initWithSampleType:sampleType
                 predicate:predicate
                     limit:HKObjectQueryNoLimit
           sortDescriptors:nil
            resultsHandler:^(HKSampleQuery *q, NSArray *samples, NSError *err) {
        results = samples;
        queryErr = err;
        dispatch_semaphore_signal(sem);
    }];
    [healthStore() executeQuery:query];
    long waitResult = dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 15 * NSEC_PER_SEC));

    if (waitResult != 0) {
        if (outError) *outError = hkTimeoutError(sampleType.identifier);
        return NSNotFound;
    }
    if (queryErr) {
        if (outError) *outError = queryErr;
        return NSNotFound;
    }
    if (outError) *outError = nil;
    return results.count;
}

static NSUInteger countSamples(HKSampleType *sampleType, NSPredicate *predicate) {
    NSError *err = nil;
    NSUInteger total = countSamplesWithError(sampleType, predicate, &err);
    // Legacy shape: callers that don't check treat a failure as "no extra
    // records", which only suppresses a truncation warning — never fabricates data.
    return total == NSNotFound ? 0 : total;
}

// ── Truncation warning helper ──
// Adds a "_warning" key when results were capped by --limit.

static void addTruncationWarning(NSMutableDictionary *data,
                                  NSUInteger returned,
                                  NSUInteger total) {
    if (total > returned) {
        data[@"_warning"] = [NSString stringWithFormat:
            @"Results truncated by --limit. Returned %lu of %lu total records. "
             "Use a larger --limit to retrieve more data.",
            (unsigned long)returned, (unsigned long)total];
        data[@"total_available"] = @(total);
        // [GH#106 Phase 2d] Machine-readable boolean — callers previously had
        // to string-probe `_warning` to detect truncation.
        data[@"truncated"] = @YES;
    }
}

// ── Structured warnings (GH#106) ──
//
// `batch` used to drop unrecognized --types names into an `unknown_types` array
// and still return the normal success envelope, so a partially-bad request was
// indistinguishable from "no health data in this range". These helpers collect
// machine-readable warnings that batch surfaces under data.warnings.
//
// Conventions (see the GH#106 design):
//   - The envelope keeps ok:true for partial success; ok:false stays reserved
//     for the pre-existing all-names-unknown hard failure.
//   - `warnings` is emitted only when non-empty — an absent key means a clean run.
//   - Each entry is {code, message, types}. Codes used here: "unknown_type",
//     "results_truncated", "read_failed" (GH#128), and — since the Phase 2
//     alias table landed — "alias_resolved" and "unsupported_in_batch".
static void appendWarning(NSMutableArray *warnings,
                           NSString *code,
                           NSString *message,
                           NSArray<NSString *> *types) {
    [warnings addObject:@{
        @"code": code,
        @"message": message,
        @"types": types ?: @[],
    }];
}

// ── Date range resolution ──

static void resolve_date_range(int argc, char **argv, NSDate **start, NSDate **end) {
    if (noff_has_flag(argc, argv, "--today")) {
        NSCalendar *cal = [NSCalendar currentCalendar];
        *start = [cal startOfDayForDate:[NSDate date]];
        *end = [cal dateByAddingUnit:NSCalendarUnitDay value:1 toDate:*start options:0];
        return;
    }

    NSString *daysStr = noff_find_arg(argc, argv, "--days");
    if (daysStr) {
        NSInteger days = [daysStr integerValue];
        if (days <= 0) days = 7;
        NSCalendar *cal = [NSCalendar currentCalendar];
        *start = [cal startOfDayForDate:[NSDate dateWithTimeIntervalSinceNow:-days * 86400]];
        *end = [NSDate date];
        return;
    }

    NSString *startStr = noff_find_arg(argc, argv, "--start");
    NSString *endStr = noff_find_arg(argc, argv, "--end");
    *start = startStr ? noff_parse_date(startStr) : [NSDate dateWithTimeIntervalSinceNow:-86400];
    *end = endStr ? noff_parse_date(endStr) : [NSDate date];
}

// ── Source name helper ──

static NSString *sourceNameForSample(HKSample *sample) {
    return sample.sourceRevision.source.name ?: @"";
}

// ── Workout type name helper ──

static NSString *workoutActivityTypeName(HKWorkoutActivityType type) {
    switch (type) {
        case HKWorkoutActivityTypeRunning:              return @"Running";
        case HKWorkoutActivityTypeWalking:              return @"Walking";
        case HKWorkoutActivityTypeCycling:              return @"Cycling";
        case HKWorkoutActivityTypeSwimming:             return @"Swimming";
        case HKWorkoutActivityTypeHiking:               return @"Hiking";
        case HKWorkoutActivityTypeYoga:                 return @"Yoga";
        case HKWorkoutActivityTypeFunctionalStrengthTraining: return @"Strength Training";
        case HKWorkoutActivityTypeTraditionalStrengthTraining: return @"Traditional Strength Training";
        case HKWorkoutActivityTypeCrossTraining:        return @"Cross Training";
        case HKWorkoutActivityTypeElliptical:           return @"Elliptical";
        case HKWorkoutActivityTypeRowing:               return @"Rowing";
        case HKWorkoutActivityTypeStairClimbing:        return @"Stair Climbing";
        case HKWorkoutActivityTypeHighIntensityIntervalTraining: return @"HIIT";
        case HKWorkoutActivityTypeDance:                return @"Dance";
        case HKWorkoutActivityTypePilates:              return @"Pilates";
        case HKWorkoutActivityTypeMartialArts:          return @"Martial Arts";
        case HKWorkoutActivityTypeTennis:               return @"Tennis";
        case HKWorkoutActivityTypeBadminton:            return @"Badminton";
        case HKWorkoutActivityTypeBasketball:           return @"Basketball";
        case HKWorkoutActivityTypeSoccer:               return @"Soccer";
        case HKWorkoutActivityTypeGolf:                 return @"Golf";
        case HKWorkoutActivityTypeCooldown:             return @"Cooldown";
        case HKWorkoutActivityTypeCoreTraining:         return @"Core Training";
        case HKWorkoutActivityTypeMixedCardio:          return @"Mixed Cardio";
        default: return [NSString stringWithFormat:@"Workout(%lu)", (unsigned long)type];
    }
}

// ── Subcommands ──

#pragma mark - steps

static int cmd_steps(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    HKQuantityType *stepType = [HKQuantityType quantityTypeForIdentifier:HKQuantityTypeIdentifierStepCount];
    NSString *authErr = nil;
    if (!requestHealthKitAccess([NSSet setWithObject:stepType], nil, &authErr)) {
        noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"steps",
                       NOFF_ERR_AUTHORIZATION_DENIED, authErr), compact, quiet);
        return NOFF_EXIT_AUTH_DENIED;
    }

    NSDate *start, *end;
    resolve_date_range(argc, argv, &start, &end);

    NSCalendar *calendar = [NSCalendar currentCalendar];
    NSDateComponents *interval = [[NSDateComponents alloc] init];
    interval.day = 1;
    NSDate *anchorDate = [calendar startOfDayForDate:start];

    NSPredicate *predicate = [HKQuery predicateForSamplesWithStartDate:start
                                                               endDate:end
                                                               options:HKQueryOptionStrictStartDate];

    // [GH#128] Routed through the shared helper along with the other three
    // statistics commands. This was the one site the first round fixed in
    // place; folding it in leaves NO open-coded copy of the pattern for a new
    // command to clone.
    NSError *statsErr = nil;
    NSArray<HKStatistics *> *dailyStats = statisticsCollectionWithError(
        stepType, predicate, HKStatisticsOptionCumulativeSum,
        anchorDate, interval, start, end, &statsErr);
    if (!dailyStats) {
        return hkEmitReadError(stdout_fd, @"steps", @"step count", statsErr, compact, quiet);
    }

    NSMutableArray *items = [NSMutableArray array];
    double total = 0;
    for (HKStatistics *stat in dailyStats) {
        HKQuantity *sum = [stat sumQuantity];
        double steps = sum ? [sum doubleValueForUnit:[HKUnit countUnit]] : 0;
        total += steps;
        [items addObject:@{
            @"date": noff_format_date(stat.startDate),
            @"steps": @((NSInteger)steps),
        }];
    }

    NSDictionary *data = @{
        @"days": items,
        @"total": @((NSInteger)total),
        @"range": @{
            @"start": noff_format_date(start),
            @"end": noff_format_date(end),
        },
    };
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"steps", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

#pragma mark - heart-rate

static int cmd_heart_rate(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    HKQuantityType *hrType = [HKQuantityType quantityTypeForIdentifier:HKQuantityTypeIdentifierHeartRate];
    NSString *authErr = nil;
    if (!requestHealthKitAccess([NSSet setWithObject:hrType], nil, &authErr)) {
        noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"heart-rate",
                       NOFF_ERR_AUTHORIZATION_DENIED, authErr), compact, quiet);
        return NOFF_EXIT_AUTH_DENIED;
    }

    NSDate *start, *end;
    resolve_date_range(argc, argv, &start, &end);

    NSString *limitStr = noff_find_arg(argc, argv, "--limit");
    NSUInteger limit = limitStr ? (NSUInteger)[limitStr integerValue] : DEFAULT_LIMIT;

    NSPredicate *predicate = [HKQuery predicateForSamplesWithStartDate:start
                                                               endDate:end
                                                               options:HKQueryOptionStrictStartDate];
    NSSortDescriptor *sort = [NSSortDescriptor sortDescriptorWithKey:HKSampleSortIdentifierStartDate
                                                           ascending:NO];

    NSError *readErr = nil;
    NSArray *samples = querySamplesWithError(hrType, predicate, limit, @[sort], &readErr);
    // [GH#128] A failed/timed-out read must not be reported as zero samples.
    if (readErr) {
        return hkEmitReadError(stdout_fd, @"heart-rate", @"heart rate", readErr, compact, quiet);
    }
    HKUnit *bpmUnit = [[HKUnit countUnit] unitDividedByUnit:[HKUnit minuteUnit]];

    NSMutableArray *items = [NSMutableArray array];
    for (HKQuantitySample *s in samples) {
        double bpm = [s.quantity doubleValueForUnit:bpmUnit];
        [items addObject:@{
            @"date": noff_format_date(s.startDate),
            @"bpm": @(round(bpm)),
            @"source": sourceNameForSample(s),
        }];
    }

    NSMutableDictionary *data = [@{
        @"samples": items,
        @"count": @(items.count),
        @"range": @{
            @"start": noff_format_date(start),
            @"end": noff_format_date(end),
        },
    } mutableCopy];
    if (items.count >= limit) {
        NSUInteger total = countSamples(hrType, predicate);
        addTruncationWarning(data, items.count, total);
    }
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"heart-rate", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

#pragma mark - sleep

static int cmd_sleep(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    HKCategoryType *sleepType = [HKCategoryType categoryTypeForIdentifier:HKCategoryTypeIdentifierSleepAnalysis];
    NSString *authErr = nil;
    if (!requestHealthKitAccess([NSSet setWithObject:sleepType], nil, &authErr)) {
        noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"sleep",
                       NOFF_ERR_AUTHORIZATION_DENIED, authErr), compact, quiet);
        return NOFF_EXIT_AUTH_DENIED;
    }

    NSDate *start, *end;
    resolve_date_range(argc, argv, &start, &end);

    NSPredicate *predicate = [HKQuery predicateForSamplesWithStartDate:start
                                                               endDate:end
                                                               options:HKQueryOptionStrictStartDate];
    NSSortDescriptor *sort = [NSSortDescriptor sortDescriptorWithKey:HKSampleSortIdentifierStartDate
                                                           ascending:YES];

    NSError *readErr = nil;
    NSArray *samples = querySamplesWithError(sleepType, predicate, HKObjectQueryNoLimit, @[sort], &readErr);
    // [GH#128] A failed/timed-out read must not be reported as zero samples.
    if (readErr) {
        return hkEmitReadError(stdout_fd, @"sleep", @"sleep", readErr, compact, quiet);
    }

    NSMutableArray *items = [NSMutableArray array];
    for (HKCategorySample *s in samples) {
        NSString *value;
        switch (s.value) {
            case HKCategoryValueSleepAnalysisInBed:     value = @"inBed"; break;
            case HKCategoryValueSleepAnalysisAsleepCore:
            case HKCategoryValueSleepAnalysisAsleepDeep:
            case HKCategoryValueSleepAnalysisAsleepREM:
                // Map all asleep subtypes
                if (s.value == HKCategoryValueSleepAnalysisAsleepCore)  value = @"asleepCore";
                else if (s.value == HKCategoryValueSleepAnalysisAsleepDeep) value = @"asleepDeep";
                else value = @"asleepREM";
                break;
            case HKCategoryValueSleepAnalysisAwake:     value = @"awake"; break;
            default:
                // Legacy asleep value
                if (s.value == HKCategoryValueSleepAnalysisAsleepUnspecified) {
                    value = @"asleep";
                } else {
                    value = @"asleep";
                }
                break;
        }

        NSTimeInterval duration = [s.endDate timeIntervalSinceDate:s.startDate];
        [items addObject:@{
            @"start": noff_format_date(s.startDate),
            @"end": noff_format_date(s.endDate),
            @"value": value,
            @"source": sourceNameForSample(s),
            @"duration_hours": @(round(duration / 3600.0 * 100.0) / 100.0),
        }];
    }

    NSDictionary *data = @{
        @"samples": items,
        @"count": @(items.count),
        @"range": @{
            @"start": noff_format_date(start),
            @"end": noff_format_date(end),
        },
    };
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"sleep", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

#pragma mark - workouts

static int cmd_workouts(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    HKWorkoutType *workoutType = [HKWorkoutType workoutType];
    NSString *authErr = nil;
    if (!requestHealthKitAccess([NSSet setWithObject:workoutType], nil, &authErr)) {
        noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"workouts",
                       NOFF_ERR_AUTHORIZATION_DENIED, authErr), compact, quiet);
        return NOFF_EXIT_AUTH_DENIED;
    }

    NSDate *start, *end;
    resolve_date_range(argc, argv, &start, &end);

    NSString *limitStr = noff_find_arg(argc, argv, "--limit");
    NSUInteger limit = limitStr ? (NSUInteger)[limitStr integerValue] : DEFAULT_LIMIT;

    NSString *typeFilter = noff_find_arg(argc, argv, "--type");

    NSPredicate *predicate = [HKQuery predicateForSamplesWithStartDate:start
                                                               endDate:end
                                                               options:HKQueryOptionStrictStartDate];
    NSSortDescriptor *sort = [NSSortDescriptor sortDescriptorWithKey:HKSampleSortIdentifierStartDate
                                                           ascending:NO];

    NSError *readErr = nil;
    NSArray *samples = querySamplesWithError(workoutType, predicate, HKObjectQueryNoLimit, @[sort], &readErr);
    // [GH#128] A failed/timed-out read must not be reported as zero samples.
    if (readErr) {
        return hkEmitReadError(stdout_fd, @"workouts", @"workout", readErr, compact, quiet);
    }

    NSMutableArray *items = [NSMutableArray array];
    NSUInteger count = 0;
    NSUInteger totalMatching = 0;
    for (HKWorkout *w in samples) {
        NSString *typeName = workoutActivityTypeName(w.workoutActivityType);

        if (typeFilter && ![typeName localizedCaseInsensitiveContainsString:typeFilter]) {
            continue;
        }
        totalMatching++;

        if (count >= limit) continue; // keep counting total but stop collecting

        double durationMin = w.duration / 60.0;
        double calories = 0;
        if (w.totalEnergyBurned) {
            calories = [w.totalEnergyBurned doubleValueForUnit:[HKUnit kilocalorieUnit]];
        }
        double distanceKm = 0;
        if (w.totalDistance) {
            distanceKm = [w.totalDistance doubleValueForUnit:[HKUnit meterUnitWithMetricPrefix:HKMetricPrefixKilo]];
        }
        double totalSwimmingStrokes = 0;
        if (w.totalSwimmingStrokeCount) {
            totalSwimmingStrokes = [w.totalSwimmingStrokeCount doubleValueForUnit:[HKUnit countUnit]];
        }
        double totalFlightsClimbed = 0;
        if (w.totalFlightsClimbed) {
            totalFlightsClimbed = [w.totalFlightsClimbed doubleValueForUnit:[HKUnit countUnit]];
        }

        NSMutableDictionary *item = [@{
            @"start": noff_format_date(w.startDate),
            @"end": noff_format_date(w.endDate),
            @"type": typeName,
            @"duration_minutes": @(round(durationMin * 10.0) / 10.0),
            @"calories": @(round(calories)),
            @"distance_km": @(round(distanceKm * 100.0) / 100.0),
            @"source": sourceNameForSample(w),
        } mutableCopy];

        // Swimming strokes
        if (totalSwimmingStrokes > 0) {
            item[@"swimming_strokes"] = @((NSInteger)totalSwimmingStrokes);
        }
        // Flights climbed
        if (totalFlightsClimbed > 0) {
            item[@"flights_climbed"] = @((NSInteger)totalFlightsClimbed);
        }
        // Workout metadata
        NSDictionary *meta = w.metadata;
        if (meta[HKMetadataKeyAverageSpeed]) {
            HKQuantity *avgSpeed = meta[HKMetadataKeyAverageSpeed];
            if ([avgSpeed isKindOfClass:[HKQuantity class]]) {
                HKUnit *mps = [HKUnit meterUnit];
                mps = [mps unitDividedByUnit:[HKUnit secondUnit]];
                double avgSpeedMS = [avgSpeed doubleValueForUnit:mps];
                double avgSpeedKmh = avgSpeedMS * 3.6;
                item[@"avg_speed_kmh"] = @(round(avgSpeedKmh * 100.0) / 100.0);
            }
        }
        // Indoor workout flag
        if (meta[HKMetadataKeyIndoorWorkout]) {
            item[@"indoor"] = meta[HKMetadataKeyIndoorWorkout];
        }
        // Swim location type
        if (meta[HKMetadataKeySwimmingLocationType]) {
            NSInteger loc = [meta[HKMetadataKeySwimmingLocationType] integerValue];
            item[@"swimming_location"] = loc == 1 ? @"pool" : loc == 2 ? @"open_water" : @"unknown";
        }
        // Lap length
        if (meta[HKMetadataKeyLapLength]) {
            HKQuantity *lapLen = meta[HKMetadataKeyLapLength];
            if ([lapLen isKindOfClass:[HKQuantity class]]) {
                item[@"lap_length_m"] = @([lapLen doubleValueForUnit:[HKUnit meterUnit]]);
            }
        }
        // Weather temperature & humidity
        if (meta[HKMetadataKeyWeatherTemperature]) {
            HKQuantity *temp = meta[HKMetadataKeyWeatherTemperature];
            if ([temp isKindOfClass:[HKQuantity class]]) {
                item[@"weather_temp_c"] = @(round([temp doubleValueForUnit:[HKUnit degreeCelsiusUnit]] * 10.0) / 10.0);
            }
        }
        if (meta[HKMetadataKeyWeatherHumidity]) {
            HKQuantity *humidity = meta[HKMetadataKeyWeatherHumidity];
            if ([humidity isKindOfClass:[HKQuantity class]]) {
                item[@"weather_humidity_pct"] = @(round([humidity doubleValueForUnit:[HKUnit percentUnit]] * 100.0));
            }
        }
        // Elevation ascended/descended
        if (meta[@"HKElevationAscended"]) {
            HKQuantity *elev = meta[@"HKElevationAscended"];
            if ([elev isKindOfClass:[HKQuantity class]]) {
                item[@"elevation_ascended_m"] = @(round([elev doubleValueForUnit:[HKUnit meterUnit]] * 10.0) / 10.0);
            }
        }
        if (meta[@"HKElevationDescended"]) {
            HKQuantity *elev = meta[@"HKElevationDescended"];
            if ([elev isKindOfClass:[HKQuantity class]]) {
                item[@"elevation_descended_m"] = @(round([elev doubleValueForUnit:[HKUnit meterUnit]] * 10.0) / 10.0);
            }
        }

        [items addObject:item];
        count++;
    }

    NSMutableDictionary *data = [@{
        @"workouts": items,
        @"count": @(items.count),
        @"range": @{
            @"start": noff_format_date(start),
            @"end": noff_format_date(end),
        },
    } mutableCopy];
    addTruncationWarning(data, items.count, totalMatching);
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"workouts", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

#pragma mark - cadence

static int cmd_cadence(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    // Walking cadence = steps per minute during walking bouts
    HKQuantityType *cadenceType = [HKQuantityType quantityTypeForIdentifier:HKQuantityTypeIdentifierWalkingSpeed];
    HKQuantityType *strideLenType = [HKQuantityType quantityTypeForIdentifier:HKQuantityTypeIdentifierWalkingStepLength];
    // Running cadence
    HKQuantityType *runCadenceType = [HKQuantityType quantityTypeForIdentifier:HKQuantityTypeIdentifierRunningStrideLength];
    HKQuantityType *stepCountType = [HKQuantityType quantityTypeForIdentifier:HKQuantityTypeIdentifierStepCount];

    NSSet *readTypes = [NSSet setWithObjects:cadenceType, strideLenType, runCadenceType, stepCountType, nil];
    NSString *authErr = nil;
    if (!requestHealthKitAccess(readTypes, nil, &authErr)) {
        noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"cadence",
                       NOFF_ERR_AUTHORIZATION_DENIED, authErr), compact, quiet);
        return NOFF_EXIT_AUTH_DENIED;
    }

    NSDate *start, *end;
    resolve_date_range(argc, argv, &start, &end);

    NSString *limitStr = noff_find_arg(argc, argv, "--limit");
    NSUInteger limit = limitStr ? (NSUInteger)[limitStr integerValue] : DEFAULT_LIMIT;

    NSPredicate *predicate = [HKQuery predicateForSamplesWithStartDate:start
                                                               endDate:end
                                                               options:HKQueryOptionStrictStartDate];
    NSSortDescriptor *sort = [NSSortDescriptor sortDescriptorWithKey:HKSampleSortIdentifierStartDate
                                                           ascending:NO];

    // Query walking speed (km/h) and step length (cm) samples
    HKUnit *kmhUnit = [[HKUnit meterUnitWithMetricPrefix:HKMetricPrefixKilo] unitDividedByUnit:[HKUnit hourUnit]];
    HKUnit *cmUnit = [HKUnit meterUnitWithMetricPrefix:HKMetricPrefixCenti];

    // [GH#128] Two reads back this command; either failing means the answer is
    // incomplete, so fail the whole command rather than silently reporting the
    // half that happened to succeed.
    NSError *speedErr = nil;
    NSArray *speedSamples = querySamplesWithError(cadenceType, predicate, limit, @[sort], &speedErr);
    if (speedErr) {
        return hkEmitReadError(stdout_fd, @"cadence", @"walking speed", speedErr, compact, quiet);
    }
    NSError *stepLenErr = nil;
    NSArray *stepLenSamples = querySamplesWithError(strideLenType, predicate, limit, @[sort], &stepLenErr);
    if (stepLenErr) {
        return hkEmitReadError(stdout_fd, @"cadence", @"step length", stepLenErr, compact, quiet);
    }

    NSMutableArray *items = [NSMutableArray array];

    // Walking speed samples → derive approximate cadence from speed/step_length
    for (HKQuantitySample *s in speedSamples) {
        double speedKmh = [s.quantity doubleValueForUnit:kmhUnit];
        [items addObject:@{
            @"date": noff_format_date(s.startDate),
            @"type": @"walking",
            @"walking_speed_kmh": @(noff_round4(speedKmh)),
            @"source": sourceNameForSample(s),
        }];
    }

    // Step length samples
    NSMutableArray *stepLenItems = [NSMutableArray array];
    for (HKQuantitySample *s in stepLenSamples) {
        double lenCm = [s.quantity doubleValueForUnit:cmUnit];
        [stepLenItems addObject:@{
            @"date": noff_format_date(s.startDate),
            @"step_length_cm": @(noff_round4(lenCm)),
            @"source": sourceNameForSample(s),
        }];
    }

    NSDictionary *data = @{
        @"walking_speed": items,
        @"step_length": stepLenItems,
        @"count": @(items.count + stepLenItems.count),
        @"range": @{
            @"start": noff_format_date(start),
            @"end": noff_format_date(end),
        },
    };
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"cadence", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

#pragma mark - elevation

static int cmd_elevation(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    HKQuantityType *flightsType = [HKQuantityType quantityTypeForIdentifier:HKQuantityTypeIdentifierFlightsClimbed];
    NSString *authErr = nil;
    if (!requestHealthKitAccess([NSSet setWithObject:flightsType], nil, &authErr)) {
        noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"elevation",
                       NOFF_ERR_AUTHORIZATION_DENIED, authErr), compact, quiet);
        return NOFF_EXIT_AUTH_DENIED;
    }

    NSDate *start, *end;
    resolve_date_range(argc, argv, &start, &end);

    // Daily aggregation of flights climbed
    NSCalendar *calendar = [NSCalendar currentCalendar];
    NSDateComponents *interval = [[NSDateComponents alloc] init];
    interval.day = 1;
    NSDate *anchorDate = [calendar startOfDayForDate:start];

    NSPredicate *predicate = [HKQuery predicateForSamplesWithStartDate:start
                                                               endDate:end
                                                               options:HKQueryOptionStrictStartDate];

    // [GH#128] Was: unchecked enumerate over a possibly-nil collection with the
    // handler's NSError dropped, so a locked store reported flights_climbed: 0
    // for every day under ok:true.
    NSError *statsErr = nil;
    NSArray<HKStatistics *> *dailyStats = statisticsCollectionWithError(
        flightsType, predicate, HKStatisticsOptionCumulativeSum,
        anchorDate, interval, start, end, &statsErr);
    if (!dailyStats) {
        return hkEmitReadError(stdout_fd, @"elevation", @"flights climbed",
                               statsErr, compact, quiet);
    }

    NSMutableArray *items = [NSMutableArray array];
    double total = 0;
    for (HKStatistics *stat in dailyStats) {
        HKQuantity *sum = [stat sumQuantity];
        double flights = sum ? [sum doubleValueForUnit:[HKUnit countUnit]] : 0;
        total += flights;
        // Approximate elevation: ~3m per flight of stairs
        double elevationM = flights * 3.0;
        [items addObject:@{
            @"date": noff_format_date(stat.startDate),
            @"flights_climbed": @((NSInteger)flights),
            @"approx_elevation_m": @(round(elevationM * 10.0) / 10.0),
        }];
    }

    NSDictionary *data = @{
        @"days": items,
        @"total_flights": @((NSInteger)total),
        @"total_approx_elevation_m": @(round(total * 3.0 * 10.0) / 10.0),
        @"range": @{
            @"start": noff_format_date(start),
            @"end": noff_format_date(end),
        },
    };
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"elevation", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

#pragma mark - weight

static int cmd_weight(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    HKQuantityType *weightType = [HKQuantityType quantityTypeForIdentifier:HKQuantityTypeIdentifierBodyMass];
    NSString *authErr = nil;
    if (!requestHealthKitAccess([NSSet setWithObject:weightType], nil, &authErr)) {
        noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"weight",
                       NOFF_ERR_AUTHORIZATION_DENIED, authErr), compact, quiet);
        return NOFF_EXIT_AUTH_DENIED;
    }

    NSDate *start, *end;
    resolve_date_range(argc, argv, &start, &end);

    NSString *limitStr = noff_find_arg(argc, argv, "--limit");
    NSUInteger limit = limitStr ? (NSUInteger)[limitStr integerValue] : DEFAULT_LIMIT;

    NSPredicate *predicate = [HKQuery predicateForSamplesWithStartDate:start
                                                               endDate:end
                                                               options:HKQueryOptionStrictStartDate];
    NSSortDescriptor *sort = [NSSortDescriptor sortDescriptorWithKey:HKSampleSortIdentifierStartDate
                                                           ascending:NO];

    NSError *readErr = nil;
    NSArray *samples = querySamplesWithError(weightType, predicate, limit, @[sort], &readErr);
    // [GH#128] A failed/timed-out read must not be reported as zero samples.
    if (readErr) {
        return hkEmitReadError(stdout_fd, @"weight", @"body mass", readErr, compact, quiet);
    }

    HKUnit *kgUnit = [HKUnit gramUnitWithMetricPrefix:HKMetricPrefixKilo];
    HKUnit *lbUnit = [HKUnit poundUnit];

    NSMutableArray *items = [NSMutableArray array];
    for (HKQuantitySample *s in samples) {
        double kg = [s.quantity doubleValueForUnit:kgUnit];
        double lbs = [s.quantity doubleValueForUnit:lbUnit];
        [items addObject:@{
            @"date": noff_format_date(s.startDate),
            @"kg": @(noff_round4(kg)),
            @"lbs": @(noff_round4(lbs)),
            @"source": sourceNameForSample(s),
        }];
    }

    NSMutableDictionary *data = [@{
        @"samples": items,
        @"count": @(items.count),
        @"range": @{
            @"start": noff_format_date(start),
            @"end": noff_format_date(end),
        },
    } mutableCopy];
    if (items.count >= limit) {
        NSUInteger total = countSamples(weightType, predicate);
        addTruncationWarning(data, items.count, total);
    }
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"weight", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

#pragma mark - blood-oxygen

static int cmd_blood_oxygen(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    HKQuantityType *spo2Type = [HKQuantityType quantityTypeForIdentifier:HKQuantityTypeIdentifierOxygenSaturation];
    NSString *authErr = nil;
    if (!requestHealthKitAccess([NSSet setWithObject:spo2Type], nil, &authErr)) {
        noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"blood-oxygen",
                       NOFF_ERR_AUTHORIZATION_DENIED, authErr), compact, quiet);
        return NOFF_EXIT_AUTH_DENIED;
    }

    NSDate *start, *end;
    resolve_date_range(argc, argv, &start, &end);

    NSString *limitStr = noff_find_arg(argc, argv, "--limit");
    NSUInteger limit = limitStr ? (NSUInteger)[limitStr integerValue] : DEFAULT_LIMIT;

    NSPredicate *predicate = [HKQuery predicateForSamplesWithStartDate:start
                                                               endDate:end
                                                               options:HKQueryOptionStrictStartDate];
    NSSortDescriptor *sort = [NSSortDescriptor sortDescriptorWithKey:HKSampleSortIdentifierStartDate
                                                           ascending:NO];

    NSError *readErr = nil;
    NSArray *samples = querySamplesWithError(spo2Type, predicate, limit, @[sort], &readErr);
    // [GH#128] A failed/timed-out read must not be reported as zero samples.
    if (readErr) {
        return hkEmitReadError(stdout_fd, @"blood-oxygen", @"blood oxygen", readErr, compact, quiet);
    }

    NSMutableArray *items = [NSMutableArray array];
    for (HKQuantitySample *s in samples) {
        double pct = [s.quantity doubleValueForUnit:[HKUnit percentUnit]] * 100.0;
        [items addObject:@{
            @"date": noff_format_date(s.startDate),
            @"percentage": @(noff_round4(pct)),
            @"source": sourceNameForSample(s),
        }];
    }

    NSMutableDictionary *data = [@{
        @"samples": items,
        @"count": @(items.count),
        @"range": @{
            @"start": noff_format_date(start),
            @"end": noff_format_date(end),
        },
    } mutableCopy];
    if (items.count >= limit) {
        NSUInteger total = countSamples(spo2Type, predicate);
        addTruncationWarning(data, items.count, total);
    }
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"blood-oxygen", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

#pragma mark - blood-glucose

static int cmd_blood_glucose(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    HKQuantityType *bgType = [HKQuantityType quantityTypeForIdentifier:HKQuantityTypeIdentifierBloodGlucose];
    NSString *authErr = nil;
    if (!requestHealthKitAccess([NSSet setWithObject:bgType], nil, &authErr)) {
        noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"blood-glucose",
                       NOFF_ERR_AUTHORIZATION_DENIED, authErr), compact, quiet);
        return NOFF_EXIT_AUTH_DENIED;
    }

    NSDate *start, *end;
    resolve_date_range(argc, argv, &start, &end);

    NSString *limitStr = noff_find_arg(argc, argv, "--limit");
    NSUInteger limit = limitStr ? (NSUInteger)[limitStr integerValue] : DEFAULT_LIMIT;

    NSPredicate *predicate = [HKQuery predicateForSamplesWithStartDate:start
                                                               endDate:end
                                                               options:HKQueryOptionStrictStartDate];
    NSSortDescriptor *sort = [NSSortDescriptor sortDescriptorWithKey:HKSampleSortIdentifierStartDate
                                                           ascending:NO];

    NSError *readErr = nil;
    NSArray *samples = querySamplesWithError(bgType, predicate, limit, @[sort], &readErr);
    // [GH#128] A failed/timed-out read must not be reported as zero samples.
    if (readErr) {
        return hkEmitReadError(stdout_fd, @"blood-glucose", @"blood glucose", readErr, compact, quiet);
    }

    // mg/dL is the most common unit; also provide mmol/L
    HKUnit *mgdLUnit = [HKUnit unitFromString:@"mg/dL"];
    HKUnit *mmolLUnit = [HKUnit moleUnitWithMetricPrefix:HKMetricPrefixMilli molarMass:HKUnitMolarMassBloodGlucose];
    mmolLUnit = [mmolLUnit unitDividedByUnit:[HKUnit literUnit]];

    NSMutableArray *items = [NSMutableArray array];
    for (HKQuantitySample *s in samples) {
        double mgdl = [s.quantity doubleValueForUnit:mgdLUnit];
        double mmoll = [s.quantity doubleValueForUnit:mmolLUnit];
        NSMutableDictionary *item = [@{
            @"date": noff_format_date(s.startDate),
            @"mg_dl": @(noff_round4(mgdl)),
            @"mmol_l": @(noff_round4(mmoll)),
            @"source": sourceNameForSample(s),
        } mutableCopy];

        // Include meal context metadata if available
        NSNumber *mealTime = s.metadata[HKMetadataKeyBloodGlucoseMealTime];
        if (mealTime) {
            item[@"meal_time"] = (mealTime.integerValue == 1) ? @"preprandial" : @"postprandial";
        }

        [items addObject:item];
    }

    NSMutableDictionary *data = [@{
        @"samples": items,
        @"count": @(items.count),
        @"range": @{
            @"start": noff_format_date(start),
            @"end": noff_format_date(end),
        },
    } mutableCopy];
    if (items.count >= limit) {
        NSUInteger total = countSamples(bgType, predicate);
        addTruncationWarning(data, items.count, total);
    }
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"blood-glucose", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

#pragma mark - hrv

static int cmd_hrv(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    HKQuantityType *hrvType = [HKQuantityType quantityTypeForIdentifier:HKQuantityTypeIdentifierHeartRateVariabilitySDNN];
    NSString *authErr = nil;
    if (!requestHealthKitAccess([NSSet setWithObject:hrvType], nil, &authErr)) {
        noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"hrv",
                       NOFF_ERR_AUTHORIZATION_DENIED, authErr), compact, quiet);
        return NOFF_EXIT_AUTH_DENIED;
    }

    NSDate *start, *end;
    resolve_date_range(argc, argv, &start, &end);

    NSString *limitStr = noff_find_arg(argc, argv, "--limit");
    NSUInteger limit = limitStr ? (NSUInteger)[limitStr integerValue] : DEFAULT_LIMIT;

    NSPredicate *predicate = [HKQuery predicateForSamplesWithStartDate:start
                                                               endDate:end
                                                               options:HKQueryOptionStrictStartDate];
    NSSortDescriptor *sort = [NSSortDescriptor sortDescriptorWithKey:HKSampleSortIdentifierStartDate
                                                           ascending:NO];

    NSError *readErr = nil;
    NSArray *samples = querySamplesWithError(hrvType, predicate, limit, @[sort], &readErr);
    // [GH#128] A failed/timed-out read must not be reported as zero samples.
    if (readErr) {
        return hkEmitReadError(stdout_fd, @"hrv", @"HRV", readErr, compact, quiet);
    }

    NSMutableArray *items = [NSMutableArray array];
    for (HKQuantitySample *s in samples) {
        double ms = [s.quantity doubleValueForUnit:[HKUnit secondUnitWithMetricPrefix:HKMetricPrefixMilli]];
        [items addObject:@{
            @"date": noff_format_date(s.startDate),
            @"ms": @(noff_round4(ms)),
            @"source": sourceNameForSample(s),
        }];
    }

    NSMutableDictionary *data = [@{
        @"samples": items,
        @"count": @(items.count),
        @"range": @{
            @"start": noff_format_date(start),
            @"end": noff_format_date(end),
        },
    } mutableCopy];
    if (items.count >= limit) {
        NSUInteger total = countSamples(hrvType, predicate);
        addTruncationWarning(data, items.count, total);
    }
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"hrv", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

#pragma mark - resting-heart-rate

static int cmd_resting_heart_rate(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    HKQuantityType *rhrType = [HKQuantityType quantityTypeForIdentifier:HKQuantityTypeIdentifierRestingHeartRate];
    NSString *authErr = nil;
    if (!requestHealthKitAccess([NSSet setWithObject:rhrType], nil, &authErr)) {
        noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"resting-heart-rate",
                       NOFF_ERR_AUTHORIZATION_DENIED, authErr), compact, quiet);
        return NOFF_EXIT_AUTH_DENIED;
    }

    NSDate *start, *end;
    resolve_date_range(argc, argv, &start, &end);

    NSString *limitStr = noff_find_arg(argc, argv, "--limit");
    NSUInteger limit = limitStr ? (NSUInteger)[limitStr integerValue] : DEFAULT_LIMIT;

    NSPredicate *predicate = [HKQuery predicateForSamplesWithStartDate:start
                                                               endDate:end
                                                               options:HKQueryOptionStrictStartDate];
    NSSortDescriptor *sort = [NSSortDescriptor sortDescriptorWithKey:HKSampleSortIdentifierStartDate
                                                           ascending:NO];

    NSError *readErr = nil;
    NSArray *samples = querySamplesWithError(rhrType, predicate, limit, @[sort], &readErr);
    // [GH#128] A failed/timed-out read must not be reported as zero samples.
    if (readErr) {
        return hkEmitReadError(stdout_fd, @"resting-heart-rate", @"resting heart rate", readErr, compact, quiet);
    }
    HKUnit *bpmUnit = [[HKUnit countUnit] unitDividedByUnit:[HKUnit minuteUnit]];

    NSMutableArray *items = [NSMutableArray array];
    for (HKQuantitySample *s in samples) {
        double bpm = [s.quantity doubleValueForUnit:bpmUnit];
        [items addObject:@{
            @"date": noff_format_date(s.startDate),
            @"bpm": @(round(bpm)),
            @"source": sourceNameForSample(s),
        }];
    }

    NSMutableDictionary *data = [@{
        @"samples": items,
        @"count": @(items.count),
        @"range": @{
            @"start": noff_format_date(start),
            @"end": noff_format_date(end),
        },
    } mutableCopy];
    if (items.count >= limit) {
        NSUInteger total = countSamples(rhrType, predicate);
        addTruncationWarning(data, items.count, total);
    }
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"resting-heart-rate", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

#pragma mark - vo2-max

static int cmd_vo2_max(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    HKQuantityType *vo2Type = [HKQuantityType quantityTypeForIdentifier:HKQuantityTypeIdentifierVO2Max];
    NSString *authErr = nil;
    if (!requestHealthKitAccess([NSSet setWithObject:vo2Type], nil, &authErr)) {
        noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"vo2-max",
                       NOFF_ERR_AUTHORIZATION_DENIED, authErr), compact, quiet);
        return NOFF_EXIT_AUTH_DENIED;
    }

    NSDate *start, *end;
    resolve_date_range(argc, argv, &start, &end);

    NSString *limitStr = noff_find_arg(argc, argv, "--limit");
    NSUInteger limit = limitStr ? (NSUInteger)[limitStr integerValue] : DEFAULT_LIMIT;

    NSPredicate *predicate = [HKQuery predicateForSamplesWithStartDate:start
                                                               endDate:end
                                                               options:HKQueryOptionStrictStartDate];
    NSSortDescriptor *sort = [NSSortDescriptor sortDescriptorWithKey:HKSampleSortIdentifierStartDate
                                                           ascending:NO];

    NSError *readErr = nil;
    NSArray *samples = querySamplesWithError(vo2Type, predicate, limit, @[sort], &readErr);
    // [GH#128] A failed/timed-out read must not be reported as zero samples.
    if (readErr) {
        return hkEmitReadError(stdout_fd, @"vo2-max", @"VO2 max", readErr, compact, quiet);
    }
    // VO2 max canonical unit: mL/(kg·min)
    HKUnit *vo2Unit = [[[HKUnit literUnitWithMetricPrefix:HKMetricPrefixMilli]
                        unitDividedByUnit:[HKUnit gramUnitWithMetricPrefix:HKMetricPrefixKilo]]
                       unitDividedByUnit:[HKUnit minuteUnit]];

    NSMutableArray *items = [NSMutableArray array];
    for (HKQuantitySample *s in samples) {
        double v = [s.quantity doubleValueForUnit:vo2Unit];
        [items addObject:@{
            @"date": noff_format_date(s.startDate),
            @"ml_kg_min": @(noff_round4(v)),
            @"source": sourceNameForSample(s),
        }];
    }

    NSMutableDictionary *data = [@{
        @"samples": items,
        @"count": @(items.count),
        @"range": @{
            @"start": noff_format_date(start),
            @"end": noff_format_date(end),
        },
    } mutableCopy];
    if (items.count >= limit) {
        NSUInteger total = countSamples(vo2Type, predicate);
        addTruncationWarning(data, items.count, total);
    }
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"vo2-max", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

#pragma mark - nutrition

static int cmd_nutrition(int argc, char **argv, int stdout_fd, int stderr_fd, BOOL compact, BOOL quiet) {
    NSString *typeName = noff_find_arg(argc, argv, "--type") ?: @"calories";
    NSDictionary *qInfo = logQuantityTypeInfo(typeName);
    HKQuantityTypeIdentifier typeId = qInfo[@"id"];

    // Only dietary/nutrition identifiers are valid for this command.
    if (!typeId || ![typeId hasPrefix:@"HKQuantityTypeIdentifierDietary"]) {
        noff_emit_help(stderr_fd, HELP_TEXT);
        noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"nutrition",
                       NOFF_ERR_INVALID_ARGS,
                       @"Invalid --type. See 'apple-healthkit --help' for the full nutrition list."),
                       compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    HKQuantityType *qType = [HKQuantityType quantityTypeForIdentifier:typeId];
    NSString *authErr = nil;
    if (!requestHealthKitAccess([NSSet setWithObject:qType], nil, &authErr)) {
        noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"nutrition",
                       NOFF_ERR_AUTHORIZATION_DENIED, authErr), compact, quiet);
        return NOFF_EXIT_AUTH_DENIED;
    }

    NSDate *start, *end;
    resolve_date_range(argc, argv, &start, &end);

    HKUnit *unit = qInfo[@"unit"];
    NSString *unitLabel = qInfo[@"label"];
    double scale = [qInfo[@"scale"] doubleValue];
    if (scale == 0.0) scale = 1.0;

    // Use statistics collection query for daily buckets
    NSCalendar *calendar = [NSCalendar currentCalendar];
    NSDateComponents *interval = [[NSDateComponents alloc] init];
    interval.day = 1;
    NSDate *anchorDate = [calendar startOfDayForDate:start];

    NSPredicate *predicate = [HKQuery predicateForSamplesWithStartDate:start
                                                               endDate:end
                                                               options:HKQueryOptionStrictStartDate];

    // [GH#128] The `if (result)` guard here prevented a crash but not the
    // misreport: a failed read still yielded value: 0 for every day under
    // ok:true. Distinguish failure from a genuinely empty range.
    NSError *statsErr = nil;
    NSArray<HKStatistics *> *dailyStats = statisticsCollectionWithError(
        qType, predicate, HKStatisticsOptionCumulativeSum,
        anchorDate, interval, start, end, &statsErr);
    if (!dailyStats) {
        return hkEmitReadError(stdout_fd, @"nutrition", typeName, statsErr, compact, quiet);
    }

    NSMutableArray *samples = [NSMutableArray array];
    double total = 0;
    for (HKStatistics *stat in dailyStats) {
        HKQuantity *sum = [stat sumQuantity];
        double val = sum ? [sum doubleValueForUnit:unit] * scale : 0;
        total += val;
        [samples addObject:@{
            @"date": noff_format_date(stat.startDate),
            @"value": @(noff_round4(val)),
        }];
    }

    NSDictionary *data = @{
        @"type": typeName,
        @"total": @(noff_round4(total)),
        @"unit": unitLabel,
        @"samples": samples,
        @"range": @{
            @"start": noff_format_date(start),
            @"end": noff_format_date(end),
        },
    };
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"nutrition", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

#pragma mark - summary

static int cmd_summary(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    HKActivitySummaryType *summaryType = [HKActivitySummaryType activitySummaryType];
    NSString *authErr = nil;
    if (!requestHealthKitAccess([NSSet setWithObject:summaryType], nil, &authErr)) {
        noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"summary",
                       NOFF_ERR_AUTHORIZATION_DENIED, authErr), compact, quiet);
        return NOFF_EXIT_AUTH_DENIED;
    }

    // Default to 7 days for summary
    NSString *daysStr = noff_find_arg(argc, argv, "--days");
    NSInteger days = daysStr ? [daysStr integerValue] : 7;
    if (days <= 0) days = 7;

    NSDate *start, *end;
    if (noff_has_flag(argc, argv, "--today")) {
        days = 1;
    }
    if (noff_find_arg(argc, argv, "--start") || noff_find_arg(argc, argv, "--end")) {
        resolve_date_range(argc, argv, &start, &end);
    } else {
        NSCalendar *cal = [NSCalendar currentCalendar];
        start = [cal startOfDayForDate:[NSDate dateWithTimeIntervalSinceNow:-days * 86400]];
        end = [NSDate date];
    }

    NSCalendar *cal = [NSCalendar currentCalendar];

    // Guard against nil dates — HKQuery throws NSException for nil date components
    if (!start) start = [cal startOfDayForDate:[NSDate dateWithTimeIntervalSinceNow:-7 * 86400]];
    if (!end) end = [NSDate date];

    NSDateComponents *startComps = [cal components:(NSCalendarUnitYear | NSCalendarUnitMonth | NSCalendarUnitDay)
                                           fromDate:start];
    startComps.calendar = cal;
    NSDateComponents *endComps = [cal components:(NSCalendarUnitYear | NSCalendarUnitMonth | NSCalendarUnitDay)
                                         fromDate:end];
    endComps.calendar = cal;

    NSPredicate *predicate = nil;
    @try {
        predicate = [HKQuery predicateForActivitySummariesBetweenStartDateComponents:startComps
                                                                    endDateComponents:endComps];
    } @catch (NSException *e) {
        noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"summary",
                       NOFF_ERR_INVALID_ARGS,
                       [NSString stringWithFormat:@"Invalid date range: %@", e.reason]), compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    // [GH#128] The results handler used to drop `err` on the floor, so a locked
    // store produced an empty rings list under ok:true — "you closed no rings"
    // instead of "can't read". HKActivitySummaryQuery is not a statistics
    // collection, so it can't use statisticsCollectionWithError; the same
    // err + waitResult discipline is applied inline.
    __block NSArray<HKActivitySummary *> *summaries = nil;
    __block NSError *summaryErr = nil;
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);

    HKActivitySummaryQuery *query = [[HKActivitySummaryQuery alloc]
        initWithPredicate:predicate
           resultsHandler:^(HKActivitySummaryQuery *q, NSArray *results, NSError *err) {
        if (err) {
            summaryErr = err;
            dispatch_semaphore_signal(sem);
            return;
        }
        summaries = results;
        dispatch_semaphore_signal(sem);
    }];

    [healthStore() executeQuery:query];
    long summaryWait = dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 15 * NSEC_PER_SEC));
    // Timed out — the handler may still fire, so don't read either __block var.
    if (summaryWait != 0) {
        return hkEmitReadError(stdout_fd, @"summary", @"activity summary",
                               hkTimeoutError(@"activity summary"), compact, quiet);
    }
    if (summaryErr) {
        return hkEmitReadError(stdout_fd, @"summary", @"activity summary",
                               summaryErr, compact, quiet);
    }

    NSMutableArray *items = [NSMutableArray array];
    for (HKActivitySummary *s in summaries) {
        NSDateComponents *dc = [s dateComponentsForCalendar:cal];
        NSDate *date = dc ? [cal dateFromComponents:dc] : nil;

        double activeCal = [s.activeEnergyBurned doubleValueForUnit:[HKUnit kilocalorieUnit]];
        double exerciseMin = [s.appleExerciseTime doubleValueForUnit:[HKUnit minuteUnit]];
        double standHrs = [s.appleStandHours doubleValueForUnit:[HKUnit countUnit]];
        double moveGoal = [s.activeEnergyBurnedGoal doubleValueForUnit:[HKUnit kilocalorieUnit]];
        double exerciseGoal = [s.appleExerciseTimeGoal doubleValueForUnit:[HKUnit minuteUnit]];
        double standGoal = [s.appleStandHoursGoal doubleValueForUnit:[HKUnit countUnit]];

        [items addObject:@{
            @"date": date ? noff_format_date(date) : @"",
            @"active_calories": @(round(activeCal)),
            @"exercise_minutes": @(round(exerciseMin)),
            @"stand_hours": @(round(standHrs)),
            @"move_goal": @(round(moveGoal)),
            @"exercise_goal": @(round(exerciseGoal)),
            @"stand_goal": @(round(standGoal)),
        }];
    }

    NSDictionary *data = @{
        @"summaries": items,
        @"count": @(items.count),
        @"range": @{
            @"start": noff_format_date(start),
            @"end": noff_format_date(end),
        },
    };
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"summary", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

#pragma mark - types

// Build a [{name, unit, desc, hk_identifier}] list for one type registry.
// Empty `desc` entries are still included — they show up as "" so the LLM
// can see the type exists even if a description was not authored.
static NSArray<NSDictionary *> *describeQuantityTypes(void) {
    NSMutableArray *out = [NSMutableArray array];
    for (NSString *name in allQuantityTypeNames()) {
        NSDictionary *info = logQuantityTypeInfo(name);
        if (!info) continue;
        [out addObject:@{
            @"name": name,
            @"unit": info[@"label"] ?: @"",
            @"desc": info[@"desc"] ?: @"",
            @"hk_identifier": info[@"id"] ?: @"",
        }];
    }
    return out;
}

static NSArray<NSDictionary *> *describeCategoryTypes(void) {
    NSMutableArray *out = [NSMutableArray array];
    for (NSString *name in allCategoryTypeNames()) {
        NSDictionary *info = logCategoryTypeInfo(name);
        if (!info) continue;
        NSMutableDictionary *entry = [@{
            @"name": name,
            @"group": info[@"label"] ?: @"",
            @"desc": info[@"desc"] ?: @"",
            @"duration_based": info[@"duration"] ?: @NO,
            @"hk_identifier": info[@"id"] ?: @"",
        } mutableCopy];
        if (info[@"values"]) entry[@"valid_values"] = info[@"values"];
        [out addObject:entry];
    }
    return out;
}

static int cmd_types(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    NSDictionary *data = @{
        @"quantity_types": describeQuantityTypes(),
        @"category_types": describeCategoryTypes(),
        @"characteristic_types": @[
            @{@"name": @"biological-sex",      @"desc": @"User's biological sex (male / female / other)."},
            @{@"name": @"date-of-birth",       @"desc": @"User's date of birth (ISO date)."},
            @{@"name": @"blood-type",          @"desc": @"Blood type (e.g. O+, A−)."},
            @{@"name": @"fitzpatrick-skin-type", @"desc": @"Fitzpatrick skin type I–VI (sun reactivity)."},
            @{@"name": @"wheelchair-use",      @"desc": @"Whether the user uses a wheelchair."},
            @{@"name": @"activity-move-mode",  @"desc": @"Activity move mode (active energy vs. move minutes)."},
        ],
        @"special_types": @[
            @{@"name": @"workouts", @"desc": @"HKWorkout — completed workout sessions with metadata."},
            @{@"name": @"summary",  @"desc": @"HKActivitySummary — daily activity ring totals & goals."},
            @{@"name": @"ecg",      @"desc": @"HKElectrocardiogram — Apple Watch ECG recordings (iOS 14+)."},
            @{@"name": @"audiogram",@"desc": @"HKAudiogramSample — hearing test results (iOS 13+)."},
            @{@"name": @"vision-rx",@"desc": @"HKVisionPrescription — glasses/contacts prescriptions (iOS 16+)."},
            @{@"name": @"assessment", @"desc": @"HKScoredAssessment — GAD-7 / PHQ-9 mental health screeners (iOS 18+)."},
            @{@"name": @"state-of-mind", @"desc": @"HKStateOfMind — mood/emotion log with valence & labels (iOS 18+)."},
        ],
        @"usage": @{
            @"read_quantity": @"apple-healthkit log <quantity-name> ... or use a dedicated read subcommand. List names: see quantity_types[*].name.",
            @"write_quantity": @"apple-healthkit log --type <quantity-name> --value <number>",
            @"write_category": @"apple-healthkit log --type <category-name> --value <enum-or-severity> [--date|--start/--end]",
            @"hint": @"Pick the type whose 'desc' best matches the user's request.",
        },
    };
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"types", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

#pragma mark - log (lookup tables)

// Returns @{@"id": HKQuantityTypeIdentifier, @"unit": HKUnit, @"label": unitLabel, @"scale": @(divisor), @"desc": humanDescription}
// scale: input value is divided by this before storing, and stored values are
// multiplied by it when read back (e.g. water mL→L = 1000; percent %→fraction = 100,
// since HKUnit.percent stores 0–1 where 1.0 = 100%)
// desc: short human-readable description shown in `types` output so an LLM
// can pick the right identifier without consulting external docs.
static NSDictionary *makeQEntry(HKQuantityTypeIdentifier ident, HKUnit *u, NSString *label, double scale, NSString *desc) {
    return @{@"id": ident, @"unit": u, @"label": label, @"scale": @(scale), @"desc": desc ?: @""};
}

static NSDictionary *logQuantityTypeInfo(NSString *name) {
    static NSMutableDictionary<NSString *, NSDictionary *> *table = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        // Convenience unit builders
        HKUnit *count     = [HKUnit countUnit];
        HKUnit *kg        = [HKUnit gramUnitWithMetricPrefix:HKMetricPrefixKilo];
        HKUnit *g         = [HKUnit gramUnit];
        HKUnit *mg        = [HKUnit gramUnitWithMetricPrefix:HKMetricPrefixMilli];
        HKUnit *mcg       = [HKUnit gramUnitWithMetricPrefix:HKMetricPrefixMicro];
        HKUnit *cm        = [HKUnit meterUnitWithMetricPrefix:HKMetricPrefixCenti];
        HKUnit *m         = [HKUnit meterUnit];
        HKUnit *km        = [HKUnit meterUnitWithMetricPrefix:HKMetricPrefixKilo];
        HKUnit *L         = [HKUnit literUnit];
        HKUnit *kcal      = [HKUnit kilocalorieUnit];
        HKUnit *degC      = [HKUnit degreeCelsiusUnit];
        HKUnit *mmHg      = [HKUnit millimeterOfMercuryUnit];
        HKUnit *percent   = [HKUnit percentUnit];
        HKUnit *bpm       = [[HKUnit countUnit] unitDividedByUnit:[HKUnit minuteUnit]];
        HKUnit *perMin    = [[HKUnit countUnit] unitDividedByUnit:[HKUnit minuteUnit]];
        HKUnit *LperMin   = [L unitDividedByUnit:[HKUnit minuteUnit]];
        HKUnit *kmPerHr   = [km unitDividedByUnit:[HKUnit hourUnit]];
        HKUnit *W         = [HKUnit wattUnit];
        HKUnit *ms        = [HKUnit secondUnitWithMetricPrefix:HKMetricPrefixMilli];
        HKUnit *IU        = [HKUnit internationalUnit];
        HKUnit *microS    = [HKUnit unitFromString:@"mcS"];

        HKUnit *mPerSec   = [m unitDividedByUnit:[HKUnit secondUnit]];
        HKUnit *hour      = [HKUnit hourUnit];
        HKUnit *minute    = [HKUnit minuteUnit];
        HKUnit *dBASPL    = [HKUnit decibelAWeightedSoundPressureLevelUnit];
        HKUnit *dBHL      = [HKUnit decibelHearingLevelUnit];

#define E makeQEntry

        table = [@{
            // ── Body Measurements ──
            @"weight":              E(HKQuantityTypeIdentifierBodyMass, kg, @"kg", 1,
                                       @"Body weight (mass)."),
            @"height":              E(HKQuantityTypeIdentifierHeight, cm, @"cm", 1,
                                       @"Body height."),
            @"bmi":                 E(HKQuantityTypeIdentifierBodyMassIndex, count, @"count", 1,
                                       @"Body Mass Index (kg/m²) — dimensionless."),
            @"body-fat":            E(HKQuantityTypeIdentifierBodyFatPercentage, percent, @"%", 100,
                                       @"Body fat percentage (0–100)."),
            @"lean-body-mass":      E(HKQuantityTypeIdentifierLeanBodyMass, kg, @"kg", 1,
                                       @"Lean body mass (kg) — body weight minus fat mass."),
            @"waist-circumference": E(HKQuantityTypeIdentifierWaistCircumference, cm, @"cm", 1,
                                       @"Waist circumference."),

            // ── Vital Signs ──
            @"heart-rate":              E(HKQuantityTypeIdentifierHeartRate, bpm, @"bpm", 1,
                                          @"Heart rate (beats per minute)."),
            @"blood-pressure-systolic": E(HKQuantityTypeIdentifierBloodPressureSystolic, mmHg, @"mmHg", 1,
                                          @"Systolic blood pressure (top number, mmHg)."),
            @"blood-pressure-diastolic":E(HKQuantityTypeIdentifierBloodPressureDiastolic, mmHg, @"mmHg", 1,
                                          @"Diastolic blood pressure (bottom number, mmHg)."),
            @"body-temperature":        E(HKQuantityTypeIdentifierBodyTemperature, degC, @"°C", 1,
                                          @"Body temperature (°C)."),
            @"basal-body-temperature":  E(HKQuantityTypeIdentifierBasalBodyTemperature, degC, @"°C", 1,
                                          @"Basal body temperature taken at rest — used in fertility tracking."),
            @"oxygen-saturation":       E(HKQuantityTypeIdentifierOxygenSaturation, percent, @"%", 100,
                                          @"Peripheral oxygen saturation (SpO2, 0–100)."),
            @"respiratory-rate":        E(HKQuantityTypeIdentifierRespiratoryRate, perMin, @"/min", 1,
                                          @"Respiratory rate (breaths per minute)."),
            @"blood-glucose":           E(HKQuantityTypeIdentifierBloodGlucose,
                                          [HKUnit unitFromString:@"mg/dL"], @"mg/dL", 1,
                                          @"Blood glucose concentration (mg/dL)."),
            @"blood-alcohol":           E(HKQuantityTypeIdentifierBloodAlcoholContent, percent, @"%", 100,
                                          @"Blood alcohol content (BAC) as a percentage."),
            @"electrodermal-activity":  E(HKQuantityTypeIdentifierElectrodermalActivity, microS, @"μS", 1,
                                          @"Electrodermal activity / galvanic skin response (μS)."),
            @"peripheral-perfusion-index": E(HKQuantityTypeIdentifierPeripheralPerfusionIndex, percent, @"%", 100,
                                          @"Peripheral perfusion index from a pulse oximeter (strength of pulse)."),
            @"atrial-fibrillation-burden": E(HKQuantityTypeIdentifierAtrialFibrillationBurden, percent, @"%", 100,
                                          @"Percentage of time AFib was detected over the measurement period."),

            // ── Cardio Fitness ──
            @"resting-heart-rate":      E(HKQuantityTypeIdentifierRestingHeartRate, bpm, @"bpm", 1,
                                          @"Resting heart rate — average heart rate while inactive."),
            @"walking-heart-rate-average": E(HKQuantityTypeIdentifierWalkingHeartRateAverage, bpm, @"bpm", 1,
                                          @"Average heart rate while walking at a steady pace."),
            @"heart-rate-recovery":     E(HKQuantityTypeIdentifierHeartRateRecoveryOneMinute, bpm, @"bpm", 1,
                                          @"One-minute heart rate recovery after exercise (bpm drop)."),
            @"vo2-max":                 E(HKQuantityTypeIdentifierVO2Max,
                                          [[HKUnit literUnitWithMetricPrefix:HKMetricPrefixMilli]
                                            unitDividedByUnit:[[HKUnit gramUnitWithMetricPrefix:HKMetricPrefixKilo]
                                                                unitMultipliedByUnit:[HKUnit minuteUnit]]],
                                          @"mL/(kg·min)", 1,
                                          @"VO2 max — maximal oxygen uptake; an aerobic fitness benchmark."),
            @"hrv-sdnn":                E(HKQuantityTypeIdentifierHeartRateVariabilitySDNN, ms, @"ms", 1,
                                          @"Heart rate variability (SDNN, ms)."),

            // ── Respiratory ──
            @"forced-vital-capacity":       E(HKQuantityTypeIdentifierForcedVitalCapacity, L, @"L", 1,
                                              @"Forced vital capacity (FVC) — max air exhaled after deep inhale."),
            @"forced-expiratory-volume":    E(HKQuantityTypeIdentifierForcedExpiratoryVolume1, L, @"L", 1,
                                              @"FEV1 — air forcibly exhaled in the first second."),
            @"inhaler-usage":               E(HKQuantityTypeIdentifierInhalerUsage, count, @"count", 1,
                                              @"Inhaler puffs used."),
            @"peak-expiratory-flow-rate":   E(HKQuantityTypeIdentifierPeakExpiratoryFlowRate, LperMin, @"L/min", 1,
                                              @"Peak expiratory flow rate — fastest exhalation speed."),

            // ── Activity ──
            @"steps":                   E(HKQuantityTypeIdentifierStepCount, count, @"steps", 1,
                                          @"Steps walked or run (cumulative)."),
            @"distance-walking-running":E(HKQuantityTypeIdentifierDistanceWalkingRunning, km, @"km", 1,
                                          @"Distance walked or run (km)."),
            @"distance-cycling":        E(HKQuantityTypeIdentifierDistanceCycling, km, @"km", 1,
                                          @"Distance cycled (km)."),
            @"distance-swimming":       E(HKQuantityTypeIdentifierDistanceSwimming, m, @"m", 1,
                                          @"Distance swum (meters)."),
            @"distance-wheelchair":     E(HKQuantityTypeIdentifierDistanceWheelchair, m, @"m", 1,
                                          @"Distance moved in a wheelchair (meters)."),
            @"distance-downhill-snow":  E(HKQuantityTypeIdentifierDistanceDownhillSnowSports, m, @"m", 1,
                                          @"Distance covered in downhill snow sports (skiing/snowboarding)."),
            // distance-{cross-country-skiing,paddle-sports,rowing,skating-sports}
            // are gated to iOS 18+ — added in @available block below.
            @"active-energy":           E(HKQuantityTypeIdentifierActiveEnergyBurned, kcal, @"kcal", 1,
                                          @"Active energy burned through movement (kcal)."),
            @"basal-energy":            E(HKQuantityTypeIdentifierBasalEnergyBurned, kcal, @"kcal", 1,
                                          @"Basal (resting) energy expenditure (kcal)."),
            @"flights-climbed":         E(HKQuantityTypeIdentifierFlightsClimbed, count, @"count", 1,
                                          @"Flights of stairs climbed."),
            @"push-count":              E(HKQuantityTypeIdentifierPushCount, count, @"count", 1,
                                          @"Wheelchair pushes."),
            @"swimming-strokes":        E(HKQuantityTypeIdentifierSwimmingStrokeCount, count, @"count", 1,
                                          @"Swimming strokes."),
            @"nike-fuel":               E(HKQuantityTypeIdentifierNikeFuel, count, @"NikeFuel", 1,
                                          @"NikeFuel score (legacy)."),
            // physical-effort gated to iOS 17+ (added below).
            @"apple-exercise-time":     E(HKQuantityTypeIdentifierAppleExerciseTime, minute, @"min", 1,
                                          @"Apple Exercise Time (green ring) — minutes of brisk activity."),
            @"apple-move-time":         E(HKQuantityTypeIdentifierAppleMoveTime, minute, @"min", 1,
                                          @"Apple Move Time (wheelchair users' red-ring metric)."),
            @"apple-stand-time":        E(HKQuantityTypeIdentifierAppleStandTime, minute, @"min", 1,
                                          @"Apple Stand Time — minutes spent standing."),

            // ── Mobility (Walking/Running Gait) ──
            @"walking-step-length":     E(HKQuantityTypeIdentifierWalkingStepLength, cm, @"cm", 1,
                                          @"Average step length while walking."),
            @"walking-speed":           E(HKQuantityTypeIdentifierWalkingSpeed, kmPerHr, @"km/h", 1,
                                          @"Walking speed."),
            @"walking-asymmetry":       E(HKQuantityTypeIdentifierWalkingAsymmetryPercentage, percent, @"%", 100,
                                          @"Walking asymmetry — % of time gait is uneven."),
            @"walking-double-support":  E(HKQuantityTypeIdentifierWalkingDoubleSupportPercentage, percent, @"%", 100,
                                          @"Walking double-support — % with both feet on ground."),
            @"walking-steadiness":      E(HKQuantityTypeIdentifierAppleWalkingSteadiness, percent, @"%", 100,
                                          @"Apple Walking Steadiness — gait stability score."),
            @"stair-ascent-speed":      E(HKQuantityTypeIdentifierStairAscentSpeed, mPerSec, @"m/s", 1,
                                          @"Speed while ascending stairs."),
            @"stair-descent-speed":     E(HKQuantityTypeIdentifierStairDescentSpeed, mPerSec, @"m/s", 1,
                                          @"Speed while descending stairs."),
            @"six-minute-walk-test":    E(HKQuantityTypeIdentifierSixMinuteWalkTestDistance, m, @"m", 1,
                                          @"Distance walked in a 6-minute walk test (cardio/mobility assessment)."),
            @"running-ground-contact-time": E(HKQuantityTypeIdentifierRunningGroundContactTime, ms, @"ms", 1,
                                          @"Time foot is in contact with ground per running step."),
            @"running-vertical-oscillation":E(HKQuantityTypeIdentifierRunningVerticalOscillation, cm, @"cm", 1,
                                          @"Vertical oscillation of torso while running."),
            @"running-stride-length":   E(HKQuantityTypeIdentifierRunningStrideLength, cm, @"cm", 1,
                                          @"Average stride length while running."),
            @"running-power":           E(HKQuantityTypeIdentifierRunningPower, W, @"W", 1,
                                          @"Running power output (watts)."),
            @"running-speed":           E(HKQuantityTypeIdentifierRunningSpeed, mPerSec, @"m/s", 1,
                                          @"Running speed (m/s)."),

            // ── Sleep (quantity-side metrics) ──
            @"sleeping-wrist-temperature": E(HKQuantityTypeIdentifierAppleSleepingWristTemperature, degC, @"°C", 1,
                                          @"Wrist skin temperature deviation measured during sleep (Apple Watch)."),
            // sleeping-breathing-disturbances gated to iOS 18+ (added below).

            // ── Hearing / Audio Exposure ──
            @"environmental-audio-exposure": E(HKQuantityTypeIdentifierEnvironmentalAudioExposure, dBASPL, @"dB(A) SPL", 1,
                                          @"Ambient sound level exposure (dB A-weighted SPL)."),
            @"environmental-sound-reduction": E(HKQuantityTypeIdentifierEnvironmentalSoundReduction, dBASPL, @"dB(A) SPL", 1,
                                          @"Sound reduction provided by headphones/hearing protection."),
            @"headphone-audio-exposure": E(HKQuantityTypeIdentifierHeadphoneAudioExposure, dBASPL, @"dB(A) SPL", 1,
                                          @"Headphone playback exposure (dB A-weighted SPL)."),

            // ── Environment / Daylight ──
            // time-in-daylight gated to iOS 17+ (added below).
            @"underwater-depth":        E(HKQuantityTypeIdentifierUnderwaterDepth, m, @"m", 1,
                                          @"Current depth underwater (meters)."),
            @"water-temperature":       E(HKQuantityTypeIdentifierWaterTemperature, degC, @"°C", 1,
                                          @"Surrounding water temperature (e.g. during dive/swim)."),

            // ── Cycling / Workout Effort ──
            // cycling-* (iOS 17+), workout-effort / estimated-workout-effort (iOS 18+)
            // added in @available blocks below.

            // ── Nutrition ──
            @"calories":               E(HKQuantityTypeIdentifierDietaryEnergyConsumed, kcal, @"kcal", 1,
                                          @"Dietary energy consumed (kcal)."),
            @"protein":                E(HKQuantityTypeIdentifierDietaryProtein, g, @"g", 1,
                                          @"Dietary protein."),
            @"carbs":                  E(HKQuantityTypeIdentifierDietaryCarbohydrates, g, @"g", 1,
                                          @"Dietary carbohydrates."),
            @"fat":                    E(HKQuantityTypeIdentifierDietaryFatTotal, g, @"g", 1,
                                          @"Total dietary fat."),
            @"fat-saturated":          E(HKQuantityTypeIdentifierDietaryFatSaturated, g, @"g", 1,
                                          @"Saturated fat."),
            @"fat-monounsaturated":    E(HKQuantityTypeIdentifierDietaryFatMonounsaturated, g, @"g", 1,
                                          @"Monounsaturated fat."),
            @"fat-polyunsaturated":    E(HKQuantityTypeIdentifierDietaryFatPolyunsaturated, g, @"g", 1,
                                          @"Polyunsaturated fat."),
            @"cholesterol":            E(HKQuantityTypeIdentifierDietaryCholesterol, mg, @"mg", 1,
                                          @"Dietary cholesterol."),
            @"sugar":                  E(HKQuantityTypeIdentifierDietarySugar, g, @"g", 1,
                                          @"Dietary sugar."),
            @"fiber":                  E(HKQuantityTypeIdentifierDietaryFiber, g, @"g", 1,
                                          @"Dietary fiber."),
            @"sodium":                 E(HKQuantityTypeIdentifierDietarySodium, mg, @"mg", 1,
                                          @"Dietary sodium."),
            @"water":                  E(HKQuantityTypeIdentifierDietaryWater, L, @"mL", 1000,
                                          @"Water intake. Pass --value in milliliters; stored as liters."),
            @"caffeine":               E(HKQuantityTypeIdentifierDietaryCaffeine, mg, @"mg", 1,
                                          @"Caffeine intake."),
            @"calcium":                E(HKQuantityTypeIdentifierDietaryCalcium, mg, @"mg", 1, @"Calcium."),
            @"iron":                   E(HKQuantityTypeIdentifierDietaryIron, mg, @"mg", 1, @"Iron."),
            @"potassium":              E(HKQuantityTypeIdentifierDietaryPotassium, mg, @"mg", 1, @"Potassium."),
            @"magnesium":              E(HKQuantityTypeIdentifierDietaryMagnesium, mg, @"mg", 1, @"Magnesium."),
            @"zinc":                   E(HKQuantityTypeIdentifierDietaryZinc, mg, @"mg", 1, @"Zinc."),
            @"selenium":               E(HKQuantityTypeIdentifierDietarySelenium, mcg, @"mcg", 1, @"Selenium."),
            @"copper":                 E(HKQuantityTypeIdentifierDietaryCopper, mg, @"mg", 1, @"Copper."),
            @"manganese":              E(HKQuantityTypeIdentifierDietaryManganese, mg, @"mg", 1, @"Manganese."),
            @"chromium":               E(HKQuantityTypeIdentifierDietaryChromium, mcg, @"mcg", 1, @"Chromium."),
            @"molybdenum":             E(HKQuantityTypeIdentifierDietaryMolybdenum, mcg, @"mcg", 1, @"Molybdenum."),
            @"phosphorus":             E(HKQuantityTypeIdentifierDietaryPhosphorus, mg, @"mg", 1, @"Phosphorus."),
            @"iodine":                 E(HKQuantityTypeIdentifierDietaryIodine, mcg, @"mcg", 1, @"Iodine."),
            @"chloride":               E(HKQuantityTypeIdentifierDietaryChloride, mg, @"mg", 1, @"Chloride."),
            @"biotin":                 E(HKQuantityTypeIdentifierDietaryBiotin, mcg, @"mcg", 1, @"Biotin (B7)."),
            @"folate":                 E(HKQuantityTypeIdentifierDietaryFolate, mcg, @"mcg", 1, @"Folate (B9)."),
            @"niacin":                 E(HKQuantityTypeIdentifierDietaryNiacin, mg, @"mg", 1, @"Niacin (B3)."),
            @"pantothenic-acid":       E(HKQuantityTypeIdentifierDietaryPantothenicAcid, mg, @"mg", 1, @"Pantothenic acid (B5)."),
            @"riboflavin":             E(HKQuantityTypeIdentifierDietaryRiboflavin, mg, @"mg", 1, @"Riboflavin (B2)."),
            @"thiamin":                E(HKQuantityTypeIdentifierDietaryThiamin, mg, @"mg", 1, @"Thiamin (B1)."),
            @"vitamin-a":              E(HKQuantityTypeIdentifierDietaryVitaminA, mcg, @"mcg", 1, @"Vitamin A."),
            @"vitamin-b6":             E(HKQuantityTypeIdentifierDietaryVitaminB6, mg, @"mg", 1, @"Vitamin B6."),
            @"vitamin-b12":            E(HKQuantityTypeIdentifierDietaryVitaminB12, mcg, @"mcg", 1, @"Vitamin B12."),
            @"vitamin-c":              E(HKQuantityTypeIdentifierDietaryVitaminC, mg, @"mg", 1, @"Vitamin C."),
            @"vitamin-d":              E(HKQuantityTypeIdentifierDietaryVitaminD, mcg, @"mcg", 1, @"Vitamin D."),
            @"vitamin-e":              E(HKQuantityTypeIdentifierDietaryVitaminE, mg, @"mg", 1, @"Vitamin E."),
            @"vitamin-k":              E(HKQuantityTypeIdentifierDietaryVitaminK, mcg, @"mcg", 1, @"Vitamin K."),

            // ── Alcohol & UV & Falls ──
            @"alcoholic-beverages":    E(HKQuantityTypeIdentifierNumberOfAlcoholicBeverages, count, @"drinks", 1,
                                          @"Number of alcoholic drinks consumed (1 standard drink units)."),
            @"insulin-delivery":       E(HKQuantityTypeIdentifierInsulinDelivery, IU, @"IU", 1,
                                          @"Insulin delivered (international units)."),
            @"uv-exposure":            E(HKQuantityTypeIdentifierUVExposure, count, @"index", 1,
                                          @"UV index exposure."),
            @"number-of-times-fallen": E(HKQuantityTypeIdentifierNumberOfTimesFallen, count, @"count", 1,
                                          @"Number of falls detected."),
        } mutableCopy];

        // Suppress unused-warning for units only consumed inside iOS-version blocks.
        (void)hour; (void)dBHL;

        // iOS 17+ types
        if (@available(iOS 17.0, *)) {
            table[@"cycling-power"]    = E(HKQuantityTypeIdentifierCyclingPower, W, @"W", 1,
                                          @"Cycling power output (watts) — iOS 17+.");
            table[@"cycling-cadence"]  = E(HKQuantityTypeIdentifierCyclingCadence, perMin, @"rpm", 1,
                                          @"Cycling cadence (rpm) — iOS 17+.");
            table[@"cycling-speed"]    = E(HKQuantityTypeIdentifierCyclingSpeed, kmPerHr, @"km/h", 1,
                                          @"Cycling speed — iOS 17+.");
            table[@"cycling-ftp"]      = E(HKQuantityTypeIdentifierCyclingFunctionalThresholdPower, W, @"W", 1,
                                          @"Cycling Functional Threshold Power (FTP, watts) — iOS 17+.");
            table[@"physical-effort"]  = E(HKQuantityTypeIdentifierPhysicalEffort,
                                          [HKUnit unitFromString:@"kcal/(kg*hr)"], @"kcal/(kg·hr)", 1,
                                          @"Physical effort intensity in METs (kcal/(kg·hr)) — iOS 17+.");
            table[@"time-in-daylight"] = E(HKQuantityTypeIdentifierTimeInDaylight, minute, @"min", 1,
                                          @"Time spent in daylight (minutes) — iOS 17+.");
        }

        // iOS 18+ types
        if (@available(iOS 18.0, *)) {
            table[@"distance-cross-country-skiing"] = E(HKQuantityTypeIdentifierDistanceCrossCountrySkiing, m, @"m", 1,
                                          @"Distance covered cross-country skiing — iOS 18+.");
            table[@"distance-paddle-sports"]  = E(HKQuantityTypeIdentifierDistancePaddleSports, m, @"m", 1,
                                          @"Distance in paddle sports (kayak/SUP/canoe) — iOS 18+.");
            table[@"distance-rowing"]         = E(HKQuantityTypeIdentifierDistanceRowing, m, @"m", 1,
                                          @"Distance rowed — iOS 18+.");
            table[@"distance-skating-sports"] = E(HKQuantityTypeIdentifierDistanceSkatingSports, m, @"m", 1,
                                          @"Distance in skating sports (ice/inline) — iOS 18+.");
            table[@"cross-country-skiing-speed"] = E(HKQuantityTypeIdentifierCrossCountrySkiingSpeed, mPerSec, @"m/s", 1,
                                          @"Cross-country skiing speed (m/s) — iOS 18+.");
            table[@"paddle-sports-speed"]     = E(HKQuantityTypeIdentifierPaddleSportsSpeed, mPerSec, @"m/s", 1,
                                          @"Paddle sports speed (m/s) — iOS 18+.");
            table[@"rowing-speed"]            = E(HKQuantityTypeIdentifierRowingSpeed, mPerSec, @"m/s", 1,
                                          @"Rowing speed (m/s) — iOS 18+.");
            table[@"sleeping-breathing-disturbances"] = E(HKQuantityTypeIdentifierAppleSleepingBreathingDisturbances, count, @"count", 1,
                                          @"Apple Sleeping Breathing Disturbances classification — iOS 18+.");
            // Effort scores are stored in the dedicated appleEffortScore unit;
            // count is NOT convertible and doubleValueForUnit: throws NSException
            // (TestFlight crash in cmd_batch, Build 57).
            table[@"workout-effort"]          = E(HKQuantityTypeIdentifierWorkoutEffortScore, [HKUnit appleEffortScoreUnit], @"score", 1,
                                          @"User-rated workout effort score (1–10) — iOS 18+.");
            table[@"estimated-workout-effort"]= E(HKQuantityTypeIdentifierEstimatedWorkoutEffortScore, [HKUnit appleEffortScoreUnit], @"score", 1,
                                          @"System-estimated workout effort score (1–10) — iOS 18+.");
        }
#undef E
    });
    return table[[name lowercaseString]];
}

// All valid quantity type names (sorted) for error messages & types output.
// Probed against the registry so unsupported names (iOS-gated) drop out.
static NSArray<NSString *> *allQuantityTypeNames(void) {
    static NSArray *names = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        // Probe-driven enumeration: the registry is internal to
        // logQuantityTypeInfo. To avoid duplicating it, we list known names
        // here — but every entry below must have a matching registry row,
        // and the build will warn (via runtime assert) if any drift.
        NSArray *candidates = @[
            // Body
            @"weight", @"height", @"bmi", @"body-fat", @"lean-body-mass", @"waist-circumference",
            // Vitals
            @"heart-rate", @"blood-pressure-systolic", @"blood-pressure-diastolic",
            @"body-temperature", @"basal-body-temperature", @"oxygen-saturation",
            @"respiratory-rate", @"blood-glucose", @"blood-alcohol",
            @"electrodermal-activity", @"peripheral-perfusion-index",
            @"atrial-fibrillation-burden",
            // Cardio fitness
            @"resting-heart-rate", @"walking-heart-rate-average", @"heart-rate-recovery",
            @"vo2-max", @"hrv-sdnn",
            // Respiratory
            @"forced-vital-capacity", @"forced-expiratory-volume", @"inhaler-usage",
            @"peak-expiratory-flow-rate",
            // Activity
            @"steps", @"distance-walking-running", @"distance-cycling", @"distance-swimming",
            @"distance-wheelchair", @"distance-downhill-snow",
            @"distance-cross-country-skiing", @"distance-paddle-sports",
            @"distance-rowing", @"distance-skating-sports",
            @"active-energy", @"basal-energy", @"flights-climbed", @"push-count",
            @"swimming-strokes", @"nike-fuel", @"physical-effort",
            @"apple-exercise-time", @"apple-move-time", @"apple-stand-time",
            // Mobility
            @"walking-step-length", @"walking-speed",
            @"walking-asymmetry", @"walking-double-support", @"walking-steadiness",
            @"stair-ascent-speed", @"stair-descent-speed", @"six-minute-walk-test",
            @"running-ground-contact-time", @"running-vertical-oscillation",
            @"running-stride-length", @"running-power", @"running-speed",
            // Sleep quantity
            @"sleeping-wrist-temperature", @"sleeping-breathing-disturbances",
            // Hearing
            @"environmental-audio-exposure", @"environmental-sound-reduction",
            @"headphone-audio-exposure",
            // Environment
            @"time-in-daylight", @"underwater-depth", @"water-temperature",
            // Workout effort
            @"workout-effort", @"estimated-workout-effort",
            // Nutrition
            @"calories", @"protein", @"carbs", @"fat", @"fat-saturated",
            @"fat-monounsaturated", @"fat-polyunsaturated", @"cholesterol",
            @"sugar", @"fiber", @"sodium", @"water", @"caffeine",
            @"calcium", @"iron", @"potassium", @"magnesium", @"zinc",
            @"selenium", @"copper", @"manganese", @"chromium", @"molybdenum",
            @"phosphorus", @"iodine", @"chloride", @"biotin", @"folate",
            @"niacin", @"pantothenic-acid", @"riboflavin", @"thiamin",
            @"vitamin-a", @"vitamin-b6", @"vitamin-b12", @"vitamin-c",
            @"vitamin-d", @"vitamin-e", @"vitamin-k",
            // Alcohol & UV & falls & insulin
            @"alcoholic-beverages", @"insulin-delivery", @"uv-exposure",
            @"number-of-times-fallen",
            // iOS 17+ cycling & speed (conditional below)
            @"cycling-power", @"cycling-cadence", @"cycling-speed",
            @"cycling-ftp", @"cross-country-skiing-speed",
            @"paddle-sports-speed", @"rowing-speed",
        ];
        NSMutableArray *valid = [NSMutableArray array];
        for (NSString *n in candidates) {
            if (logQuantityTypeInfo(n)) [valid addObject:n];
        }
        [valid sortUsingSelector:@selector(compare:)];
        names = [valid copy];
    });
    return names;
}


// ── Category type lookup ──

typedef struct {
    NSString *identifier;
    NSString *label;
    BOOL durationBased;  // uses --start/--end (sleep, mindful-session, etc.)
    NSArray<NSString *> *validValues;  // nil = use integer directly
} CategoryTypeInfo;

static NSDictionary *logCategoryTypeInfo(NSString *name) {
    static NSMutableDictionary<NSString *, NSDictionary *> *table = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        // Symptom severity values
        NSArray *severityValues = @[@"not-present", @"mild", @"moderate", @"severe"];
        // Presence values (for boolean-like categories)
        NSArray *presenceValues = @[@"not-present", @"present"];

        NSDictionary *(^Symptom)(HKCategoryTypeIdentifier, NSString *) =
            ^(HKCategoryTypeIdentifier ident, NSString *desc) {
                return @{@"id": ident, @"label": @"symptom", @"duration": @NO,
                         @"values": severityValues, @"desc": desc ?: @""};
            };

        NSDictionary *(^Cat)(HKCategoryTypeIdentifier, NSString *, BOOL, NSArray *, NSString *) =
            ^(HKCategoryTypeIdentifier ident, NSString *label, BOOL dur, NSArray *vals, NSString *desc) {
                NSMutableDictionary *d = [@{@"id": ident, @"label": label,
                                            @"duration": @(dur), @"desc": desc ?: @""} mutableCopy];
                if (vals) d[@"values"] = vals;
                return [d copy];
            };

        table = [@{
            // ── Symptoms ──
            @"acne":                    Symptom(HKCategoryTypeIdentifierAcne, @"Acne flare-up severity."),
            @"headache":                Symptom(HKCategoryTypeIdentifierHeadache, @"Headache severity."),
            @"constipation":            Symptom(HKCategoryTypeIdentifierConstipation, @"Constipation severity."),
            @"heartburn":               Symptom(HKCategoryTypeIdentifierHeartburn, @"Heartburn / acid reflux severity."),
            @"hot-flashes":             Symptom(HKCategoryTypeIdentifierHotFlashes, @"Hot flashes severity."),
            @"bladder-incontinence":    Symptom(HKCategoryTypeIdentifierBladderIncontinence, @"Bladder incontinence severity."),
            @"loss-of-taste":           Symptom(HKCategoryTypeIdentifierLossOfTaste, @"Loss of taste severity."),
            @"nausea":                  Symptom(HKCategoryTypeIdentifierNausea, @"Nausea severity."),
            @"vomiting":                Symptom(HKCategoryTypeIdentifierVomiting, @"Vomiting severity."),
            @"diarrhea":                Symptom(HKCategoryTypeIdentifierDiarrhea, @"Diarrhea severity."),
            @"abdominal-cramps":        Symptom(HKCategoryTypeIdentifierAbdominalCramps, @"Abdominal cramps severity."),
            @"bloating":                Symptom(HKCategoryTypeIdentifierBloating, @"Bloating severity."),
            @"fatigue":                 Symptom(HKCategoryTypeIdentifierFatigue, @"Fatigue severity."),
            @"fever":                   Symptom(HKCategoryTypeIdentifierFever, @"Fever severity (subjective)."),
            @"chills":                  Symptom(HKCategoryTypeIdentifierChills, @"Chills severity."),
            @"dizziness":               Symptom(HKCategoryTypeIdentifierDizziness, @"Dizziness severity."),
            @"chest-tightness":         Symptom(HKCategoryTypeIdentifierChestTightnessOrPain, @"Chest tightness or pain severity."),
            @"coughing":                Symptom(HKCategoryTypeIdentifierCoughing, @"Coughing severity."),
            @"sore-throat":             Symptom(HKCategoryTypeIdentifierSoreThroat, @"Sore throat severity."),
            @"runny-nose":              Symptom(HKCategoryTypeIdentifierRunnyNose, @"Runny nose severity."),
            @"appetite-changes":        Symptom(HKCategoryTypeIdentifierAppetiteChanges, @"Appetite changes severity."),
            @"sleep-changes":           Symptom(HKCategoryTypeIdentifierSleepChanges, @"Sleep pattern changes severity."),
            @"mood-changes":            Symptom(HKCategoryTypeIdentifierMoodChanges, @"Mood changes severity."),
            @"hair-loss":               Symptom(HKCategoryTypeIdentifierHairLoss, @"Hair loss severity."),
            @"dry-skin":                Symptom(HKCategoryTypeIdentifierDrySkin, @"Dry skin severity."),
            @"night-sweats":            Symptom(HKCategoryTypeIdentifierNightSweats, @"Night sweats severity."),
            @"pelvic-pain":             Symptom(HKCategoryTypeIdentifierPelvicPain, @"Pelvic pain severity."),
            @"lower-back-pain":         Symptom(HKCategoryTypeIdentifierLowerBackPain, @"Lower-back pain severity."),
            @"breast-pain":             Symptom(HKCategoryTypeIdentifierBreastPain, @"Breast pain severity."),
            @"memory-lapse":            Symptom(HKCategoryTypeIdentifierMemoryLapse, @"Memory lapse severity."),
            @"rapid-pounding-heartbeat":Symptom(HKCategoryTypeIdentifierRapidPoundingOrFlutteringHeartbeat, @"Rapid/pounding/fluttering heartbeat severity."),
            @"skipped-heartbeat":       Symptom(HKCategoryTypeIdentifierSkippedHeartbeat, @"Skipped heartbeat severity."),
            @"vaginal-dryness":         Symptom(HKCategoryTypeIdentifierVaginalDryness, @"Vaginal dryness severity."),
            @"loss-of-smell":           Symptom(HKCategoryTypeIdentifierLossOfSmell, @"Loss of smell severity."),
            @"fainting":                Symptom(HKCategoryTypeIdentifierFainting, @"Fainting severity."),
            @"generalized-body-ache":   Symptom(HKCategoryTypeIdentifierGeneralizedBodyAche, @"Generalized body ache severity."),
            @"shortness-of-breath":     Symptom(HKCategoryTypeIdentifierShortnessOfBreath, @"Shortness of breath severity."),
            @"sinus-congestion":        Symptom(HKCategoryTypeIdentifierSinusCongestion, @"Sinus congestion severity."),
            @"wheezing":                Symptom(HKCategoryTypeIdentifierWheezing, @"Wheezing severity."),

            // ── Reproductive ──
            @"menstrual-flow":      Cat(HKCategoryTypeIdentifierMenstrualFlow, @"menstrual",    NO,
                                        @[@"unspecified", @"light", @"medium", @"heavy"],
                                        @"Menstrual flow volume on a given day."),
            @"intermenstrual-bleeding": Cat(HKCategoryTypeIdentifierIntermenstrualBleeding, @"reproductive", NO, presenceValues,
                                        @"Spotting / bleeding outside the menstrual period."),
            @"persistent-intermenstrual-bleeding": Cat(HKCategoryTypeIdentifierPersistentIntermenstrualBleeding, @"reproductive", NO, presenceValues,
                                        @"Repeated intermenstrual bleeding across multiple cycles."),
            @"prolonged-menstrual-periods": Cat(HKCategoryTypeIdentifierProlongedMenstrualPeriods, @"reproductive", NO, presenceValues,
                                        @"Menstrual period lasting longer than typical."),
            @"infrequent-menstrual-cycles": Cat(HKCategoryTypeIdentifierInfrequentMenstrualCycles, @"reproductive", NO, presenceValues,
                                        @"Cycle length longer than typical."),
            @"irregular-menstrual-cycles": Cat(HKCategoryTypeIdentifierIrregularMenstrualCycles, @"reproductive", NO, presenceValues,
                                        @"Cycle length variability outside normal range."),
            @"ovulation-test":      Cat(HKCategoryTypeIdentifierOvulationTestResult, @"reproductive", NO,
                                        @[@"negative", @"luteinizing-hormone-surge", @"indeterminate", @"estrogen-surge"],
                                        @"Ovulation predictor kit test result."),
            @"progesterone-test":   Cat(HKCategoryTypeIdentifierProgesteroneTestResult, @"reproductive", NO,
                                        @[@"negative", @"positive", @"indeterminate"],
                                        @"Progesterone test result (luteal-phase confirmation)."),
            @"cervical-mucus":      Cat(HKCategoryTypeIdentifierCervicalMucusQuality, @"reproductive", NO,
                                        @[@"dry", @"sticky", @"creamy", @"watery", @"egg-white"],
                                        @"Cervical mucus quality for fertility tracking."),
            @"sexual-activity":     Cat(HKCategoryTypeIdentifierSexualActivity, @"reproductive", NO, presenceValues,
                                        @"Sexual activity occurrence."),
            @"pregnancy":           Cat(HKCategoryTypeIdentifierPregnancy, @"reproductive", NO, presenceValues,
                                        @"User is currently pregnant."),
            @"pregnancy-test":      Cat(HKCategoryTypeIdentifierPregnancyTestResult, @"reproductive", NO,
                                        @[@"negative", @"positive", @"indeterminate"],
                                        @"Pregnancy test result."),
            // bleeding-during-pregnancy / bleeding-after-pregnancy gated to
            // iOS 18+ (added in @available block below).
            @"contraceptive":       Cat(HKCategoryTypeIdentifierContraceptive, @"reproductive", NO,
                                        @[@"unspecified", @"implant", @"injection", @"iud",
                                          @"intravaginal-ring", @"oral", @"patch"],
                                        @"Contraceptive method used."),
            @"lactation":           Cat(HKCategoryTypeIdentifierLactation, @"reproductive", NO, presenceValues,
                                        @"Lactation event (breastfeeding/pumping)."),

            // ── Duration-based ──
            @"sleep":               Cat(HKCategoryTypeIdentifierSleepAnalysis, @"sleep", YES,
                                        @[@"inBed", @"asleep", @"awake", @"rem", @"core", @"deep"],
                                        @"Sleep stage/state over a time range."),
            @"mindful-session":     Cat(HKCategoryTypeIdentifierMindfulSession, @"mindfulness", YES, nil,
                                        @"Mindfulness / meditation session."),
            @"toothbrushing":       Cat(HKCategoryTypeIdentifierToothbrushingEvent, @"hygiene", YES, nil,
                                        @"Toothbrushing event."),
            @"handwashing":         Cat(HKCategoryTypeIdentifierHandwashingEvent, @"hygiene", YES, nil,
                                        @"Handwashing event."),

            // ── Cardio events ──
            @"high-heart-rate-event":    Cat(HKCategoryTypeIdentifierHighHeartRateEvent, @"cardio-event", NO, nil,
                                        @"Apple Watch high-heart-rate notification event."),
            @"low-heart-rate-event":     Cat(HKCategoryTypeIdentifierLowHeartRateEvent, @"cardio-event", NO, nil,
                                        @"Apple Watch low-heart-rate notification event."),
            @"irregular-heart-rhythm-event": Cat(HKCategoryTypeIdentifierIrregularHeartRhythmEvent, @"cardio-event", NO, nil,
                                        @"Apple Watch irregular-rhythm notification."),
            @"low-cardio-fitness-event": Cat(HKCategoryTypeIdentifierLowCardioFitnessEvent, @"cardio-event", NO, nil,
                                        @"Low cardio-fitness (VO2 max) notification."),
            // hypertension-event gated to iOS 26.2+ (added in @available block).

            // ── Activity rings ──
            @"apple-stand-hour":         Cat(HKCategoryTypeIdentifierAppleStandHour, @"activity", NO,
                                        @[@"idle", @"stood"],
                                        @"Apple Stand Hour — whether the user stood during that hour."),
            @"walking-steadiness-event": Cat(HKCategoryTypeIdentifierAppleWalkingSteadinessEvent, @"mobility", NO,
                                        @[@"initial-low", @"initial-very-low", @"repeat-low", @"repeat-very-low"],
                                        @"Walking Steadiness notification event."),

            // ── Audio exposure events ──
            @"audio-exposure-event":             Cat(HKCategoryTypeIdentifierAudioExposureEvent, @"audio", NO, nil,
                                        @"Loud audio exposure event (deprecated; use environmental/headphone variants)."),
            @"environmental-audio-exposure-event": Cat(HKCategoryTypeIdentifierEnvironmentalAudioExposureEvent, @"audio", NO, nil,
                                        @"Environmental loud-sound exposure event."),
            @"headphone-audio-exposure-event":   Cat(HKCategoryTypeIdentifierHeadphoneAudioExposureEvent, @"audio", NO, nil,
                                        @"Headphone loud-audio exposure event."),

            // sleep-apnea-event gated to iOS 18+ (added in @available block).
        } mutableCopy];

        if (@available(iOS 18.0, *)) {
            table[@"bleeding-during-pregnancy"] = Cat(HKCategoryTypeIdentifierBleedingDuringPregnancy, @"reproductive", NO, presenceValues,
                                        @"Bleeding observed during pregnancy — iOS 18+.");
            table[@"bleeding-after-pregnancy"]  = Cat(HKCategoryTypeIdentifierBleedingAfterPregnancy, @"reproductive", NO, presenceValues,
                                        @"Postpartum bleeding — iOS 18+.");
            table[@"sleep-apnea-event"]         = Cat(HKCategoryTypeIdentifierSleepApneaEvent, @"sleep", YES, nil,
                                        @"Sleep apnea detection event — iOS 18+.");
        }
        if (@available(iOS 26.2, *)) {
            table[@"hypertension-event"]        = Cat(HKCategoryTypeIdentifierHypertensionEvent, @"cardio-event", NO, nil,
                                        @"Hypertension notification — iOS 26.2+.");
        }
    });
    return table[[name lowercaseString]];
}

static NSArray<NSString *> *allCategoryTypeNames(void) {
    static NSArray *names = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        NSArray *candidates = @[
            // Symptoms
            @"abdominal-cramps", @"acne", @"appetite-changes", @"bladder-incontinence",
            @"bloating", @"breast-pain", @"chest-tightness", @"chills", @"constipation",
            @"coughing", @"diarrhea", @"dizziness", @"dry-skin", @"fainting",
            @"fatigue", @"fever", @"generalized-body-ache", @"hair-loss",
            @"headache", @"heartburn", @"hot-flashes", @"loss-of-smell",
            @"loss-of-taste", @"lower-back-pain", @"memory-lapse", @"mood-changes",
            @"nausea", @"night-sweats", @"pelvic-pain", @"rapid-pounding-heartbeat",
            @"runny-nose", @"shortness-of-breath", @"sinus-congestion",
            @"skipped-heartbeat", @"sleep-changes", @"sore-throat", @"vaginal-dryness",
            @"vomiting", @"wheezing",
            // Reproductive
            @"cervical-mucus", @"contraceptive", @"intermenstrual-bleeding",
            @"persistent-intermenstrual-bleeding", @"prolonged-menstrual-periods",
            @"infrequent-menstrual-cycles", @"irregular-menstrual-cycles",
            @"lactation", @"menstrual-flow", @"ovulation-test", @"progesterone-test",
            @"pregnancy", @"pregnancy-test", @"bleeding-during-pregnancy",
            @"bleeding-after-pregnancy", @"sexual-activity",
            // Duration-based
            @"handwashing", @"mindful-session", @"sleep", @"toothbrushing",
            @"sleep-apnea-event",
            // Cardio events
            @"high-heart-rate-event", @"low-heart-rate-event",
            @"irregular-heart-rhythm-event", @"low-cardio-fitness-event",
            @"hypertension-event",
            // Activity
            @"apple-stand-hour", @"walking-steadiness-event",
            // Audio
            @"audio-exposure-event", @"environmental-audio-exposure-event",
            @"headphone-audio-exposure-event",
        ];
        NSMutableArray *valid = [NSMutableArray array];
        for (NSString *n in candidates) {
            if (logCategoryTypeInfo(n)) [valid addObject:n];
        }
        [valid sortUsingSelector:@selector(compare:)];
        names = [valid copy];
    });
    return names;
}

// Resolve category value string to integer
static BOOL resolveCategoryValue(NSDictionary *info, NSString *valueStr, NSInteger *outValue, NSString **outError) {
    NSArray *validValues = info[@"values"];

    // If no valid values defined, accept raw integer (e.g. mindful-session uses 0)
    if (!validValues) {
        *outValue = [valueStr integerValue];
        return YES;
    }

    // Try exact string match first
    NSString *lower = [valueStr lowercaseString];
    for (NSUInteger i = 0; i < validValues.count; i++) {
        if ([[validValues[i] lowercaseString] isEqualToString:lower]) {
            *outValue = (NSInteger)i;
            return YES;
        }
    }

    // Try integer value
    NSInteger intVal = [valueStr integerValue];
    if ([valueStr length] > 0 && (intVal > 0 || [valueStr isEqualToString:@"0"])) {
        if (intVal >= 0 && intVal < (NSInteger)validValues.count) {
            *outValue = intVal;
            return YES;
        }
    }

    // Map special sleep values to HK enum values
    NSString *catId = info[@"id"];
    if ([catId isEqualToString:HKCategoryTypeIdentifierSleepAnalysis]) {
        NSDictionary *sleepMap = @{
            @"inbed": @(HKCategoryValueSleepAnalysisInBed),
            @"asleep": @(HKCategoryValueSleepAnalysisAsleepUnspecified),
            @"awake": @(HKCategoryValueSleepAnalysisAwake),
            @"rem": @(HKCategoryValueSleepAnalysisAsleepREM),
            @"core": @(HKCategoryValueSleepAnalysisAsleepCore),
            @"deep": @(HKCategoryValueSleepAnalysisAsleepDeep),
        };
        NSNumber *mapped = sleepMap[lower];
        if (mapped) {
            *outValue = [mapped integerValue];
            return YES;
        }
    }

    // Map menstrual flow values
    if ([catId isEqualToString:HKCategoryTypeIdentifierMenstrualFlow]) {
        NSDictionary *flowMap = @{
            @"unspecified": @(HKCategoryValueMenstrualFlowUnspecified),
            @"light": @(HKCategoryValueMenstrualFlowLight),
            @"medium": @(HKCategoryValueMenstrualFlowMedium),
            @"heavy": @(HKCategoryValueMenstrualFlowHeavy),
        };
        NSNumber *mapped = flowMap[lower];
        if (mapped) {
            *outValue = [mapped integerValue];
            return YES;
        }
    }

    // Map ovulation test values
    if ([catId isEqualToString:HKCategoryTypeIdentifierOvulationTestResult]) {
        NSDictionary *ovMap = @{
            @"negative": @(HKCategoryValueOvulationTestResultNegative),
            @"luteinizing-hormone-surge": @(HKCategoryValueOvulationTestResultLuteinizingHormoneSurge),
            @"indeterminate": @(HKCategoryValueOvulationTestResultIndeterminate),
            @"estrogen-surge": @(HKCategoryValueOvulationTestResultEstrogenSurge),
        };
        NSNumber *mapped = ovMap[lower];
        if (mapped) {
            *outValue = [mapped integerValue];
            return YES;
        }
    }

    // Map cervical mucus values
    if ([catId isEqualToString:HKCategoryTypeIdentifierCervicalMucusQuality]) {
        NSDictionary *cmMap = @{
            @"dry": @(HKCategoryValueCervicalMucusQualityDry),
            @"sticky": @(HKCategoryValueCervicalMucusQualitySticky),
            @"creamy": @(HKCategoryValueCervicalMucusQualityCreamy),
            @"watery": @(HKCategoryValueCervicalMucusQualityWatery),
            @"egg-white": @(HKCategoryValueCervicalMucusQualityEggWhite),
        };
        NSNumber *mapped = cmMap[lower];
        if (mapped) {
            *outValue = [mapped integerValue];
            return YES;
        }
    }

    // Map contraceptive values
    if ([catId isEqualToString:HKCategoryTypeIdentifierContraceptive]) {
        NSDictionary *cMap = @{
            @"unspecified": @(HKCategoryValueContraceptiveUnspecified),
            @"implant": @(HKCategoryValueContraceptiveImplant),
            @"injection": @(HKCategoryValueContraceptiveInjection),
            @"iud": @(HKCategoryValueContraceptiveIntrauterineDevice),
            @"intravaginal-ring": @(HKCategoryValueContraceptiveIntravaginalRing),
            @"oral": @(HKCategoryValueContraceptiveOral),
            @"patch": @(HKCategoryValueContraceptivePatch),
        };
        NSNumber *mapped = cMap[lower];
        if (mapped) {
            *outValue = [mapped integerValue];
            return YES;
        }
    }

    // Map pregnancy test values
    if ([catId isEqualToString:HKCategoryTypeIdentifierPregnancyTestResult]) {
        NSDictionary *pMap = @{
            @"negative": @(HKCategoryValuePregnancyTestResultNegative),
            @"positive": @(HKCategoryValuePregnancyTestResultPositive),
            @"indeterminate": @(HKCategoryValuePregnancyTestResultIndeterminate),
        };
        NSNumber *mapped = pMap[lower];
        if (mapped) {
            *outValue = [mapped integerValue];
            return YES;
        }
    }

    // Progesterone test shares the same enum shape as pregnancy test.
    if ([catId isEqualToString:HKCategoryTypeIdentifierProgesteroneTestResult]) {
        NSDictionary *prMap = @{
            @"negative": @(HKCategoryValueProgesteroneTestResultNegative),
            @"positive": @(HKCategoryValueProgesteroneTestResultPositive),
            @"indeterminate": @(HKCategoryValueProgesteroneTestResultIndeterminate),
        };
        NSNumber *mapped = prMap[lower];
        if (mapped) {
            *outValue = [mapped integerValue];
            return YES;
        }
    }

    // Apple Stand Hour: idle (0) | stood (1)
    if ([catId isEqualToString:HKCategoryTypeIdentifierAppleStandHour]) {
        NSDictionary *shMap = @{
            @"idle":  @(HKCategoryValueAppleStandHourIdle),
            @"stood": @(HKCategoryValueAppleStandHourStood),
        };
        NSNumber *mapped = shMap[lower];
        if (mapped) {
            *outValue = [mapped integerValue];
            return YES;
        }
    }

    // Walking Steadiness event severity tier.
    if ([catId isEqualToString:HKCategoryTypeIdentifierAppleWalkingSteadinessEvent]) {
        if (@available(iOS 15.0, *)) {
            NSDictionary *wsMap = @{
                @"initial-low":      @(HKCategoryValueAppleWalkingSteadinessEventInitialLow),
                @"initial-very-low": @(HKCategoryValueAppleWalkingSteadinessEventInitialVeryLow),
                @"repeat-low":       @(HKCategoryValueAppleWalkingSteadinessEventRepeatLow),
                @"repeat-very-low":  @(HKCategoryValueAppleWalkingSteadinessEventRepeatVeryLow),
            };
            NSNumber *mapped = wsMap[lower];
            if (mapped) {
                *outValue = [mapped integerValue];
                return YES;
            }
        }
    }

    // Symptom severity (generic for all symptom types)
    NSDictionary *symptomMap = @{
        @"not-present": @(HKCategoryValueSeverityUnspecified),
        @"mild": @(HKCategoryValueSeverityMild),
        @"moderate": @(HKCategoryValueSeverityModerate),
        @"severe": @(HKCategoryValueSeveritySevere),
    };
    NSNumber *mapped = symptomMap[lower];
    if (mapped) {
        *outValue = [mapped integerValue];
        return YES;
    }

    // Presence values
    NSDictionary *presenceMap = @{
        @"not-present": @(HKCategoryValueNotApplicable),
        @"present": @(HKCategoryValueNotApplicable),  // presence categories use 0 for present
    };
    mapped = presenceMap[lower];
    if (mapped) {
        *outValue = [mapped integerValue];
        return YES;
    }

    *outError = [NSString stringWithFormat:@"Invalid --value '%@'. Valid values: %@",
                 valueStr, [validValues componentsJoinedByString:@", "]];
    return NO;
}

// Find closest match for typo correction
static NSString *findClosestMatch(NSString *input, NSArray<NSString *> *candidates) {
    NSString *lower = [input lowercaseString];
    NSString *best = nil;

    for (NSString *c in candidates) {
        // Simple substring check
        if ([c containsString:lower] || [lower containsString:c]) {
            if (!best || c.length < best.length) best = c;
        }
        // Also check without hyphens
        NSString *nohyphen = [c stringByReplacingOccurrencesOfString:@"-" withString:@""];
        NSString *inputNohyphen = [lower stringByReplacingOccurrencesOfString:@"-" withString:@""];
        if ([nohyphen isEqualToString:inputNohyphen]) return c;
    }
    return best;
}

#pragma mark - log-blood-pressure

// Blood pressure must be saved as an HKCorrelation that bundles systolic +
// diastolic together; otherwise the Health app's "Blood Pressure" card does
// not render the entry (it filters for correlations, not isolated quantity
// samples). This dedicated command takes both numbers in one call so we can
// build the correlation atomically.
//
//   apple-healthkit log-blood-pressure --systolic 120 --diastolic 80 [--date <iso>]
static int cmd_log_blood_pressure(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    NSString *sysStr = noff_find_arg(argc, argv, "--systolic");
    NSString *diaStr = noff_find_arg(argc, argv, "--diastolic");

    if (!sysStr || !diaStr) {
        noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"log-blood-pressure",
                       NOFF_ERR_INVALID_ARGS,
                       @"Required: --systolic <mmHg> --diastolic <mmHg>. "
                        "Optional: --date <iso8601>. Example: "
                        "apple-healthkit log-blood-pressure --systolic 120 --diastolic 80"),
                       compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    double sysVal = [sysStr doubleValue];
    double diaVal = [diaStr doubleValue];
    if (sysVal <= 0 || diaVal <= 0) {
        noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"log-blood-pressure",
                       NOFF_ERR_INVALID_ARGS,
                       @"--systolic and --diastolic must be positive numbers (mmHg)."),
                       compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    HKQuantityType *sysType = [HKQuantityType quantityTypeForIdentifier:HKQuantityTypeIdentifierBloodPressureSystolic];
    HKQuantityType *diaType = [HKQuantityType quantityTypeForIdentifier:HKQuantityTypeIdentifierBloodPressureDiastolic];
    HKCorrelationType *bpType = [HKCorrelationType correlationTypeForIdentifier:HKCorrelationTypeIdentifierBloodPressure];

    // Request authorization for all three types in one prompt. Correlation
    // share-auth piggybacks on the constituent quantity types.
    NSSet *writeTypes = [NSSet setWithObjects:sysType, diaType, bpType, nil];
    NSString *authErr = nil;
    if (!requestHealthKitAccess(writeTypes, writeTypes, &authErr)) {
        noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"log-blood-pressure",
                       NOFF_ERR_AUTHORIZATION_DENIED, authErr), compact, quiet);
        return NOFF_EXIT_AUTH_DENIED;
    }

    NSString *dateStr = noff_find_arg(argc, argv, "--date");
    NSDate *sampleDate = dateStr ? noff_parse_date(dateStr) : [NSDate date];
    if (!sampleDate) sampleDate = [NSDate date];

    HKUnit *mmHg = [HKUnit millimeterOfMercuryUnit];
    HKQuantity *sysQty = [HKQuantity quantityWithUnit:mmHg doubleValue:sysVal];
    HKQuantity *diaQty = [HKQuantity quantityWithUnit:mmHg doubleValue:diaVal];

    HKQuantitySample *sysSample = nil;
    HKQuantitySample *diaSample = nil;
    HKCorrelation *bpCorrelation = nil;
    @try {
        sysSample = [HKQuantitySample quantitySampleWithType:sysType
                                                    quantity:sysQty
                                                   startDate:sampleDate
                                                     endDate:sampleDate];
        diaSample = [HKQuantitySample quantitySampleWithType:diaType
                                                    quantity:diaQty
                                                   startDate:sampleDate
                                                     endDate:sampleDate];
        bpCorrelation = [HKCorrelation correlationWithType:bpType
                                                 startDate:sampleDate
                                                   endDate:sampleDate
                                                   objects:[NSSet setWithObjects:sysSample, diaSample, nil]];
    } @catch (NSException *ex) {
        NSString *msg = [NSString stringWithFormat:@"Invalid blood-pressure sample: %@", ex.reason ?: ex.name];
        noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"log-blood-pressure",
                       NOFF_ERR_INVALID_ARGS, msg), compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    // Save the correlation; HealthKit persists the contained quantity samples
    // as part of the atomic write. saveWithAuthRetry's second arg is only used
    // to re-request authorization on -25300; passing sysType is sufficient
    // because the retry path requests both constituent types via the set.
    NSError *saveErr = nil;
    if (!saveWithAuthRetry(bpCorrelation, sysType, &saveErr)) {
        BOOL authDenied = isHealthKitAuthError(saveErr);
        NSString *msg = saveErr.localizedDescription ?: @"Failed to save blood-pressure correlation";
        if (authDenied) {
            msg = [NSString stringWithFormat:
                @"%@. Open Settings > Health > Data Access & Devices > Minis "
                 "and enable write access for 'Blood Pressure', then retry.", msg];
        }
        noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"log-blood-pressure",
                       authDenied ? NOFF_ERR_AUTHORIZATION_DENIED : NOFF_ERR_INTERNAL_ERROR,
                       msg), compact, quiet);
        return authDenied ? NOFF_EXIT_AUTH_DENIED : NOFF_EXIT_ERROR;
    }

    NSDictionary *data = @{
        @"systolic": @(sysVal),
        @"diastolic": @(diaVal),
        @"unit": @"mmHg",
        @"date": noff_format_date(sampleDate),
        @"correlation_uuid": bpCorrelation.UUID.UUIDString,
        @"saved": @YES,
    };
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"log-blood-pressure", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

#pragma mark - log

static int cmd_log(int argc, char **argv, int stdout_fd, int stderr_fd, BOOL compact, BOOL quiet) {
    NSString *typeName = noff_find_arg(argc, argv, "--type");
    NSString *valueStr = noff_find_arg(argc, argv, "--value");

    // Blood-pressure must be written via HKCorrelation (see cmd_log_blood_pressure).
    // Saving one half as an isolated quantity sample succeeds at the HealthKit
    // API level but the Health app's "Blood Pressure" card filters for the
    // correlation type and silently hides the entry. Reject early with a
    // pointer to the right command so callers (LLM included) don't waste
    // writes that never surface in the user's Health app.
    if (typeName) {
        NSString *lower = [typeName lowercaseString];
        if ([lower isEqualToString:@"blood-pressure-systolic"]
            || [lower isEqualToString:@"blood-pressure-diastolic"]
            || [lower isEqualToString:@"blood-pressure"]) {
            noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"log",
                NOFF_ERR_INVALID_ARGS,
                @"Blood pressure must be written as a correlation (systolic + diastolic together) "
                 "or the Health app will not display the entry. Use: "
                 "apple-healthkit log-blood-pressure --systolic <mmHg> --diastolic <mmHg> [--date <iso>]"),
                compact, quiet);
            return NOFF_EXIT_INVALID_ARGS;
        }
    }

    if (!typeName || !valueStr) {
        noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"log",
                       NOFF_ERR_INVALID_ARGS,
                       @"Required: --type <name> --value <number|string>. "
                        "Run 'apple-healthkit log --help' for all supported types."),
                       compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    // ── Try quantity type first ──
    NSDictionary *qInfo = logQuantityTypeInfo(typeName);
    if (qInfo) {
        HKQuantityTypeIdentifier typeId = qInfo[@"id"];
        HKUnit *unit = qInfo[@"unit"];
        NSString *unitLabel = qInfo[@"label"];
        double scale = [qInfo[@"scale"] doubleValue];

        double value = [valueStr doubleValue];
        if (scale != 1.0 && scale != 0.0) {
            value = value / scale;
        }

        HKQuantityType *qType = [HKQuantityType quantityTypeForIdentifier:typeId];
        NSString *authErr = nil;
        if (!requestHealthKitAccess([NSSet setWithObject:qType],
                                     [NSSet setWithObject:qType], &authErr)) {
            noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"log",
                           NOFF_ERR_AUTHORIZATION_DENIED, authErr), compact, quiet);
            return NOFF_EXIT_AUTH_DENIED;
        }

        NSString *dateStr = noff_find_arg(argc, argv, "--date");
        NSDate *sampleDate = dateStr ? noff_parse_date(dateStr) : [NSDate date];
        if (!sampleDate) sampleDate = [NSDate date];

        HKQuantity *quantity = [HKQuantity quantityWithUnit:unit doubleValue:value];
        HKQuantitySample *sample = nil;
        @try {
            sample = [HKQuantitySample quantitySampleWithType:qType
                                                     quantity:quantity
                                                    startDate:sampleDate
                                                      endDate:sampleDate];
        } @catch (NSException *ex) {
            NSString *msg = [NSString stringWithFormat:@"Invalid quantity sample: %@", ex.reason ?: ex.name];
            noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"log",
                           NOFF_ERR_INVALID_ARGS, msg), compact, quiet);
            return NOFF_EXIT_INVALID_ARGS;
        }

        NSError *saveErr = nil;
        if (!saveWithAuthRetry(sample, qType, &saveErr)) {
            BOOL authDenied = isHealthKitAuthError(saveErr);
            NSString *msg = saveErr.localizedDescription ?: @"Failed to save sample";
            if (authDenied) {
                msg = [NSString stringWithFormat:
                    @"%@. Open Settings > Health > Data Access & Devices > Minis "
                     "and enable write access for '%@', then retry.", msg, typeName];
            }
            noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"log",
                           authDenied ? NOFF_ERR_AUTHORIZATION_DENIED : NOFF_ERR_INTERNAL_ERROR,
                           msg), compact, quiet);
            return authDenied ? NOFF_EXIT_AUTH_DENIED : NOFF_EXIT_ERROR;
        }

        NSDictionary *data = @{
            @"type": typeName,
            @"value": @(noff_round4([valueStr doubleValue])),
            @"unit": unitLabel,
            @"date": noff_format_date(sampleDate),
            @"saved": @YES,
        };
        noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"log", data), compact, quiet);
        return NOFF_EXIT_SUCCESS;
    }

    // ── Try category type ──
    NSDictionary *cInfo = logCategoryTypeInfo(typeName);
    if (cInfo) {
        HKCategoryTypeIdentifier catId = cInfo[@"id"];
        BOOL durationBased = [cInfo[@"duration"] boolValue];

        // Resolve value
        NSInteger catValue = 0;
        NSString *valueErr = nil;
        if (!resolveCategoryValue(cInfo, valueStr, &catValue, &valueErr)) {
            NSMutableDictionary *errData = [@{
                @"error": valueErr,
            } mutableCopy];
            NSArray *vals = cInfo[@"values"];
            if (vals) errData[@"valid_values"] = vals;
            noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"log",
                           NOFF_ERR_INVALID_ARGS, valueErr), compact, quiet);
            return NOFF_EXIT_INVALID_ARGS;
        }

        HKCategoryType *cType = [HKCategoryType categoryTypeForIdentifier:catId];
        NSString *authErr = nil;
        if (!requestHealthKitAccess([NSSet setWithObject:cType],
                                     [NSSet setWithObject:cType], &authErr)) {
            noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"log",
                           NOFF_ERR_AUTHORIZATION_DENIED, authErr), compact, quiet);
            return NOFF_EXIT_AUTH_DENIED;
        }

        NSDate *startDate, *endDate;
        if (durationBased) {
            NSString *startStr = noff_find_arg(argc, argv, "--start");
            NSString *endStr = noff_find_arg(argc, argv, "--end");
            startDate = startStr ? noff_parse_date(startStr) : [NSDate dateWithTimeIntervalSinceNow:-3600];
            endDate = endStr ? noff_parse_date(endStr) : [NSDate date];
            if (!startDate) startDate = [NSDate dateWithTimeIntervalSinceNow:-3600];
            if (!endDate) endDate = [NSDate date];
        } else {
            NSString *dateStr = noff_find_arg(argc, argv, "--date");
            startDate = dateStr ? noff_parse_date(dateStr) : [NSDate date];
            if (!startDate) startDate = [NSDate date];
            endDate = startDate;
        }

        HKCategorySample *sample = nil;
        @try {
            sample = [HKCategorySample categorySampleWithType:cType
                                                        value:catValue
                                                    startDate:startDate
                                                      endDate:endDate];
        } @catch (NSException *ex) {
            NSString *msg = [NSString stringWithFormat:@"Invalid category sample: %@", ex.reason ?: ex.name];
            noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"log",
                           NOFF_ERR_INVALID_ARGS, msg), compact, quiet);
            return NOFF_EXIT_INVALID_ARGS;
        }

        NSError *saveErr = nil;
        if (!saveWithAuthRetry(sample, cType, &saveErr)) {
            BOOL authDenied = isHealthKitAuthError(saveErr);
            NSString *msg = saveErr.localizedDescription ?: @"Failed to save category sample";
            if (authDenied) {
                msg = [NSString stringWithFormat:
                    @"%@. Open Settings > Health > Data Access & Devices > Minis "
                     "and enable write access for '%@', then retry.", msg, typeName];
            }
            noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"log",
                           authDenied ? NOFF_ERR_AUTHORIZATION_DENIED : NOFF_ERR_INTERNAL_ERROR,
                           msg), compact, quiet);
            return authDenied ? NOFF_EXIT_AUTH_DENIED : NOFF_EXIT_ERROR;
        }

        NSMutableDictionary *data = [@{
            @"type": typeName,
            @"value": valueStr,
            @"category_value": @(catValue),
            @"saved": @YES,
        } mutableCopy];
        if (durationBased) {
            data[@"start"] = noff_format_date(startDate);
            data[@"end"] = noff_format_date(endDate);
        } else {
            data[@"date"] = noff_format_date(startDate);
        }
        noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"log", data), compact, quiet);
        return NOFF_EXIT_SUCCESS;
    }

    // ── Unknown type — AI-friendly error with suggestions ──
    NSString *suggestion = findClosestMatch(typeName,
        [allQuantityTypeNames() arrayByAddingObjectsFromArray:allCategoryTypeNames()]);
    NSString *errMsg;
    if (suggestion) {
        errMsg = [NSString stringWithFormat:@"Unknown --type '%@'. Did you mean '%@'?", typeName, suggestion];
    } else {
        errMsg = [NSString stringWithFormat:@"Unknown --type '%@'.", typeName];
    }

    NSDictionary *errResponse = @{
        @"tool": TOOL_NAME,
        @"command": @"log",
        @"error": errMsg,
        @"available_quantity_types": allQuantityTypeNames(),
        @"available_category_types": allCategoryTypeNames(),
        @"hint": @"Use: apple-healthkit log --type <name> --value <number|string>",
    };
    noff_emit_json(stdout_fd, errResponse, compact, quiet);
    return NOFF_EXIT_INVALID_ARGS;
}

#pragma mark - delete

// Delete samples of a given type. Supports three modes:
//   --id <uuid>                 delete a single sample by UUID
//   --today | --days N          delete all matching samples in a date range
//   --start ... --end ...       explicit date range
// HealthKit only allows deleting samples written by the current app; samples
// from other sources (Health app, Apple Watch, third-party apps) are not
// deletable and HealthKit's delete call will fail for the whole batch if any
// such sample is included. We filter the query to HKSource.default (this app)
// before deleting to avoid that and report accurately.
static int cmd_delete(int argc, char **argv, int stdout_fd, int stderr_fd, BOOL compact, BOOL quiet) {
    NSString *typeName = noff_find_arg(argc, argv, "--type");
    if (!typeName) {
        noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"delete",
                       NOFF_ERR_INVALID_ARGS,
                       @"Required: --type <name>. Also provide --id <uuid> OR a date range (--today / --days N / --start --end)."),
                       compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    // Resolve type → HKSampleType. Reuse the same registries cmd_log uses.
    HKSampleType *sampleType = nil;
    NSDictionary *qInfo = logQuantityTypeInfo(typeName);
    if (qInfo) {
        sampleType = [HKQuantityType quantityTypeForIdentifier:qInfo[@"id"]];
    } else {
        NSDictionary *cInfo = logCategoryTypeInfo(typeName);
        if (cInfo) {
            sampleType = [HKCategoryType categoryTypeForIdentifier:cInfo[@"id"]];
        }
    }
    if (!sampleType) {
        NSString *suggestion = findClosestMatch(typeName,
            [allQuantityTypeNames() arrayByAddingObjectsFromArray:allCategoryTypeNames()]);
        NSString *errMsg = suggestion
            ? [NSString stringWithFormat:@"Unknown --type '%@'. Did you mean '%@'?", typeName, suggestion]
            : [NSString stringWithFormat:@"Unknown --type '%@'.", typeName];
        noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"delete",
                       NOFF_ERR_INVALID_ARGS, errMsg), compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    // Authorization: deleting needs share (write) access, same as log.
    NSString *authErr = nil;
    if (!requestHealthKitAccess([NSSet setWithObject:sampleType],
                                 [NSSet setWithObject:sampleType], &authErr)) {
        noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"delete",
                       NOFF_ERR_AUTHORIZATION_DENIED, authErr), compact, quiet);
        return NOFF_EXIT_AUTH_DENIED;
    }

    // Build predicate: --id takes precedence over date range.
    NSString *idStr = noff_find_arg(argc, argv, "--id");
    NSPredicate *predicate = nil;
    NSString *rangeDescription = nil;
    if (idStr) {
        NSUUID *uuid = [[NSUUID alloc] initWithUUIDString:idStr];
        if (!uuid) {
            noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"delete",
                           NOFF_ERR_INVALID_ARGS,
                           [NSString stringWithFormat:@"Invalid --id '%@' (expected UUID)", idStr]),
                           compact, quiet);
            return NOFF_EXIT_INVALID_ARGS;
        }
        predicate = [HKQuery predicateForObjectsWithUUIDs:[NSSet setWithObject:uuid]];
        rangeDescription = [NSString stringWithFormat:@"id=%@", idStr];
    } else {
        NSDate *start, *end;
        resolve_date_range(argc, argv, &start, &end);
        predicate = [HKQuery predicateForSamplesWithStartDate:start
                                                      endDate:end
                                                      options:HKQueryOptionStrictStartDate];
        rangeDescription = [NSString stringWithFormat:@"%@ → %@",
                            noff_format_date(start), noff_format_date(end)];
    }

    // Restrict to samples written by this app. HKSource.defaultSource
    // represents the current app; combining with the user predicate avoids
    // matching (and then failing on) records owned by other sources.
    NSPredicate *sourcePredicate = [HKQuery predicateForObjectsFromSource:[HKSource defaultSource]];
    NSPredicate *finalPredicate = [NSCompoundPredicate
        andPredicateWithSubpredicates:@[predicate, sourcePredicate]];

    // Query matching samples first so we can report which UUIDs were removed
    // and distinguish "nothing matched" from "delete failed".
    NSError *lookupErr = nil;
    NSArray<HKSample *> *matches = querySamplesWithError(sampleType, finalPredicate,
                                                          HKObjectQueryNoLimit, nil, &lookupErr);
    // [GH#128] A failed lookup previously fell through to the count==0 branch and
    // reported "No matching samples" with ok:true — telling the user their data
    // was checked and found absent when in fact nothing was ever read.
    if (lookupErr) {
        return hkEmitReadError(stdout_fd, @"delete",
                               @"pre-delete lookup", lookupErr, compact, quiet);
    }
    if (matches.count == 0) {
        NSDictionary *data = @{
            @"type": typeName,
            @"range": rangeDescription,
            @"deleted_count": @0,
            @"deleted_ids": @[],
            @"note": @"No matching samples written by this app in the given range.",
        };
        noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"delete", data), compact, quiet);
        return NOFF_EXIT_SUCCESS;
    }

    NSMutableArray *deletedIds = [NSMutableArray arrayWithCapacity:matches.count];
    for (HKSample *s in matches) {
        [deletedIds addObject:s.UUID.UUIDString];
    }

    __block BOOL success = NO;
    __block NSError *deleteErr = nil;
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);
    [healthStore() deleteObjects:matches withCompletion:^(BOOL ok, NSError *err) {
        success = ok;
        deleteErr = err;
        dispatch_semaphore_signal(sem);
    }];
    dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_SEC));

    // Retry path mirroring saveWithAuthRetry: if iOS cached a denied auth
    // state, rebuild the HKHealthStore and try once more.
    if (!success && isHealthKitAuthError(deleteErr)) {
        NSLog(@"[healthkit/auth] delete failed with auth error — rebuilding HKHealthStore and retrying");
        resetHealthStore();
        NSString *retryAuthErr = nil;
        if (requestHealthKitAccess([NSSet setWithObject:sampleType],
                                    [NSSet setWithObject:sampleType], &retryAuthErr)) {
            success = NO;
            deleteErr = nil;
            dispatch_semaphore_t sem2 = dispatch_semaphore_create(0);
            [healthStore() deleteObjects:matches withCompletion:^(BOOL ok, NSError *err) {
                success = ok;
                deleteErr = err;
                dispatch_semaphore_signal(sem2);
            }];
            dispatch_semaphore_wait(sem2, dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_SEC));
        }
    }

    if (!success) {
        BOOL authDenied = isHealthKitAuthError(deleteErr);
        NSString *msg = deleteErr.localizedDescription ?: @"Failed to delete samples";
        if (authDenied) {
            msg = [NSString stringWithFormat:
                @"%@. Open Settings > Health > Data Access & Devices > Minis "
                 "and enable write access for '%@', then retry.", msg, typeName];
        }
        noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"delete",
                       authDenied ? NOFF_ERR_AUTHORIZATION_DENIED : NOFF_ERR_INTERNAL_ERROR,
                       msg), compact, quiet);
        return authDenied ? NOFF_EXIT_AUTH_DENIED : NOFF_EXIT_ERROR;
    }

    NSDictionary *data = @{
        @"type": typeName,
        @"range": rangeDescription,
        @"deleted_count": @(matches.count),
        @"deleted_ids": deletedIds,
    };
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"delete", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

// ── Basal Energy ──

static int cmd_basal_energy(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    HKQuantityType *basalType = [HKQuantityType quantityTypeForIdentifier:HKQuantityTypeIdentifierBasalEnergyBurned];
    NSString *authErr = nil;
    if (!requestHealthKitAccess([NSSet setWithObject:basalType], nil, &authErr)) {
        noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"basal-energy",
                       NOFF_ERR_AUTHORIZATION_DENIED, authErr), compact, quiet);
        return NOFF_EXIT_AUTH_DENIED;
    }

    NSDate *start, *end;
    resolve_date_range(argc, argv, &start, &end);

    NSCalendar *calendar = [NSCalendar currentCalendar];
    NSDateComponents *interval = [[NSDateComponents alloc] init];
    interval.day = 1;
    NSDate *anchorDate = [calendar startOfDayForDate:start];

    NSPredicate *predicate = [HKQuery predicateForSamplesWithStartDate:start
                                                               endDate:end
                                                               options:HKQueryOptionStrictStartDate];

    // [GH#128] Same silent-zeros shape as elevation — see
    // statisticsCollectionWithError.
    NSError *statsErr = nil;
    NSArray<HKStatistics *> *dailyStats = statisticsCollectionWithError(
        basalType, predicate, HKStatisticsOptionCumulativeSum,
        anchorDate, interval, start, end, &statsErr);
    if (!dailyStats) {
        return hkEmitReadError(stdout_fd, @"basal_energy", @"basal energy",
                               statsErr, compact, quiet);
    }

    HKUnit *kcalUnit = [HKUnit kilocalorieUnit];
    NSMutableArray *items = [NSMutableArray array];
    double total = 0;
    for (HKStatistics *stat in dailyStats) {
        HKQuantity *sum = [stat sumQuantity];
        double kcal = sum ? [sum doubleValueForUnit:kcalUnit] : 0;
        total += kcal;
        [items addObject:@{
            @"date": noff_format_date(stat.startDate),
            @"basal_kcal": @(round(kcal * 10.0) / 10.0),
        }];
    }

    NSDictionary *data = @{
        @"days": items,
        @"total": @(round(total * 10.0) / 10.0),
        @"range": @{
            @"start": noff_format_date(start),
            @"end": noff_format_date(end),
        },
    };
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"basal-energy", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

#pragma mark - characteristic

// Read all six HKCharacteristicTypeIdentifier values for the user.
// Characteristics are read-only and one-shot — they live with the user's
// Health profile, not as samples. Filter with --type <name> to fetch a
// single field, or omit --type to fetch every available characteristic.
static int cmd_characteristic(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    NSString *filter = noff_find_arg(argc, argv, "--type");
    NSString *lowerFilter = filter ? [filter lowercaseString] : nil;

    NSMutableSet<HKObjectType *> *readSet = [NSMutableSet set];
    BOOL (^want)(NSString *) = ^BOOL(NSString *name) {
        return lowerFilter == nil || [lowerFilter isEqualToString:name];
    };
    if (want(@"biological-sex"))
        [readSet addObject:[HKCharacteristicType characteristicTypeForIdentifier:HKCharacteristicTypeIdentifierBiologicalSex]];
    if (want(@"date-of-birth"))
        [readSet addObject:[HKCharacteristicType characteristicTypeForIdentifier:HKCharacteristicTypeIdentifierDateOfBirth]];
    if (want(@"blood-type"))
        [readSet addObject:[HKCharacteristicType characteristicTypeForIdentifier:HKCharacteristicTypeIdentifierBloodType]];
    if (want(@"fitzpatrick-skin-type"))
        [readSet addObject:[HKCharacteristicType characteristicTypeForIdentifier:HKCharacteristicTypeIdentifierFitzpatrickSkinType]];
    if (want(@"wheelchair-use"))
        [readSet addObject:[HKCharacteristicType characteristicTypeForIdentifier:HKCharacteristicTypeIdentifierWheelchairUse]];
    if (want(@"activity-move-mode")) {
        if (@available(iOS 14.0, *)) {
            [readSet addObject:[HKCharacteristicType characteristicTypeForIdentifier:HKCharacteristicTypeIdentifierActivityMoveMode]];
        }
    }

    if (readSet.count == 0) {
        noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"characteristic",
                       NOFF_ERR_INVALID_ARGS,
                       @"Unknown --type. Valid: biological-sex, date-of-birth, blood-type, "
                        "fitzpatrick-skin-type, wheelchair-use, activity-move-mode"),
                       compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    NSString *authErr = nil;
    if (!requestHealthKitAccess(readSet, nil, &authErr)) {
        noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"characteristic",
                       NOFF_ERR_AUTHORIZATION_DENIED, authErr), compact, quiet);
        return NOFF_EXIT_AUTH_DENIED;
    }

    NSMutableDictionary *data = [NSMutableDictionary dictionary];
    HKHealthStore *store = healthStore();

    if (want(@"biological-sex")) {
        NSError *err = nil;
        HKBiologicalSexObject *obj = [store biologicalSexWithError:&err];
        if (!err) {
            NSString *s;
            switch (obj.biologicalSex) {
                case HKBiologicalSexFemale: s = @"female"; break;
                case HKBiologicalSexMale:   s = @"male"; break;
                case HKBiologicalSexOther:  s = @"other"; break;
                default: s = @"not-set"; break;
            }
            data[@"biological_sex"] = s;
        }
    }
    if (want(@"date-of-birth")) {
        NSError *err = nil;
        NSDate *dob = [store dateOfBirthWithError:&err];
        if (!err && dob) {
            data[@"date_of_birth"] = noff_format_date(dob);
        }
    }
    if (want(@"blood-type")) {
        NSError *err = nil;
        HKBloodTypeObject *obj = [store bloodTypeWithError:&err];
        if (!err) {
            NSString *s;
            switch (obj.bloodType) {
                case HKBloodTypeAPositive:  s = @"A+"; break;
                case HKBloodTypeANegative:  s = @"A-"; break;
                case HKBloodTypeBPositive:  s = @"B+"; break;
                case HKBloodTypeBNegative:  s = @"B-"; break;
                case HKBloodTypeABPositive: s = @"AB+"; break;
                case HKBloodTypeABNegative: s = @"AB-"; break;
                case HKBloodTypeOPositive:  s = @"O+"; break;
                case HKBloodTypeONegative:  s = @"O-"; break;
                default: s = @"not-set"; break;
            }
            data[@"blood_type"] = s;
        }
    }
    if (want(@"fitzpatrick-skin-type")) {
        NSError *err = nil;
        HKFitzpatrickSkinTypeObject *obj = [store fitzpatrickSkinTypeWithError:&err];
        if (!err) {
            data[@"fitzpatrick_skin_type"] = obj.skinType == HKFitzpatrickSkinTypeNotSet
                ? @"not-set"
                : [NSString stringWithFormat:@"type-%ld", (long)obj.skinType];
        }
    }
    if (want(@"wheelchair-use")) {
        NSError *err = nil;
        HKWheelchairUseObject *obj = [store wheelchairUseWithError:&err];
        if (!err) {
            switch (obj.wheelchairUse) {
                case HKWheelchairUseYes: data[@"wheelchair_use"] = @"yes"; break;
                case HKWheelchairUseNo:  data[@"wheelchair_use"] = @"no"; break;
                default: data[@"wheelchair_use"] = @"not-set"; break;
            }
        }
    }
    if (want(@"activity-move-mode")) {
        if (@available(iOS 14.0, *)) {
            NSError *err = nil;
            HKActivityMoveModeObject *obj = [store activityMoveModeWithError:&err];
            if (!err) {
                switch (obj.activityMoveMode) {
                    case HKActivityMoveModeActiveEnergy: data[@"activity_move_mode"] = @"active-energy"; break;
                    case HKActivityMoveModeAppleMoveTime: data[@"activity_move_mode"] = @"move-time"; break;
                    default: data[@"activity_move_mode"] = @"not-set"; break;
                }
            }
        }
    }

    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"characteristic", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

#pragma mark - ecg

static int cmd_ecg(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    if (@available(iOS 14.0, *)) {
        HKElectrocardiogramType *ecgType = [HKObjectType electrocardiogramType];
        NSString *authErr = nil;
        if (!requestHealthKitAccess([NSSet setWithObject:ecgType], nil, &authErr)) {
            noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"ecg",
                           NOFF_ERR_AUTHORIZATION_DENIED, authErr), compact, quiet);
            return NOFF_EXIT_AUTH_DENIED;
        }

        NSDate *start, *end;
        resolve_date_range(argc, argv, &start, &end);
        NSString *limitStr = noff_find_arg(argc, argv, "--limit");
        NSUInteger limit = limitStr ? (NSUInteger)[limitStr integerValue] : DEFAULT_LIMIT;

        NSPredicate *predicate = [HKQuery predicateForSamplesWithStartDate:start endDate:end options:HKQueryOptionStrictStartDate];
        NSSortDescriptor *sort = [NSSortDescriptor sortDescriptorWithKey:HKSampleSortIdentifierStartDate ascending:NO];
        NSError *ecgSamplesErr = nil;
        NSArray<HKElectrocardiogram *> *samples = querySamplesWithError(ecgType, predicate, limit, @[sort], &ecgSamplesErr);
        // [GH#128] Surface read failures instead of an empty result set.
        if (ecgSamplesErr) {
            return hkEmitReadError(stdout_fd, @"ecg", @"ECG", ecgSamplesErr, compact, quiet);
        }

        HKUnit *bpmUnit = [[HKUnit countUnit] unitDividedByUnit:[HKUnit minuteUnit]];
        NSMutableArray *items = [NSMutableArray array];
        for (HKElectrocardiogram *e in samples) {
            NSString *classification;
            switch (e.classification) {
                case HKElectrocardiogramClassificationSinusRhythm:               classification = @"sinusRhythm"; break;
                case HKElectrocardiogramClassificationAtrialFibrillation:        classification = @"atrialFibrillation"; break;
                case HKElectrocardiogramClassificationInconclusiveLowHeartRate:  classification = @"inconclusiveLowHeartRate"; break;
                case HKElectrocardiogramClassificationInconclusiveHighHeartRate: classification = @"inconclusiveHighHeartRate"; break;
                case HKElectrocardiogramClassificationInconclusivePoorReading:   classification = @"inconclusivePoorReading"; break;
                case HKElectrocardiogramClassificationInconclusiveOther:         classification = @"inconclusiveOther"; break;
                case HKElectrocardiogramClassificationUnrecognized:              classification = @"unrecognized"; break;
                default: classification = @"notSet"; break;
            }
            NSMutableDictionary *item = [@{
                @"start": noff_format_date(e.startDate),
                @"end": noff_format_date(e.endDate),
                @"classification": classification,
                @"num_voltage_measurements": @(e.numberOfVoltageMeasurements),
                @"sampling_frequency_hz": e.samplingFrequency
                    ? @([e.samplingFrequency doubleValueForUnit:[HKUnit hertzUnit]])
                    : (id)[NSNull null],
                @"source": sourceNameForSample(e),
            } mutableCopy];
            if (e.averageHeartRate) {
                item[@"avg_bpm"] = @(round([e.averageHeartRate doubleValueForUnit:bpmUnit]));
            }
            if (@available(iOS 17.4, *)) {
                NSNumber *low = e.symptomsStatus == HKElectrocardiogramSymptomsStatusPresent ? @YES :
                                e.symptomsStatus == HKElectrocardiogramSymptomsStatusNone    ? @NO  : nil;
                if (low != nil) item[@"symptoms_present"] = low;
            }
            [items addObject:item];
        }

        NSDictionary *data = @{
            @"samples": items,
            @"count": @(items.count),
            @"range": @{@"start": noff_format_date(start), @"end": noff_format_date(end)},
        };
        noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"ecg", data), compact, quiet);
        return NOFF_EXIT_SUCCESS;
    } else {
        noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"ecg",
                       NOFF_ERR_INVALID_ARGS, @"ECG requires iOS 14+."), compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }
}

#pragma mark - audiogram

static int cmd_audiogram(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    if (@available(iOS 13.0, *)) {
        HKSampleType *audioType = [HKObjectType audiogramSampleType];
        NSString *authErr = nil;
        if (!requestHealthKitAccess([NSSet setWithObject:audioType], nil, &authErr)) {
            noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"audiogram",
                           NOFF_ERR_AUTHORIZATION_DENIED, authErr), compact, quiet);
            return NOFF_EXIT_AUTH_DENIED;
        }

        NSDate *start, *end;
        resolve_date_range(argc, argv, &start, &end);
        NSString *limitStr = noff_find_arg(argc, argv, "--limit");
        NSUInteger limit = limitStr ? (NSUInteger)[limitStr integerValue] : DEFAULT_LIMIT;

        NSPredicate *predicate = [HKQuery predicateForSamplesWithStartDate:start endDate:end options:HKQueryOptionStrictStartDate];
        NSSortDescriptor *sort = [NSSortDescriptor sortDescriptorWithKey:HKSampleSortIdentifierStartDate ascending:NO];
        NSError *audioSamplesErr = nil;
        NSArray<HKAudiogramSample *> *samples = querySamplesWithError(audioType, predicate, limit, @[sort], &audioSamplesErr);
        // [GH#128] Surface read failures instead of an empty result set.
        if (audioSamplesErr) {
            return hkEmitReadError(stdout_fd, @"audiogram", @"audiogram", audioSamplesErr, compact, quiet);
        }

        HKUnit *hz = [HKUnit hertzUnit];
        HKUnit *dBHL = [HKUnit decibelHearingLevelUnit];
        NSMutableArray *items = [NSMutableArray array];
        for (HKAudiogramSample *a in samples) {
            NSMutableArray *points = [NSMutableArray array];
            for (HKAudiogramSensitivityPoint *p in a.sensitivityPoints) {
                NSMutableDictionary *pt = [@{
                    @"frequency_hz": @([p.frequency doubleValueForUnit:hz]),
                } mutableCopy];
                if (p.leftEarSensitivity) pt[@"left_ear_db_hl"] = @([p.leftEarSensitivity doubleValueForUnit:dBHL]);
                if (p.rightEarSensitivity) pt[@"right_ear_db_hl"] = @([p.rightEarSensitivity doubleValueForUnit:dBHL]);
                [points addObject:pt];
            }
            [items addObject:@{
                @"start": noff_format_date(a.startDate),
                @"end": noff_format_date(a.endDate),
                @"sensitivity_points": points,
                @"source": sourceNameForSample(a),
            }];
        }

        NSDictionary *data = @{
            @"samples": items,
            @"count": @(items.count),
            @"range": @{@"start": noff_format_date(start), @"end": noff_format_date(end)},
        };
        noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"audiogram", data), compact, quiet);
        return NOFF_EXIT_SUCCESS;
    } else {
        noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"audiogram",
                       NOFF_ERR_INVALID_ARGS, @"Audiogram requires iOS 13+."), compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }
}

#pragma mark - vision-rx

static int cmd_vision_rx(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    if (@available(iOS 16.0, *)) {
        HKSampleType *visionType = [HKObjectType visionPrescriptionType];
        NSString *authErr = nil;
        if (!requestHealthKitAccess([NSSet setWithObject:visionType], nil, &authErr)) {
            noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"vision-rx",
                           NOFF_ERR_AUTHORIZATION_DENIED, authErr), compact, quiet);
            return NOFF_EXIT_AUTH_DENIED;
        }

        NSDate *start, *end;
        resolve_date_range(argc, argv, &start, &end);
        NSString *limitStr = noff_find_arg(argc, argv, "--limit");
        NSUInteger limit = limitStr ? (NSUInteger)[limitStr integerValue] : DEFAULT_LIMIT;

        NSPredicate *predicate = [HKQuery predicateForSamplesWithStartDate:start endDate:end options:HKQueryOptionStrictStartDate];
        NSSortDescriptor *sort = [NSSortDescriptor sortDescriptorWithKey:HKSampleSortIdentifierStartDate ascending:NO];
        NSError *visionSamplesErr = nil;
        NSArray<HKVisionPrescription *> *samples = querySamplesWithError(visionType, predicate, limit, @[sort], &visionSamplesErr);
        // [GH#128] Surface read failures instead of an empty result set.
        if (visionSamplesErr) {
            return hkEmitReadError(stdout_fd, @"vision-rx", @"vision prescription", visionSamplesErr, compact, quiet);
        }

        NSMutableArray *items = [NSMutableArray array];
        for (HKVisionPrescription *v in samples) {
            NSString *type;
            switch (v.prescriptionType) {
                case HKVisionPrescriptionTypeGlasses:  type = @"glasses"; break;
                case HKVisionPrescriptionTypeContacts: type = @"contacts"; break;
                default: type = @"unknown"; break;
            }
            [items addObject:@{
                @"date_issued": noff_format_date(v.dateIssued),
                @"expiration_date": v.expirationDate ? noff_format_date(v.expirationDate) : [NSNull null],
                @"prescription_type": type,
                @"source": sourceNameForSample(v),
            }];
        }

        NSDictionary *data = @{
            @"prescriptions": items,
            @"count": @(items.count),
            @"range": @{@"start": noff_format_date(start), @"end": noff_format_date(end)},
        };
        noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"vision-rx", data), compact, quiet);
        return NOFF_EXIT_SUCCESS;
    } else {
        noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"vision-rx",
                       NOFF_ERR_INVALID_ARGS, @"VisionPrescription requires iOS 16+."), compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }
}

#pragma mark - assessment (GAD-7 / PHQ-9)

static int cmd_assessment(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    if (@available(iOS 18.0, *)) {
        NSString *which = noff_find_arg(argc, argv, "--type"); // gad-7 | phq-9 | both
        BOOL wantGAD = !which || [[which lowercaseString] hasPrefix:@"gad"] || [which isEqualToString:@"both"];
        BOOL wantPHQ = !which || [[which lowercaseString] hasPrefix:@"phq"] || [which isEqualToString:@"both"];

        HKScoredAssessmentType *gadType = [HKObjectType scoredAssessmentTypeForIdentifier:HKScoredAssessmentTypeIdentifierGAD7];
        HKScoredAssessmentType *phqType = [HKObjectType scoredAssessmentTypeForIdentifier:HKScoredAssessmentTypeIdentifierPHQ9];

        NSMutableSet *readSet = [NSMutableSet set];
        if (wantGAD && gadType) [readSet addObject:gadType];
        if (wantPHQ && phqType) [readSet addObject:phqType];

        NSString *authErr = nil;
        if (!requestHealthKitAccess(readSet, nil, &authErr)) {
            noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"assessment",
                           NOFF_ERR_AUTHORIZATION_DENIED, authErr), compact, quiet);
            return NOFF_EXIT_AUTH_DENIED;
        }

        NSDate *start, *end;
        resolve_date_range(argc, argv, &start, &end);
        NSString *limitStr = noff_find_arg(argc, argv, "--limit");
        NSUInteger limit = limitStr ? (NSUInteger)[limitStr integerValue] : DEFAULT_LIMIT;
        NSPredicate *predicate = [HKQuery predicateForSamplesWithStartDate:start endDate:end options:HKQueryOptionStrictStartDate];
        NSSortDescriptor *sort = [NSSortDescriptor sortDescriptorWithKey:HKSampleSortIdentifierStartDate ascending:NO];

        NSMutableDictionary *data = [NSMutableDictionary dictionary];
        if (wantGAD && gadType) {
            NSError *gadRawErr = nil;
        NSArray<HKGAD7Assessment *> *raw = querySamplesWithError(gadType, predicate, limit, @[sort], &gadRawErr);
        // [GH#128] Surface read failures instead of an empty result set.
        if (gadRawErr) {
            return hkEmitReadError(stdout_fd, @"assessment", @"GAD-7 assessment", gadRawErr, compact, quiet);
        }
            NSMutableArray *out = [NSMutableArray array];
            for (HKGAD7Assessment *s in raw) {
                NSString *risk;
                switch (s.risk) {
                    case HKGAD7AssessmentRiskNoneToMinimal: risk = @"none-to-minimal"; break;
                    case HKGAD7AssessmentRiskMild:          risk = @"mild"; break;
                    case HKGAD7AssessmentRiskModerate:      risk = @"moderate"; break;
                    case HKGAD7AssessmentRiskSevere:        risk = @"severe"; break;
                    default: risk = @"unknown"; break;
                }
                [out addObject:@{
                    @"start": noff_format_date(s.startDate),
                    @"end": noff_format_date(s.endDate),
                    @"score": @(s.score),
                    @"risk": risk,
                    @"answers": s.answers ?: @[],
                    @"source": sourceNameForSample(s),
                }];
            }
            data[@"gad7"] = out;
        }
        if (wantPHQ && phqType) {
            NSError *phqRawErr = nil;
        NSArray<HKPHQ9Assessment *> *raw = querySamplesWithError(phqType, predicate, limit, @[sort], &phqRawErr);
        // [GH#128] Surface read failures instead of an empty result set.
        if (phqRawErr) {
            return hkEmitReadError(stdout_fd, @"assessment", @"PHQ-9 assessment", phqRawErr, compact, quiet);
        }
            NSMutableArray *out = [NSMutableArray array];
            for (HKPHQ9Assessment *s in raw) {
                NSString *risk;
                switch (s.risk) {
                    case HKPHQ9AssessmentRiskNoneToMinimal:    risk = @"none-to-minimal"; break;
                    case HKPHQ9AssessmentRiskMild:             risk = @"mild"; break;
                    case HKPHQ9AssessmentRiskModerate:         risk = @"moderate"; break;
                    case HKPHQ9AssessmentRiskModeratelySevere: risk = @"moderately-severe"; break;
                    case HKPHQ9AssessmentRiskSevere:           risk = @"severe"; break;
                    default: risk = @"unknown"; break;
                }
                [out addObject:@{
                    @"start": noff_format_date(s.startDate),
                    @"end": noff_format_date(s.endDate),
                    @"score": @(s.score),
                    @"risk": risk,
                    @"answers": s.answers ?: @[],
                    @"source": sourceNameForSample(s),
                }];
            }
            data[@"phq9"] = out;
        }
        data[@"range"] = @{@"start": noff_format_date(start), @"end": noff_format_date(end)};

        noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"assessment", data), compact, quiet);
        return NOFF_EXIT_SUCCESS;
    } else {
        noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"assessment",
                       NOFF_ERR_INVALID_ARGS, @"GAD-7 / PHQ-9 scored assessments require iOS 18+."), compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }
}

#pragma mark - state-of-mind

static int cmd_state_of_mind(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    if (@available(iOS 18.0, *)) {
        HKSampleType *somType = [HKObjectType stateOfMindType];
        NSString *authErr = nil;
        if (!requestHealthKitAccess([NSSet setWithObject:somType], nil, &authErr)) {
            noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"state-of-mind",
                           NOFF_ERR_AUTHORIZATION_DENIED, authErr), compact, quiet);
            return NOFF_EXIT_AUTH_DENIED;
        }

        NSDate *start, *end;
        resolve_date_range(argc, argv, &start, &end);
        NSString *limitStr = noff_find_arg(argc, argv, "--limit");
        NSUInteger limit = limitStr ? (NSUInteger)[limitStr integerValue] : DEFAULT_LIMIT;
        NSPredicate *predicate = [HKQuery predicateForSamplesWithStartDate:start endDate:end options:HKQueryOptionStrictStartDate];
        NSSortDescriptor *sort = [NSSortDescriptor sortDescriptorWithKey:HKSampleSortIdentifierStartDate ascending:NO];
        NSError *somSamplesErr = nil;
        NSArray<HKStateOfMind *> *samples = querySamplesWithError(somType, predicate, limit, @[sort], &somSamplesErr);
        // [GH#128] Surface read failures instead of an empty result set.
        if (somSamplesErr) {
            return hkEmitReadError(stdout_fd, @"state-of-mind", @"state of mind", somSamplesErr, compact, quiet);
        }

        NSMutableArray *items = [NSMutableArray array];
        for (HKStateOfMind *s in samples) {
            NSString *kind = s.kind == HKStateOfMindKindMomentaryEmotion ? @"momentary"
                          : s.kind == HKStateOfMindKindDailyMood        ? @"daily-mood"
                          : @"unknown";
            [items addObject:@{
                @"start": noff_format_date(s.startDate),
                @"end": noff_format_date(s.endDate),
                @"kind": kind,
                @"valence": @(s.valence),  // -1.0 (very unpleasant) to +1.0 (very pleasant)
                @"valence_classification": @(s.valenceClassification),
                @"labels": s.labels ?: @[],
                @"associations": s.associations ?: @[],
                @"source": sourceNameForSample(s),
            }];
        }

        NSDictionary *data = @{
            @"samples": items,
            @"count": @(items.count),
            @"range": @{@"start": noff_format_date(start), @"end": noff_format_date(end)},
            @"valence_scale": @"-1.0 very unpleasant ... 0 neutral ... +1.0 very pleasant",
        };
        noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"state-of-mind", data), compact, quiet);
        return NOFF_EXIT_SUCCESS;
    } else {
        noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"state-of-mind",
                       NOFF_ERR_INVALID_ARGS, @"State of Mind requires iOS 18+."), compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }
}

#pragma mark - batch (multi-metric read)

// Helper: per-metric quantity reader used by `batch`.
//   - Cumulative units (energy, distance, steps, flights, nutrition, ...) get
//     summed over the range and returned as `{type, sum, unit}`.
//   - Non-cumulative (discrete) units (heart rate, BMI, weight, ...) get the N
//     most recent samples, returned as `{type, samples:[...], latest_value}`.
//
// [T-healthkit-batch-nutrient-not-summed] Ask HealthKit itself for the
// aggregation style instead of maintaining a hand-curated allowlist. The old
// allowlist listed only 8 dietary types (energy/water/protein/carbs/fat/
// sodium/sugar/fiber/caffeine) and OMITTED every mineral and vitamin
// (calcium, iron, potassium, magnesium, zinc, cholesterol, all vitamins, …).
// Those omitted nutrients are cumulative in HealthKit, but batch treated them
// as discrete: it returned the latest N raw samples instead of the day's SUM,
// so a user logging a nutrient across several meals saw scattered single
// values (or 0 when the latest-N window / range query returned no rows) rather
// than the correct daily total. HKQuantityType.aggregationStyle is the
// authoritative source and automatically covers every present + future
// cumulative type.
static BOOL quantityIsCumulative(HKQuantityTypeIdentifier ident) {
    HKQuantityType *qType = [HKQuantityType quantityTypeForIdentifier:ident];
    if (qType == nil) return NO;
    // Primary source of truth: HealthKit's own aggregation style. Covers every
    // cumulative dietary nutrient (minerals, vitamins) the legacy allowlist
    // missed, plus steps/distance/energy/etc.
    if (qType.aggregationStyle == HKQuantityAggregationStyleCumulative) return YES;
    // These "activity time" types are DiscreteArithmetic in HealthKit but are
    // meaningfully SUMMED per day (total exercise/stand/move/daylight minutes);
    // the legacy allowlist summed them, so preserve that.
    static NSSet *summableDiscrete = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        NSMutableSet *m = [NSMutableSet setWithArray:@[
            HKQuantityTypeIdentifierAppleExerciseTime,
            HKQuantityTypeIdentifierAppleMoveTime,
            HKQuantityTypeIdentifierAppleStandTime,
        ]];
        if (@available(iOS 17.0, *)) {
            [m addObject:HKQuantityTypeIdentifierTimeInDaylight];
        }
        summableDiscrete = [m copy];
    });
    return [summableDiscrete containsObject:ident];
}

// Compute a single statistic (sum) over the date range. Synchronous.
// `outError` optional (GH#128). On failure/timeout the returned total is 0 and
// `*outError` is set — a caller that passes NULL keeps the old lossy behaviour.
static double sumQuantityOverRangeWithError(HKQuantityType *qType, HKUnit *unit,
                                             NSDate *start, NSDate *end,
                                             NSError **outError) {
    __block double total = 0;
    __block NSError *queryErr = nil;
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);
    NSPredicate *predicate = [HKQuery predicateForSamplesWithStartDate:start endDate:end
                                                               options:HKQueryOptionStrictStartDate];
    HKStatisticsQuery *q = [[HKStatisticsQuery alloc]
        initWithQuantityType:qType
             quantitySamplePredicate:predicate
                             options:HKStatisticsOptionCumulativeSum
                   completionHandler:^(HKStatisticsQuery *_q, HKStatistics *r, NSError *err) {
        if (err) {
            queryErr = err;
            dispatch_semaphore_signal(sem);
            return;
        }
        HKQuantity *sum = r.sumQuantity;
        // A unit mismatch here would raise an uncatchable-by-caller NSException
        // inside the HealthKit callback and abort the app — never convert blind.
        if (sum && [sum isCompatibleWithUnit:unit]) total = [sum doubleValueForUnit:unit];
        dispatch_semaphore_signal(sem);
    }];
    [healthStore() executeQuery:q];
    long waitResult = dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 15 * NSEC_PER_SEC));

    if (waitResult != 0) {
        if (outError) *outError = hkTimeoutError(qType.identifier);
        return 0;
    }
    if (queryErr) {
        if (outError) *outError = queryErr;
        return 0;
    }
    // Note: a nil sumQuantity with no error is a genuine "no samples in range"
    // and correctly yields 0 — that stays a success.
    if (outError) *outError = nil;
    return total;
}

// (No error-dropping `sumQuantityOverRange()` wrapper — see the note on
// querySamples above. Callers must take the out-error.)

static int cmd_batch(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    NSString *typesArg = noff_find_arg(argc, argv, "--types");
    if (!typesArg) typesArg = noff_find_arg(argc, argv, "--type"); // accept singular too
    if (!typesArg || typesArg.length == 0) {
        noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"batch",
                       NOFF_ERR_INVALID_ARGS,
                       @"Required: --types t1,t2,...  Pass a comma-separated list of metric names "
                        "(see `apple-healthkit types` for valid names). The batch command requests "
                        "authorization for all metrics in ONE prompt, then returns every metric's "
                        "data over the same date range in one envelope."),
                       compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    // [GH#106 Phase 2a] Alias table: every per-metric SUBCOMMAND name is a
    // valid --types token too, resolved to its registry name. The two
    // vocabularies previously diverged exactly here — `hrv` was a working
    // subcommand but an "unknown type" in batch (registry: hrv-sdnn), same
    // for blood-oxygen (registry: oxygen-saturation). Common synonyms ride
    // along. Composite subcommands that have no single backing sample type
    // are announced as unsupported_in_batch instead of "unknown + typo hint".
    static NSDictionary<NSString *, NSString *> *batchAliases = nil;
    static NSSet<NSString *> *batchUnsupported = nil;
    static dispatch_once_t aliasOnce;
    dispatch_once(&aliasOnce, ^{
        batchAliases = @{
            @"hrv": @"hrv-sdnn",
            @"heart-rate-variability": @"hrv-sdnn",
            @"blood-oxygen": @"oxygen-saturation",
            @"spo2": @"oxygen-saturation",
        };
        batchUnsupported = [NSSet setWithArray:@[
            @"cadence", @"elevation", @"workouts", @"nutrition", @"summary",
            @"ecg", @"audiogram", @"vision-rx", @"assessment", @"state-of-mind",
            @"characteristic",
        ]];
    });

    NSArray<NSString *> *rawNames = [typesArg componentsSeparatedByString:@","];
    NSMutableArray<NSString *> *quantityNames = [NSMutableArray array];   // requested (caller-facing) names
    NSMutableArray<NSString *> *categoryNames = [NSMutableArray array];
    NSMutableArray<NSString *> *unknownNames = [NSMutableArray array];
    NSMutableArray<NSString *> *unsupportedNames = [NSMutableArray array];
    // requested name → registry name, identity included; result entries stay
    // keyed by the REQUESTED token so `results[what-I-asked-for]` always hits.
    NSMutableDictionary<NSString *, NSString *> *resolvedNames = [NSMutableDictionary dictionary];
    NSMutableSet<HKObjectType *> *readSet = [NSMutableSet set];

    for (NSString *raw in rawNames) {
        NSString *name = [[raw stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]] lowercaseString];
        if (name.length == 0) continue;
        if ([batchUnsupported containsObject:name]) {
            [unsupportedNames addObject:name];
            continue;
        }
        NSString *resolved = batchAliases[name] ?: name;
        resolvedNames[name] = resolved;
        NSDictionary *qInfo = logQuantityTypeInfo(resolved);
        if (qInfo) {
            [quantityNames addObject:name];
            [readSet addObject:[HKQuantityType quantityTypeForIdentifier:qInfo[@"id"]]];
            continue;
        }
        NSDictionary *cInfo = logCategoryTypeInfo(resolved);
        if (cInfo) {
            [categoryNames addObject:name];
            [readSet addObject:[HKCategoryType categoryTypeForIdentifier:cInfo[@"id"]]];
            continue;
        }
        [unknownNames addObject:name];
    }

    if (readSet.count == 0) {
        NSMutableDictionary *err = [@{
            @"tool": TOOL_NAME, @"command": @"batch",
            @"error": @"None of the --types names were recognized.",
            @"unknown": unknownNames,
            @"hint": @"Run `apple-healthkit types` to see valid quantity/category names.",
        } mutableCopy];
        if (unsupportedNames.count > 0) {
            err[@"unsupported_in_batch"] = unsupportedNames;
            err[@"hint"] = @"Composite metrics (cadence, elevation, workouts, ...) have no single "
                            "sample type — run their standalone subcommand instead. For everything "
                            "else, run `apple-healthkit types` to see valid names.";
        }
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    // One authorization prompt for all requested metrics.
    NSString *authErr = nil;
    if (!requestHealthKitAccess(readSet, nil, &authErr)) {
        noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"batch",
                       NOFF_ERR_AUTHORIZATION_DENIED, authErr), compact, quiet);
        return NOFF_EXIT_AUTH_DENIED;
    }

    NSDate *start, *end;
    resolve_date_range(argc, argv, &start, &end);

    NSString *limitStr = noff_find_arg(argc, argv, "--limit");
    NSUInteger perTypeLimit = limitStr ? (NSUInteger)[limitStr integerValue] : 20;

    NSPredicate *rangePred = [HKQuery predicateForSamplesWithStartDate:start endDate:end
                                                               options:HKQueryOptionStrictStartDate];
    NSSortDescriptor *descSort = [NSSortDescriptor sortDescriptorWithKey:HKSampleSortIdentifierStartDate ascending:NO];

    NSMutableArray *warnings = [NSMutableArray array];

    // Unrecognized --types names are dropped (as before) but now also announced,
    // so a typo can't masquerade as an empty date range. Suggestion wording
    // matches the `log` command's unknown-type error.
    for (NSString *unknown in unknownNames) {
        NSString *suggestion = findClosestMatch(unknown,
            [allQuantityTypeNames() arrayByAddingObjectsFromArray:allCategoryTypeNames()]);
        NSString *msg;
        if (suggestion) {
            msg = [NSString stringWithFormat:
                @"Unknown type '%@' — dropped. Did you mean '%@'? "
                 "Run `apple-healthkit types` for valid names.", unknown, suggestion];
        } else {
            msg = [NSString stringWithFormat:
                @"Unknown type '%@' — dropped. "
                 "Run `apple-healthkit types` for valid names.", unknown];
        }
        appendWarning(warnings, @"unknown_type", msg, @[unknown]);
    }

    // [GH#106 Phase 2a] Composite subcommands can't be batched — say so
    // explicitly (with the escape hatch) instead of treating them as typos.
    for (NSString *unsupported in unsupportedNames) {
        appendWarning(warnings, @"unsupported_in_batch",
            [NSString stringWithFormat:
                @"'%@' is a composite metric with no single sample type — run "
                 "`apple-healthkit %@` directly instead.", unsupported, unsupported],
            @[unsupported]);
    }
    // Announce alias resolutions so output keys are traceable to input tokens.
    for (NSString *requested in resolvedNames) {
        NSString *resolved = resolvedNames[requested];
        if (![resolved isEqualToString:requested]) {
            appendWarning(warnings, @"alias_resolved",
                [NSString stringWithFormat:
                    @"'%@' accepted as '%@' (results are keyed by '%@').",
                    requested, resolved, requested],
                @[requested]);
        }
    }

    NSMutableDictionary *quantityResults = [NSMutableDictionary dictionary];
    for (NSString *name in quantityNames) {
        NSString *registryName = resolvedNames[name] ?: name;
        NSDictionary *info = logQuantityTypeInfo(registryName);
        HKQuantityType *qType = [HKQuantityType quantityTypeForIdentifier:info[@"id"]];
        HKUnit *unit = info[@"unit"];
        NSString *unitLabel = info[@"label"];
        // Convert HK storage unit back to the advertised display unit (GH#66):
        // without ×scale, percent types leaked the 0–1 fraction (body-fat 23.45%
        // printed as "0.23" with unit "%") and water leaked liters labeled "mL".
        double scale = [info[@"scale"] doubleValue];
        if (scale == 0.0) scale = 1.0;
        BOOL cumulative = quantityIsCumulative(info[@"id"]);

        NSMutableDictionary *entry = [@{
            @"unit": unitLabel ?: @"",
            @"desc": info[@"desc"] ?: @"",
            @"cumulative": @(cumulative),
        } mutableCopy];
        if (![registryName isEqualToString:name]) {
            entry[@"resolved_as"] = registryName;
        }

        if (cumulative) {
            // [GH#128] Mark the entry as failed instead of publishing sum:0,
            // which is indistinguishable from a real zero total.
            NSError *sumErr = nil;
            double total = sumQuantityOverRangeWithError(qType, unit, start, end, &sumErr) * scale;
            if (sumErr) {
                entry[@"error"] = hkReadErrorCode(sumErr);
                entry[@"error_message"] = hkReadErrorMessage(sumErr, name);
                appendWarning(warnings, @"read_failed",
                              hkReadErrorMessage(sumErr, name), @[name]);
                quantityResults[name] = entry;
                continue;
            }
            entry[@"sum"] = @(noff_round4(total));
        } else {
            NSError *readErr = nil;
            NSArray *samples = querySamplesWithError(qType, rangePred, perTypeLimit, @[descSort], &readErr);
            if (readErr) {
                entry[@"error"] = hkReadErrorCode(readErr);
                entry[@"error_message"] = hkReadErrorMessage(readErr, name);
                appendWarning(warnings, @"read_failed",
                              hkReadErrorMessage(readErr, name), @[name]);
                quantityResults[name] = entry;
                continue;
            }
            // [GH#106 Phase 2c] Duplicate `value` under the metric's natural
            // unit key (ms / bpm / kg / kcal / steps / ...) so parsers written
            // against the per-metric subcommands (which use those keys) read
            // batch output unchanged. `value` stays for existing batch
            // consumers — additive, not a rename. Only simple alphabetic
            // labels qualify; symbolic units (%, mg/dL, °C, /min) don't map
            // to a stable key and are skipped.
            NSString *metricKey = nil;
            if (unitLabel.length > 0 && unitLabel.length <= 8 &&
                ![unitLabel isEqualToString:@"count"] && ![unitLabel isEqualToString:@"value"]) {
                NSCharacterSet *nonAlpha = [[NSCharacterSet characterSetWithCharactersInString:
                    @"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"] invertedSet];
                if ([unitLabel rangeOfCharacterFromSet:nonAlpha].location == NSNotFound) {
                    metricKey = unitLabel;
                }
            }
            NSMutableArray *items = [NSMutableArray array];
            for (HKQuantitySample *s in samples) {
                // Skip samples whose stored unit can't convert to the table unit
                // instead of letting doubleValueForUnit: throw and kill the app.
                if (![s.quantity isCompatibleWithUnit:unit]) continue;
                double v = [s.quantity doubleValueForUnit:unit] * scale;
                NSMutableDictionary *item = [@{
                    @"date": noff_format_date(s.startDate),
                    @"value": @(noff_round4(v)),
                    @"source": sourceNameForSample(s),
                } mutableCopy];
                if (metricKey) item[metricKey] = @(noff_round4(v));
                [items addObject:item];
            }
            entry[@"samples"] = items;
            entry[@"count"] = @(items.count);
            if (items.count > 0) {
                entry[@"latest_value"] = items.firstObject[@"value"];
                entry[@"latest_date"]  = items.firstObject[@"date"];
            }
            // Only pay for countSamples() when the cap was actually hit. It runs an
            // unlimited query with a 15s semaphore wait, and batch fans out over
            // every requested type — ungated that would be one extra full query per
            // type. Same gate the single commands use.
            if (items.count >= perTypeLimit) {
                NSUInteger total = countSamples(qType, rangePred);
                addTruncationWarning(entry, items.count, total);
                if (total > items.count) {
                    appendWarning(warnings, @"results_truncated",
                        [NSString stringWithFormat:
                            @"%@: returned %lu of %lu records (--limit %lu).",
                            name, (unsigned long)items.count,
                            (unsigned long)total, (unsigned long)perTypeLimit],
                        @[name]);
                }
            }
        }
        quantityResults[name] = entry;
    }

    NSMutableDictionary *categoryResults = [NSMutableDictionary dictionary];
    for (NSString *name in categoryNames) {
        NSString *registryName = resolvedNames[name] ?: name;
        NSDictionary *info = logCategoryTypeInfo(registryName);
        HKCategoryType *cType = [HKCategoryType categoryTypeForIdentifier:info[@"id"]];
        // [GH#128] Same per-type failure marking as the quantity loop — a locked
        // store must not render as "0 sleep segments".
        NSError *catErr = nil;
        NSArray<HKCategorySample *> *samples = querySamplesWithError(cType, rangePred, perTypeLimit, @[descSort], &catErr);
        if (catErr) {
            categoryResults[name] = [@{
                @"desc": info[@"desc"] ?: @"",
                @"error": hkReadErrorCode(catErr),
                @"error_message": hkReadErrorMessage(catErr, name),
            } mutableCopy];
            appendWarning(warnings, @"read_failed",
                          hkReadErrorMessage(catErr, name), @[name]);
            continue;
        }
        NSMutableArray *items = [NSMutableArray array];
        for (HKCategorySample *s in samples) {
            [items addObject:@{
                @"start": noff_format_date(s.startDate),
                @"end": noff_format_date(s.endDate),
                @"value": @(s.value),
                @"source": sourceNameForSample(s),
            }];
        }
        NSMutableDictionary *cEntry = [@{
            @"desc": info[@"desc"] ?: @"",
            @"samples": items,
            @"count": @(items.count),
        } mutableCopy];
        if (![registryName isEqualToString:name]) {
            cEntry[@"resolved_as"] = registryName;
        }
        // Category results were capped by --limit with no indication at all —
        // sleep in particular runs 40-100+ segments per night, so a multi-day
        // range silently lost data. Same gate as the quantity loop above.
        if (items.count >= perTypeLimit) {
            NSUInteger total = countSamples(cType, rangePred);
            addTruncationWarning(cEntry, items.count, total);
            if (total > items.count) {
                appendWarning(warnings, @"results_truncated",
                    [NSString stringWithFormat:
                        @"%@: returned %lu of %lu records (--limit %lu).",
                        name, (unsigned long)items.count,
                        (unsigned long)total, (unsigned long)perTypeLimit],
                    @[name]);
            }
        }
        categoryResults[name] = cEntry;
    }

    NSMutableDictionary *data = [@{
        @"range": @{
            @"start": noff_format_date(start),
            @"end": noff_format_date(end),
        },
        @"requested_count": @(quantityNames.count + categoryNames.count),
        @"quantity": quantityResults,
        @"category": categoryResults,
    } mutableCopy];
    // `unknown_types` is retained for backward compatibility; `warnings` is the
    // structured form and appears only when there is something to report.
    if (unknownNames.count > 0) data[@"unknown_types"] = unknownNames;
    if (warnings.count > 0) data[@"warnings"] = warnings;

    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"batch", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

// ── Main handler ──

static int healthkit_handler(int argc, char **argv,
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

    if ([subcmd isEqualToString:@"steps"])        return cmd_steps(argc, argv, stdout_fd, compact, quiet);
    if ([subcmd isEqualToString:@"basal-energy"]) return cmd_basal_energy(argc, argv, stdout_fd, compact, quiet);
    if ([subcmd isEqualToString:@"heart-rate"])    return cmd_heart_rate(argc, argv, stdout_fd, compact, quiet);
    if ([subcmd isEqualToString:@"sleep"])         return cmd_sleep(argc, argv, stdout_fd, compact, quiet);
    if ([subcmd isEqualToString:@"workouts"])      return cmd_workouts(argc, argv, stdout_fd, compact, quiet);
    if ([subcmd isEqualToString:@"cadence"])       return cmd_cadence(argc, argv, stdout_fd, compact, quiet);
    if ([subcmd isEqualToString:@"elevation"])     return cmd_elevation(argc, argv, stdout_fd, compact, quiet);
    if ([subcmd isEqualToString:@"weight"])        return cmd_weight(argc, argv, stdout_fd, compact, quiet);
    if ([subcmd isEqualToString:@"blood-oxygen"])  return cmd_blood_oxygen(argc, argv, stdout_fd, compact, quiet);
    if ([subcmd isEqualToString:@"blood-glucose"]) return cmd_blood_glucose(argc, argv, stdout_fd, compact, quiet);
    if ([subcmd isEqualToString:@"hrv"])           return cmd_hrv(argc, argv, stdout_fd, compact, quiet);
    if ([subcmd isEqualToString:@"resting-heart-rate"]) return cmd_resting_heart_rate(argc, argv, stdout_fd, compact, quiet);
    if ([subcmd isEqualToString:@"vo2-max"])       return cmd_vo2_max(argc, argv, stdout_fd, compact, quiet);
    if ([subcmd isEqualToString:@"nutrition"])     return cmd_nutrition(argc, argv, stdout_fd, stderr_fd, compact, quiet);
    if ([subcmd isEqualToString:@"summary"])       return cmd_summary(argc, argv, stdout_fd, compact, quiet);
    if ([subcmd isEqualToString:@"types"])         return cmd_types(argc, argv, stdout_fd, compact, quiet);
    if ([subcmd isEqualToString:@"log"])           return cmd_log(argc, argv, stdout_fd, stderr_fd, compact, quiet);
    if ([subcmd isEqualToString:@"log-blood-pressure"]) return cmd_log_blood_pressure(argc, argv, stdout_fd, compact, quiet);
    if ([subcmd isEqualToString:@"delete"])        return cmd_delete(argc, argv, stdout_fd, stderr_fd, compact, quiet);
    if ([subcmd isEqualToString:@"characteristic"]) return cmd_characteristic(argc, argv, stdout_fd, compact, quiet);
    if ([subcmd isEqualToString:@"ecg"])           return cmd_ecg(argc, argv, stdout_fd, compact, quiet);
    if ([subcmd isEqualToString:@"audiogram"])     return cmd_audiogram(argc, argv, stdout_fd, compact, quiet);
    if ([subcmd isEqualToString:@"vision-rx"])     return cmd_vision_rx(argc, argv, stdout_fd, compact, quiet);
    if ([subcmd isEqualToString:@"assessment"])    return cmd_assessment(argc, argv, stdout_fd, compact, quiet);
    if ([subcmd isEqualToString:@"state-of-mind"]) return cmd_state_of_mind(argc, argv, stdout_fd, compact, quiet);
    if ([subcmd isEqualToString:@"batch"])         return cmd_batch(argc, argv, stdout_fd, compact, quiet);

    noff_emit_help(stderr_fd, HELP_TEXT);
    NSDictionary *err = noff_json_error(TOOL_NAME, subcmd,
                                         NOFF_ERR_INVALID_ARGS,
                                         [NSString stringWithFormat:@"Unknown command '%@'. Valid commands: steps, basal-energy, heart-rate, resting-heart-rate, vo2-max, sleep, workouts, cadence, elevation, weight, blood-oxygen, blood-glucose, hrv, nutrition, summary, types, log, log-blood-pressure, delete, batch, characteristic, ecg, audiogram, vision-rx, assessment, state-of-mind. Use --help for details.", subcmd]);
    noff_emit_json(stdout_fd, err, compact, quiet);
    return NOFF_EXIT_INVALID_ARGS;
}

void healthkit_offload_register(void) {
    int err = native_offload_add_handler("apple-healthkit", healthkit_handler);
    if (err == 0) {
        noff_ensure_guest_stub("/usr/local/bin/apple-healthkit");
        NSLog(@"NativeOffloads: apple-healthkit handler registered");
    } else {
        NSLog(@"NativeOffloads: failed to register apple-healthkit handler (err=%d)", err);
    }
}
