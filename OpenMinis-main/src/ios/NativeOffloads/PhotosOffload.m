//
//  PhotosOffload.m
//  MinisApp
//
//  Native offload handler for `apple-photos`.
//  Subcommands: list, near, albums, album, stats, export, import,
//               create-album, add-to-album, favorite, delete
//

#import <Foundation/Foundation.h>
#import <Photos/Photos.h>
#import <PhotosUI/PhotosUI.h>
#import <UIKit/UIKit.h>
#import <CoreLocation/CoreLocation.h>
#import "NativeOffloadUtils.h"
#include "kernel/native_offload.h"
#include <unistd.h>

static NSString *const TOOL_NAME = @"apple-photos";

static NSString *const HELP_TEXT =
    @"apple-photos - Query and manage the iOS photo library\n"
     "\n"
     "USAGE:\n"
     "  apple-photos <command> [options]\n"
     "\n"
     "COMMANDS:\n"
     "  list          List recent photos/videos\n"
     "  near          Find photos near a location\n"
     "  albums        List all albums\n"
     "  album         List assets in an album\n"
     "  stats         Photo library statistics\n"
     "  export        Export a photo/video to /var/minis/offloads/\n"
     "  import        Import an image/video file into the photo library (alias: save)\n"
     "  create-album  Create a new album\n"
     "  add-to-album  Add assets to an album\n"
     "  favorite      Toggle favorite on an asset\n"
     "  delete        Delete assets\n"
     "\n"
     "COMMON OPTIONS:\n"
     "  --help, -h           Show this help message\n"
     "  --compact            Minimize JSON output\n"
     "  -q, --quiet          Output only data field\n"
     "\n"
     "LIST OPTIONS:\n"
     "  --limit <N>          Maximum results (default 100)\n"
     "  --type <type>        photo, video, or all (default all)\n"
     "  --start <datetime>   Filter by creation date start\n"
     "  --end <datetime>     Filter by creation date end\n"
     "  --days <N>           Last N days\n"
     "\n"
     "NEAR OPTIONS:\n"
     "  --lat <degrees>      Latitude (required)\n"
     "  --lon <degrees>      Longitude (required)\n"
     "  --radius <km>        Search radius in km (default 1)\n"
     "  --limit <N>          Maximum results (default 100)\n"
     "\n"
     "ALBUMS OPTIONS:\n"
     "  --type <type>        user, smart, or all (default all)\n"
     "\n"
     "ALBUM OPTIONS:\n"
     "  --id <identifier>    Album local identifier\n"
     "  --name <name>        Album title (searched case-insensitive)\n"
     "  --limit <N>          Maximum results (default 100)\n"
     "\n"
     "EXPORT OPTIONS:\n"
     "  --id <identifier>    Asset local identifier (required)\n"
     "  --size <size>        thumb, medium, or original (default original)\n"
     "\n"
     "IMPORT OPTIONS (alias: save):\n"
     "  --path <file>        File to import. Image or video. The flag is\n"
     "                       optional: `import <file>` works the same.\n"
     "                       Accepts guest paths (/var/minis/attachments/a.jpg),\n"
     "                       relative paths (attachments/a.jpg), or host-absolute\n"
     "                       paths.\n"
     "  --album <id>         Add to album by local identifier (optional)\n"
     "  --album-name <name>  Add to album by name; created if missing (optional)\n"
     "                       If neither --album nor --album-name is given, the\n"
     "                       asset is saved to the default Recents album only.\n"
     "\n"
     "CREATE-ALBUM OPTIONS:\n"
     "  --name <name>        Album name (required)\n"
     "\n"
     "ADD-TO-ALBUM OPTIONS:\n"
     "  --album <id>         Target album by local identifier\n"
     "  --album-name <name>  Target album by name; created if missing\n"
     "                       (one of --album or --album-name is required)\n"
     "  --assets <ids>       Comma-separated existing asset IDs\n"
     "  --paths <files>      Comma-separated file paths to import and add.\n"
     "                       Accepts guest paths (/var/minis/...), paths relative\n"
     "                       to the current directory (attachments/foo.jpg), or\n"
     "                       host-absolute paths. At least one of --assets or\n"
     "                       --paths is required.\n"
     "\n"
     "FAVORITE OPTIONS:\n"
     "  --id <identifier>    Asset local identifier (required)\n"
     "\n"
     "DELETE OPTIONS:\n"
     "  --ids <ids>          Comma-separated asset IDs (required)\n"
     "  --confirm            Required flag to confirm deletion\n"
     "\n"
     "EXAMPLES:\n"
     "  apple-photos list --limit 10 --type photo\n"
     "  apple-photos near --lat 37.7749 --lon -122.4194 --radius 5\n"
     "  apple-photos albums\n"
     "  apple-photos album --name \"Vacation\"\n"
     "  apple-photos stats\n"
     "  apple-photos export --id ABC123\n"
     "  apple-photos export --id ABC123 --size medium\n"
     "  apple-photos import /var/minis/offloads/pic.jpg\n"
     "  apple-photos import --path /var/minis/offloads/pic.jpg\n"
     "  apple-photos import --path /var/minis/offloads/pic.jpg --album-name \"My Album\"\n"
     "  apple-photos save --path /var/minis/offloads/clip.mov --album <album-id>\n"
     "  apple-photos add-to-album --album-name \"Trip\" --paths attachments/a.jpg,attachments/b.jpg\n"
     "  apple-photos create-album --name \"My Album\"\n"
     "  apple-photos favorite --id ABC123\n"
     "  apple-photos delete --ids ABC123,DEF456 --confirm\n";

// Serial queue to prevent concurrent authorization dialogs
static dispatch_queue_t authQueue(void) {
    static dispatch_queue_t q = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        q = dispatch_queue_create("com.openminis.photos.auth", DISPATCH_QUEUE_SERIAL);
    });
    return q;
}

// Request photo library access synchronously via semaphore
static BOOL requestPhotosAccess(NSString **outError) {
    __block PHAuthorizationStatus status;

    dispatch_sync(authQueue(), ^{
        dispatch_semaphore_t sem = dispatch_semaphore_create(0);

        if (@available(iOS 14.0, *)) {
            [PHPhotoLibrary requestAuthorizationForAccessLevel:PHAccessLevelReadWrite
                                                      handler:^(PHAuthorizationStatus s) {
                status = s;
                dispatch_semaphore_signal(sem);
            }];
        } else {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
            [PHPhotoLibrary requestAuthorization:^(PHAuthorizationStatus s) {
                status = s;
                dispatch_semaphore_signal(sem);
            }];
#pragma clang diagnostic pop
        }
        dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_SEC));
    });

    BOOL granted = (status == PHAuthorizationStatusAuthorized);
    if (@available(iOS 14.0, *)) {
        if (status == PHAuthorizationStatusLimited) granted = YES;
    }

    if (!granted && outError) {
        *outError = @"Photo library access not granted. "
                     "To grant access, open Settings > Privacy & Security > Photos "
                     "and enable Minis.";
    }
    return granted;
}

