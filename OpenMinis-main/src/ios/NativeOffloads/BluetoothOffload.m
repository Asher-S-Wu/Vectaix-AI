//
//  BluetoothOffload.m
//  MinisApp
//
//  Native offload handler for `apple-bluetooth`.
//  Subcommands: scan, connect, disconnect, services, read, write, status, notify
//

#import <Foundation/Foundation.h>
#import <CoreBluetooth/CoreBluetooth.h>
#import "NativeOffloadUtils.h"
#include "kernel/native_offload.h"
#include <unistd.h>
#include <signal.h>
#include <stdatomic.h>

static NSString *const TOOL_NAME = @"apple-bluetooth";

static NSString *const HELP_TEXT =
    @"apple-bluetooth - Bluetooth Low Energy operations\n"
     "\n"
     "USAGE:\n"
     "  apple-bluetooth <command> [options]\n"
     "\n"
     "COMMANDS:\n"
     "  status         Get Bluetooth adapter status\n"
     "  scan           Scan for nearby BLE peripherals\n"
     "  connect        Connect to a peripheral by UUID\n"
     "  disconnect     Disconnect from a peripheral\n"
     "  services       List services and characteristics of a connected peripheral\n"
     "  read           Read a characteristic value\n"
     "  write          Write a value to a characteristic\n"
     "  notify         Subscribe to a characteristic's notify/indicate updates\n"
     "\n"
     "OPTIONS:\n"
     "  --help, -h              Show this help message\n"
     "  --compact               Minimize JSON output\n"
     "  -q, --quiet             Output only data field\n"
     "  --duration <seconds>    Scan / notify duration (scan default: 5, notify default: 10, notify 0 = until Ctrl-C)\n"
     "  --uuid <peripheral>     Peripheral UUID (for connect/disconnect/services/read/write/notify)\n"
     "  --service <uuid>        Service UUID filter (for scan/read/write/notify)\n"
     "  --characteristic <uuid> Characteristic UUID (for read/write/notify)\n"
     "  --value <hex>           Hex-encoded value to write\n"
     "  --value-string <text>   UTF-8 string value to write\n"
     "\n"
     "EXAMPLES:\n"
     "  apple-bluetooth status\n"
     "  apple-bluetooth scan --duration 10\n"
     "  apple-bluetooth scan --service 180D\n"
     "  apple-bluetooth connect --uuid <peripheral-uuid>\n"
     "  apple-bluetooth services --uuid <peripheral-uuid>\n"
     "  apple-bluetooth read --uuid <peripheral-uuid> --service 180D --characteristic 2A37\n"
     "  apple-bluetooth write --uuid <peripheral-uuid> --service 180D --characteristic 2A39 --value 0100\n"
     "  apple-bluetooth notify --uuid <peripheral-uuid> --service 180D --characteristic 2A37 --duration 15\n"
     "  apple-bluetooth notify --uuid <peripheral-uuid> --service 180D --characteristic 2A37 --duration 0  # until Ctrl-C\n";

// MARK: - BLE Delegate Helper

/// Synchronous wrapper around CoreBluetooth async delegate callbacks.
@interface BLEHelper : NSObject <CBCentralManagerDelegate, CBPeripheralDelegate>
@property (nonatomic, strong) CBCentralManager *central;
@property (nonatomic, strong) NSMutableArray<CBPeripheral *> *discovered;
@property (nonatomic, strong) CBPeripheral *connectedPeripheral;
@property (nonatomic, strong) NSMutableArray<NSDictionary *> *discoveredInfo;
@property (nonatomic, strong) NSData *readValue;
@property (nonatomic, assign) BOOL writeSuccess;
@property (nonatomic, strong) NSString *errorMessage;
@property (nonatomic, strong) dispatch_semaphore_t semaphore;
@property (nonatomic, assign) CBManagerState managerState;
@property (nonatomic, assign) BOOL servicesDiscovered;
/// Auto-disconnect timer — fires after inactivity timeout.
@property (nonatomic, strong) dispatch_source_t disconnectTimer;
// MARK: notify subcommand state
/// Characteristic we're currently subscribed to (weak — peripheral owns it).
@property (nonatomic, weak) CBCharacteristic *notifyChar;
/// Append-only buffer of received notify samples. Each entry is a
/// dictionary with timestamp / value_hex / value_base64 / value_string,
/// matching the documented JSON shape.
@property (nonatomic, strong) NSMutableArray<NSDictionary *> *notifyBuffer;
/// Lock guarding notifyBuffer — appended from the main queue's delegate
/// callback and drained from the helper thread when duration expires.
@property (nonatomic, strong) NSLock *notifyBufferLock;
/// Separate semaphore for `didUpdateNotificationStateForCharacteristic`
/// signalling, so the read/write/discover semaphore stays uncoupled.
@property (nonatomic, strong) dispatch_semaphore_t notifyStateSem;
@end

static const NSTimeInterval kAutoDisconnectTimeout = 300.0; // 5 minutes

// Forward declarations for helpers used by the BLEHelper delegate methods
// below. Implementations live further down in the file.
static NSString *dataToHex(NSData *data);

@implementation BLEHelper

- (instancetype)init {
    self = [super init];
    if (self) {
        _discovered = [NSMutableArray new];
        _discoveredInfo = [NSMutableArray new];
        _semaphore = dispatch_semaphore_create(0);
        _notifyBuffer = [NSMutableArray new];
        _notifyBufferLock = [NSLock new];
        _notifyStateSem = dispatch_semaphore_create(0);

        // Create central manager on main queue (required by CoreBluetooth)
        dispatch_semaphore_t initSem = dispatch_semaphore_create(0);
        dispatch_async(dispatch_get_main_queue(), ^{
            self->_central = [[CBCentralManager alloc] initWithDelegate:self queue:nil options:@{
                CBCentralManagerOptionShowPowerAlertKey: @NO
            }];
            dispatch_semaphore_signal(initSem);
        });
        dispatch_semaphore_wait(initSem, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC));
    }
    return self;
}

