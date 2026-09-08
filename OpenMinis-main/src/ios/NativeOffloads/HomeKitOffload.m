//
//  HomeKitOffload.m
//  MinisApp
//
//  Native offload handler for `apple-homekit`.
//  Subcommands: list, search, get, set, scenes, trigger
//
//  Progressive disclosure:
//    list   → compact overview (name, room, reachable, category)
//    search → filter by name/type/room, compact results
//    get    → full detail for one accessory (all characteristics, fresh read)
//    set    → write a characteristic value
//    scenes → list available scenes
//    trigger→ execute a scene
//

#import <Foundation/Foundation.h>
#import <HomeKit/HomeKit.h>
#import "NativeOffloadUtils.h"
#include "kernel/native_offload.h"
#include <unistd.h>

static NSString *const TOOL_NAME = @"apple-homekit";

// Lock characteristic types removed from HomeKit SDK in iOS 26.
// HAP spec UUIDs: current-state = "0000001D", target-state = "0000001E".
static NSString *const kLockCurrentStateType = @"00000021-0000-1000-8000-0026BB765291";
static NSString *const kLockTargetStateType  = @"00000019-0000-1000-8000-0026BB765291";

static NSString *const HELP_TEXT =
    @"apple-homekit - Control HomeKit accessories\n"
     "\n"
     "USAGE:\n"
     "  apple-homekit <command> [options]\n"
     "\n"
     "COMMANDS:\n"
     "  list       List all homes, rooms, and accessories (compact)\n"
     "  search     Search accessories by name, type, or room\n"
     "  get        Get full accessory details with all characteristics\n"
     "  set        Set characteristic value on an accessory\n"
     "  scenes     List available scenes\n"
     "  trigger    Execute a scene\n"
     "\n"
     "COMMON OPTIONS:\n"
     "  --help, -h                    Show this help message\n"
     "  --compact                     Minimize JSON output\n"
     "  -q, --quiet                   Output only data field\n"
     "\n"
     "SEARCH OPTIONS:\n"
     "  --query <name>                Search by accessory name (fuzzy)\n"
     "  --type <category>             Filter by type: light, fan, thermostat,\n"
     "                                lock, door, sensor, switch, outlet, camera,\n"
     "                                speaker, blind, sprinkler, other\n"
     "  --room <room>                 Filter by room name (fuzzy)\n"
     "\n"
     "GET OPTIONS:\n"
     "  --name <accessory>            Accessory name (required)\n"
     "\n"
     "SET OPTIONS:\n"
     "  --name <accessory>            Accessory name (required)\n"
     "  --characteristic <type>       Characteristic type (required)\n"
     "  --value <val>                 Value to set (required)\n"
     "\n"
     "TRIGGER OPTIONS:\n"
     "  --name <scene>                Scene name (required)\n"
     "\n"
     "EXAMPLES:\n"
     "  apple-homekit list\n"
     "  apple-homekit search --query \"lamp\"\n"
     "  apple-homekit search --type light --room \"bedroom\"\n"
     "  apple-homekit search --room \"Kitchen\"\n"
     "  apple-homekit get --name \"Living Room Light\"\n"
     "  apple-homekit set --name \"Desk Lamp\" --characteristic power --value 1\n"
     "  apple-homekit set --name \"Desk Lamp\" --characteristic brightness --value 75\n"
     "  apple-homekit scenes\n"
     "  apple-homekit trigger --name \"Good Night\"\n";

// ── Singleton HMHomeManager with delegate ──
//
// HMHomeManager must live on the main thread and persists for the app lifetime.
// The delegate signals readiness once homeManagerDidUpdateHomes: fires.
// Subsequent calls to get_home_manager_sync() reuse the same instance and only
// wait if the initial callback hasn't arrived yet.

@interface NoffHomeManagerDelegate : NSObject <HMHomeManagerDelegate>
@property (nonatomic, strong) dispatch_semaphore_t semaphore;
@property (nonatomic, assign) BOOL ready;
@end

@implementation NoffHomeManagerDelegate
- (instancetype)init {
    self = [super init];
    if (self) _semaphore = dispatch_semaphore_create(0);
    return self;
}
- (void)homeManagerDidUpdateHomes:(HMHomeManager *)manager {
    if (!self.ready) {
        self.ready = YES;
        dispatch_semaphore_signal(self.semaphore);
    }
}
@end