// Convert a PHAsset to an NSDictionary
static NSDictionary *asset_to_dict(PHAsset *asset) {
    NSMutableDictionary *d = [NSMutableDictionary dictionary];
    d[@"id"] = asset.localIdentifier ?: @"";
    d[@"date"] = asset.creationDate ? noff_format_date(asset.creationDate) : [NSNull null];
    d[@"type"] = (asset.mediaType == PHAssetMediaTypeVideo) ? @"video" : @"photo";
    d[@"width"] = @(asset.pixelWidth);
    d[@"height"] = @(asset.pixelHeight);
    d[@"duration"] = (asset.mediaType == PHAssetMediaTypeVideo) ? @(asset.duration) : @(0);
    d[@"favorite"] = @(asset.isFavorite);

    if (asset.location) {
        d[@"location"] = @{
            @"lat": @(asset.location.coordinate.latitude),
            @"lon": @(asset.location.coordinate.longitude),
        };
    } else {
        d[@"location"] = [NSNull null];
    }

    // Media subtypes
    NSMutableArray *subtypes = [NSMutableArray array];
    PHAssetMediaSubtype sub = asset.mediaSubtypes;
    if (sub & PHAssetMediaSubtypePhotoScreenshot)  [subtypes addObject:@"screenshot"];
    if (sub & PHAssetMediaSubtypePhotoHDR)         [subtypes addObject:@"hdr"];
    if (sub & PHAssetMediaSubtypePhotoPanorama)     [subtypes addObject:@"panorama"];
    if (sub & PHAssetMediaSubtypePhotoLive)         [subtypes addObject:@"live"];
    if (sub & PHAssetMediaSubtypePhotoDepthEffect)  [subtypes addObject:@"depth"];
    if (sub & PHAssetMediaSubtypeVideoHighFrameRate) [subtypes addObject:@"slo-mo"];
    if (sub & PHAssetMediaSubtypeVideoTimelapse)    [subtypes addObject:@"timelapse"];
    d[@"media_subtypes"] = subtypes;

    return d;
}

// Resolve date range from args (reusable pattern from CalendarOffload)
static void resolve_date_range(int argc, char **argv, NSDate **start, NSDate **end) {
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
    *start = startStr ? noff_parse_date(startStr) : nil;
    *end = endStr ? noff_parse_date(endStr) : nil;
}

#pragma mark - list

static int cmd_list(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    NSString *authErr = nil;
    if (!requestPhotosAccess(&authErr)) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"list",
                                             NOFF_ERR_AUTHORIZATION_DENIED, authErr);
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_AUTH_DENIED;
    }

    NSString *limitStr = noff_find_arg(argc, argv, "--limit");
    NSInteger limit = limitStr ? [limitStr integerValue] : 100;
    NSString *typeStr = noff_find_arg(argc, argv, "--type");

    PHFetchOptions *opts = [[PHFetchOptions alloc] init];
    opts.sortDescriptors = @[[NSSortDescriptor sortDescriptorWithKey:@"creationDate" ascending:NO]];
    opts.fetchLimit = (NSUInteger)limit;

    // Build predicate components
    NSMutableArray *predicates = [NSMutableArray array];

    // Media type filter
    if (typeStr) {
        if ([typeStr isEqualToString:@"photo"]) {
            [predicates addObject:[NSPredicate predicateWithFormat:@"mediaType == %d",
                                   PHAssetMediaTypeImage]];
        } else if ([typeStr isEqualToString:@"video"]) {
            [predicates addObject:[NSPredicate predicateWithFormat:@"mediaType == %d",
                                   PHAssetMediaTypeVideo]];
        }
        // "all" = no type predicate
    }

    // Date range filter
    NSDate *start = nil, *end = nil;
    resolve_date_range(argc, argv, &start, &end);
    if (start && end) {
        [predicates addObject:[NSPredicate predicateWithFormat:
                               @"creationDate >= %@ AND creationDate <= %@", start, end]];
    } else if (start) {
        [predicates addObject:[NSPredicate predicateWithFormat:
                               @"creationDate >= %@", start]];
    } else if (end) {
        [predicates addObject:[NSPredicate predicateWithFormat:
                               @"creationDate <= %@", end]];
    }

    if (predicates.count > 0) {
        opts.predicate = [[NSCompoundPredicate alloc] initWithType:NSAndPredicateType
                                                     subpredicates:predicates];
    }

    PHFetchResult<PHAsset *> *result = [PHAsset fetchAssetsWithOptions:opts];

    NSMutableArray *assets = [NSMutableArray array];
    [result enumerateObjectsUsingBlock:^(PHAsset *asset, NSUInteger idx, BOOL *stop) {
        [assets addObject:asset_to_dict(asset)];
    }];

    NSDictionary *data = @{
        @"assets": assets,
        @"count": @(assets.count),
    };
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"list", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

#pragma mark - near