- (void)waitForPowerOn {
    // Wait up to 3 seconds for BT to be ready
    for (int i = 0; i < 30 && self.managerState != CBManagerStatePoweredOn; i++) {
        dispatch_semaphore_wait(self.semaphore, dispatch_time(DISPATCH_TIME_NOW, 100 * NSEC_PER_MSEC));
    }
}

/// Reset the auto-disconnect timer. Called after every command that uses the connection.
- (void)resetDisconnectTimer {
    [self cancelDisconnectTimer];
    if (!self.connectedPeripheral) return;
    self.disconnectTimer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_main_queue());
    dispatch_source_set_timer(self.disconnectTimer,
        dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kAutoDisconnectTimeout * NSEC_PER_SEC)),
        DISPATCH_TIME_FOREVER, 1 * NSEC_PER_SEC);
    __weak BLEHelper *weakSelf = self;
    dispatch_source_set_event_handler(self.disconnectTimer, ^{
        BLEHelper *s = weakSelf;
        if (s && s.connectedPeripheral) {
            NSLog(@"[BLE] Auto-disconnecting after %.0fs inactivity", kAutoDisconnectTimeout);
            [s.central cancelPeripheralConnection:s.connectedPeripheral];
        }
    });
    dispatch_resume(self.disconnectTimer);
}

- (void)cancelDisconnectTimer {
    if (self.disconnectTimer) {
        dispatch_source_cancel(self.disconnectTimer);
        self.disconnectTimer = nil;
    }
}

// MARK: CBCentralManagerDelegate

- (void)centralManagerDidUpdateState:(CBCentralManager *)central {
    self.managerState = central.state;
    dispatch_semaphore_signal(self.semaphore);
}

- (void)centralManager:(CBCentralManager *)central
 didDiscoverPeripheral:(CBPeripheral *)peripheral
     advertisementData:(NSDictionary<NSString *,id> *)advertisementData
                  RSSI:(NSNumber *)RSSI {
    // Dedup by identifier
    for (CBPeripheral *p in self.discovered) {
        if ([p.identifier isEqual:peripheral.identifier]) return;
    }
    [self.discovered addObject:peripheral];

    NSMutableDictionary *info = [NSMutableDictionary dictionary];
    info[@"uuid"] = peripheral.identifier.UUIDString;
    info[@"name"] = peripheral.name ?: [NSNull null];
    info[@"rssi"] = RSSI;

    NSArray *serviceUUIDs = advertisementData[CBAdvertisementDataServiceUUIDsKey];
    if (serviceUUIDs) {
        info[@"advertised_services"] = [serviceUUIDs valueForKey:@"UUIDString"];
    }

    NSNumber *connectable = advertisementData[CBAdvertisementDataIsConnectable];
    if (connectable) info[@"connectable"] = connectable;

    NSNumber *txPower = advertisementData[CBAdvertisementDataTxPowerLevelKey];
    if (txPower) info[@"tx_power"] = txPower;

    [self.discoveredInfo addObject:info];
}

- (void)centralManager:(CBCentralManager *)central
  didConnectPeripheral:(CBPeripheral *)peripheral {
    self.connectedPeripheral = peripheral;
    [self resetDisconnectTimer];
    dispatch_semaphore_signal(self.semaphore);
}

- (void)centralManager:(CBCentralManager *)central
didFailToConnectPeripheral:(CBPeripheral *)peripheral
                 error:(NSError *)error {
    self.errorMessage = error.localizedDescription ?: @"Connection failed";
    dispatch_semaphore_signal(self.semaphore);
}

- (void)centralManager:(CBCentralManager *)central
didDisconnectPeripheral:(CBPeripheral *)peripheral
                 error:(NSError *)error {
    self.connectedPeripheral = nil;
    [self cancelDisconnectTimer];
    dispatch_semaphore_signal(self.semaphore);
}

// MARK: CBPeripheralDelegate

- (void)peripheral:(CBPeripheral *)peripheral didDiscoverServices:(NSError *)error {
    if (error) {
        self.errorMessage = error.localizedDescription;
    }
    self.servicesDiscovered = YES;
    dispatch_semaphore_signal(self.semaphore);
}

- (void)peripheral:(CBPeripheral *)peripheral
didDiscoverCharacteristicsForService:(CBService *)service
             error:(NSError *)error {
    if (error) {
        self.errorMessage = error.localizedDescription;
    }
    dispatch_semaphore_signal(self.semaphore);
}

- (void)peripheral:(CBPeripheral *)peripheral
didUpdateValueForCharacteristic:(CBCharacteristic *)characteristic
             error:(NSError *)error {
    // The notify path and the read path share this delegate method on
    // CoreBluetooth. When characteristic.isNotifying is true and we have
    // an active subscription on the same CBCharacteristic, route the
    // update into the notify ring instead of overwriting `readValue` /
    // signalling the synchronous read semaphore.
    CBCharacteristic *target = self.notifyChar;
    if (target && characteristic == target && characteristic.isNotifying) {
        if (error) {
            // Stream-time errors are surfaced through `errorMessage` but
            // we keep delivering subsequent samples (the central manager
            // does this anyway). Don't append a sample for the error.
            self.errorMessage = error.localizedDescription;
            return;
        }
        NSData *value = characteristic.value ?: [NSData data];
        NSString *hex = dataToHex(value);
        NSString *b64 = [value base64EncodedStringWithOptions:0];
        NSString *utf8 = [[NSString alloc] initWithData:value encoding:NSUTF8StringEncoding];
        NSDate *now = [NSDate date];
        NSISO8601DateFormatter *fmt = [NSISO8601DateFormatter new];
        fmt.formatOptions = NSISO8601DateFormatWithInternetDateTime |
                            NSISO8601DateFormatWithFractionalSeconds;
        NSDictionary *sample = @{
            @"timestamp": [fmt stringFromDate:now],
            @"value_hex": hex,
            @"value_base64": b64,
            @"value_string": utf8 ?: [NSNull null],
        };
        [self.notifyBufferLock lock];
        [self.notifyBuffer addObject:sample];
        [self.notifyBufferLock unlock];
        return;
    }
    // Synchronous read path (cmd_read).
    if (error) {
        self.errorMessage = error.localizedDescription;
    } else {
        self.readValue = characteristic.value;
    }
    dispatch_semaphore_signal(self.semaphore);
}