static NoffHomeManagerDelegate *_sharedDelegate = nil;
static HMHomeManager *_sharedHomeManager = nil;

static HMHomeManager *get_home_manager_sync(void) {
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        _sharedDelegate = [[NoffHomeManagerDelegate alloc] init];

        if ([NSThread isMainThread]) {
            _sharedHomeManager = [[HMHomeManager alloc] init];
            _sharedHomeManager.delegate = _sharedDelegate;
        } else {
            dispatch_sync(dispatch_get_main_queue(), ^{
                _sharedHomeManager = [[HMHomeManager alloc] init];
                _sharedHomeManager.delegate = _sharedDelegate;
            });
        }
    });

    // If already ready from a previous call, return immediately
    if (_sharedDelegate.ready) return _sharedHomeManager;

    // Wait up to 10s for the initial homeManagerDidUpdateHomes: callback
    dispatch_semaphore_wait(_sharedDelegate.semaphore,
                            dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC));

    return _sharedDelegate.ready ? _sharedHomeManager : nil;
}

// ── Characteristic type maps ──

static NSString *characteristic_type_name(NSString *type) {
    static NSDictionary *map = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        map = @{
            HMCharacteristicTypePowerState:          @"power",
            HMCharacteristicTypeBrightness:          @"brightness",
            HMCharacteristicTypeHue:                 @"hue",
            HMCharacteristicTypeSaturation:          @"saturation",
            HMCharacteristicTypeCurrentTemperature:  @"current_temperature",
            HMCharacteristicTypeTargetTemperature:   @"target_temperature",
            HMCharacteristicTypeCurrentRelativeHumidity: @"humidity",
            kLockCurrentStateType:    @"lock_state",
            kLockTargetStateType:     @"lock_target",
            HMCharacteristicTypeObstructionDetected: @"obstruction",
            HMCharacteristicTypeCurrentDoorState:    @"door_state",
            HMCharacteristicTypeTargetDoorState:     @"door_target",
            HMCharacteristicTypeMotionDetected:      @"motion",
            HMCharacteristicTypeBatteryLevel:        @"battery_level",
        };
    });
    return map[type] ?: type;
}

static NSString *readable_name_to_characteristic_type(NSString *name) {
    static NSDictionary *reverseMap = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        reverseMap = @{
            @"power":               HMCharacteristicTypePowerState,
            @"brightness":          HMCharacteristicTypeBrightness,
            @"hue":                 HMCharacteristicTypeHue,
            @"saturation":          HMCharacteristicTypeSaturation,
            @"target_temperature":  HMCharacteristicTypeTargetTemperature,
            @"lock_target":         kLockTargetStateType,
            @"door_target":         HMCharacteristicTypeTargetDoorState,
        };
    });
    return reverseMap[name] ?: name;
}

// ── Accessory category classification ──