static int cmd_near(int argc, char **argv, int stdout_fd, int stderr_fd, BOOL compact, BOOL quiet) {
    NSString *authErr = nil;
    if (!requestPhotosAccess(&authErr)) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"near",
                                             NOFF_ERR_AUTHORIZATION_DENIED, authErr);
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_AUTH_DENIED;
    }

    NSString *latStr = noff_find_arg(argc, argv, "--lat");
    NSString *lonStr = noff_find_arg(argc, argv, "--lon");
    if (!latStr || !lonStr) {
        noff_emit_help(stderr_fd, HELP_TEXT);
        NSDictionary *err = noff_json_error(TOOL_NAME, @"near",
                                             NOFF_ERR_INVALID_ARGS,
                                             @"Required: --lat and --lon");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    double lat = [latStr doubleValue];
    double lon = [lonStr doubleValue];
    NSString *radiusStr = noff_find_arg(argc, argv, "--radius");
    double radiusKm = radiusStr ? [radiusStr doubleValue] : 1.0;
    double radiusMeters = radiusKm * 1000.0;

    NSString *limitStr = noff_find_arg(argc, argv, "--limit");
    NSInteger limit = limitStr ? [limitStr integerValue] : 100;

    CLLocation *target = [[CLLocation alloc] initWithLatitude:lat longitude:lon];

    // Fetch all assets (location is not indexable, must filter in memory)
    PHFetchOptions *opts = [[PHFetchOptions alloc] init];
    opts.sortDescriptors = @[[NSSortDescriptor sortDescriptorWithKey:@"creationDate" ascending:NO]];

    PHFetchResult<PHAsset *> *result = [PHAsset fetchAssetsWithOptions:opts];

    NSMutableArray *matches = [NSMutableArray array];
    [result enumerateObjectsUsingBlock:^(PHAsset *asset, NSUInteger idx, BOOL *stop) {
        if (!asset.location) return;
        CLLocationDistance dist = [asset.location distanceFromLocation:target];
        if (dist <= radiusMeters) {
            NSMutableDictionary *d = [asset_to_dict(asset) mutableCopy];
            d[@"distance_m"] = @(dist);
            [matches addObject:d];
        }
    }];

    // Sort by distance
    [matches sortUsingComparator:^NSComparisonResult(NSDictionary *a, NSDictionary *b) {
        return [a[@"distance_m"] compare:b[@"distance_m"]];
    }];

    // Apply limit
    if ((NSInteger)matches.count > limit) {
        [matches removeObjectsInRange:NSMakeRange(limit, matches.count - limit)];
    }

    NSDictionary *data = @{
        @"assets": matches,
        @"count": @(matches.count),
        @"center": @{@"lat": @(lat), @"lon": @(lon)},
        @"radius_km": @(radiusKm),
    };
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"near", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

#pragma mark - albums

static int cmd_albums(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    NSString *authErr = nil;
    if (!requestPhotosAccess(&authErr)) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"albums",
                                             NOFF_ERR_AUTHORIZATION_DENIED, authErr);
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_AUTH_DENIED;
    }

    NSString *typeStr = noff_find_arg(argc, argv, "--type");
    BOOL includeUser  = !typeStr || [typeStr isEqualToString:@"all"] || [typeStr isEqualToString:@"user"];
    BOOL includeSmart = !typeStr || [typeStr isEqualToString:@"all"] || [typeStr isEqualToString:@"smart"];

    NSMutableArray *items = [NSMutableArray array];

    if (includeUser) {
        PHFetchResult<PHAssetCollection *> *userAlbums =
            [PHAssetCollection fetchAssetCollectionsWithType:PHAssetCollectionTypeAlbum
                                                    subtype:PHAssetCollectionSubtypeAlbumRegular
                                                    options:nil];
        [userAlbums enumerateObjectsUsingBlock:^(PHAssetCollection *col, NSUInteger idx, BOOL *stop) {
            PHFetchResult *assets = [PHAsset fetchAssetsInAssetCollection:col options:nil];
            [items addObject:@{
                @"id": col.localIdentifier ?: @"",
                @"title": col.localizedTitle ?: @"",
                @"type": @"user",
                @"count": @(assets.count),
            }];
        }];
    }

    if (includeSmart) {
        PHFetchResult<PHAssetCollection *> *smartAlbums =
            [PHAssetCollection fetchAssetCollectionsWithType:PHAssetCollectionTypeSmartAlbum
                                                    subtype:PHAssetCollectionSubtypeAlbumRegular
                                                    options:nil];
        [smartAlbums enumerateObjectsUsingBlock:^(PHAssetCollection *col, NSUInteger idx, BOOL *stop) {
            PHFetchResult *assets = [PHAsset fetchAssetsInAssetCollection:col options:nil];
            [items addObject:@{
                @"id": col.localIdentifier ?: @"",
                @"title": col.localizedTitle ?: @"",
                @"type": @"smart",
                @"count": @(assets.count),
            }];
        }];
    }

    NSDictionary *data = @{@"albums": items, @"count": @(items.count)};
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"albums", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

#pragma mark - album

static int cmd_album(int argc, char **argv, int stdout_fd, int stderr_fd, BOOL compact, BOOL quiet) {
    NSString *authErr = nil;
    if (!requestPhotosAccess(&authErr)) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"album",
                                             NOFF_ERR_AUTHORIZATION_DENIED, authErr);
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_AUTH_DENIED;
    }

    NSString *albumId = noff_find_arg(argc, argv, "--id");
    NSString *albumName = noff_find_arg(argc, argv, "--name");
    if (!albumId && !albumName) {
        noff_emit_help(stderr_fd, HELP_TEXT);
        NSDictionary *err = noff_json_error(TOOL_NAME, @"album",
                                             NOFF_ERR_INVALID_ARGS,
                                             @"Required: --id or --name");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    NSString *limitStr = noff_find_arg(argc, argv, "--limit");
    NSInteger limit = limitStr ? [limitStr integerValue] : 100;

    PHAssetCollection *collection = nil;

    if (albumId) {
        PHFetchResult<PHAssetCollection *> *result =
            [PHAssetCollection fetchAssetCollectionsWithLocalIdentifiers:@[albumId] options:nil];
        collection = result.firstObject;
    } else {
        // Search by name across user and smart albums
        PHFetchOptions *searchOpts = [[PHFetchOptions alloc] init];
        searchOpts.predicate = [NSPredicate predicateWithFormat:
                                @"localizedTitle CONTAINS[cd] %@", albumName];

        PHFetchResult<PHAssetCollection *> *result =
            [PHAssetCollection fetchAssetCollectionsWithType:PHAssetCollectionTypeAlbum
                                                    subtype:PHAssetCollectionSubtypeAny
                                                    options:searchOpts];
        if (result.count == 0) {
            result = [PHAssetCollection fetchAssetCollectionsWithType:PHAssetCollectionTypeSmartAlbum
                                                             subtype:PHAssetCollectionSubtypeAny
                                                             options:searchOpts];
        }
        collection = result.firstObject;
    }

    if (!collection) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"album",
                                             NOFF_ERR_NO_DATA, @"Album not found");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_ERROR;
    }

    PHFetchOptions *fetchOpts = [[PHFetchOptions alloc] init];
    fetchOpts.sortDescriptors = @[[NSSortDescriptor sortDescriptorWithKey:@"creationDate" ascending:NO]];
    fetchOpts.fetchLimit = (NSUInteger)limit;

    PHFetchResult<PHAsset *> *assets = [PHAsset fetchAssetsInAssetCollection:collection options:fetchOpts];

    NSMutableArray *assetDicts = [NSMutableArray array];
    [assets enumerateObjectsUsingBlock:^(PHAsset *asset, NSUInteger idx, BOOL *stop) {
        [assetDicts addObject:asset_to_dict(asset)];
    }];

    NSDictionary *data = @{
        @"album": @{
            @"id": collection.localIdentifier ?: @"",
            @"title": collection.localizedTitle ?: @"",
        },
        @"assets": assetDicts,
        @"count": @(assetDicts.count),
    };
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"album", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

#pragma mark - stats