- (void)peripheral:(CBPeripheral *)peripheral
didUpdateNotificationStateForCharacteristic:(CBCharacteristic *)characteristic
             error:(NSError *)error {
    if (error) {
        self.errorMessage = error.localizedDescription;
    }
    dispatch_semaphore_signal(self.notifyStateSem);
}

- (void)peripheral:(CBPeripheral *)peripheral
didWriteValueForCharacteristic:(CBCharacteristic *)characteristic
             error:(NSError *)error {
    if (error) {
        self.errorMessage = error.localizedDescription;
        self.writeSuccess = NO;
    } else {
        self.writeSuccess = YES;
    }
    dispatch_semaphore_signal(self.semaphore);
}

@end

// MARK: - Shared BLE Helper (persists connections across commands)

static BLEHelper *sharedBLE(void) {
    static BLEHelper *helper = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        helper = [[BLEHelper alloc] init];
    });
    return helper;
}

// [T-ish-offload-hang-audit] Drop stale tokens from the shared BLE semaphore
// before issuing a new request.
//
// BLEHelper is a process-wide singleton (above) and `semaphore` is created ONCE
// with a count of 0, yet it is signalled from seven different delegate
// callbacks (didUpdateState / didConnect / didFailToConnect / didDisconnect /
// didDiscoverServices / didDiscoverCharacteristics / didUpdateValue /
// didWriteValue). A dispatch semaphore COUNTS: when a call times out and gives
// up, a CoreBluetooth callback that arrives afterwards — routine with a slow or
// flaky peripheral — still signals, raising the count to 1 where it stays
// forever.
//
// The next command's wait then returns immediately on that leftover token
// rather than on its own callback, and the code proceeds to read state the
// callback never set: a characteristic read returns the PREVIOUS read's value,
// a write reports success it never got. That is a silent wrong answer, which is
// worse than the timeout it masquerades as.
//
// The same hazard was already recognised for `notifyStateSem`, which drains
// exactly like this before use (see the notify path). This generalises that fix
// to the main semaphore, which had no such protection.
//
// Deliberately called just before the async request is issued, NOT immediately
// before the wait: the request must be in flight only after the counter is
// clean, otherwise a genuine fast callback could be drained away.
//
// `errorMessage` is already reset at each of these sites, so error state was
// never the gap — only the semaphore counter.
static void drainStaleBLESignals(BLEHelper *ble) {
    NSUInteger drained = 0;
    while (dispatch_semaphore_wait(ble.semaphore, DISPATCH_TIME_NOW) == 0)
        drained++;
    if (drained > 0)
        NSLog(@"[BLE] dropped %lu stale semaphore token(s) from a previous command",
              (unsigned long)drained);
}

static NSString *stateString(CBManagerState state) {
    switch (state) {
        case CBManagerStatePoweredOn:    return @"powered_on";
        case CBManagerStatePoweredOff:   return @"powered_off";
        case CBManagerStateUnauthorized: return @"unauthorized";
        case CBManagerStateUnsupported:  return @"unsupported";
        case CBManagerStateResetting:    return @"resetting";
        default:                         return @"unknown";
    }
}

static NSData *dataFromHex(NSString *hex) {
    NSMutableData *data = [NSMutableData new];
    for (NSUInteger i = 0; i + 1 < hex.length; i += 2) {
        unsigned int byte;
        NSScanner *scanner = [NSScanner scannerWithString:[hex substringWithRange:NSMakeRange(i, 2)]];
        if ([scanner scanHexInt:&byte]) {
            uint8_t b = (uint8_t)byte;
            [data appendBytes:&b length:1];
        }
    }
    return data;
}

static NSString *dataToHex(NSData *data) {
    const uint8_t *bytes = data.bytes;
    NSMutableString *hex = [NSMutableString stringWithCapacity:data.length * 2];
    for (NSUInteger i = 0; i < data.length; i++) {
        [hex appendFormat:@"%02x", bytes[i]];
    }
    return hex;
}

// MARK: - Commands