static NSString *accessory_category(HMAccessory *acc) {
    // Derive a human-readable category from service types
    for (HMService *svc in acc.services) {
        NSString *t = svc.serviceType;
        if ([t isEqualToString:HMServiceTypeLightbulb])        return @"light";
        if ([t isEqualToString:HMServiceTypeFan])              return @"fan";
        if ([t isEqualToString:HMServiceTypeThermostat])       return @"thermostat";
        if ([t isEqualToString:HMServiceTypeLockMechanism])    return @"lock";
        if ([t isEqualToString:HMServiceTypeGarageDoorOpener]) return @"door";
        if ([t isEqualToString:HMServiceTypeDoor])             return @"door";
        if ([t isEqualToString:HMServiceTypeWindow])           return @"blind";
        if ([t isEqualToString:HMServiceTypeWindowCovering])   return @"blind";
        if ([t isEqualToString:HMServiceTypeMotionSensor])     return @"sensor";
        if ([t isEqualToString:HMServiceTypeTemperatureSensor])return @"sensor";
        if ([t isEqualToString:HMServiceTypeHumiditySensor])   return @"sensor";
        if ([t isEqualToString:HMServiceTypeContactSensor])    return @"sensor";
        if ([t isEqualToString:HMServiceTypeSmokeSensor])      return @"sensor";
        if ([t isEqualToString:HMServiceTypeCarbonMonoxideSensor]) return @"sensor";
        if ([t isEqualToString:HMServiceTypeCarbonDioxideSensor])  return @"sensor";
        if ([t isEqualToString:HMServiceTypeLightSensor])      return @"sensor";
        if ([t isEqualToString:HMServiceTypeOccupancySensor])  return @"sensor";
        if ([t isEqualToString:HMServiceTypeLeakSensor])       return @"sensor";
        if ([t isEqualToString:HMServiceTypeSwitch])           return @"switch";
        if ([t isEqualToString:HMServiceTypeOutlet])           return @"outlet";
        if ([t isEqualToString:HMServiceTypeSpeaker])          return @"speaker";
        if ([t isEqualToString:HMServiceTypeValve] ||
            [t isEqualToString:HMServiceTypeIrrigationSystem]) return @"sprinkler";
        if ([t isEqualToString:HMServiceTypeCameraControl] ||
            [t isEqualToString:HMServiceTypeCameraRTPStreamManagement]) return @"camera";
    }
    return @"other";
}

// ── Compact accessory dict (for list/search) ──

static NSDictionary *accessory_to_compact_dict(HMAccessory *acc) {
    return @{
        @"name":      acc.name ?: @"",
        @"room":      acc.room.name ?: @"Default Room",
        @"category":  accessory_category(acc),
        @"reachable": @(acc.isReachable),
    };
}

// ── Full accessory dict (for get) ──

static id json_safe_value(id value) {
    if (!value) return [NSNull null];
    if ([value isKindOfClass:[NSString class]] ||
        [value isKindOfClass:[NSNumber class]]) return value;
    if ([value isKindOfClass:[NSData class]])
        return [(NSData *)value base64EncodedStringWithOptions:0];
    return [value description];
}

static NSDictionary *characteristic_to_dict(HMCharacteristic *c) {
    NSMutableDictionary *d = [NSMutableDictionary dictionary];
    d[@"type"] = characteristic_type_name(c.characteristicType);
    d[@"value"] = json_safe_value(c.value);

    NSMutableArray *props = [NSMutableArray array];
    if ([c.properties containsObject:HMCharacteristicPropertyReadable]) [props addObject:@"readable"];
    if ([c.properties containsObject:HMCharacteristicPropertyWritable]) [props addObject:@"writable"];
    d[@"properties"] = props;

    if (c.metadata) {
        NSMutableDictionary *meta = [NSMutableDictionary dictionary];
        if (c.metadata.minimumValue) meta[@"min"] = c.metadata.minimumValue;
        if (c.metadata.maximumValue) meta[@"max"] = c.metadata.maximumValue;
        if (c.metadata.stepValue) meta[@"step"] = c.metadata.stepValue;
        if (c.metadata.units) meta[@"units"] = c.metadata.units;
        if (meta.count > 0) d[@"metadata"] = meta;
    }

    return d;
}

static NSDictionary *accessory_to_full_dict(HMAccessory *acc) {
    NSMutableDictionary *d = [NSMutableDictionary dictionary];
    d[@"name"] = acc.name ?: @"";
    d[@"room"] = acc.room.name ?: @"Default Room";
    d[@"category"] = accessory_category(acc);
    d[@"reachable"] = @(acc.isReachable);
    d[@"blocked"] = @(acc.isBlocked);
    d[@"model"] = acc.model ?: [NSNull null];
    d[@"manufacturer"] = acc.manufacturer ?: [NSNull null];
    d[@"firmware_version"] = acc.firmwareVersion ?: [NSNull null];

    NSMutableArray *services = [NSMutableArray array];
    for (HMService *svc in acc.services) {
        if ([svc.serviceType isEqualToString:HMServiceTypeAccessoryInformation]) continue;

        NSMutableDictionary *sd = [NSMutableDictionary dictionary];
        sd[@"name"] = svc.name ?: @"";
        sd[@"type"] = svc.serviceType;

        NSMutableArray *chars = [NSMutableArray array];
        for (HMCharacteristic *c in svc.characteristics) {
            [chars addObject:characteristic_to_dict(c)];
        }
        sd[@"characteristics"] = chars;
        [services addObject:sd];
    }
    d[@"services"] = services;

    return d;
}