static int cmd_stats(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    NSString *authErr = nil;
    if (!requestPhotosAccess(&authErr)) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"stats",
                                             NOFF_ERR_AUTHORIZATION_DENIED, authErr);
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_AUTH_DENIED;
    }

    // Total photos
    PHFetchOptions *photoOpts = [[PHFetchOptions alloc] init];
    photoOpts.predicate = [NSPredicate predicateWithFormat:@"mediaType == %d", PHAssetMediaTypeImage];
    NSUInteger totalPhotos = [PHAsset fetchAssetsWithOptions:photoOpts].count;

    // Total videos
    PHFetchOptions *videoOpts = [[PHFetchOptions alloc] init];
    videoOpts.predicate = [NSPredicate predicateWithFormat:@"mediaType == %d", PHAssetMediaTypeVideo];
    NSUInteger totalVideos = [PHAsset fetchAssetsWithOptions:videoOpts].count;

    // Smart album counts
    NSUInteger screenshots = 0, selfies = 0, panoramas = 0, livePhotos = 0, bursts = 0;

    PHFetchResult<PHAssetCollection *> *screenshotAlbum =
        [PHAssetCollection fetchAssetCollectionsWithType:PHAssetCollectionTypeSmartAlbum
                                                subtype:PHAssetCollectionSubtypeSmartAlbumScreenshots
                                                options:nil];
    if (screenshotAlbum.firstObject) {
        screenshots = [PHAsset fetchAssetsInAssetCollection:screenshotAlbum.firstObject options:nil].count;
    }

    PHFetchResult<PHAssetCollection *> *selfieAlbum =
        [PHAssetCollection fetchAssetCollectionsWithType:PHAssetCollectionTypeSmartAlbum
                                                subtype:PHAssetCollectionSubtypeSmartAlbumSelfPortraits
                                                options:nil];
    if (selfieAlbum.firstObject) {
        selfies = [PHAsset fetchAssetsInAssetCollection:selfieAlbum.firstObject options:nil].count;
    }

    PHFetchResult<PHAssetCollection *> *panoAlbum =
        [PHAssetCollection fetchAssetCollectionsWithType:PHAssetCollectionTypeSmartAlbum
                                                subtype:PHAssetCollectionSubtypeSmartAlbumPanoramas
                                                options:nil];
    if (panoAlbum.firstObject) {
        panoramas = [PHAsset fetchAssetsInAssetCollection:panoAlbum.firstObject options:nil].count;
    }

    PHFetchResult<PHAssetCollection *> *liveAlbum =
        [PHAssetCollection fetchAssetCollectionsWithType:PHAssetCollectionTypeSmartAlbum
                                                subtype:PHAssetCollectionSubtypeSmartAlbumLivePhotos
                                                options:nil];
    if (liveAlbum.firstObject) {
        livePhotos = [PHAsset fetchAssetsInAssetCollection:liveAlbum.firstObject options:nil].count;
    }

    PHFetchResult<PHAssetCollection *> *burstAlbum =
        [PHAssetCollection fetchAssetCollectionsWithType:PHAssetCollectionTypeSmartAlbum
                                                subtype:PHAssetCollectionSubtypeSmartAlbumBursts
                                                options:nil];
    if (burstAlbum.firstObject) {
        bursts = [PHAsset fetchAssetsInAssetCollection:burstAlbum.firstObject options:nil].count;
    }

    NSDictionary *data = @{
        @"total_photos": @(totalPhotos),
        @"total_videos": @(totalVideos),
        @"screenshots": @(screenshots),
        @"selfies": @(selfies),
        @"panoramas": @(panoramas),
        @"live_photos": @(livePhotos),
        @"bursts": @(bursts),
    };
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"stats", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

#pragma mark - export

static int cmd_export(int argc, char **argv, int stdout_fd, int stderr_fd, BOOL compact, BOOL quiet) {
    NSString *authErr = nil;
    if (!requestPhotosAccess(&authErr)) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"export",
                                             NOFF_ERR_AUTHORIZATION_DENIED, authErr);
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_AUTH_DENIED;
    }

    NSString *assetId = noff_find_arg(argc, argv, "--id");
    if (!assetId) {
        noff_emit_help(stderr_fd, HELP_TEXT);
        NSDictionary *err = noff_json_error(TOOL_NAME, @"export",
                                             NOFF_ERR_INVALID_ARGS, @"Required: --id");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    NSString *sizeStr = noff_find_arg(argc, argv, "--size");
    if (!sizeStr) sizeStr = @"original";
    // Accept "full" as alias for "original" for backwards compat
    if ([sizeStr isEqualToString:@"full"]) sizeStr = @"original";

    PHFetchResult<PHAsset *> *result =
        [PHAsset fetchAssetsWithLocalIdentifiers:@[assetId] options:nil];
    PHAsset *asset = result.firstObject;
    if (!asset) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"export",
                                             NOFF_ERR_NO_DATA, @"Asset not found");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_ERROR;
    }

    BOOL isVideo = (asset.mediaType == PHAssetMediaTypeVideo);

    // Sanitize asset ID for filename (remove special chars like /)
    NSString *safeId = [[assetId componentsSeparatedByCharactersInSet:
                         [[NSCharacterSet alphanumericCharacterSet] invertedSet]]
                        componentsJoinedByString:@"_"];

    NSString *guestDir = @"/var/minis/offloads";
    NSString *hostDir = noff_resolve_host_path(guestDir);

    // Ensure host directory exists
    NSFileManager *fm = [NSFileManager defaultManager];
    if (![fm fileExistsAtPath:hostDir]) {
        [fm createDirectoryAtPath:hostDir withIntermediateDirectories:YES attributes:nil error:nil];
    }

    // --- Original quality export via PHAssetResourceManager ---
    if ([sizeStr isEqualToString:@"original"]) {
        NSArray<PHAssetResource *> *resources = [PHAssetResource assetResourcesForAsset:asset];

        // Find primary resource
        PHAssetResourceType targetType = isVideo ? PHAssetResourceTypeVideo
                                                 : PHAssetResourceTypePhoto;
        PHAssetResource *primary = nil;
        for (PHAssetResource *r in resources) {
            if (r.type == targetType) {
                primary = r;
                break;
            }
        }
        // Fallback: use first resource if exact type not found
        if (!primary && resources.count > 0) {
            primary = resources.firstObject;
        }

        if (!primary) {
            NSDictionary *err = noff_json_error(TOOL_NAME, @"export",
                                                 NOFF_ERR_INTERNAL_ERROR,
                                                 @"No exportable resource found for asset");
            noff_emit_json(stdout_fd, err, compact, quiet);
            return NOFF_EXIT_ERROR;
        }

        // Get original file extension from the resource filename
        NSString *origFilename = primary.originalFilename ?: @"export";
        NSString *ext = [origFilename pathExtension];
        if (ext.length == 0) ext = isVideo ? @"mov" : @"heic";

        NSString *guestPath = [NSString stringWithFormat:@"%@/%@.%@", guestDir, safeId, ext.lowercaseString];
        NSString *hostPath = noff_resolve_host_path(guestPath);

        // Remove existing file if present (writeDataForAssetResource fails if file exists)
        [fm removeItemAtPath:hostPath error:nil];

        NSURL *hostURL = [NSURL fileURLWithPath:hostPath];
        PHAssetResourceRequestOptions *resOpts = [[PHAssetResourceRequestOptions alloc] init];
        resOpts.networkAccessAllowed = YES;

        __block NSError *resErr = nil;
        dispatch_semaphore_t sem = dispatch_semaphore_create(0);
        [[PHAssetResourceManager defaultManager] writeDataForAssetResource:primary
                                                                    toFile:hostURL
                                                                   options:resOpts
                                                         completionHandler:^(NSError *error) {
            resErr = error;
            dispatch_semaphore_signal(sem);
        }];
        dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 60 * NSEC_PER_SEC));

        if (resErr) {
            NSDictionary *err = noff_json_error(TOOL_NAME, @"export",
                                                 NOFF_ERR_INTERNAL_ERROR,
                                                 resErr.localizedDescription ?: @"Failed to export original resource");
            noff_emit_json(stdout_fd, err, compact, quiet);
            return NOFF_EXIT_ERROR;
        }

        // Get exported file size
        NSDictionary *attrs = [fm attributesOfItemAtPath:hostPath error:nil];
        unsigned long long fileSize = [attrs fileSize];

        NSMutableDictionary *data = [NSMutableDictionary dictionary];
        data[@"path"] = guestPath;
        data[@"size_bytes"] = @(fileSize);
        data[@"width"] = @(asset.pixelWidth);
        data[@"height"] = @(asset.pixelHeight);
        data[@"media_type"] = isVideo ? @"video" : @"photo";
        data[@"format"] = @"original";
        if (isVideo) {
            data[@"duration"] = @(asset.duration);
        }

        noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"export", data), compact, quiet);
        return NOFF_EXIT_SUCCESS;
    }

    // --- Thumbnail / medium export via PHImageManager (JPEG re-encode) ---
    CGSize targetSize;
    if ([sizeStr isEqualToString:@"thumb"]) {
        targetSize = CGSizeMake(200, 200);
    } else {
        // medium
        targetSize = CGSizeMake(1024, 1024);
    }

    PHImageRequestOptions *imgOpts = [[PHImageRequestOptions alloc] init];
    imgOpts.synchronous = YES;
    imgOpts.deliveryMode = PHImageRequestOptionsDeliveryModeHighQualityFormat;
    imgOpts.resizeMode = PHImageRequestOptionsResizeModeFast;
    imgOpts.networkAccessAllowed = YES;

    __block UIImage *exportedImage = nil;
    [[PHImageManager defaultManager] requestImageForAsset:asset
                                               targetSize:targetSize
                                              contentMode:PHImageContentModeAspectFit
                                                  options:imgOpts
                                            resultHandler:^(UIImage *img, NSDictionary *info) {
        exportedImage = img;
    }];

    if (!exportedImage) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"export",
                                             NOFF_ERR_INTERNAL_ERROR,
                                             isVideo ? @"Failed to export video poster frame"
                                                     : @"Failed to export image");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_ERROR;
    }

    NSData *jpegData = UIImageJPEGRepresentation(exportedImage, 0.85);
    if (!jpegData) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"export",
                                             NOFF_ERR_INTERNAL_ERROR,
                                             @"Failed to encode JPEG");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_ERROR;
    }

    NSString *guestPath = [NSString stringWithFormat:@"%@/%@.jpg", guestDir, safeId];
    NSString *hostPath = noff_resolve_host_path(guestPath);

    NSError *writeErr = nil;
    if (![jpegData writeToFile:hostPath options:NSDataWritingAtomic error:&writeErr]) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"export",
                                             NOFF_ERR_INTERNAL_ERROR,
                                             writeErr.localizedDescription ?: @"Failed to write file");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_ERROR;
    }

    NSMutableDictionary *data = [NSMutableDictionary dictionary];
    data[@"path"] = guestPath;
    data[@"size_bytes"] = @(jpegData.length);
    data[@"width"] = @((NSInteger)exportedImage.size.width);
    data[@"height"] = @((NSInteger)exportedImage.size.height);
    data[@"media_type"] = isVideo ? @"video" : @"photo";
    data[@"format"] = sizeStr;
    if (isVideo) {
        data[@"duration"] = @(asset.duration);
    }

    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"export", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