static int cmd_status(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    BLEHelper *ble = sharedBLE();
    [ble waitForPowerOn];

    // Clear stale reference if peripheral disconnected externally
    if (ble.connectedPeripheral && ble.connectedPeripheral.state != CBPeripheralStateConnected) {
        ble.connectedPeripheral = nil;
        [ble cancelDisconnectTimer];
    }
    BOOL connected = (ble.connectedPeripheral != nil);
    NSMutableDictionary *data = [@{
        @"state": stateString(ble.managerState),
        @"is_scanning": @(ble.central.isScanning),
        @"has_connected_peripheral": @(connected),
    } mutableCopy];
    if (connected) {
        data[@"connected_uuid"] = ble.connectedPeripheral.identifier.UUIDString;
        data[@"connected_name"] = ble.connectedPeripheral.name ?: [NSNull null];
    }
    if (ble.managerState == CBManagerStatePoweredOn) {
        data[@"hint"] = connected
            ? @"Peripheral connected. Use 'apple-bluetooth services' to discover services, then 'read' or 'write' characteristics."
            : @"Bluetooth is ready. Use 'apple-bluetooth scan' to discover nearby BLE peripherals.";
    } else if (ble.managerState == CBManagerStatePoweredOff) {
        data[@"hint"] = @"Bluetooth is off. Ask the user to enable it in Settings > Bluetooth.";
    } else if (ble.managerState == CBManagerStateUnauthorized) {
        data[@"hint"] = @"Bluetooth permission denied. Ask the user to enable it in Settings > Privacy > Bluetooth.";
    }
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"status", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

static int cmd_scan(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    BLEHelper *ble = sharedBLE();
    [ble waitForPowerOn];

    if (ble.managerState != CBManagerStatePoweredOn) {
        noff_emit_json(stdout_fd,
            noff_json_error(TOOL_NAME, @"scan", NOFF_ERR_NOT_AVAILABLE,
                @"Bluetooth is not powered on. Check Settings > Bluetooth."),
            compact, quiet);
        return NOFF_EXIT_NOT_AVAILABLE;
    }

    NSString *durationStr = noff_find_arg(argc, argv, "--duration");
    NSTimeInterval duration = durationStr ? [durationStr doubleValue] : 5.0;
    if (duration <= 0 || duration > 60) duration = 5.0;

    NSString *serviceFilter = noff_find_arg(argc, argv, "--service");
    NSArray *serviceUUIDs = nil;
    if (serviceFilter) {
        serviceUUIDs = @[[CBUUID UUIDWithString:serviceFilter]];
    }

    [ble.discovered removeAllObjects];
    [ble.discoveredInfo removeAllObjects];

    dispatch_semaphore_t scanSem = dispatch_semaphore_create(0);
    dispatch_async(dispatch_get_main_queue(), ^{
        [ble.central scanForPeripheralsWithServices:serviceUUIDs options:@{
            CBCentralManagerScanOptionAllowDuplicatesKey: @NO
        }];
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(duration * NSEC_PER_SEC)),
                       dispatch_get_main_queue(), ^{
            [ble.central stopScan];
            dispatch_semaphore_signal(scanSem);
        });
    });
    dispatch_semaphore_wait(scanSem, dispatch_time(DISPATCH_TIME_NOW, (int64_t)((duration + 2) * NSEC_PER_SEC)));

    NSMutableDictionary *data = [@{
        @"count": @(ble.discoveredInfo.count),
        @"duration_seconds": @(duration),
        @"peripherals": [ble.discoveredInfo copy],
    } mutableCopy];
    if (ble.discoveredInfo.count > 0) {
        data[@"hint"] = @"Use 'apple-bluetooth connect --uuid <peripheral-uuid>' to connect to a device, then 'services' to discover its capabilities.";
    } else {
        data[@"hint"] = @"No devices found. Try 'apple-bluetooth scan --duration 15' for a longer scan, or ensure the target device is advertising.";
    }
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"scan", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

