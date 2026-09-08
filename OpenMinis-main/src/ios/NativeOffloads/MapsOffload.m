//
//  MapsOffload.m
//  MinisApp
//
//  Native offload handler for `apple-maps`.
//  Subcommands: search, route, eta
//

#import <Foundation/Foundation.h>
#import <MapKit/MapKit.h>
#import <CoreLocation/CoreLocation.h>
#import <UIKit/UIKit.h>
#import "NativeOffloadUtils.h"
#import "CoordinateUtils.h"
#include "kernel/native_offload.h"
#include <unistd.h>

static NSString *const TOOL_NAME = @"apple-maps";

static NSString *const HELP_TEXT =
    @"apple-maps - Search places, get directions, and estimate travel times\n"
     "\n"
     "USAGE:\n"
     "  apple-maps <command> [options]\n"
     "\n"
     "COMMANDS:\n"
     "  search      Search for places and points of interest\n"
     "  route       Get directions between two points\n"
     "  eta         Get estimated travel time (lightweight)\n"
     "\n"
     "COMMON OPTIONS:\n"
     "  --help, -h           Show this help message\n"
     "  --compact            Minimize JSON output\n"
     "  -q, --quiet          Output only data field\n"
     "\n"
     "SEARCH OPTIONS:\n"
     "  --query <text>       Search query (required)\n"
     "  --lat <degrees>      Center latitude (required)\n"
     "  --lon <degrees>      Center longitude (required)\n"
     "  --radius <m>         Search radius in meters (default 1000)\n"
     "  --limit <N>          Maximum results (default 10)\n"
     "\n"
     "ROUTE / ETA OPTIONS:\n"
     "  --from <addr|lat,lon>  Origin (required)\n"
     "  --to <addr|lat,lon>    Destination (required)\n"
     "  --mode <mode>          Transport: driving, walking, transit (default driving)\n"
     "\n"
     "EXAMPLES:\n"
     "  apple-maps search --query \"coffee shops\" --lat 37.7749 --lon -122.4194\n"
     "  apple-maps search --query \"gas station\" --radius 500 --limit 5\n"
     "  apple-maps route --from \"San Francisco\" --to \"Los Angeles\" --mode driving\n"
     "  apple-maps route --from 37.7749,-122.4194 --to 34.0522,-118.2437\n"
     "  apple-maps eta --from \"New York\" --to \"Boston\" --mode transit\n";

// ── Helpers ──

/// Try to parse a "lat,lon" string. Returns YES if successful.
static BOOL parse_lat_lon(NSString *str, CLLocationCoordinate2D *outCoord) {
    NSArray *parts = [str componentsSeparatedByString:@","];
    if (parts.count != 2) return NO;

    NSString *latStr = [parts[0] stringByTrimmingCharactersInSet:
                        [NSCharacterSet whitespaceCharacterSet]];
    NSString *lonStr = [parts[1] stringByTrimmingCharactersInSet:
                        [NSCharacterSet whitespaceCharacterSet]];

    NSScanner *latScanner = [NSScanner scannerWithString:latStr];
    NSScanner *lonScanner = [NSScanner scannerWithString:lonStr];
    double lat, lon;

    if (![latScanner scanDouble:&lat] || !latScanner.isAtEnd) return NO;
    if (![lonScanner scanDouble:&lon] || !lonScanner.isAtEnd) return NO;

    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return NO;

    outCoord->latitude = lat;
    outCoord->longitude = lon;
    return YES;
}

/// Geocode an address string synchronously. Returns kCLLocationCoordinate2DInvalid on failure.
static CLLocationCoordinate2D geocode_address(NSString *address) {
    __block CLLocationCoordinate2D result = kCLLocationCoordinate2DInvalid;
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);

    CLGeocoder *geocoder = [[CLGeocoder alloc] init];
    [geocoder geocodeAddressString:address completionHandler:^(NSArray<CLPlacemark *> *placemarks, NSError *error) {
        if (placemarks.count > 0) {
            CLPlacemark *place = placemarks.firstObject;
            result = place.location.coordinate;
        }
        dispatch_semaphore_signal(sem);
    }];
    dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 15 * NSEC_PER_SEC));

    return result;
}

/// Resolve a location string (either "lat,lon" or address) to a coordinate.
static CLLocationCoordinate2D resolve_location(NSString *str) {
    CLLocationCoordinate2D coord;
    if (parse_lat_lon(str, &coord)) {
        return coord;
    }
    return geocode_address(str);
}

/// Map mode string to MKDirectionsTransportType.
static MKDirectionsTransportType transport_type_for_mode(NSString *mode) {
    if ([mode isEqualToString:@"walking"])  return MKDirectionsTransportTypeWalking;
    if ([mode isEqualToString:@"transit"])  return MKDirectionsTransportTypeTransit;
    return MKDirectionsTransportTypeAutomobile; // default: driving
}