#pragma mark - import

// Resolve a user-provided path to a host filesystem path that exists.
// Supports three forms:
//   1. Guest-absolute: "/var/minis/attachments/foo.jpg" → mapped into fakefs data dir.
//   2. Relative:       "attachments/foo.jpg"           → resolved against host CWD,
//                                                        which the offload runtime has already
//                                                        chdir'd to the guest CWD equivalent.
//   3. Host-absolute:  "/private/var/mobile/..."       → used as-is if file exists.
// Returns nil if no existing file is found under any interpretation.
static NSString *resolve_input_file(NSString *path) {
    if (path.length == 0) return nil;
    NSFileManager *fm = [NSFileManager defaultManager];
    BOOL isDir = NO;

    if ([path hasPrefix:@"/"]) {
        // Try host-absolute first (covers iOS Files / Photos export paths).
        if ([fm fileExistsAtPath:path isDirectory:&isDir] && !isDir) {
            return path;
        }
        // Fall back to guest-absolute → fakefs data dir.
        NSString *mapped = noff_resolve_host_path(path);
        if (mapped && [fm fileExistsAtPath:mapped isDirectory:&isDir] && !isDir) {
            return mapped;
        }
        return nil;
    }

    // Relative path: resolve against host CWD (offload runtime chdir'd us to the
    // host equivalent of the guest CWD, so relative paths match user expectations).
    NSString *cwd = [fm currentDirectoryPath];
    NSString *joined = [cwd stringByAppendingPathComponent:path];
    if ([fm fileExistsAtPath:joined isDirectory:&isDir] && !isDir) {
        return joined;
    }
    return nil;
}

// Determine media type from file extension.
// Returns PHAssetResourceTypePhoto for image, PHAssetResourceTypeVideo for video.
// Returns -1 if unknown.
static NSInteger classify_media_by_ext(NSString *path) {
    NSString *ext = path.pathExtension.lowercaseString;
    NSSet *imageExts = [NSSet setWithArray:@[@"jpg", @"jpeg", @"png", @"heic", @"heif",
                                              @"gif", @"bmp", @"tiff", @"tif", @"webp"]];
    NSSet *videoExts = [NSSet setWithArray:@[@"mov", @"mp4", @"m4v", @"3gp", @"avi"]];
    if ([imageExts containsObject:ext]) return PHAssetResourceTypePhoto;
    if ([videoExts containsObject:ext]) return PHAssetResourceTypeVideo;
    return -1;
}

// Look up a user album by exact localized title. Returns nil if none found.
static PHAssetCollection *find_user_album_by_name(NSString *name) {
    PHFetchOptions *opts = [[PHFetchOptions alloc] init];
    opts.predicate = [NSPredicate predicateWithFormat:@"localizedTitle == %@", name];
    PHFetchResult<PHAssetCollection *> *result =
        [PHAssetCollection fetchAssetCollectionsWithType:PHAssetCollectionTypeAlbum
                                                subtype:PHAssetCollectionSubtypeAlbumRegular
                                                options:opts];
    return result.firstObject;
}

// Create a user album with the given title and return its placeholder local identifier.
// Writes nil + error on failure.
static NSString *create_user_album_sync(NSString *name, NSError **outError) {
    __block NSString *createdId = nil;
    __block NSError *changeErr = nil;
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);

    [[PHPhotoLibrary sharedPhotoLibrary] performChanges:^{
        PHAssetCollectionChangeRequest *req =
            [PHAssetCollectionChangeRequest creationRequestForAssetCollectionWithTitle:name];
        createdId = req.placeholderForCreatedAssetCollection.localIdentifier;
    } completionHandler:^(BOOL success, NSError *error) {
        if (!success) changeErr = error;
        dispatch_semaphore_signal(sem);
    }];
    dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC));

    if (changeErr) {
        if (outError) *outError = changeErr;
        return nil;
    }
    return createdId;
}