// ── Find accessory by name (case-insensitive, substring match) ──

static HMAccessory *find_accessory(HMHomeManager *manager, NSString *name) {
    NSString *lower = [name lowercaseString];
    // Prefer exact match first
    for (HMHome *home in manager.homes) {
        for (HMAccessory *acc in home.accessories) {
            if ([[acc.name lowercaseString] isEqualToString:lower]) {
                return acc;
            }
        }
    }
    // Fall back to substring
    for (HMHome *home in manager.homes) {
        for (HMAccessory *acc in home.accessories) {
            if ([[acc.name lowercaseString] containsString:lower]) {
                return acc;
            }
        }
    }
    return nil;
}

// ── Read all readable characteristics synchronously ──

static void read_all_characteristics(HMAccessory *acc) {
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);
    dispatch_group_t group = dispatch_group_create();
    for (HMService *svc in acc.services) {
        for (HMCharacteristic *c in svc.characteristics) {
            if ([c.properties containsObject:HMCharacteristicPropertyReadable]) {
                dispatch_group_enter(group);
                [c readValueWithCompletionHandler:^(NSError *error) {
                    dispatch_group_leave(group);
                }];
            }
        }
    }
    dispatch_group_notify(group, dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
        dispatch_semaphore_signal(sem);
    });
    dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC));
}

// ── Subcommands ──

#pragma mark - list (compact overview)

static int cmd_list(int stdout_fd, BOOL compact, BOOL quiet) {
    HMHomeManager *manager = get_home_manager_sync();
    if (!manager) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"list",
                                             NOFF_ERR_NOT_AVAILABLE,
                                             @"HomeKit not available or timed out. Check Home setup.");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_NOT_AVAILABLE;
    }

    NSMutableArray *homes = [NSMutableArray array];
    for (HMHome *home in manager.homes) {
        NSMutableDictionary *hd = [NSMutableDictionary dictionary];
        hd[@"name"] = home.name;
        hd[@"is_primary"] = @(home.isPrimary);

        NSMutableArray *rooms = [NSMutableArray array];
        for (HMRoom *room in home.rooms) {
            NSMutableDictionary *rd = [NSMutableDictionary dictionary];
            rd[@"name"] = room.name;

            NSMutableArray *accessories = [NSMutableArray array];
            for (HMAccessory *acc in room.accessories) {
                [accessories addObject:accessory_to_compact_dict(acc)];
            }
            rd[@"accessories"] = accessories;
            rd[@"accessory_count"] = @(accessories.count);
            [rooms addObject:rd];
        }
        hd[@"rooms"] = rooms;
        hd[@"room_count"] = @(rooms.count);
        hd[@"accessory_count"] = @(home.accessories.count);
        [homes addObject:hd];
    }

    NSDictionary *data = @{
        @"homes": homes,
        @"home_count": @(homes.count),
        @"hint": @"Use 'apple-homekit search' to filter or 'apple-homekit get --name <name>' for full details.",
    };
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"list", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

#pragma mark - search (filter by name/type/room)

