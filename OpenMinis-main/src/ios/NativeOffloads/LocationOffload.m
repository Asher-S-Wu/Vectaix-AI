//
//  LocationOffload.m
//  MinisApp
//
//  Native offload handler for `apple-location`.
//  Subcommands: current, geocode, forward
//

#import <Foundation/Foundation.h>
#import <CoreLocation/CoreLocation.h>
#import "NativeOffloadUtils.h"
#import "CoordinateUtils.h"
#include "kernel/native_offload.h"
#include <unistd.h>

static NSString *const TOOL_NAME = @"apple-location";

static NSString *const HELP_TEXT =
    @"apple-location - Get device location and geocoding\n"
     "\n"
     "USAGE:\n"
     "  apple-location [command] [options]\n"
     "\n"
     "COMMANDS:\n"
     "  current    Get current device location (default when no command given)\n"
     "  geocode    Reverse geocode coordinates to address\n"
     "  forward    Forward geocode address to coordinates\n"
     "\n"
     "OPTIONS:\n"
     "  --help, -h          Show this help message\n"
     "  --compact           Minimize JSON output\n"
     "  -q, --quiet         Output only data field\n"
     "  --accuracy <level>  Accuracy: best, near, km (default: best)\n"
     "  --lat <latitude>    Latitude for geocode\n"
     "  --lng <longitude>   Longitude for geocode\n"
     "  --address <addr>    Address string for forward geocode\n"
     "\n"
     "EXAMPLES:\n"
     "  apple-location                  (same as: apple-location current)\n"
     "  apple-location current --accuracy near --compact -q\n"
     "  apple-location geocode --lat 31.2304 --lng 121.4737\n"
     "  apple-location forward --address \"1 Apple Park Way, Cupertino\"\n";

// ── CLLocationManager delegate for synchronous location fetch ──

@interface NoffLocationDelegate : NSObject <CLLocationManagerDelegate>
@property (nonatomic, strong) CLLocation *location;
@property (nonatomic, strong) NSError *error;
@property (nonatomic, strong) dispatch_semaphore_t semaphore;
@end

@implementation NoffLocationDelegate

- (instancetype)init {
    self = [super init];
    if (self) {
        _semaphore = dispatch_semaphore_create(0);
    }
    return self;
}

- (void)locationManager:(CLLocationManager *)manager didUpdateLocations:(NSArray<CLLocation *> *)locations {
    self.location = locations.lastObject;
    dispatch_semaphore_signal(self.semaphore);
}

- (void)locationManager:(CLLocationManager *)manager didFailWithError:(NSError *)error {
    self.error = error;
    dispatch_semaphore_signal(self.semaphore);
}

@end

static NSDictionary *placemark_to_dict(CLPlacemark *pm) {
    NSMutableDictionary *addr = [NSMutableDictionary dictionary];
    if (pm.name) addr[@"name"] = pm.name;
    if (pm.locality) addr[@"locality"] = pm.locality;
    if (pm.subLocality) addr[@"sub_locality"] = pm.subLocality;
    if (pm.administrativeArea) addr[@"administrative_area"] = pm.administrativeArea;
    if (pm.country) addr[@"country"] = pm.country;
    if (pm.ISOcountryCode) addr[@"country_code"] = pm.ISOcountryCode;
    if (pm.postalCode) addr[@"postal_code"] = pm.postalCode;
    if (pm.thoroughfare) addr[@"street"] = pm.thoroughfare;
    if (pm.subThoroughfare) addr[@"street_number"] = pm.subThoroughfare;
    return addr;
}