static int cmd_import(int argc, char **argv, int stdout_fd, int stderr_fd,
                      BOOL compact, BOOL quiet, NSString *action) {
    NSString *authErr = nil;
    if (!requestPhotosAccess(&authErr)) {
        NSDictionary *err = noff_json_error(TOOL_NAME, action,
                                             NOFF_ERR_AUTHORIZATION_DENIED, authErr);
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_AUTH_DENIED;
    }

    NSString *inputPath = noff_find_arg(argc, argv, "--path");
    if (!inputPath) {
        // `import <path>` without the --path flag — the path is this
        // subcommand's only natural argument, so accept it positionally
        // (the form LLMs and humans guess first).
        inputPath = noff_positional_args(argc, argv).firstObject;
    }
    if (!inputPath) {
        noff_emit_help(stderr_fd, HELP_TEXT);
        NSDictionary *err = noff_json_error(TOOL_NAME, action,
                                             NOFF_ERR_INVALID_ARGS,
                                             @"Required: a file path (positional or --path <file>)");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    NSString *hostPath = resolve_input_file(inputPath);
    if (!hostPath) {
        NSDictionary *err = noff_json_error(TOOL_NAME, action,
                                             NOFF_ERR_NO_DATA,
                                             [NSString stringWithFormat:@"File not found: %@", inputPath]);
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_ERROR;
    }

    NSInteger mediaType = classify_media_by_ext(inputPath);
    if (mediaType < 0) {
        NSDictionary *err = noff_json_error(TOOL_NAME, action,
                                             NOFF_ERR_INVALID_ARGS,
                                             @"Unsupported file extension. Use an image "
                                             "(jpg/png/heic/gif/...) or video (mov/mp4/...).");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }
    BOOL isVideo = (mediaType == PHAssetResourceTypeVideo);

    // Resolve album if requested. Priority: --album (id) > --album-name.
    NSString *albumArg = noff_find_arg(argc, argv, "--album");
    NSString *albumNameArg = noff_find_arg(argc, argv, "--album-name");
    PHAssetCollection *album = nil;

    if (albumArg) {
        PHFetchResult<PHAssetCollection *> *r =
            [PHAssetCollection fetchAssetCollectionsWithLocalIdentifiers:@[albumArg] options:nil];
        album = r.firstObject;
        if (!album) {
            NSDictionary *err = noff_json_error(TOOL_NAME, action,
                                                 NOFF_ERR_NO_DATA,
                                                 [NSString stringWithFormat:@"Album not found: %@", albumArg]);
            noff_emit_json(stdout_fd, err, compact, quiet);
            return NOFF_EXIT_ERROR;
        }
    } else if (albumNameArg) {
        album = find_user_album_by_name(albumNameArg);
        if (!album) {
            NSError *createErr = nil;
            NSString *newId = create_user_album_sync(albumNameArg, &createErr);
            if (!newId) {
                NSDictionary *err = noff_json_error(TOOL_NAME, action,
                                                     NOFF_ERR_INTERNAL_ERROR,
                                                     createErr.localizedDescription ?: @"Failed to create album");
                noff_emit_json(stdout_fd, err, compact, quiet);
                return NOFF_EXIT_ERROR;
            }
            PHFetchResult<PHAssetCollection *> *r =
                [PHAssetCollection fetchAssetCollectionsWithLocalIdentifiers:@[newId] options:nil];
            album = r.firstObject;
        }
    }

    NSURL *fileURL = [NSURL fileURLWithPath:hostPath];
    __block NSString *newAssetId = nil;
    __block NSError *changeErr = nil;
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);

    [[PHPhotoLibrary sharedPhotoLibrary] performChanges:^{
        PHAssetCreationRequest *assetReq = [PHAssetCreationRequest creationRequestForAsset];
        PHAssetResourceCreationOptions *resOpts = [[PHAssetResourceCreationOptions alloc] init];
        resOpts.originalFilename = fileURL.lastPathComponent;
        [assetReq addResourceWithType:(isVideo ? PHAssetResourceTypeVideo : PHAssetResourceTypePhoto)
                              fileURL:fileURL
                              options:resOpts];

        PHObjectPlaceholder *placeholder = assetReq.placeholderForCreatedAsset;
        newAssetId = placeholder.localIdentifier;

        if (album && placeholder) {
            PHAssetCollectionChangeRequest *albumReq =
                [PHAssetCollectionChangeRequest changeRequestForAssetCollection:album];
            [albumReq addAssets:@[placeholder]];
        }
    } completionHandler:^(BOOL success, NSError *error) {
        if (!success) changeErr = error;
        dispatch_semaphore_signal(sem);
    }];
    dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 60 * NSEC_PER_SEC));

    if (changeErr) {
        NSDictionary *err = noff_json_error(TOOL_NAME, action,
                                             NOFF_ERR_INTERNAL_ERROR,
                                             changeErr.localizedDescription ?: @"Failed to import asset");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_ERROR;
    }

    NSMutableDictionary *data = [NSMutableDictionary dictionary];
    data[@"id"] = newAssetId ?: @"";
    data[@"path"] = inputPath;
    data[@"media_type"] = isVideo ? @"video" : @"photo";
    if (album) {
        data[@"album"] = @{
            @"id": album.localIdentifier ?: @"",
            @"title": album.localizedTitle ?: @"",
        };
    } else {
        data[@"album"] = [NSNull null];
    }

    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, action, data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

#pragma mark - create-album

static int cmd_create_album(int argc, char **argv, int stdout_fd, int stderr_fd, BOOL compact, BOOL quiet) {
    NSString *authErr = nil;
    if (!requestPhotosAccess(&authErr)) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"create-album",
                                             NOFF_ERR_AUTHORIZATION_DENIED, authErr);
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_AUTH_DENIED;
    }

    NSString *name = noff_find_arg(argc, argv, "--name");
    if (!name) {
        noff_emit_help(stderr_fd, HELP_TEXT);
        NSDictionary *err = noff_json_error(TOOL_NAME, @"create-album",
                                             NOFF_ERR_INVALID_ARGS, @"Required: --name");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    __block NSString *albumId = nil;
    __block NSError *changeErr = nil;
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);

    [[PHPhotoLibrary sharedPhotoLibrary] performChanges:^{
        PHAssetCollectionChangeRequest *req =
            [PHAssetCollectionChangeRequest creationRequestForAssetCollectionWithTitle:name];
        albumId = req.placeholderForCreatedAssetCollection.localIdentifier;
    } completionHandler:^(BOOL success, NSError *error) {
        if (!success) changeErr = error;
        dispatch_semaphore_signal(sem);
    }];
    dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC));

    if (changeErr) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"create-album",
                                             NOFF_ERR_INTERNAL_ERROR,
                                             changeErr.localizedDescription ?: @"Failed to create album");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_ERROR;
    }

    NSDictionary *data = @{
        @"id": albumId ?: @"",
        @"name": name,
    };
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"create-album", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