static int cmd_search(int argc, char **argv, int stdout_fd, int stderr_fd, BOOL compact, BOOL quiet) {
    NSString *query = noff_find_arg(argc, argv, "--query");
    NSString *typeFilter = noff_find_arg(argc, argv, "--type");
    NSString *roomFilter = noff_find_arg(argc, argv, "--room");

    if (!query && !typeFilter && !roomFilter) {
        noff_emit_help(stderr_fd, HELP_TEXT);
        NSDictionary *err = noff_json_error(TOOL_NAME, @"search",
                                             NOFF_ERR_INVALID_ARGS,
                                             @"Specify at least one of --query, --type, or --room.");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    HMHomeManager *manager = get_home_manager_sync();
    if (!manager) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"search",
                                             NOFF_ERR_NOT_AVAILABLE,
                                             @"HomeKit not available or timed out.");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_NOT_AVAILABLE;
    }

    NSString *queryLower = [query lowercaseString];
    NSString *typeLower = [typeFilter lowercaseString];
    NSString *roomLower = [roomFilter lowercaseString];

    NSMutableArray *results = [NSMutableArray array];
    for (HMHome *home in manager.homes) {
        for (HMAccessory *acc in home.accessories) {
            // Name filter
            if (queryLower && ![[acc.name lowercaseString] containsString:queryLower]) {
                continue;
            }
            // Type filter
            if (typeLower && ![[accessory_category(acc) lowercaseString] isEqualToString:typeLower]) {
                continue;
            }
            // Room filter
            if (roomLower) {
                NSString *rn = [acc.room.name lowercaseString] ?: @"";
                if (![rn containsString:roomLower]) continue;
            }
            [results addObject:accessory_to_compact_dict(acc)];
        }
    }

    NSMutableDictionary *data = [NSMutableDictionary dictionary];
    data[@"accessories"] = results;
    data[@"count"] = @(results.count);
    if (query) data[@"query"] = query;
    if (typeFilter) data[@"type"] = typeFilter;
    if (roomFilter) data[@"room"] = roomFilter;
    if (results.count > 0) {
        data[@"hint"] = @"Use 'apple-homekit get --name <name>' for full details.";
    }
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"search", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

#pragma mark - get (full detail, single accessory or room)

static int cmd_get(int argc, char **argv, int stdout_fd, int stderr_fd, BOOL compact, BOOL quiet) {
    NSString *name = noff_find_arg(argc, argv, "--name");
    NSString *roomFilter = noff_find_arg(argc, argv, "--room");

    if (!name && !roomFilter) {
        noff_emit_help(stderr_fd, HELP_TEXT);
        NSDictionary *err = noff_json_error(TOOL_NAME, @"get",
                                             NOFF_ERR_INVALID_ARGS,
                                             @"Specify --name <accessory> or --room <room>.");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    HMHomeManager *manager = get_home_manager_sync();
    if (!manager) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"get",
                                             NOFF_ERR_NOT_AVAILABLE,
                                             @"HomeKit not available or timed out.");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_NOT_AVAILABLE;
    }

    if (name) {
        HMAccessory *acc = find_accessory(manager, name);
        if (!acc) {
            NSDictionary *err = noff_json_error(TOOL_NAME, @"get",
                                                 NOFF_ERR_NO_DATA,
                                                 [NSString stringWithFormat:@"Accessory '%@' not found.", name]);
            noff_emit_json(stdout_fd, err, compact, quiet);
            return NOFF_EXIT_ERROR;
        }

        read_all_characteristics(acc);
        noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"get", accessory_to_full_dict(acc)), compact, quiet);
        return NOFF_EXIT_SUCCESS;
    }

    // Room filter — return full details for all accessories in matching rooms
    NSString *roomLower = [roomFilter lowercaseString];
    NSMutableArray *accessories = [NSMutableArray array];
    for (HMHome *home in manager.homes) {
        for (HMRoom *room in home.rooms) {
            NSString *rn = [room.name lowercaseString] ?: @"";
            if ([rn isEqualToString:roomLower] || [rn containsString:roomLower]) {
                for (HMAccessory *acc in room.accessories) {
                    read_all_characteristics(acc);
                    [accessories addObject:accessory_to_full_dict(acc)];
                }
            }
        }
    }

    NSDictionary *data = @{
        @"room": roomFilter,
        @"accessories": accessories,
        @"count": @(accessories.count),
    };
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"get", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

#pragma mark - set (write characteristic)