// ── Subcommands ──

static int cmd_search(int argc, char **argv, int stdout_fd, int stderr_fd, BOOL compact, BOOL quiet) {
    NSString *query = noff_find_arg(argc, argv, "--query");
    if (!query) {
        noff_emit_help(stderr_fd, HELP_TEXT);
        NSDictionary *err = noff_json_error(TOOL_NAME, @"search",
                                             NOFF_ERR_INVALID_ARGS,
                                             @"Required: --query");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    NSString *latStr = noff_find_arg(argc, argv, "--lat") ?: noff_find_arg(argc, argv, "--latitude");
    NSString *lonStr = noff_find_arg(argc, argv, "--lon") ?: noff_find_arg(argc, argv, "--longitude");
    NSString *radiusStr = noff_find_arg(argc, argv, "--radius");
    NSString *limitStr = noff_find_arg(argc, argv, "--limit");

    double radiusM = radiusStr ? [radiusStr doubleValue] : 1000.0;
    NSInteger limit = limitStr ? [limitStr integerValue] : 10;
    if (limit <= 0) limit = 10;

    if (!latStr || !lonStr) {
        noff_emit_help(stderr_fd, HELP_TEXT);
        NSDictionary *err = noff_json_error(TOOL_NAME, @"search",
                                             NOFF_ERR_INVALID_ARGS,
                                             @"Required: --lat and --lon");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    CLLocationCoordinate2D center = CLLocationCoordinate2DMake([latStr doubleValue], [lonStr doubleValue]);

    // MapKit objects (MKMapItem, MKLocalSearch, etc.) must be created and
    // released on the main thread to avoid crashes in NSNotificationCenter
    // during dealloc. Dispatch the entire MapKit operation to main.
    __block NSDictionary *resultData = nil;
    __block NSString *errorMsg = nil;
    dispatch_semaphore_t mainSem = dispatch_semaphore_create(0);

    dispatch_async(dispatch_get_main_queue(), ^{
        MKLocalSearchRequest *request = [[MKLocalSearchRequest alloc] init];
        request.naturalLanguageQuery = query;

        MKCoordinateRegion region = MKCoordinateRegionMakeWithDistance(center,
                                                                       radiusM * 2,
                                                                       radiusM * 2);
        request.region = region;

        MKLocalSearch *search = [[MKLocalSearch alloc] initWithRequest:request];
        [search startWithCompletionHandler:^(MKLocalSearchResponse *response, NSError *error) {
            if (error || !response) {
                errorMsg = error.localizedDescription ?: @"Search returned no results";
                dispatch_semaphore_signal(mainSem);
                return;
            }

            NSArray<MKMapItem *> *items = response.mapItems;
            if ((NSInteger)items.count > limit) {
                items = [items subarrayWithRange:NSMakeRange(0, limit)];
            }

            CLLocation *centerLoc = [[CLLocation alloc] initWithLatitude:center.latitude
                                                                       longitude:center.longitude];

            NSMutableArray *results = [NSMutableArray array];
            for (MKMapItem *item in items) {
                NSMutableDictionary *d = [NSMutableDictionary dictionary];
                d[@"name"] = item.name ?: @"";

                // Build address string from placemark
                MKPlacemark *pm = item.placemark;
                NSMutableArray *addrParts = [NSMutableArray array];
                if (pm.subThoroughfare) [addrParts addObject:pm.subThoroughfare];
                if (pm.thoroughfare) [addrParts addObject:pm.thoroughfare];
                if (pm.locality) [addrParts addObject:pm.locality];
                if (pm.administrativeArea) [addrParts addObject:pm.administrativeArea];
                if (pm.postalCode) [addrParts addObject:pm.postalCode];
                if (pm.country) [addrParts addObject:pm.country];
                d[@"address"] = addrParts.count > 0 ? [addrParts componentsJoinedByString:@", "] : @"";

                d[@"lat"] = @(item.placemark.coordinate.latitude);
                d[@"lon"] = @(item.placemark.coordinate.longitude);
                if (!gcj_isOutOfChina(center.latitude, center.longitude)) {
                    d[@"coordinate_system"] = @"GCJ-02";
                }
                d[@"phone"] = item.phoneNumber ?: [NSNull null];
                d[@"url"] = item.url.absoluteString ?: [NSNull null];

                if (@available(iOS 13.0, *)) {
                    d[@"category"] = item.pointOfInterestCategory ?: [NSNull null];
                } else {
                    d[@"category"] = [NSNull null];
                }

                CLLocation *itemLoc = [[CLLocation alloc]
                    initWithLatitude:item.placemark.coordinate.latitude
                           longitude:item.placemark.coordinate.longitude];
                double distM = [centerLoc distanceFromLocation:itemLoc];
                d[@"distance_m"] = @((int)round(distM));

                [results addObject:d];
            }

            resultData = @{
                @"results": results,
                @"count": @(results.count),
                @"query": query,
            };
            dispatch_semaphore_signal(mainSem);
        }];
    });
    dispatch_semaphore_wait(mainSem, dispatch_time(DISPATCH_TIME_NOW, 20 * NSEC_PER_SEC));

    if (errorMsg || !resultData) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"search",
                                             NOFF_ERR_INTERNAL_ERROR,
                                             errorMsg ?: @"Search timed out");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_ERROR;
    }

    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"search", resultData), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