static int cmd_connect(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    NSString *uuidStr = noff_find_arg(argc, argv, "--uuid");
    if (!uuidStr) {
        noff_emit_json(stdout_fd,
            noff_json_error(TOOL_NAME, @"connect", NOFF_ERR_INVALID_ARGS, @"--uuid is required."),
            compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    BLEHelper *ble = sharedBLE();
    [ble waitForPowerOn];

    NSUUID *uuid = [[NSUUID alloc] initWithUUIDString:uuidStr];
    if (!uuid) {
        noff_emit_json(stdout_fd,
            noff_json_error(TOOL_NAME, @"connect", NOFF_ERR_INVALID_ARGS, @"Invalid UUID format."),
            compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    // Find peripheral from known or discovered list
    NSArray<CBPeripheral *> *known = [ble.central retrievePeripheralsWithIdentifiers:@[uuid]];
    CBPeripheral *peripheral = known.firstObject;
    if (!peripheral) {
        // Try discovered list
        for (CBPeripheral *p in ble.discovered) {
            if ([p.identifier isEqual:uuid]) { peripheral = p; break; }
        }
    }
    if (!peripheral) {
        noff_emit_json(stdout_fd,
            noff_json_error(TOOL_NAME, @"connect", NOFF_ERR_NO_DATA,
                @"Peripheral not found. Run 'apple-bluetooth scan' first to discover nearby devices."),
            compact, quiet);
        return NOFF_EXIT_ERROR;
    }

    ble.errorMessage = nil;
    ble.connectedPeripheral = nil;
    drainStaleBLESignals(ble);
    dispatch_async(dispatch_get_main_queue(), ^{
        [ble.central connectPeripheral:peripheral options:nil];
    });
    dispatch_semaphore_wait(ble.semaphore, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC));

    if (ble.errorMessage) {
        noff_emit_json(stdout_fd,
            noff_json_error(TOOL_NAME, @"connect", NOFF_ERR_INTERNAL_ERROR, ble.errorMessage),
            compact, quiet);
        return NOFF_EXIT_ERROR;
    }
    if (!ble.connectedPeripheral) {
        noff_emit_json(stdout_fd,
            noff_json_error(TOOL_NAME, @"connect", NOFF_ERR_INTERNAL_ERROR, @"Connection timed out."),
            compact, quiet);
        return NOFF_EXIT_ERROR;
    }

    NSDictionary *data = @{
        @"uuid": peripheral.identifier.UUIDString,
        @"name": peripheral.name ?: [NSNull null],
        @"state": @"connected",
        @"hint": @"Connected (auto-disconnects after 5 min idle). Use 'apple-bluetooth services --uuid <uuid>' to discover available services and characteristics.",
    };
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"connect", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

static int cmd_disconnect(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    BLEHelper *ble = sharedBLE();
    CBPeripheral *peripheral = ble.connectedPeripheral;
    if (!peripheral) {
        noff_emit_json(stdout_fd,
            noff_json_error(TOOL_NAME, @"disconnect", NOFF_ERR_NO_DATA, @"No peripheral connected. Run 'apple-bluetooth scan' then 'connect --uuid <uuid>' first."),
            compact, quiet);
        return NOFF_EXIT_ERROR;
    }

    drainStaleBLESignals(ble);
    dispatch_async(dispatch_get_main_queue(), ^{
        [ble.central cancelPeripheralConnection:peripheral];
    });
    dispatch_semaphore_wait(ble.semaphore, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC));

    NSDictionary *data = @{
        @"uuid": peripheral.identifier.UUIDString,
        @"state": @"disconnected",
    };
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"disconnect", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

static int cmd_services(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    BLEHelper *ble = sharedBLE();
    CBPeripheral *peripheral = ble.connectedPeripheral;
    if (!peripheral) {
        noff_emit_json(stdout_fd,
            noff_json_error(TOOL_NAME, @"services", NOFF_ERR_NO_DATA,
                @"No peripheral connected. Run 'apple-bluetooth scan' then 'apple-bluetooth connect --uuid <uuid>' first."),
            compact, quiet);
        return NOFF_EXIT_ERROR;
    }

    // Discover services
    ble.servicesDiscovered = NO;
    ble.errorMessage = nil;
    peripheral.delegate = ble;
    drainStaleBLESignals(ble);
    dispatch_async(dispatch_get_main_queue(), ^{
        [peripheral discoverServices:nil];
    });
    dispatch_semaphore_wait(ble.semaphore, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC));

    if (ble.errorMessage) {
        noff_emit_json(stdout_fd,
            noff_json_error(TOOL_NAME, @"services", NOFF_ERR_INTERNAL_ERROR, ble.errorMessage),
            compact, quiet);
        return NOFF_EXIT_ERROR;
    }

    // Discover characteristics for each service
    NSMutableArray *servicesArr = [NSMutableArray new];
    for (CBService *service in peripheral.services) {
        ble.errorMessage = nil;
        drainStaleBLESignals(ble);
        dispatch_async(dispatch_get_main_queue(), ^{
            [peripheral discoverCharacteristics:nil forService:service];
        });
        dispatch_semaphore_wait(ble.semaphore, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC));

        NSMutableArray *chars = [NSMutableArray new];
        for (CBCharacteristic *c in service.characteristics) {
            NSMutableArray *props = [NSMutableArray new];
            if (c.properties & CBCharacteristicPropertyRead) [props addObject:@"read"];
            if (c.properties & CBCharacteristicPropertyWrite) [props addObject:@"write"];
            if (c.properties & CBCharacteristicPropertyWriteWithoutResponse) [props addObject:@"write_no_response"];
            if (c.properties & CBCharacteristicPropertyNotify) [props addObject:@"notify"];
            if (c.properties & CBCharacteristicPropertyIndicate) [props addObject:@"indicate"];

            [chars addObject:@{
                @"uuid": c.UUID.UUIDString,
                @"properties": props,
            }];
        }

        [servicesArr addObject:@{
            @"uuid": service.UUID.UUIDString,
            @"characteristics": chars,
        }];
    }

    NSDictionary *data = @{
        @"uuid": peripheral.identifier.UUIDString,
        @"name": peripheral.name ?: [NSNull null],
        @"services": servicesArr,
        @"hint": @"Use 'apple-bluetooth read --uuid <uuid> --service <service-uuid> --characteristic <char-uuid>' to read a value, or 'write' to send data.",
    };
    [ble resetDisconnectTimer];
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"services", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

/// Ensure the helper has a connected CBPeripheral whose identifier matches
/// `uuidStr`. If the helper currently has no connection, or a different
/// peripheral connected, this disconnects and reconnects synchronously.
/// On success returns the connected CBPeripheral; on failure returns nil
/// and populates `*errOut` with a human-readable diagnostic.
static CBPeripheral *ensureConnected(BLEHelper *ble, NSString *uuidStr, NSString **errOut) {
    NSUUID *uuid = [[NSUUID alloc] initWithUUIDString:uuidStr];
    if (!uuid) {
        if (errOut) *errOut = @"Invalid UUID format.";
        return nil;
    }
    // Already connected to the right peripheral?
    CBPeripheral *existing = ble.connectedPeripheral;
    if (existing && [existing.identifier isEqual:uuid] &&
        existing.state == CBPeripheralStateConnected) {
        return existing;
    }
    if (existing && existing.state != CBPeripheralStateConnected) {
        ble.connectedPeripheral = nil;
        [ble cancelDisconnectTimer];
    }
    // Find peripheral from system / discovered list.
    NSArray<CBPeripheral *> *known = [ble.central retrievePeripheralsWithIdentifiers:@[uuid]];
    CBPeripheral *peripheral = known.firstObject;
    if (!peripheral) {
        for (CBPeripheral *p in ble.discovered) {
            if ([p.identifier isEqual:uuid]) { peripheral = p; break; }
        }
    }
    if (!peripheral) {
        if (errOut) *errOut = @"Peripheral not found. Run 'apple-bluetooth scan' first to discover nearby devices.";
        return nil;
    }
    ble.errorMessage = nil;
    ble.connectedPeripheral = nil;
    drainStaleBLESignals(ble);
    dispatch_async(dispatch_get_main_queue(), ^{
        [ble.central connectPeripheral:peripheral options:nil];
    });
    dispatch_semaphore_wait(ble.semaphore, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC));
    if (ble.errorMessage) {
        if (errOut) *errOut = ble.errorMessage;
        return nil;
    }
    if (!ble.connectedPeripheral) {
        if (errOut) *errOut = @"Connection timed out.";
        return nil;
    }
    return ble.connectedPeripheral;
}

/// Synchronous service + characteristic discovery on an already-connected
/// peripheral. Idempotent: subsequent calls will short-circuit if services
/// were already populated by an earlier `services` invocation.
static BOOL ensureServicesDiscovered(BLEHelper *ble, CBPeripheral *peripheral, NSString **errOut) {
    if (peripheral.services.count > 0) {
        BOOL anyMissingChars = NO;
        for (CBService *s in peripheral.services) {
            if (s.characteristics == nil) { anyMissingChars = YES; break; }
        }
        if (!anyMissingChars) return YES;
    }
    ble.servicesDiscovered = NO;
    ble.errorMessage = nil;
    peripheral.delegate = ble;
    drainStaleBLESignals(ble);
    dispatch_async(dispatch_get_main_queue(), ^{
        [peripheral discoverServices:nil];
    });
    dispatch_semaphore_wait(ble.semaphore, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC));
    if (ble.errorMessage) {
        if (errOut) *errOut = ble.errorMessage;
        return NO;
    }
    for (CBService *s in peripheral.services) {
        if (s.characteristics.count > 0) continue;
        ble.errorMessage = nil;
        drainStaleBLESignals(ble);
        dispatch_async(dispatch_get_main_queue(), ^{
            [peripheral discoverCharacteristics:nil forService:s];
        });
        dispatch_semaphore_wait(ble.semaphore, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC));
        if (ble.errorMessage) {
            if (errOut) *errOut = ble.errorMessage;
            return NO;
        }
    }
    return YES;
}