static int cmd_set(int argc, char **argv, int stdout_fd, int stderr_fd, BOOL compact, BOOL quiet) {
    NSString *name = noff_find_arg(argc, argv, "--name");
    NSString *charType = noff_find_arg(argc, argv, "--characteristic");
    NSString *valueStr = noff_find_arg(argc, argv, "--value");

    if (!name || !charType || !valueStr) {
        noff_emit_help(stderr_fd, HELP_TEXT);
        NSDictionary *err = noff_json_error(TOOL_NAME, @"set",
                                             NOFF_ERR_INVALID_ARGS,
                                             @"Required: --name <accessory> --characteristic <type> --value <val>");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    HMHomeManager *manager = get_home_manager_sync();
    if (!manager) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"set",
                                             NOFF_ERR_NOT_AVAILABLE,
                                             @"HomeKit not available or timed out.");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_NOT_AVAILABLE;
    }

    HMAccessory *acc = find_accessory(manager, name);
    if (!acc) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"set",
                                             NOFF_ERR_NO_DATA,
                                             [NSString stringWithFormat:@"Accessory '%@' not found.", name]);
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_ERROR;
    }

    // Find the characteristic
    NSString *resolvedType = readable_name_to_characteristic_type(charType);
    HMCharacteristic *targetChar = nil;
    for (HMService *svc in acc.services) {
        for (HMCharacteristic *c in svc.characteristics) {
            if ([c.characteristicType isEqualToString:resolvedType] ||
                [characteristic_type_name(c.characteristicType) isEqualToString:charType]) {
                targetChar = c;
                break;
            }
        }
        if (targetChar) break;
    }

    if (!targetChar) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"set",
                                             NOFF_ERR_NO_DATA,
                                             [NSString stringWithFormat:@"Characteristic '%@' not found on '%@'.", charType, name]);
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_ERROR;
    }

    if (![targetChar.properties containsObject:HMCharacteristicPropertyWritable]) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"set",
                                             NOFF_ERR_INVALID_ARGS,
                                             [NSString stringWithFormat:@"Characteristic '%@' is read-only.", charType]);
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    // Parse value — attempt number first, then boolean, then string
    id value;
    if ([valueStr isEqualToString:@"true"] || [valueStr isEqualToString:@"1"]) {
        value = @YES;
    } else if ([valueStr isEqualToString:@"false"] || [valueStr isEqualToString:@"0"]) {
        value = @NO;
    } else {
        NSNumberFormatter *fmt = [[NSNumberFormatter alloc] init];
        fmt.numberStyle = NSNumberFormatterDecimalStyle;
        NSNumber *num = [fmt numberFromString:valueStr];
        value = num ?: valueStr;
    }

    dispatch_semaphore_t sem = dispatch_semaphore_create(0);
    __block NSError *writeError = nil;

    [targetChar writeValue:value completionHandler:^(NSError *error) {
        writeError = error;
        dispatch_semaphore_signal(sem);
    }];

    dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC));

    if (writeError) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"set",
                                             NOFF_ERR_INTERNAL_ERROR,
                                             writeError.localizedDescription);
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_ERROR;
    }

    NSDictionary *data = @{
        @"accessory": acc.name ?: @"",
        @"characteristic": charType,
        @"value": value,
        @"success": @YES,
    };
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"set", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

#pragma mark - scenes

static int cmd_scenes(int stdout_fd, BOOL compact, BOOL quiet) {
    HMHomeManager *manager = get_home_manager_sync();
    if (!manager) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"scenes",
                                             NOFF_ERR_NOT_AVAILABLE,
                                             @"HomeKit not available or timed out.");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_NOT_AVAILABLE;
    }

    NSMutableArray *scenes = [NSMutableArray array];
    for (HMHome *home in manager.homes) {
        for (HMActionSet *actionSet in home.actionSets) {
            NSMutableDictionary *sd = [NSMutableDictionary dictionary];
            sd[@"name"] = actionSet.name;
            sd[@"home"] = home.name;
            sd[@"action_count"] = @(actionSet.actions.count);
            sd[@"type"] = actionSet.actionSetType;

            NSMutableArray *actions = [NSMutableArray array];
            for (HMAction *action in actionSet.actions) {
                if ([action isKindOfClass:[HMCharacteristicWriteAction class]]) {
                    HMCharacteristicWriteAction *wa = (HMCharacteristicWriteAction *)action;
                    [actions addObject:@{
                        @"accessory": wa.characteristic.service.accessory.name ?: @"",
                        @"characteristic": characteristic_type_name(wa.characteristic.characteristicType),
                        @"target_value": wa.targetValue ?: [NSNull null],
                    }];
                }
            }
            sd[@"actions"] = actions;
            [scenes addObject:sd];
        }
    }

    NSDictionary *data = @{
        @"scenes": scenes,
        @"count": @(scenes.count),
    };
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"scenes", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

#pragma mark - trigger