static int cmd_current(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    __block CLLocationManager *manager;
    __block NoffLocationDelegate *delegate;

    // CLLocationManager must be created on a thread with a run loop.
    // We dispatch to the main thread for setup and use semaphore for sync wait.
    delegate = [[NoffLocationDelegate alloc] init];

    dispatch_async(dispatch_get_main_queue(), ^{
        manager = [[CLLocationManager alloc] init];
        manager.delegate = delegate;

        NSString *accuracy = noff_find_arg(argc, argv, "--accuracy");
        if ([accuracy isEqualToString:@"km"]) {
            manager.desiredAccuracy = kCLLocationAccuracyKilometer;
        } else if ([accuracy isEqualToString:@"near"]) {
            manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters;
        } else {
            manager.desiredAccuracy = kCLLocationAccuracyBest;
        }

        CLAuthorizationStatus status = manager.authorizationStatus;
        if (status == kCLAuthorizationStatusNotDetermined) {
            [manager requestWhenInUseAuthorization];
            // Give the auth dialog a moment, then request location
            dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC),
                           dispatch_get_main_queue(), ^{
                [manager requestLocation];
            });
        } else if (status == kCLAuthorizationStatusAuthorizedWhenInUse ||
                   status == kCLAuthorizationStatusAuthorizedAlways) {
            [manager requestLocation];
        } else {
            delegate.error = [NSError errorWithDomain:@"NativeOffload" code:3
                               userInfo:@{NSLocalizedDescriptionKey:
                                   @"Location access denied. To grant access, open "
                                    "Settings > Privacy & Security > Location Services "
                                    "and enable Minis."}];
            dispatch_semaphore_signal(delegate.semaphore);
        }
    });

    // Wait up to 15s for a location fix
    dispatch_semaphore_wait(delegate.semaphore,
                            dispatch_time(DISPATCH_TIME_NOW, 15 * NSEC_PER_SEC));

    if (delegate.error || !delegate.location) {
        NSString *msg = delegate.error.localizedDescription ?: @"Location request timed out";
        NSString *code = delegate.error.code == 3 ? NOFF_ERR_AUTHORIZATION_DENIED : NOFF_ERR_NOT_AVAILABLE;
        NSDictionary *err = noff_json_error(TOOL_NAME, @"current", code, msg);
        noff_emit_json(stdout_fd, err, compact, quiet);
        return delegate.error.code == 3 ? NOFF_EXIT_AUTH_DENIED : NOFF_EXIT_NOT_AVAILABLE;
    }

    CLLocation *loc = delegate.location;
    NSMutableDictionary *data = [NSMutableDictionary dictionary];
    data[@"latitude"] = @(loc.coordinate.latitude);
    data[@"longitude"] = @(loc.coordinate.longitude);
    data[@"altitude_m"] = @(loc.altitude);
    data[@"accuracy_m"] = @(loc.horizontalAccuracy);
    data[@"speed_mps"] = @(loc.speed >= 0 ? loc.speed : 0);
    data[@"course_deg"] = @(loc.course);
    data[@"timestamp"] = noff_format_date(loc.timestamp);
    data[@"coordinate_system"] = @"WGS-84";
    if (loc.floor) data[@"floor"] = @(loc.floor.level);

    // Add GCJ-02 coordinates when in mainland China
    if (!gcj_isOutOfChina(loc.coordinate.latitude, loc.coordinate.longitude)) {
        CLLocationCoordinate2D gcj = wgs84_to_gcj02(loc.coordinate.latitude, loc.coordinate.longitude);
        data[@"gcj02_latitude"] = @(gcj.latitude);
        data[@"gcj02_longitude"] = @(gcj.longitude);
        data[@"gcj02_note"] = @"Use gcj02_* coordinates with Chinese map services (Amap, Baidu, Apple Maps China)";
    }

    // Auto reverse-geocode
    dispatch_semaphore_t geoSem = dispatch_semaphore_create(0);
    CLGeocoder *geocoder = [[CLGeocoder alloc] init];
    __block CLPlacemark *placemark = nil;
    [geocoder reverseGeocodeLocation:loc completionHandler:^(NSArray<CLPlacemark *> *placemarks, NSError *err) {
        placemark = placemarks.firstObject;
        dispatch_semaphore_signal(geoSem);
    }];
    dispatch_semaphore_wait(geoSem, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC));

    if (placemark) {
        data[@"address"] = placemark_to_dict(placemark);
    }

    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"current", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

static int cmd_geocode(int argc, char **argv, int stdout_fd, int stderr_fd, BOOL compact, BOOL quiet) {
    NSString *latStr = noff_find_arg(argc, argv, "--lat");
    NSString *lngStr = noff_find_arg(argc, argv, "--lng");

    if (!latStr || !lngStr) {
        noff_emit_help(stderr_fd, HELP_TEXT);
        NSDictionary *err = noff_json_error(TOOL_NAME, @"geocode",
                                             NOFF_ERR_INVALID_ARGS,
                                             @"Required: --lat <latitude> --lng <longitude>");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    CLLocation *loc = [[CLLocation alloc] initWithLatitude:[latStr doubleValue]
                                                 longitude:[lngStr doubleValue]];

    dispatch_semaphore_t sem = dispatch_semaphore_create(0);
    CLGeocoder *geocoder = [[CLGeocoder alloc] init];
    __block NSArray<CLPlacemark *> *results = nil;
    __block NSError *geoError = nil;

    [geocoder reverseGeocodeLocation:loc completionHandler:^(NSArray<CLPlacemark *> *placemarks, NSError *error) {
        results = placemarks;
        geoError = error;
        dispatch_semaphore_signal(sem);
    }];
    dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC));

    if (geoError || !results.count) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"geocode",
                                             NOFF_ERR_NO_DATA,
                                             geoError.localizedDescription ?: @"No results found");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_ERROR;
    }

    NSMutableArray *addresses = [NSMutableArray array];
    for (CLPlacemark *pm in results) {
        [addresses addObject:placemark_to_dict(pm)];
    }

    NSDictionary *data = @{
        @"latitude": @([latStr doubleValue]),
        @"longitude": @([lngStr doubleValue]),
        @"addresses": addresses,
        @"count": @(addresses.count),
    };
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"geocode", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