#pragma mark - add-to-album

static int cmd_add_to_album(int argc, char **argv, int stdout_fd, int stderr_fd, BOOL compact, BOOL quiet) {
    NSString *authErr = nil;
    if (!requestPhotosAccess(&authErr)) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"add-to-album",
                                             NOFF_ERR_AUTHORIZATION_DENIED, authErr);
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_AUTH_DENIED;
    }

    NSString *albumArg = noff_find_arg(argc, argv, "--album");
    NSString *albumNameArg = noff_find_arg(argc, argv, "--album-name");
    NSString *assetsStr = noff_find_arg(argc, argv, "--assets");
    NSString *pathsStr = noff_find_arg(argc, argv, "--paths");

    if (!albumArg && !albumNameArg) {
        noff_emit_help(stderr_fd, HELP_TEXT);
        NSDictionary *err = noff_json_error(TOOL_NAME, @"add-to-album",
                                             NOFF_ERR_INVALID_ARGS,
                                             @"Required: --album or --album-name");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }
    if (!assetsStr && !pathsStr) {
        noff_emit_help(stderr_fd, HELP_TEXT);
        NSDictionary *err = noff_json_error(TOOL_NAME, @"add-to-album",
                                             NOFF_ERR_INVALID_ARGS,
                                             @"Required: --assets or --paths (or both)");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    // Resolve album: prefer --album id, fall back to --album-name (create if missing).
    PHAssetCollection *album = nil;
    if (albumArg) {
        PHFetchResult<PHAssetCollection *> *r =
            [PHAssetCollection fetchAssetCollectionsWithLocalIdentifiers:@[albumArg] options:nil];
        album = r.firstObject;
        if (!album) {
            NSDictionary *err = noff_json_error(TOOL_NAME, @"add-to-album",
                                                 NOFF_ERR_NO_DATA,
                                                 [NSString stringWithFormat:@"Album not found: %@", albumArg]);
            noff_emit_json(stdout_fd, err, compact, quiet);
            return NOFF_EXIT_ERROR;
        }
    } else {
        album = find_user_album_by_name(albumNameArg);
        if (!album) {
            NSError *createErr = nil;
            NSString *newId = create_user_album_sync(albumNameArg, &createErr);
            if (!newId) {
                NSDictionary *err = noff_json_error(TOOL_NAME, @"add-to-album",
                                                     NOFF_ERR_INTERNAL_ERROR,
                                                     createErr.localizedDescription ?: @"Failed to create album");
                noff_emit_json(stdout_fd, err, compact, quiet);
                return NOFF_EXIT_ERROR;
            }
            PHFetchResult<PHAssetCollection *> *r =
                [PHAssetCollection fetchAssetCollectionsWithLocalIdentifiers:@[newId] options:nil];
            album = r.firstObject;
        }
    }

    // Parse and validate files up-front so we can fail cleanly without partial work.
    // Each entry: @{ @"input": <original string>, @"host": <resolved host path>, @"video": @(BOOL) }
    NSMutableArray<NSDictionary *> *fileEntries = [NSMutableArray array];
    if (pathsStr) {
        for (NSString *raw in [pathsStr componentsSeparatedByString:@","]) {
            NSString *p = [raw stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
            if (p.length == 0) continue;

            NSString *host = resolve_input_file(p);
            if (!host) {
                NSDictionary *err = noff_json_error(TOOL_NAME, @"add-to-album",
                                                     NOFF_ERR_NO_DATA,
                                                     [NSString stringWithFormat:@"File not found: %@", p]);
                noff_emit_json(stdout_fd, err, compact, quiet);
                return NOFF_EXIT_ERROR;
            }
            NSInteger t = classify_media_by_ext(p);
            if (t < 0) {
                NSDictionary *err = noff_json_error(TOOL_NAME, @"add-to-album",
                                                     NOFF_ERR_INVALID_ARGS,
                                                     [NSString stringWithFormat:@"Unsupported file extension: %@", p]);
                noff_emit_json(stdout_fd, err, compact, quiet);
                return NOFF_EXIT_INVALID_ARGS;
            }
            [fileEntries addObject:@{
                @"input": p,
                @"host": host,
                @"video": @(t == PHAssetResourceTypeVideo),
            }];
        }
    }

    // Fetch existing assets by id (may be empty array).
    PHFetchResult<PHAsset *> *assetResult = nil;
    NSArray<NSString *> *assetIds = @[];
    if (assetsStr) {
        assetIds = [assetsStr componentsSeparatedByString:@","];
        assetResult = [PHAsset fetchAssetsWithLocalIdentifiers:assetIds options:nil];
    }

    // Single performChanges: create new assets from files (if any) and add everything to album.
    __block NSError *changeErr = nil;
    __block NSMutableArray<NSString *> *newAssetIds = [NSMutableArray array];
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);

    [[PHPhotoLibrary sharedPhotoLibrary] performChanges:^{
        NSMutableArray *toAdd = [NSMutableArray array];

        for (NSDictionary *entry in fileEntries) {
            NSString *hostPath = entry[@"host"];
            BOOL entryIsVideo = [entry[@"video"] boolValue];
            NSURL *fileURL = [NSURL fileURLWithPath:hostPath];

            PHAssetCreationRequest *createReq = [PHAssetCreationRequest creationRequestForAsset];
            PHAssetResourceCreationOptions *resOpts = [[PHAssetResourceCreationOptions alloc] init];
            resOpts.originalFilename = fileURL.lastPathComponent;
            [createReq addResourceWithType:(entryIsVideo ? PHAssetResourceTypeVideo : PHAssetResourceTypePhoto)
                                   fileURL:fileURL
                                   options:resOpts];
            PHObjectPlaceholder *ph = createReq.placeholderForCreatedAsset;
            if (ph) {
                [toAdd addObject:ph];
                [newAssetIds addObject:ph.localIdentifier ?: @""];
            }
        }

        if (assetResult) {
            [assetResult enumerateObjectsUsingBlock:^(PHAsset *a, NSUInteger i, BOOL *stop) {
                [toAdd addObject:a];
            }];
        }

        if (toAdd.count > 0) {
            PHAssetCollectionChangeRequest *albumReq =
                [PHAssetCollectionChangeRequest changeRequestForAssetCollection:album];
            [albumReq addAssets:toAdd];
        }
    } completionHandler:^(BOOL success, NSError *error) {
        if (!success) changeErr = error;
        dispatch_semaphore_signal(sem);
    }];
    // Importing files from disk can take time; allow 60s like cmd_import.
    dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 60 * NSEC_PER_SEC));

    if (changeErr) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"add-to-album",
                                             NOFF_ERR_INTERNAL_ERROR,
                                             changeErr.localizedDescription ?: @"Failed to add assets");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_ERROR;
    }

    NSUInteger addedCount = newAssetIds.count + (assetResult ? assetResult.count : 0);
    NSDictionary *data = @{
        @"album": @{
            @"id": album.localIdentifier ?: @"",
            @"title": album.localizedTitle ?: @"",
        },
        @"added_count": @(addedCount),
        @"imported_ids": newAssetIds,
        @"existing_ids": assetIds,
    };
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"add-to-album", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