static int cmd_trigger(int argc, char **argv, int stdout_fd, int stderr_fd, BOOL compact, BOOL quiet) {
    NSString *name = noff_find_arg(argc, argv, "--name");
    if (!name) {
        noff_emit_help(stderr_fd, HELP_TEXT);
        NSDictionary *err = noff_json_error(TOOL_NAME, @"trigger",
                                             NOFF_ERR_INVALID_ARGS,
                                             @"--name <scene> is required.");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    HMHomeManager *manager = get_home_manager_sync();
    if (!manager) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"trigger",
                                             NOFF_ERR_NOT_AVAILABLE,
                                             @"HomeKit not available or timed out.");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_NOT_AVAILABLE;
    }

    NSString *lower = [name lowercaseString];
    HMActionSet *targetScene = nil;
    HMHome *targetHome = nil;
    // Prefer exact match
    for (HMHome *home in manager.homes) {
        for (HMActionSet *actionSet in home.actionSets) {
            if ([[actionSet.name lowercaseString] isEqualToString:lower]) {
                targetScene = actionSet;
                targetHome = home;
                break;
            }
        }
        if (targetScene) break;
    }
    // Fall back to substring
    if (!targetScene) {
        for (HMHome *home in manager.homes) {
            for (HMActionSet *actionSet in home.actionSets) {
                if ([[actionSet.name lowercaseString] containsString:lower]) {
                    targetScene = actionSet;
                    targetHome = home;
                    break;
                }
            }
            if (targetScene) break;
        }
    }

    if (!targetScene) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"trigger",
                                             NOFF_ERR_NO_DATA,
                                             [NSString stringWithFormat:@"Scene '%@' not found.", name]);
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_ERROR;
    }

    dispatch_semaphore_t sem = dispatch_semaphore_create(0);
    __block NSError *execError = nil;

    [targetHome executeActionSet:targetScene completionHandler:^(NSError *error) {
        execError = error;
        dispatch_semaphore_signal(sem);
    }];

    dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 15 * NSEC_PER_SEC));

    if (execError) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"trigger",
                                             NOFF_ERR_INTERNAL_ERROR,
                                             execError.localizedDescription);
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_ERROR;
    }

    NSDictionary *data = @{
        @"scene": targetScene.name,
        @"home": targetHome.name,
        @"triggered": @YES,
        @"action_count": @(targetScene.actions.count),
    };
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"trigger", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

#pragma mark - Handler & Registration

static int homekit_handler(int argc, char **argv,
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

    if ([subcmd isEqualToString:@"list"])    return cmd_list(stdout_fd, compact, quiet);
    if ([subcmd isEqualToString:@"search"])  return cmd_search(argc, argv, stdout_fd, stderr_fd, compact, quiet);
    if ([subcmd isEqualToString:@"get"])     return cmd_get(argc, argv, stdout_fd, stderr_fd, compact, quiet);
    if ([subcmd isEqualToString:@"set"])     return cmd_set(argc, argv, stdout_fd, stderr_fd, compact, quiet);
    if ([subcmd isEqualToString:@"scenes"])  return cmd_scenes(stdout_fd, compact, quiet);
    if ([subcmd isEqualToString:@"trigger"]) return cmd_trigger(argc, argv, stdout_fd, stderr_fd, compact, quiet);

    noff_emit_help(stderr_fd, HELP_TEXT);
    NSDictionary *err = noff_json_error(TOOL_NAME, subcmd,
                                         NOFF_ERR_INVALID_ARGS,
                                         [NSString stringWithFormat:@"Unknown command '%@'. Valid commands: list, search, get, set, scenes, trigger. Use --help for details.", subcmd]);
    noff_emit_json(stdout_fd, err, compact, quiet);
    return NOFF_EXIT_INVALID_ARGS;
}

void homekit_offload_register(void) {
    int err = native_offload_add_handler("apple-homekit", homekit_handler);
    if (err == 0) {
        noff_ensure_guest_stub("/usr/local/bin/apple-homekit");
        NSLog(@"NativeOffloads: apple-homekit handler registered");
    } else {
        NSLog(@"NativeOffloads: failed to register apple-homekit handler (err=%d)", err);
    }
}