static CBCharacteristic *findCharacteristic(CBPeripheral *peripheral, NSString *serviceUUID, NSString *charUUID) {
    CBUUID *sUUID = [CBUUID UUIDWithString:serviceUUID];
    CBUUID *cUUID = [CBUUID UUIDWithString:charUUID];
    for (CBService *s in peripheral.services) {
        if ([s.UUID isEqual:sUUID]) {
            for (CBCharacteristic *c in s.characteristics) {
                if ([c.UUID isEqual:cUUID]) return c;
            }
        }
    }
    return nil;
}

static int cmd_read(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    NSString *serviceStr = noff_find_arg(argc, argv, "--service");
    NSString *charStr = noff_find_arg(argc, argv, "--characteristic");
    if (!serviceStr || !charStr) {
        noff_emit_json(stdout_fd,
            noff_json_error(TOOL_NAME, @"read", NOFF_ERR_INVALID_ARGS,
                @"--service and --characteristic are required."),
            compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    BLEHelper *ble = sharedBLE();
    CBPeripheral *peripheral = ble.connectedPeripheral;
    if (!peripheral) {
        noff_emit_json(stdout_fd,
            noff_json_error(TOOL_NAME, @"read", NOFF_ERR_NO_DATA, @"No peripheral connected. Run 'apple-bluetooth scan' then 'connect --uuid <uuid>' first."),
            compact, quiet);
        return NOFF_EXIT_ERROR;
    }

    CBCharacteristic *characteristic = findCharacteristic(peripheral, serviceStr, charStr);
    if (!characteristic) {
        noff_emit_json(stdout_fd,
            noff_json_error(TOOL_NAME, @"read", NOFF_ERR_NO_DATA,
                @"Characteristic not found. Run 'apple-bluetooth services --uuid <uuid>' first to discover available characteristics."),
            compact, quiet);
        return NOFF_EXIT_ERROR;
    }

    ble.readValue = nil;
    ble.errorMessage = nil;
    peripheral.delegate = ble;
    // The read path is the clearest case for this: without the drain, a stale
    // token returns the wait instantly and `readValue` is whatever the PREVIOUS
    // read left behind.
    drainStaleBLESignals(ble);
    dispatch_async(dispatch_get_main_queue(), ^{
        [peripheral readValueForCharacteristic:characteristic];
    });
    dispatch_semaphore_wait(ble.semaphore, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC));

    if (ble.errorMessage) {
        noff_emit_json(stdout_fd,
            noff_json_error(TOOL_NAME, @"read", NOFF_ERR_INTERNAL_ERROR, ble.errorMessage),
            compact, quiet);
        return NOFF_EXIT_ERROR;
    }

    NSData *value = ble.readValue ?: [NSData data];
    NSString *utf8 = [[NSString alloc] initWithData:value encoding:NSUTF8StringEncoding];

    NSDictionary *data = @{
        @"service": serviceStr,
        @"characteristic": charStr,
        @"hex": dataToHex(value),
        @"bytes": @(value.length),
        @"utf8": utf8 ?: [NSNull null],
    };
    [ble resetDisconnectTimer];
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"read", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

static int cmd_write(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    NSString *serviceStr = noff_find_arg(argc, argv, "--service");
    NSString *charStr = noff_find_arg(argc, argv, "--characteristic");
    if (!serviceStr || !charStr) {
        noff_emit_json(stdout_fd,
            noff_json_error(TOOL_NAME, @"write", NOFF_ERR_INVALID_ARGS,
                @"--service and --characteristic are required."),
            compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    NSString *hexValue = noff_find_arg(argc, argv, "--value");
    NSString *strValue = noff_find_arg(argc, argv, "--value-string");
    NSData *writeData = nil;
    if (hexValue) {
        writeData = dataFromHex(hexValue);
    } else if (strValue) {
        writeData = [strValue dataUsingEncoding:NSUTF8StringEncoding];
    }
    if (!writeData || writeData.length == 0) {
        noff_emit_json(stdout_fd,
            noff_json_error(TOOL_NAME, @"write", NOFF_ERR_INVALID_ARGS,
                @"--value <hex> or --value-string <text> is required."),
            compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    BLEHelper *ble = sharedBLE();
    CBPeripheral *peripheral = ble.connectedPeripheral;
    if (!peripheral) {
        noff_emit_json(stdout_fd,
            noff_json_error(TOOL_NAME, @"write", NOFF_ERR_NO_DATA, @"No peripheral connected. Run 'apple-bluetooth scan' then 'connect --uuid <uuid>' first."),
            compact, quiet);
        return NOFF_EXIT_ERROR;
    }

    CBCharacteristic *characteristic = findCharacteristic(peripheral, serviceStr, charStr);
    if (!characteristic) {
        noff_emit_json(stdout_fd,
            noff_json_error(TOOL_NAME, @"write", NOFF_ERR_NO_DATA,
                @"Characteristic not found. Run 'apple-bluetooth services --uuid <uuid>' first to discover available characteristics."),
            compact, quiet);
        return NOFF_EXIT_ERROR;
    }

    ble.writeSuccess = NO;
    ble.errorMessage = nil;
    peripheral.delegate = ble;

    CBCharacteristicWriteType writeType =
        (characteristic.properties & CBCharacteristicPropertyWrite)
            ? CBCharacteristicWriteWithResponse
            : CBCharacteristicWriteWithoutResponse;

    drainStaleBLESignals(ble);
    dispatch_async(dispatch_get_main_queue(), ^{
        [peripheral writeValue:writeData forCharacteristic:characteristic type:writeType];
    });

    if (writeType == CBCharacteristicWriteWithResponse) {
        dispatch_semaphore_wait(ble.semaphore, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC));
    } else {
        // No response expected — assume success after short delay
        usleep(100000);
        ble.writeSuccess = YES;
    }

    if (ble.errorMessage) {
        noff_emit_json(stdout_fd,
            noff_json_error(TOOL_NAME, @"write", NOFF_ERR_INTERNAL_ERROR, ble.errorMessage),
            compact, quiet);
        return NOFF_EXIT_ERROR;
    }

    NSDictionary *data = @{
        @"service": serviceStr,
        @"characteristic": charStr,
        @"bytes_written": @(writeData.length),
        @"write_type": writeType == CBCharacteristicWriteWithResponse ? @"with_response" : @"without_response",
    };
    [ble resetDisconnectTimer];
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"write", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

// MARK: - notify

/// Global SIGINT flag for `cmd_notify` so a Ctrl-C can break out of the
/// `duration=0` (run-forever) wait loop. atomic int so the signal handler
/// can write it safely.
static atomic_int g_notify_sigint = ATOMIC_VAR_INIT(0);

static void notify_sigint_handler(int sig) {
    (void)sig;
    atomic_store(&g_notify_sigint, 1);
}

static int cmd_notify(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    NSString *uuidStr = noff_find_arg(argc, argv, "--uuid");
    NSString *serviceStr = noff_find_arg(argc, argv, "--service");
    NSString *charStr = noff_find_arg(argc, argv, "--characteristic");
    if (!uuidStr || !serviceStr || !charStr) {
        noff_emit_json(stdout_fd,
            noff_json_error(TOOL_NAME, @"notify", NOFF_ERR_INVALID_ARGS,
                @"--uuid, --service and --characteristic are required."),
            compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    // duration parsing: default 10s. 0 means "until SIGINT". Negative or
    // unparseable strings fall back to the default.
    NSString *durationStr = noff_find_arg(argc, argv, "--duration");
    NSTimeInterval duration = 10.0;
    BOOL untilSigint = NO;
    if (durationStr) {
        double parsed = [durationStr doubleValue];
        if (parsed == 0 && [durationStr isEqualToString:@"0"]) {
            untilSigint = YES;
            duration = 0;
        } else if (parsed > 0) {
            duration = parsed;
        }
    }

    BLEHelper *ble = sharedBLE();
    [ble waitForPowerOn];
    if (ble.managerState != CBManagerStatePoweredOn) {
        noff_emit_json(stdout_fd,
            noff_json_error(TOOL_NAME, @"notify", NOFF_ERR_NOT_AVAILABLE,
                @"Bluetooth is not powered on. Check Settings > Bluetooth."),
            compact, quiet);
        return NOFF_EXIT_NOT_AVAILABLE;
    }

    // Step 1: ensure a connection to the target peripheral.
    NSString *connectErr = nil;
    CBPeripheral *peripheral = ensureConnected(ble, uuidStr, &connectErr);
    if (!peripheral) {
        noff_emit_json(stdout_fd,
            noff_json_error(TOOL_NAME, @"notify", NOFF_ERR_NO_DATA,
                connectErr ?: @"Failed to connect to peripheral."),
            compact, quiet);
        return NOFF_EXIT_ERROR;
    }

    // Step 2: make sure services/characteristics are populated so
    // findCharacteristic below has data to work with.
    NSString *discoverErr = nil;
    if (!ensureServicesDiscovered(ble, peripheral, &discoverErr)) {
        noff_emit_json(stdout_fd,
            noff_json_error(TOOL_NAME, @"notify", NOFF_ERR_INTERNAL_ERROR,
                discoverErr ?: @"Failed to discover services."),
            compact, quiet);
        return NOFF_EXIT_ERROR;
    }

    CBCharacteristic *characteristic = findCharacteristic(peripheral, serviceStr, charStr);
    if (!characteristic) {
        noff_emit_json(stdout_fd,
            noff_json_error(TOOL_NAME, @"notify", NOFF_ERR_NO_DATA,
                @"Characteristic not found. Run 'apple-bluetooth services --uuid <uuid>' to list available characteristics."),
            compact, quiet);
        return NOFF_EXIT_ERROR;
    }

    // Step 3: verify the characteristic actually supports notify/indicate.
    BOOL hasNotify = (characteristic.properties & CBCharacteristicPropertyNotify) != 0;
    BOOL hasIndicate = (characteristic.properties & CBCharacteristicPropertyIndicate) != 0;
    if (!hasNotify && !hasIndicate) {
        noff_emit_json(stdout_fd,
            noff_json_error(TOOL_NAME, @"notify", NOFF_ERR_INVALID_ARGS,
                @"Characteristic does not support notify or indicate. Inspect its 'properties' list via 'apple-bluetooth services'."),
            compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    // Step 4: arm the helper as the active subscriber so the shared
    // didUpdateValueForCharacteristic delegate routes incoming samples
    // into notifyBuffer instead of the read path.
    [ble.notifyBufferLock lock];
    [ble.notifyBuffer removeAllObjects];
    [ble.notifyBufferLock unlock];
    ble.errorMessage = nil;
    ble.notifyChar = characteristic;
    peripheral.delegate = ble;

    // Drain any stale token left in notifyStateSem.
    while (dispatch_semaphore_wait(ble.notifyStateSem, DISPATCH_TIME_NOW) == 0) { /* drain */ }

    dispatch_async(dispatch_get_main_queue(), ^{
        [peripheral setNotifyValue:YES forCharacteristic:characteristic];
    });
    // Wait for didUpdateNotificationStateForCharacteristic confirmation.
    if (dispatch_semaphore_wait(ble.notifyStateSem,
                                 dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC)) != 0) {
        ble.notifyChar = nil;
        noff_emit_json(stdout_fd,
            noff_json_error(TOOL_NAME, @"notify", NOFF_ERR_INTERNAL_ERROR,
                @"Timed out waiting for subscription to activate."),
            compact, quiet);
        return NOFF_EXIT_ERROR;
    }
    if (ble.errorMessage) {
        NSString *e = ble.errorMessage;
        ble.notifyChar = nil;
        noff_emit_json(stdout_fd,
            noff_json_error(TOOL_NAME, @"notify", NOFF_ERR_INTERNAL_ERROR, e),
            compact, quiet);
        return NOFF_EXIT_ERROR;
    }

    // Step 5: install SIGINT handler and wait. Save the previous handler
    // so we restore it before returning (the offload thread can be
    // reused for other tools).
    atomic_store(&g_notify_sigint, 0);
    struct sigaction saved_sigint;
    struct sigaction notify_sa;
    memset(&notify_sa, 0, sizeof(notify_sa));
    notify_sa.sa_handler = notify_sigint_handler;
    sigemptyset(&notify_sa.sa_mask);
    sigaction(SIGINT, &notify_sa, &saved_sigint);

    NSDate *startedAt = [NSDate date];
    NSDate *deadline = untilSigint ? nil : [startedAt dateByAddingTimeInterval:duration];
    while (1) {
        if (atomic_load(&g_notify_sigint)) break;
        if (deadline && [[NSDate date] timeIntervalSinceDate:deadline] >= 0) break;
        // Poll every 200ms — small enough to react quickly to SIGINT /
        // duration expiry without burning CPU.
        usleep(200 * 1000);
    }

    // Step 6: tear down subscription and restore SIGINT.
    sigaction(SIGINT, &saved_sigint, NULL);

    dispatch_async(dispatch_get_main_queue(), ^{
        [peripheral setNotifyValue:NO forCharacteristic:characteristic];
    });
    // Best-effort wait for the "unsubscribed" callback; don't fail the
    // command if it never arrives (the helper will still be in a sane
    // state because notifyChar is cleared below).
    dispatch_semaphore_wait(ble.notifyStateSem,
                            dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC));
    ble.notifyChar = nil;

    [ble resetDisconnectTimer];

    // Snapshot the buffer so we don't race the delegate (which can't fire
    // any more for this characteristic, but a stray queued callback might).
    [ble.notifyBufferLock lock];
    NSArray *samples = [ble.notifyBuffer copy];
    [ble.notifyBuffer removeAllObjects];
    [ble.notifyBufferLock unlock];

    NSTimeInterval elapsed = -[startedAt timeIntervalSinceNow];
    NSDictionary *data = @{
        @"uuid": uuidStr,
        @"service": serviceStr,
        @"characteristic": charStr,
        @"duration_seconds": @(elapsed),
        @"count": @(samples.count),
        @"samples": samples,
        @"stopped_by": atomic_load(&g_notify_sigint) ? @"sigint" : (untilSigint ? @"sigint" : @"duration"),
        @"hint": samples.count > 0
            ? @"Subscription closed. Re-run with a longer --duration (or --duration 0 for Ctrl-C-only) to capture more samples."
            : @"No samples received during the subscription window. Confirm the peripheral is producing notifications on this characteristic.",
    };
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"notify", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

// MARK: - Main Handler

static int bluetooth_handler(int argc, char **argv,
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
        noff_emit_json(stdout_fd,
            noff_json_error(TOOL_NAME, @"unknown", NOFF_ERR_INVALID_ARGS,
                @"No command specified. Use --help for usage."),
            compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    if ([subcmd isEqualToString:@"status"])     return cmd_status(argc, argv, stdout_fd, compact, quiet);
    if ([subcmd isEqualToString:@"scan"])        return cmd_scan(argc, argv, stdout_fd, compact, quiet);
    if ([subcmd isEqualToString:@"connect"])     return cmd_connect(argc, argv, stdout_fd, compact, quiet);
    if ([subcmd isEqualToString:@"disconnect"])  return cmd_disconnect(argc, argv, stdout_fd, compact, quiet);
    if ([subcmd isEqualToString:@"services"])    return cmd_services(argc, argv, stdout_fd, compact, quiet);
    if ([subcmd isEqualToString:@"read"])        return cmd_read(argc, argv, stdout_fd, compact, quiet);
    if ([subcmd isEqualToString:@"write"])       return cmd_write(argc, argv, stdout_fd, compact, quiet);
    if ([subcmd isEqualToString:@"notify"])      return cmd_notify(argc, argv, stdout_fd, compact, quiet);

    noff_emit_help(stderr_fd, HELP_TEXT);
    noff_emit_json(stdout_fd,
        noff_json_error(TOOL_NAME, subcmd, NOFF_ERR_INVALID_ARGS,
            [NSString stringWithFormat:@"Unknown command '%@'. Use --help for details.", subcmd]),
        compact, quiet);
    return NOFF_EXIT_INVALID_ARGS;
}

void bluetooth_offload_register(void) {
    int err = native_offload_add_handler("apple-bluetooth", bluetooth_handler);
    if (err == 0) {
        noff_ensure_guest_stub("/usr/local/bin/apple-bluetooth");
        NSLog(@"NativeOffloads: apple-bluetooth handler registered");
    } else {
        NSLog(@"NativeOffloads: failed to register apple-bluetooth handler (err=%d)", err);
    }
}