static int cmd_route(int argc, char **argv, int stdout_fd, int stderr_fd, BOOL compact, BOOL quiet) {
    NSString *fromStr = noff_find_arg(argc, argv, "--from");
    NSString *toStr = noff_find_arg(argc, argv, "--to");

    if (!fromStr || !toStr) {
        noff_emit_help(stderr_fd, HELP_TEXT);
        NSDictionary *err = noff_json_error(TOOL_NAME, @"route",
                                             NOFF_ERR_INVALID_ARGS,
                                             @"Required: --from, --to");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    NSString *mode = noff_find_arg(argc, argv, "--mode") ?: @"driving";

    CLLocationCoordinate2D fromCoord = resolve_location(fromStr);
    if (!CLLocationCoordinate2DIsValid(fromCoord)) {
        noff_emit_help(stderr_fd, HELP_TEXT);
        NSDictionary *err = noff_json_error(TOOL_NAME, @"route",
                                             NOFF_ERR_INVALID_ARGS,
                                             @"Could not resolve --from location");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    CLLocationCoordinate2D toCoord = resolve_location(toStr);
    if (!CLLocationCoordinate2DIsValid(toCoord)) {
        noff_emit_help(stderr_fd, HELP_TEXT);
        NSDictionary *err = noff_json_error(TOOL_NAME, @"route",
                                             NOFF_ERR_INVALID_ARGS,
                                             @"Could not resolve --to location");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    // MapKit objects must be created/released on the main thread to avoid
    // crashes in -[MKMapItem dealloc] → NSNotificationCenter removeObserver:.
    __block NSDictionary *resultData = nil;
    __block NSString *errorMsg = nil;
    MKDirectionsTransportType transportType = transport_type_for_mode(mode);
    dispatch_semaphore_t mainSem = dispatch_semaphore_create(0);

    dispatch_async(dispatch_get_main_queue(), ^{
        MKDirectionsRequest *request = [[MKDirectionsRequest alloc] init];
        MKPlacemark *srcPlacemark = [[MKPlacemark alloc] initWithCoordinate:fromCoord];
        MKPlacemark *dstPlacemark = [[MKPlacemark alloc] initWithCoordinate:toCoord];
        request.source = [[MKMapItem alloc] initWithPlacemark:srcPlacemark];
        request.destination = [[MKMapItem alloc] initWithPlacemark:dstPlacemark];
        request.transportType = transportType;
        request.requestsAlternateRoutes = NO;

        MKDirections *directions = [[MKDirections alloc] initWithRequest:request];
        [directions calculateDirectionsWithCompletionHandler:^(MKDirectionsResponse *response, NSError *error) {
            if (error || !response || response.routes.count == 0) {
                errorMsg = error.localizedDescription ?: @"No route found";
                dispatch_semaphore_signal(mainSem);
                return;
            }

            MKRoute *route = response.routes.firstObject;

            NSMutableArray *steps = [NSMutableArray array];
            for (MKRouteStep *step in route.steps) {
                if (step.instructions.length == 0) continue;
                [steps addObject:@{
                    @"instruction": step.instructions,
                    @"distance_m": @((int)round(step.distance)),
                }];
            }

            resultData = @{
                @"distance_km": @(round(route.distance / 10.0) / 100.0),
                @"duration_minutes": @(round(route.expectedTravelTime / 6.0) / 10.0),
                @"steps": steps,
                @"polyline_point_count": @(route.polyline.pointCount),
            };
            dispatch_semaphore_signal(mainSem);
        }];
    });
    dispatch_semaphore_wait(mainSem, dispatch_time(DISPATCH_TIME_NOW, 35 * NSEC_PER_SEC));

    if (errorMsg || !resultData) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"route",
                                             NOFF_ERR_INTERNAL_ERROR,
                                             errorMsg ?: @"Route calculation timed out");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_ERROR;
    }

    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"route", resultData), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

static int cmd_eta(int argc, char **argv, int stdout_fd, int stderr_fd, BOOL compact, BOOL quiet) {
    NSString *fromStr = noff_find_arg(argc, argv, "--from");
    NSString *toStr = noff_find_arg(argc, argv, "--to");

    if (!fromStr || !toStr) {
        noff_emit_help(stderr_fd, HELP_TEXT);
        NSDictionary *err = noff_json_error(TOOL_NAME, @"eta",
                                             NOFF_ERR_INVALID_ARGS,
                                             @"Required: --from, --to");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    NSString *mode = noff_find_arg(argc, argv, "--mode") ?: @"driving";

    CLLocationCoordinate2D fromCoord = resolve_location(fromStr);
    if (!CLLocationCoordinate2DIsValid(fromCoord)) {
        noff_emit_help(stderr_fd, HELP_TEXT);
        NSDictionary *err = noff_json_error(TOOL_NAME, @"eta",
                                             NOFF_ERR_INVALID_ARGS,
                                             @"Could not resolve --from location");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    CLLocationCoordinate2D toCoord = resolve_location(toStr);
    if (!CLLocationCoordinate2DIsValid(toCoord)) {
        noff_emit_help(stderr_fd, HELP_TEXT);
        NSDictionary *err = noff_json_error(TOOL_NAME, @"eta",
                                             NOFF_ERR_INVALID_ARGS,
                                             @"Could not resolve --to location");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    // MapKit objects must be created/released on the main thread.
    __block NSDictionary *resultData = nil;
    __block NSString *errorMsg = nil;
    MKDirectionsTransportType transportType = transport_type_for_mode(mode);
    dispatch_semaphore_t mainSem = dispatch_semaphore_create(0);

    dispatch_async(dispatch_get_main_queue(), ^{
        MKDirectionsRequest *request = [[MKDirectionsRequest alloc] init];
        MKPlacemark *srcPlacemark = [[MKPlacemark alloc] initWithCoordinate:fromCoord];
        MKPlacemark *dstPlacemark = [[MKPlacemark alloc] initWithCoordinate:toCoord];
        request.source = [[MKMapItem alloc] initWithPlacemark:srcPlacemark];
        request.destination = [[MKMapItem alloc] initWithPlacemark:dstPlacemark];
        request.transportType = transportType;

        MKDirections *directions = [[MKDirections alloc] initWithRequest:request];
        [directions calculateETAWithCompletionHandler:^(MKETAResponse *response, NSError *error) {
            if (error || !response) {
                errorMsg = error.localizedDescription ?: @"Could not calculate ETA";
                dispatch_semaphore_signal(mainSem);
                return;
            }

            resultData = @{
                @"distance_km": @(round(response.distance / 10.0) / 100.0),
                @"duration_minutes": @(round(response.expectedTravelTime / 6.0) / 10.0),
                @"expected_arrival": noff_format_date(response.expectedArrivalDate),
            };
            dispatch_semaphore_signal(mainSem);
        }];
    });
    dispatch_semaphore_wait(mainSem, dispatch_time(DISPATCH_TIME_NOW, 20 * NSEC_PER_SEC));

    if (errorMsg || !resultData) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"eta",
                                             NOFF_ERR_INTERNAL_ERROR,
                                             errorMsg ?: @"ETA calculation timed out");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_ERROR;
    }

    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"eta", resultData), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

// ── Main handler ──

static int maps_handler(int argc, char **argv,
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

    if ([subcmd isEqualToString:@"search"])  return cmd_search(argc, argv, stdout_fd, stderr_fd, compact, quiet);
    if ([subcmd isEqualToString:@"route"])   return cmd_route(argc, argv, stdout_fd, stderr_fd, compact, quiet);
    if ([subcmd isEqualToString:@"eta"])     return cmd_eta(argc, argv, stdout_fd, stderr_fd, compact, quiet);

    noff_emit_help(stderr_fd, HELP_TEXT);
    NSDictionary *err = noff_json_error(TOOL_NAME, subcmd,
                                         NOFF_ERR_INVALID_ARGS,
                                         [NSString stringWithFormat:@"Unknown command '%@'. Valid commands: search, route, eta. Use --help for details.", subcmd]);
    noff_emit_json(stdout_fd, err, compact, quiet);
    return NOFF_EXIT_INVALID_ARGS;
}

// ── Registration ──

void maps_offload_register(void) {
    int err = native_offload_add_handler("apple-maps", maps_handler);
    if (err == 0) {
        noff_ensure_guest_stub("/usr/local/bin/apple-maps");
        NSLog(@"NativeOffloads: apple-maps handler registered");
    } else {
        NSLog(@"NativeOffloads: failed to register apple-maps handler (err=%d)", err);
    }
}