#pragma mark - favorite

static int cmd_favorite(int argc, char **argv, int stdout_fd, int stderr_fd, BOOL compact, BOOL quiet) {
    NSString *authErr = nil;
    if (!requestPhotosAccess(&authErr)) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"favorite",
                                             NOFF_ERR_AUTHORIZATION_DENIED, authErr);
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_AUTH_DENIED;
    }

    NSString *assetId = noff_find_arg(argc, argv, "--id");
    if (!assetId) {
        noff_emit_help(stderr_fd, HELP_TEXT);
        NSDictionary *err = noff_json_error(TOOL_NAME, @"favorite",
                                             NOFF_ERR_INVALID_ARGS, @"Required: --id");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    PHFetchResult<PHAsset *> *result =
        [PHAsset fetchAssetsWithLocalIdentifiers:@[assetId] options:nil];
    PHAsset *asset = result.firstObject;
    if (!asset) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"favorite",
                                             NOFF_ERR_NO_DATA, @"Asset not found");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_ERROR;
    }

    __block BOOL newFavorite = !asset.isFavorite;
    __block NSError *changeErr = nil;
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);

    [[PHPhotoLibrary sharedPhotoLibrary] performChanges:^{
        PHAssetChangeRequest *req = [PHAssetChangeRequest changeRequestForAsset:asset];
        req.favorite = newFavorite;
    } completionHandler:^(BOOL success, NSError *error) {
        if (!success) changeErr = error;
        dispatch_semaphore_signal(sem);
    }];
    dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC));

    if (changeErr) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"favorite",
                                             NOFF_ERR_INTERNAL_ERROR,
                                             changeErr.localizedDescription ?: @"Failed to toggle favorite");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_ERROR;
    }

    NSDictionary *data = @{
        @"id": assetId,
        @"favorite": @(newFavorite),
    };
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"favorite", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

#pragma mark - delete

static int cmd_delete(int argc, char **argv, int stdout_fd, int stderr_fd, BOOL compact, BOOL quiet) {
    NSString *authErr = nil;
    if (!requestPhotosAccess(&authErr)) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"delete",
                                             NOFF_ERR_AUTHORIZATION_DENIED, authErr);
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_AUTH_DENIED;
    }

    NSString *idsStr = noff_find_arg(argc, argv, "--ids");
    if (!idsStr) {
        noff_emit_help(stderr_fd, HELP_TEXT);
        NSDictionary *err = noff_json_error(TOOL_NAME, @"delete",
                                             NOFF_ERR_INVALID_ARGS, @"Required: --ids");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    if (!noff_has_flag(argc, argv, "--confirm")) {
        noff_emit_help(stderr_fd, HELP_TEXT);
        NSDictionary *err = noff_json_error(TOOL_NAME, @"delete",
                                             NOFF_ERR_INVALID_ARGS,
                                             @"--confirm flag is required to delete assets");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    NSArray<NSString *> *assetIds = [idsStr componentsSeparatedByString:@","];

    PHFetchResult<PHAsset *> *assets =
        [PHAsset fetchAssetsWithLocalIdentifiers:assetIds options:nil];

    if (assets.count == 0) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"delete",
                                             NOFF_ERR_NO_DATA, @"No matching assets found");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_ERROR;
    }

    __block NSError *changeErr = nil;
    __block NSUInteger deletedCount = assets.count;
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);

    [[PHPhotoLibrary sharedPhotoLibrary] performChanges:^{
        [PHAssetChangeRequest deleteAssets:assets];
    } completionHandler:^(BOOL success, NSError *error) {
        if (!success) {
            changeErr = error;
            deletedCount = 0;
        }
        dispatch_semaphore_signal(sem);
    }];
    dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC));

    if (changeErr) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"delete",
                                             NOFF_ERR_INTERNAL_ERROR,
                                             changeErr.localizedDescription ?: @"Failed to delete assets");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_ERROR;
    }

    NSDictionary *data = @{
        @"deleted_count": @(deletedCount),
    };
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"delete", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

#pragma mark - Handler & Registration

static int photos_handler(int argc, char **argv,
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

    if ([subcmd isEqualToString:@"list"])         return cmd_list(argc, argv, stdout_fd, compact, quiet);
    if ([subcmd isEqualToString:@"near"])         return cmd_near(argc, argv, stdout_fd, stderr_fd, compact, quiet);
    if ([subcmd isEqualToString:@"albums"])       return cmd_albums(argc, argv, stdout_fd, compact, quiet);
    if ([subcmd isEqualToString:@"album"])        return cmd_album(argc, argv, stdout_fd, stderr_fd, compact, quiet);
    if ([subcmd isEqualToString:@"stats"])        return cmd_stats(argc, argv, stdout_fd, compact, quiet);
    if ([subcmd isEqualToString:@"export"])       return cmd_export(argc, argv, stdout_fd, stderr_fd, compact, quiet);
    if ([subcmd isEqualToString:@"import"] ||
        [subcmd isEqualToString:@"save"])         return cmd_import(argc, argv, stdout_fd, stderr_fd, compact, quiet, subcmd);
    if ([subcmd isEqualToString:@"create-album"]) return cmd_create_album(argc, argv, stdout_fd, stderr_fd, compact, quiet);
    if ([subcmd isEqualToString:@"add-to-album"]) return cmd_add_to_album(argc, argv, stdout_fd, stderr_fd, compact, quiet);
    if ([subcmd isEqualToString:@"favorite"])     return cmd_favorite(argc, argv, stdout_fd, stderr_fd, compact, quiet);
    if ([subcmd isEqualToString:@"delete"])       return cmd_delete(argc, argv, stdout_fd, stderr_fd, compact, quiet);

    noff_emit_help(stderr_fd, HELP_TEXT);
    NSDictionary *err = noff_json_error(TOOL_NAME, subcmd,
                                         NOFF_ERR_INVALID_ARGS,
                                         [NSString stringWithFormat:@"Unknown command '%@'. Valid commands: list, albums, album, export, import, save, favorite, delete, near, stats, create-album, add-to-album. Use --help for details.", subcmd]);
    noff_emit_json(stdout_fd, err, compact, quiet);
    return NOFF_EXIT_INVALID_ARGS;
}

void photos_offload_register(void) {
    int err = native_offload_add_handler("apple-photos", photos_handler);
    if (err == 0) {
        noff_ensure_guest_stub("/usr/local/bin/apple-photos");
        NSLog(@"NativeOffloads: apple-photos handler registered");
    } else {
        NSLog(@"NativeOffloads: failed to register apple-photos handler (err=%d)", err);
    }
}