static int cmd_forward(int argc, char **argv, int stdout_fd, int stderr_fd, BOOL compact, BOOL quiet) {
    NSString *address = noff_find_arg(argc, argv, "--address");
    if (!address) {
        noff_emit_help(stderr_fd, HELP_TEXT);
        NSDictionary *err = noff_json_error(TOOL_NAME, @"forward",
                                             NOFF_ERR_INVALID_ARGS,
                                             @"Required: --address <address>");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    dispatch_semaphore_t sem = dispatch_semaphore_create(0);
    CLGeocoder *geocoder = [[CLGeocoder alloc] init];
    __block NSArray<CLPlacemark *> *results = nil;
    __block NSError *geoError = nil;

    [geocoder geocodeAddressString:address completionHandler:^(NSArray<CLPlacemark *> *placemarks, NSError *error) {
        results = placemarks;
        geoError = error;
        dispatch_semaphore_signal(sem);
    }];
    dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC));

    if (geoError || !results.count) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"forward",
                                             NOFF_ERR_NO_DATA,
                                             geoError.localizedDescription ?: @"No results found");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_ERROR;
    }

    NSMutableArray *locations = [NSMutableArray array];
    for (CLPlacemark *pm in results) {
        NSMutableDictionary *d = [NSMutableDictionary dictionaryWithDictionary:placemark_to_dict(pm)];
        d[@"latitude"] = @(pm.location.coordinate.latitude);
        d[@"longitude"] = @(pm.location.coordinate.longitude);
        [locations addObject:d];
    }

    NSDictionary *data = @{
        @"query": address,
        @"locations": locations,
        @"count": @(locations.count),
    };
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"forward", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

static int location_handler(int argc, char **argv,
                              int stdin_fd, int stdout_fd, int stderr_fd) {
    if (noff_has_flag(argc, argv, "--help") || noff_has_flag(argc, argv, "-h")) {
        noff_emit_help(stderr_fd, HELP_TEXT);
        return NOFF_EXIT_SUCCESS;
    }

    BOOL compact = noff_has_flag(argc, argv, "--compact");
    BOOL quiet = noff_has_flag(argc, argv, "-q") || noff_has_flag(argc, argv, "--quiet");

    NSString *subcmd = noff_get_subcommand(argc, argv);
    if (!subcmd) {
        // [T-location-default-current-ios] Bare `apple-location` (including
        // flags-only invocations — noff_get_subcommand returns nil when argv
        // has no non-flag token) defaults to `current` instead of erroring:
        // the overwhelmingly common intent is "where am I".
        subcmd = @"current";
    }

    if ([subcmd isEqualToString:@"current"])  return cmd_current(argc, argv, stdout_fd, compact, quiet);
    if ([subcmd isEqualToString:@"geocode"])  return cmd_geocode(argc, argv, stdout_fd, stderr_fd, compact, quiet);
    if ([subcmd isEqualToString:@"forward"])  return cmd_forward(argc, argv, stdout_fd, stderr_fd, compact, quiet);

    noff_emit_help(stderr_fd, HELP_TEXT);
    NSDictionary *err = noff_json_error(TOOL_NAME, subcmd,
                                         NOFF_ERR_INVALID_ARGS,
                                         [NSString stringWithFormat:@"Unknown command '%@'. Valid commands: current, forward, geocode. Use --help for details.", subcmd]);
    noff_emit_json(stdout_fd, err, compact, quiet);
    return NOFF_EXIT_INVALID_ARGS;
}

void location_offload_register(void) {
    int err = native_offload_add_handler("apple-location", location_handler);
    if (err == 0) {
        noff_ensure_guest_stub("/usr/local/bin/apple-location");
        NSLog(@"NativeOffloads: apple-location handler registered");
    } else {
        NSLog(@"NativeOffloads: failed to register apple-location handler (err=%d)", err);
    }
}
