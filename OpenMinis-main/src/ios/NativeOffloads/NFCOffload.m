//
//  NFCOffload.m
//  MinisApp
//
//  Native offload handler for `apple-nfc`.
//  Subcommands: status, scan, write, tag-read, tag-write, tag-info, apdu
//
//  Supports NDEF reading/writing and raw tag operations (MIFARE, ISO 7816, ISO 15693, FeliCa).
//  Requires iPhone 7+ and NFC entitlement.
//
//  ---------------------------------------------------------------------------
//  NFC configuration notes — Info.plist and entitlements
//  ---------------------------------------------------------------------------
//  `NFCTagReaderSession` requires the host app to declare in Info.plist:
//    - com.apple.developer.nfc.readersession.iso7816.select-identifiers
//      (AID whitelist — iOS performs prefix matching; unlisted AIDs are
//       silently filtered and the session reports "Missing required
//       entitlement" when polling would otherwise surface them.)
//    - com.apple.developer.nfc.readersession.felica.systemcodes
//      (FeliCa system-code whitelist for `NFCPollingISO18092`.)
//
//  Entitlement file (Minis.entitlements) declares:
//    - com.apple.developer.nfc.readersession.formats = [TAG, NDEF, PACE]
//      TAG  → NFCTagReaderSession (raw tag access: MIFARE, ISO 7816, ISO 15693, FeliCa)
//      NDEF → NFCNDEFReaderSession (high-level NDEF scan/write)
//      PACE → Password Authenticated Connection Establishment for eMRTD (ICAO 9303 passports)
//
//  AID / FeliCa whitelist provenance (see Info.plist):
//    - NFC Forum NDEF Type 4              — NFC Forum / ISO/IEC 14443-4 standard
//    - EMV PSE / PPSE and card networks   — EMVCo Book 1; Wikipedia EMV article
//        (Visa, Mastercard, Amex, JCB, Discover, UnionPay, Interac, Girocard,
//         Maestro, Mir, RuPay, Dankort, CB, TROY, PagoBANCOMAT, Postamat, Elo)
//    - Passport / eMRTD / mDL             — ICAO Doc 9303 Part 10; ISO 18013-5
//        (https://github.com/AndyQ/NFCPassportReader example Info.plist)
//    - US PIV / DoD CAC                   — NIST SP 800-73-4; DoD CAC specs
//    - European eID (German nPA, BelPIC)  — BSI TR-03110; Belgian PKCS-15 eID
//    - Norwegian BuyPass, Dutch DL        — community readers
//    - Japan My Number (JPKI)             — https://github.com/Lakr233/CoreExtendedNFC
//    - Calypso / transit (Navigo, CEPAS,  — community readers;
//      ITSO, T-Union, Octopus virtual,     https://github.com/RfidResearchGroup/proxmark3
//      ORCA, PRESTO, Myki, Madrid, Korean  (client/resources/aidlist.json)
//      T-money / Cashbee)
//    - YubiKey applet suite               — https://github.com/Yubico/yubikit-ios
//        (YKFSelectApplicationAPDU.m — Mgmt, PIV, OATH, OTP/ChalResp, FIDO2/U2F,
//         Security Domain)
//    - Tangem hardware wallet             — https://github.com/tangem/tangem-sdk-ios
//    - OpenPGP card                       — GnuPG OpenPGP Smart Card 3.4.1 spec
//    - Apple Home / Access Keys           — Proxmark3 aidlist (enumerable only)
//    - FeliCa system codes                — Wikipedia FeliCa; Sony FeliCa docs;
//        Suica/PASMO/ICOCA (0003), common e-money (FE00), Octopus (8008),
//        FeliCa Lite-S (88B4), WAON-style (12FC), community values
//        (8005, 90B7, 927A, 86A7 from react-native-nfc-manager)
//
//  Aggregated reference: https://github.com/Lakr233/CoreExtendedNFC
//    (docs/NFC-InfoPlist-Reference.md) — curated per-AID provenance notes.
//
//  Whitelist is allow-list, not exclusive — adding AIDs only broadens
//  detection. Prefix matching means short AIDs (e.g. A000000308 for PIV)
//  cover all longer variants automatically.
//

#import <Foundation/Foundation.h>
#import <CoreNFC/CoreNFC.h>
#import "NativeOffloadUtils.h"
#include "kernel/native_offload.h"
#include <unistd.h>

static NSString *const TOOL_NAME = @"apple-nfc";

static NSString *const HELP_TEXT =
    @"apple-nfc - NFC tag reading and writing\n"
     "\n"
     "USAGE:\n"
     "  apple-nfc <command> [options]\n"
     "\n"
     "NDEF COMMANDS (high-level):\n"
     "  status         Check NFC availability\n"
     "  scan           Scan and read NDEF records from a tag\n"
     "  write          Write an NDEF record to a tag\n"
     "\n"
     "RAW TAG COMMANDS (low-level):\n"
     "  tag-info       Detect tag type, UID, and capabilities\n"
     "  tag-read       Read raw memory pages/blocks from MIFARE/ISO 15693 tags\n"
     "  tag-write      Write raw data to MIFARE/ISO 15693 tag pages/blocks\n"
     "  apdu           Send an ISO 7816 APDU command (smart cards, transit cards)\n"
     "  felica         Send a FeliCa command (Japanese transit cards)\n"
     "\n"
     "HIGH-LEVEL COMMANDS:\n"
     "  read-emv       Read contactless bank card info (PAN, expiry, name, brand)\n"
     "\n"
     "LOOKUP COMMANDS (offline, no NFC session):\n"
     "  lookup-tag <hex>   Look up an EMV TLV tag name (e.g. 9F36 = ATC)\n"
     "  lookup-aid <hex>   Look up an ISO 7816 AID name (e.g. A0000000041010 = Mastercard)\n"
     "  search [query]     List/search built-in tags, AIDs, and aliases\n"
     "                     (use --kind tag|aid|alias to filter)\n"
     "\n"
     "NDEF OPTIONS:\n"
     "  --timeout <seconds>     Scan timeout (default: 30)\n"
     "  --message <text>        Alert message shown during scan\n"
     "  --type <ndef-type>      NDEF record type: text, url, mime (default: text)\n"
     "  --payload <content>     Content to write\n"
     "  --mime <type>           MIME type for mime records\n"
     "  --locale <lang>         Locale for text records (default: en)\n"
     "\n"
     "RAW TAG OPTIONS:\n"
     "  --page <number>         Start page for MIFARE read/write (default: 0)\n"
     "  --pages <count>         Number of pages to read (default: 4)\n"
     "  --block <number>        Block number for ISO 15693 (default: 0)\n"
     "  --blocks <count>        Number of blocks to read (default: 4)\n"
     "  --data <hex>            Hex data to write (e.g. 48656C6C6F)\n"
     "  --apdu <hex>            Raw APDU command in hex (for apdu command)\n"
     "  --select-aid <id>       Semantic SELECT: AID hex or alias (ppse, pse,\n"
     "                          unionpay, visa, mastercard, amex, jcb, piv,\n"
     "                          openpgp, passport, tmoney, cashbee, ...)\n"
     "  --select-name <ascii>   SELECT by DF name (ASCII, e.g. \"2PAY.SYS.DDF01\")\n"
     "  --cla <hex>             APDU class byte (default: 00)\n"
     "  --ins <hex>             APDU instruction byte\n"
     "  --p1 <hex>              APDU P1 (default: 00)\n"
     "  --p2 <hex>              APDU P2 (default: 00)\n"
     "  --le <number>           Expected response length (default: 0 = max)\n"
     "  --sc <hex>              FeliCa service code in hex (2 bytes LE)\n"
     "  --bc <number>           FeliCa block count (default: 1)\n"
     "  --bl <hex>              FeliCa block list element(s) in hex\n"
     "\n"
     "WORKFLOW:\n"
     "  1. apple-nfc status              — check NFC availability\n"
     "  2. apple-nfc scan                — read NDEF data (text, URLs)\n"
     "  3. apple-nfc tag-info            — detect tag type & UID\n"
     "  4. apple-nfc tag-read --page 0   — read raw memory (MIFARE)\n"
     "  5. apple-nfc apdu --ins B0 ...   — send smart card commands\n"
     "\n"
     "EXAMPLES:\n"
     "  apple-nfc scan\n"
     "  apple-nfc write --type url --payload \"https://example.com\"\n"
     "  apple-nfc tag-info\n"
     "  apple-nfc tag-read --page 4 --pages 8\n"
     "  apple-nfc tag-write --page 4 --data 48656C6C6F000000\n"
     "  apple-nfc apdu --cla 00 --ins B0 --p1 00 --p2 00 --le 256\n"
     "  apple-nfc apdu --apdu 00B0000000\n"
     "  apple-nfc apdu --select-aid ppse                  # SELECT PPSE directory\n"
     "  apple-nfc apdu --select-aid unionpay              # SELECT UnionPay Debit\n"
     "  apple-nfc apdu --select-aid A0000000041010        # SELECT Mastercard\n"
     "  apple-nfc apdu --select-name \"2PAY.SYS.DDF01\"     # SELECT by DF name\n"
     "  apple-nfc felica --sc 0B00 --bc 1 --bl 8000\n"
     "  apple-nfc read-emv\n"
     "  apple-nfc read-emv --verbose   # include APDU trace\n"
     "  apple-nfc lookup-tag 9F36\n"
     "  apple-nfc lookup-aid A000000333010101\n"
     "  apple-nfc search                      # dump everything\n"
     "  apple-nfc search unionpay             # find UnionPay-related entries\n"
     "  apple-nfc search --kind alias         # list only aliases usable with --select-aid\n"
     "  apple-nfc search 57 --kind tag        # find TLV tag 57 / Track2\n";

// MARK: - Hex Helpers

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

static uint8_t hexByte(NSString *hex) {
    unsigned int val = 0;
    [[NSScanner scannerWithString:hex] scanHexInt:&val];
    return (uint8_t)val;
}

// MARK: - BER-TLV Parser (EMV Profile)

// Parse one TLV at *cursor. On success advances *cursor and fills out params.
// Skips leading 0x00/0xFF padding. Returns NO on malformed input or end-of-buffer.
static BOOL tlvParseOne(const uint8_t *buf, NSUInteger len, NSUInteger *cursor,
                        uint32_t *outTag, const uint8_t **outVal, NSUInteger *outValLen) {
    NSUInteger i = *cursor;
    while (i < len && (buf[i] == 0x00 || buf[i] == 0xFF)) i++;
    if (i >= len) return NO;

    // Tag: multi-byte if low 5 bits of first byte are all 1
    uint32_t tag = buf[i++];
    if ((tag & 0x1F) == 0x1F) {
        do {
            if (i >= len) return NO;
            tag = (tag << 8) | buf[i];
        } while ((buf[i++] & 0x80) != 0);
    }

    if (i >= len) return NO;
    // Length: short (bit7=0) or long (bit7=1, low 7 bits = number of length octets)
    uint8_t lb = buf[i++];
    NSUInteger vlen;
    if ((lb & 0x80) == 0) {
        vlen = lb;
    } else {
        int nOctets = lb & 0x7F;
        if (nOctets == 0 || nOctets > 4 || i + nOctets > len) return NO;
        vlen = 0;
        for (int k = 0; k < nOctets; k++) vlen = (vlen << 8) | buf[i++];
    }

    if (i + vlen > len) return NO;
    *outTag = tag;
    *outVal = &buf[i];
    *outValLen = vlen;
    *cursor = i + vlen;
    return YES;
}

static BOOL tlvIsConstructed(uint32_t tag) {
    // Walk to first byte of tag
    uint32_t first = tag;
    while (first > 0xFF) first >>= 8;
    return (first & 0x20) != 0;
}

// Recursively walk TLV, invoking visitor for each primitive (non-constructed) tag.
// Constructed templates are descended into automatically.
static void tlvWalk(const uint8_t *buf, NSUInteger len, void (^visitor)(uint32_t tag, const uint8_t *val, NSUInteger vlen)) {
    NSUInteger cursor = 0;
    uint32_t tag;
    const uint8_t *val;
    NSUInteger vlen;
    while (tlvParseOne(buf, len, &cursor, &tag, &val, &vlen)) {
        if (tlvIsConstructed(tag)) {
            tlvWalk(val, vlen, visitor);
        } else {
            visitor(tag, val, vlen);
        }
    }
}

// Find the first occurrence of a tag (searches recursively into constructed templates).
// Returns YES and fills out params, or NO if not found.
static BOOL tlvFind(const uint8_t *buf, NSUInteger len, uint32_t wantTag,
                    const uint8_t **outVal, NSUInteger *outValLen) {
    NSUInteger cursor = 0;
    uint32_t tag;
    const uint8_t *val;
    NSUInteger vlen;
    while (tlvParseOne(buf, len, &cursor, &tag, &val, &vlen)) {
        if (tag == wantTag) {
            *outVal = val;
            *outValLen = vlen;
            return YES;
        }
        if (tlvIsConstructed(tag)) {
            if (tlvFind(val, vlen, wantTag, outVal, outValLen)) return YES;
        }
    }
    return NO;
}

// Decode BCD-packed digits, stripping trailing 'F' nibbles (used for PAN, expiry padding).
static NSString *bcdToString(const uint8_t *buf, NSUInteger len) {
    NSMutableString *out = [NSMutableString stringWithCapacity:len * 2];
    for (NSUInteger i = 0; i < len; i++) {
        uint8_t hi = (buf[i] >> 4) & 0x0F;
        uint8_t lo = buf[i] & 0x0F;
        if (hi <= 9) [out appendFormat:@"%u", hi]; else if (hi == 0x0F) break; else [out appendFormat:@"?"];
        if (lo <= 9) [out appendFormat:@"%u", lo]; else if (lo == 0x0F) break; else [out appendFormat:@"?"];
    }
    return out;
}

// Decode ASCII from TLV value, trimming trailing spaces/NULs.
static NSString *asciiTrim(const uint8_t *buf, NSUInteger len) {
    NSString *s = [[NSString alloc] initWithBytes:buf length:len encoding:NSASCIIStringEncoding];
    return [s stringByTrimmingCharactersInSet:[NSCharacterSet characterSetWithCharactersInString:@" \0"]] ?: @"";
}

// MARK: - EMV Tag & AID Dictionaries

// Shared accessor for the tag map so `search` / `list-tags` can enumerate.
static NSDictionary<NSNumber *, NSString *> *emvTagMap(void) {
    static NSDictionary<NSNumber *, NSString *> *map;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        map = @{
            @(0x4F):    @"Application Identifier (AID)",
            @(0x50):    @"Application Label",
            @(0x57):    @"Track 2 Equivalent Data",
            @(0x5A):    @"Application PAN",
            @(0x5F20):  @"Cardholder Name",
            @(0x5F24):  @"Application Expiration Date (YYMMDD)",
            @(0x5F25):  @"Application Effective Date (YYMMDD)",
            @(0x5F28):  @"Issuer Country Code",
            @(0x5F2A):  @"Transaction Currency Code",
            @(0x5F2D):  @"Language Preference",
            @(0x5F30):  @"Service Code",
            @(0x5F34):  @"PAN Sequence Number",
            @(0x61):    @"Application Template",
            @(0x6F):    @"FCI Template",
            @(0x70):    @"Record Template",
            @(0x77):    @"Response Message Template Format 2",
            @(0x80):    @"Response Message Template Format 1",
            @(0x82):    @"Application Interchange Profile (AIP)",
            @(0x84):    @"DF Name",
            @(0x87):    @"Application Priority Indicator",
            @(0x88):    @"SFI",
            @(0x8C):    @"CDOL1",
            @(0x8D):    @"CDOL2",
            @(0x8E):    @"CVM List",
            @(0x8F):    @"Certification Authority Public Key Index",
            @(0x94):    @"Application File Locator (AFL)",
            @(0x95):    @"Terminal Verification Results (TVR)",
            @(0x9A):    @"Transaction Date",
            @(0x9C):    @"Transaction Type",
            @(0xA5):    @"FCI Proprietary Template",
            @(0x9F02):  @"Amount, Authorised",
            @(0x9F03):  @"Amount, Other",
            @(0x9F07):  @"Application Usage Control",
            @(0x9F08):  @"Application Version Number",
            @(0x9F0D):  @"IAC-Default",
            @(0x9F0E):  @"IAC-Denial",
            @(0x9F0F):  @"IAC-Online",
            @(0x9F10):  @"Issuer Application Data",
            @(0x9F11):  @"Issuer Code Table Index",
            @(0x9F12):  @"Application Preferred Name",
            @(0x9F1A):  @"Terminal Country Code",
            @(0x9F1F):  @"Track 1 Discretionary Data",
            @(0x9F20):  @"Track 2 Discretionary Data",
            @(0x9F26):  @"Application Cryptogram",
            @(0x9F27):  @"Cryptogram Information Data",
            @(0x9F33):  @"Terminal Capabilities",
            @(0x9F34):  @"CVM Results",
            @(0x9F35):  @"Terminal Type",
            @(0x9F36):  @"Application Transaction Counter (ATC)",
            @(0x9F37):  @"Unpredictable Number",
            @(0x9F38):  @"PDOL",
            @(0x9F40):  @"Additional Terminal Capabilities",
            @(0x9F42):  @"Application Currency Code",
            @(0x9F44):  @"Application Currency Exponent",
            @(0x9F4D):  @"Log Entry",
            @(0x9F4E):  @"Merchant Name and Location",
            @(0x9F66):  @"Terminal Transaction Qualifiers (TTQ)",
            @(0x9F6B):  @"Track 2 Data (Mastercard CLESS)",
            @(0x9F6C):  @"Card Transaction Qualifiers (CTQ)",
            @(0xBF0C):  @"FCI Issuer Discretionary Data",
        };
    });
    return map;
}

static NSString *emvTagName(uint32_t tag) {
    return emvTagMap()[@(tag)];
}

// Shared accessor for the AID table so `search` / `list-aids` can enumerate.
static NSArray<NSArray *> *emvAidTable(void) {
    static NSArray<NSArray *> *table; // array of {prefix, name}
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        table = @[
            // EMV directories
            @[@"315041592E5359532E4444463031", @"PSE (1PAY.SYS.DDF01, contact)"],
            @[@"325041592E5359532E4444463031", @"PPSE (2PAY.SYS.DDF01, contactless)"],
            // Payment networks
            @[@"A000000003", @"Visa"],
            @[@"A000000004", @"Mastercard"],
            @[@"A00000002501", @"American Express"],
            @[@"A000000025", @"American Express"],
            @[@"A0000000291010", @"LINK (UK)"],
            @[@"A0000000421010", @"Cartes Bancaires"],
            @[@"A0000000651010", @"JCB"],
            @[@"A000000152", @"Discover / Pulse D-PAS"],
            @[@"A0000001524010", @"Discover"],
            @[@"A0000002771010", @"Interac"],
            @[@"A0000001211010", @"Dankort"],
            @[@"A0000001410001", @"PagoBANCOMAT"],
            @[@"A0000003660001", @"Postamat"],
            @[@"A00000005945430100", @"Girocard Electronic Cash"],
            @[@"A0000003591010", @"Girocard EAPS"],
            @[@"A000000333010101", @"UnionPay Debit"],
            @[@"A000000333010102", @"UnionPay Credit"],
            @[@"A000000333010103", @"UnionPay Quasi Credit"],
            @[@"A000000333010106", @"UnionPay Electronic Cash"],
            @[@"A000000333010108", @"UnionPay US Common Debit"],
            @[@"A000000333", @"UnionPay"],
            @[@"A0000005241010", @"RuPay"],
            @[@"A0000006581010", @"Mir Credit"],
            @[@"A0000006582010", @"Mir Debit"],
            @[@"A0000006723010", @"TROY"],
            @[@"A00000000386980701", @"UnionPay-family"],
            // NFC Forum
            @[@"D2760000850101", @"NFC Forum Type 4 NDEF"],
            @[@"D2760000850100", @"NDEF / DESFire Tag Application"],
            // Transit
            @[@"A000000291", @"Calypso transit"],
            @[@"315449432E494341", @"Calypso 1TIC.ICA"],
            @[@"304554502E494341", @"Calypso 0ETP.ICA"],
            @[@"324D50502E494341", @"Calypso 2MPP.ICA"],
            @[@"334D54522E494341", @"Calypso 3MTR.ICA"],
            @[@"A0000004040125090101", @"Navigo (Paris)"],
            @[@"A000000341000101", @"CEPAS (Singapore)"],
            @[@"A0000002164954534F2D31", @"ITSO (UK transit)"],
            @[@"A000000632010105", @"China T-Union"],
            @[@"A0000005500011", @"Virtual Octopus (HK)"],
            @[@"A00000F21100", @"Myki (Melbourne)"],
            @[@"A0000004520001", @"Korean transit"],
            @[@"D4100000030001", @"Korean T-money"],
            @[@"D4100000140001", @"Korean Cashbee"],
            // Passport / ID
            @[@"A0000002471001", @"ICAO eMRTD LDS1 (passport)"],
            @[@"A0000002472001", @"ICAO eMRTD auxiliary"],
            @[@"A0000002480400", @"ISO 18013-5 mDL"],
            @[@"A00000045645444C2D3031", @"Dutch driving licence"],
            // National ID / PKI
            @[@"A000000308", @"US PIV"],
            @[@"A000000079", @"US DoD CAC"],
            @[@"E80704007F00070302", @"German eID nPA"],
            @[@"A000000167455349474E", @"eSign (EU eID signing)"],
            @[@"A000000177504B43532D3135", @"Belgian BelPIC"],
            @[@"A000000088102201034221", @"Norwegian BuyPass"],
            @[@"D392F000260100000001", @"Japan JPKI (My Number)"],
            @[@"D392100031000101", @"Japan My Number applet"],
            // Hardware security keys
            @[@"A000000527471117", @"YubiKey Management"],
            @[@"A000000527200101", @"YubiKey OTP / ChalResp"],
            @[@"A0000005272101", @"YubiKey OATH"],
            @[@"A0000006472F0001", @"FIDO2 / U2F"],
            @[@"A000000151000000", @"YubiKey Security Domain"],
            @[@"A0000001510000", @"GlobalPlatform Card Manager"],
            // Crypto wallets
            @[@"A000000812010208", @"Tangem wallet"],
            // OpenPGP
            @[@"D27600012401", @"OpenPGP Card"],
            // Apple wallet keys
            @[@"A0000008580101", @"Apple Home Key"],
            @[@"A0000008580102", @"Apple Home Key Step-Up"],
            @[@"A0000008580201", @"Apple Access Key"],
        ];
    });
    return table;
}

static NSString *emvAidName(NSString *aidHex) {
    NSString *upper = aidHex.uppercaseString;
    for (NSArray *row in emvAidTable()) {
        NSString *prefix = row[0];
        if ([upper hasPrefix:prefix]) return row[1];
    }
    return nil;
}

// Reverse lookup: resolve a human-friendly name (or raw hex) into an AID hex string.
// Accepts:
//   - hex AID directly (e.g. "A000000333010101")
//   - "ppse" / "pse"  → the EMV directory names
//   - brand name ("unionpay", "visa", "mastercard", "amex", "jcb", "discover", "interac",
//     "unionpay-debit", "unionpay-credit", "unionpay-quasi")
//   - "ndef" → NFC Forum Type 4 NDEF
// Returns nil if the input cannot be resolved.
// Shared accessor for the alias table so `search` / `list-aliases` can enumerate.
static NSDictionary<NSString *, NSString *> *emvAidAliases(void) {
    static NSDictionary<NSString *, NSString *> *aliases;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        aliases = @{
            @"ppse":               @"325041592E5359532E4444463031",
            @"pse":                @"315041592E5359532E4444463031",
            @"ndef":               @"D2760000850101",
            @"visa":               @"A0000000031010",
            @"visa-electron":      @"A0000000032010",
            @"visa-debit":         @"A0000000031010",
            @"mastercard":         @"A0000000041010",
            @"maestro":            @"A0000000043060",
            @"amex":               @"A00000002501",
            @"american-express":   @"A00000002501",
            @"jcb":                @"A0000000651010",
            @"discover":           @"A0000001524010",
            @"interac":            @"A0000002771010",
            @"unionpay":           @"A000000333010101",
            @"unionpay-debit":     @"A000000333010101",
            @"unionpay-credit":    @"A000000333010102",
            @"unionpay-quasi":     @"A000000333010103",
            @"cb":                 @"A0000000421010",
            @"cartes-bancaires":   @"A0000000421010",
            @"dankort":            @"A0000001211010",
            @"girocard":           @"A00000005945430100",
            @"rupay":              @"A0000005241010",
            @"mir":                @"A0000006581010",
            @"troy":               @"A0000006723010",
            @"yubikey-piv":        @"A000000308",
            @"yubikey-oath":       @"A0000005272101",
            @"yubikey-otp":        @"A000000527200101",
            @"yubikey-mgmt":       @"A000000527471117",
            @"fido2":              @"A0000006472F0001",
            @"u2f":                @"A0000006472F0001",
            @"piv":                @"A000000308",
            @"openpgp":            @"D27600012401",
            @"tangem":             @"A000000812010208",
            @"epassport":          @"A0000002471001",
            @"passport":           @"A0000002471001",
            @"mdl":                @"A0000002480400",
            @"tmoney":             @"D4100000030001",
            @"t-money":            @"D4100000030001",
            @"cashbee":            @"D4100000140001",
            @"cepas":              @"A000000341000101",
            @"navigo":             @"A0000004040125090101",
            @"t-union":            @"A000000632010105",
            @"itso":               @"A0000002164954534F2D31",
            @"orca":               @"A00000039656434103F213F000000000",
            @"presto":             @"A00000039656434103F2142000000000",
            @"myki":               @"A00000F21100",
            @"octopus":            @"A0000005500011",
        };
    });
    return aliases;
}

static NSString *emvAidResolve(NSString *input) {
    if (!input) return nil;
    NSString *lower = [input lowercaseString];

    // If input looks like pure hex, use it as-is (normalize to uppercase, strip spaces)
    NSCharacterSet *hexChars = [NSCharacterSet characterSetWithCharactersInString:@"0123456789abcdefABCDEF"];
    NSString *stripped = [[input componentsSeparatedByCharactersInSet:hexChars.invertedSet] componentsJoinedByString:@""];
    if (stripped.length == input.length && input.length >= 4 && (input.length % 2) == 0) {
        return [input uppercaseString];
    }

    return emvAidAliases()[lower];
}

// Encode an ASCII DF name (e.g. "2PAY.SYS.DDF01") as hex for SELECT by name.
static NSString *emvNameToHex(NSString *name) {
    NSData *bytes = [name dataUsingEncoding:NSASCIIStringEncoding];
    return dataToHex(bytes);
}

// Resolve card brand from AID prefix, for read-emv output.
static NSString *emvBrandFromAid(NSString *aidHex) {
    NSString *upper = aidHex.uppercaseString;
    if ([upper hasPrefix:@"A000000003"]) return @"Visa";
    if ([upper hasPrefix:@"A000000004"]) return @"Mastercard";
    if ([upper hasPrefix:@"A000000025"]) return @"American Express";
    if ([upper hasPrefix:@"A000000065"]) return @"JCB";
    if ([upper hasPrefix:@"A000000152"]) return @"Discover";
    if ([upper hasPrefix:@"A000000277"]) return @"Interac";
    if ([upper hasPrefix:@"A000000333"]) return @"UnionPay";
    if ([upper hasPrefix:@"A000000524"]) return @"RuPay";
    if ([upper hasPrefix:@"A000000658"]) return @"Mir";
    if ([upper hasPrefix:@"A000000672"]) return @"TROY";
    if ([upper hasPrefix:@"A000000042"]) return @"Cartes Bancaires";
    if ([upper hasPrefix:@"A000000121"]) return @"Dankort";
    if ([upper hasPrefix:@"A000000359"]) return @"Girocard";
    if ([upper hasPrefix:@"A000000141"]) return @"PagoBANCOMAT";
    return nil;
}

// MARK: - NFC NDEF Helper

API_AVAILABLE(ios(13.0))
@interface NFCHelper : NSObject <NFCNDEFReaderSessionDelegate>
@property (nonatomic, strong) NFCNDEFReaderSession *ndefSession;
@property (nonatomic, strong) NSMutableArray<NSDictionary *> *scannedRecords;
@property (nonatomic, assign) BOOL isWritable;
@property (nonatomic, assign) NSInteger tagCapacity;
@property (nonatomic, strong) NSString *errorMessage;
@property (nonatomic, assign) BOOL writeSuccess;
@property (nonatomic, strong) dispatch_semaphore_t semaphore;
@property (nonatomic, strong) NFCNDEFMessage *messageToWrite;
@property (nonatomic, assign) BOOL isWriteMode;
@end

API_AVAILABLE(ios(13.0))
@implementation NFCHelper

- (instancetype)init {
    self = [super init];
    if (self) {
        _scannedRecords = [NSMutableArray new];
        _semaphore = dispatch_semaphore_create(0);
    }
    return self;
}

- (void)readerSessionDidBecomeActive:(NFCNDEFReaderSession *)session {}

- (void)readerSession:(NFCNDEFReaderSession *)session didDetectNDEFs:(NSArray<NFCNDEFMessage *> *)messages {
    for (NFCNDEFMessage *msg in messages) {
        for (NFCNDEFPayload *record in msg.records) {
            [self.scannedRecords addObject:[self recordToDict:record]];
        }
    }
    [session invalidateSession];
    dispatch_semaphore_signal(self.semaphore);
}

- (void)readerSession:(NFCNDEFReaderSession *)session didInvalidateWithError:(NSError *)error {
    if (error.code != 200 && error.code != 204) {
        self.errorMessage = error.localizedDescription;
    }
    dispatch_semaphore_signal(self.semaphore);
}

- (void)readerSession:(NFCNDEFReaderSession *)session
          didDetectTags:(NSArray<__kindof id<NFCNDEFTag>> *)tags {
    if (tags.count == 0) return;
    id<NFCNDEFTag> tag = tags.firstObject;

    [session connectToTag:tag completionHandler:^(NSError *connectError) {
        if (connectError) {
            self.errorMessage = connectError.localizedDescription;
            [session invalidateSession];
            dispatch_semaphore_signal(self.semaphore);
            return;
        }
        [tag queryNDEFStatusWithCompletionHandler:^(NFCNDEFStatus ndefStatus, NSUInteger capacity, NSError *queryError) {
            if (queryError) {
                self.errorMessage = queryError.localizedDescription;
                [session invalidateSession];
                dispatch_semaphore_signal(self.semaphore);
                return;
            }
            self.isWritable = (ndefStatus == NFCNDEFStatusReadWrite);
            self.tagCapacity = capacity;

            if (self.isWriteMode && self.messageToWrite) {
                if (ndefStatus != NFCNDEFStatusReadWrite) {
                    self.errorMessage = @"Tag is read-only.";
                    [session invalidateSessionWithErrorMessage:@"Tag is read-only"];
                    dispatch_semaphore_signal(self.semaphore);
                    return;
                }
                [tag writeNDEF:self.messageToWrite completionHandler:^(NSError *writeError) {
                    if (writeError) {
                        self.errorMessage = writeError.localizedDescription;
                        [session invalidateSessionWithErrorMessage:@"Write failed"];
                    } else {
                        self.writeSuccess = YES;
                        session.alertMessage = @"Write successful!";
                        [session invalidateSession];
                    }
                    dispatch_semaphore_signal(self.semaphore);
                }];
            } else {
                [tag readNDEFWithCompletionHandler:^(NFCNDEFMessage *message, NSError *readError) {
                    if (readError) {
                        self.errorMessage = readError.localizedDescription;
                    } else if (message) {
                        for (NFCNDEFPayload *record in message.records) {
                            [self.scannedRecords addObject:[self recordToDict:record]];
                        }
                    }
                    [session invalidateSession];
                    dispatch_semaphore_signal(self.semaphore);
                }];
            }
        }];
    }];
}

- (NSDictionary *)recordToDict:(NFCNDEFPayload *)record {
    NSMutableDictionary *dict = [NSMutableDictionary dictionary];
    NSString *tnfStr;
    switch (record.typeNameFormat) {
        case NFCTypeNameFormatEmpty:             tnfStr = @"empty"; break;
        case NFCTypeNameFormatNFCWellKnown:      tnfStr = @"well_known"; break;
        case NFCTypeNameFormatMedia:             tnfStr = @"media"; break;
        case NFCTypeNameFormatAbsoluteURI:       tnfStr = @"absolute_uri"; break;
        case NFCTypeNameFormatNFCExternal:       tnfStr = @"external"; break;
        default:                                 tnfStr = @"unknown"; break;
    }
    dict[@"tnf"] = tnfStr;
    if (record.type) {
        dict[@"type"] = [[NSString alloc] initWithData:record.type encoding:NSUTF8StringEncoding] ?: @"";
    }
    if (record.payload) {
        dict[@"payload_hex"] = dataToHex(record.payload);
        dict[@"payload_bytes"] = @(record.payload.length);
        NSString *text = [[NSString alloc] initWithData:record.payload encoding:NSUTF8StringEncoding];
        if (text) dict[@"payload_text"] = text;
    }
    if (record.typeNameFormat == NFCTypeNameFormatNFCWellKnown) {
        NSString *typeStr = [[NSString alloc] initWithData:record.type encoding:NSUTF8StringEncoding];
        if ([typeStr isEqualToString:@"T"] && record.payload.length > 0) {
            dict[@"parsed_type"] = @"text";
            const uint8_t *bytes = record.payload.bytes;
            uint8_t langLen = bytes[0] & 0x3F;
            if (1 + langLen < record.payload.length) {
                NSString *lang = [[NSString alloc] initWithBytes:bytes+1 length:langLen encoding:NSUTF8StringEncoding];
                NSString *t = [[NSString alloc] initWithBytes:bytes+1+langLen length:record.payload.length-1-langLen encoding:NSUTF8StringEncoding];
                if (lang) dict[@"language"] = lang;
                if (t) dict[@"text"] = t;
            }
        } else if ([typeStr isEqualToString:@"U"] && record.payload.length > 0) {
            dict[@"parsed_type"] = @"url";
            NSURL *url = [record wellKnownTypeURIPayload];
            if (url) dict[@"url"] = url.absoluteString;
        }
    }
    return dict;
}

@end

// MARK: - Raw Tag Helper

API_AVAILABLE(ios(13.0))
@interface RawTagHelper : NSObject <NFCTagReaderSessionDelegate>
@property (nonatomic, strong) NFCTagReaderSession *session;
@property (nonatomic, strong) dispatch_semaphore_t semaphore;
@property (nonatomic, strong) NSString *errorMessage;
@property (nonatomic, strong) NSMutableDictionary *result;
// Detected tag references (retained for command use)
@property (nonatomic, strong) id<NFCMiFareTag> mifareTag;
@property (nonatomic, strong) id<NFCISO7816Tag> iso7816Tag;
@property (nonatomic, strong) id<NFCISO15693Tag> iso15693Tag;
@property (nonatomic, strong) id<NFCFeliCaTag> felicaTag;
@property (nonatomic, copy) NSString *detectedType;
// Operation block — executed after tag is connected
@property (nonatomic, copy) void (^onConnected)(void);
@end

API_AVAILABLE(ios(13.0))
@implementation RawTagHelper

- (instancetype)init {
    self = [super init];
    if (self) {
        _semaphore = dispatch_semaphore_create(0);
        _result = [NSMutableDictionary new];
    }
    return self;
}

- (void)tagReaderSessionDidBecomeActive:(NFCTagReaderSession *)session {}

- (void)tagReaderSession:(NFCTagReaderSession *)session didInvalidateWithError:(NSError *)error {
    if (error.code != 200) { // not user-cancelled
        if (!self.errorMessage) self.errorMessage = error.localizedDescription;
    }
    dispatch_semaphore_signal(self.semaphore);
}

- (void)tagReaderSession:(NFCTagReaderSession *)session didDetectTags:(NSArray<__kindof id<NFCTag>> *)tags {
    if (tags.count == 0) return;
    id<NFCTag> tag = tags.firstObject;

    // Identify tag type
    id<NFCTag> connectTag = nil;
    if ([tag conformsToProtocol:@protocol(NFCMiFareTag)]) {
        self.mifareTag = (id<NFCMiFareTag>)tag;
        self.detectedType = [self mifareTypeString:self.mifareTag.mifareFamily];
        connectTag = tag;
    } else if ([tag conformsToProtocol:@protocol(NFCISO7816Tag)]) {
        self.iso7816Tag = (id<NFCISO7816Tag>)tag;
        self.detectedType = @"iso7816";
        connectTag = tag;
    } else if ([tag conformsToProtocol:@protocol(NFCISO15693Tag)]) {
        self.iso15693Tag = (id<NFCISO15693Tag>)tag;
        self.detectedType = @"iso15693";
        connectTag = tag;
    } else if ([tag conformsToProtocol:@protocol(NFCFeliCaTag)]) {
        self.felicaTag = (id<NFCFeliCaTag>)tag;
        self.detectedType = @"felica";
        connectTag = tag;
    } else {
        self.errorMessage = @"Unsupported tag type.";
        [session invalidateSessionWithErrorMessage:@"Unsupported tag"];
        return;
    }

    [session connectToTag:connectTag completionHandler:^(NSError *err) {
        if (err) {
            self.errorMessage = err.localizedDescription;
            [session invalidateSession];
            dispatch_semaphore_signal(self.semaphore);
            return;
        }
        if (self.onConnected) {
            self.onConnected();
        } else {
            [session invalidateSession];
            dispatch_semaphore_signal(self.semaphore);
        }
    }];
}

- (NSString *)mifareTypeString:(NFCMiFareFamily)family {
    switch (family) {
        case NFCMiFareUltralight: return @"mifare_ultralight";
        case NFCMiFarePlus:       return @"mifare_plus";
        case NFCMiFareDESFire:    return @"mifare_desfire";
        default:                        return @"mifare_unknown";
    }
}

@end

// MARK: - Start a raw tag session and wait

API_AVAILABLE(ios(13.0))
static RawTagHelper *startRawTagSession(NSString *message, NSTimeInterval timeout) {
    RawTagHelper *helper = [[RawTagHelper alloc] init];
    dispatch_async(dispatch_get_main_queue(), ^{
        helper.session = [[NFCTagReaderSession alloc]
            initWithPollingOption:(NFCPollingISO14443 | NFCPollingISO15693 | NFCPollingISO18092)
                        delegate:helper queue:nil];
        helper.session.alertMessage = message ?: @"Hold your iPhone near the NFC tag";
        [helper.session beginSession];
    });
    long result = dispatch_semaphore_wait(helper.semaphore,
        dispatch_time(DISPATCH_TIME_NOW, (int64_t)(timeout * NSEC_PER_SEC)));
    if (result != 0) {
        dispatch_async(dispatch_get_main_queue(), ^{
            [helper.session invalidateSessionWithErrorMessage:@"Timed out"];
        });
        helper.errorMessage = @"Timed out. Hold the top of the iPhone directly against the tag.";
    }
    return helper;
}

// MARK: - NDEF Commands

static int cmd_status(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    if (@available(iOS 13.0, *)) {
        BOOL available = NFCNDEFReaderSession.readingAvailable;
        NSDictionary *data = @{
            @"nfc_available": @(available),
            @"ndef_supported": @(available),
            @"raw_tag_supported": @(available),
            @"supported_protocols": @[@"NDEF", @"MIFARE Ultralight/DESFire", @"ISO 7816 (smart cards)", @"ISO 15693", @"FeliCa"],
            @"hint": available
                ? @"NFC ready. Use 'apple-nfc scan' for NDEF data, 'tag-info' to detect tag type, or 'apdu' for smart card commands."
                : @"NFC is not available on this device (requires iPhone 7+).",
        };
        noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"status", data), compact, quiet);
        return NOFF_EXIT_SUCCESS;
    }
    noff_emit_json(stdout_fd,
        noff_json_error(TOOL_NAME, @"status", NOFF_ERR_NOT_AVAILABLE, @"NFC requires iOS 13+."),
        compact, quiet);
    return NOFF_EXIT_NOT_AVAILABLE;
}

static int cmd_scan(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    if (@available(iOS 13.0, *)) {
        if (!NFCNDEFReaderSession.readingAvailable) {
            noff_emit_json(stdout_fd,
                noff_json_error(TOOL_NAME, @"scan", NOFF_ERR_NOT_AVAILABLE, @"NFC not available."),
                compact, quiet);
            return NOFF_EXIT_NOT_AVAILABLE;
        }
        NSString *message = noff_find_arg(argc, argv, "--message") ?: @"Hold your iPhone near an NFC tag";
        NSString *timeoutStr = noff_find_arg(argc, argv, "--timeout");
        NSTimeInterval timeout = timeoutStr ? [timeoutStr doubleValue] : 30.0;
        if (timeout <= 0 || timeout > 120) timeout = 30.0;

        __block NFCHelper *helper = [[NFCHelper alloc] init];
        helper.isWriteMode = NO;
        dispatch_async(dispatch_get_main_queue(), ^{
            helper.ndefSession = [[NFCNDEFReaderSession alloc]
                initWithDelegate:helper queue:nil invalidateAfterFirstRead:NO];
            helper.ndefSession.alertMessage = message;
            [helper.ndefSession beginSession];
        });
        long result = dispatch_semaphore_wait(helper.semaphore,
            dispatch_time(DISPATCH_TIME_NOW, (int64_t)(timeout * NSEC_PER_SEC)));
        if (result != 0) {
            dispatch_async(dispatch_get_main_queue(), ^{
                [helper.ndefSession invalidateSessionWithErrorMessage:@"Scan timed out"];
            });
            noff_emit_json(stdout_fd,
                noff_json_error(TOOL_NAME, @"scan", NOFF_ERR_INTERNAL_ERROR,
                    @"Scan timed out. Hold the top of the iPhone directly against the tag. Try --timeout 30 for more time."),
                compact, quiet);
            return NOFF_EXIT_ERROR;
        }
        if (helper.errorMessage) {
            noff_emit_json(stdout_fd,
                noff_json_error(TOOL_NAME, @"scan", NOFF_ERR_INTERNAL_ERROR, helper.errorMessage),
                compact, quiet);
            return NOFF_EXIT_ERROR;
        }
        NSMutableDictionary *data = [@{
            @"records": [helper.scannedRecords copy],
            @"record_count": @(helper.scannedRecords.count),
            @"writable": @(helper.isWritable),
            @"capacity_bytes": @(helper.tagCapacity),
        } mutableCopy];
        if (helper.isWritable) {
            data[@"hint"] = @"Tag is writable. Use 'apple-nfc write --type text --payload \"your text\"' to write. For raw access use 'apple-nfc tag-info'.";
        } else if (helper.scannedRecords.count == 0) {
            data[@"hint"] = @"No NDEF records. Try 'apple-nfc tag-info' to detect tag type, then 'tag-read' for raw memory.";
        }
        noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"scan", data), compact, quiet);
        return NOFF_EXIT_SUCCESS;
    }
    noff_emit_json(stdout_fd,
        noff_json_error(TOOL_NAME, @"scan", NOFF_ERR_NOT_AVAILABLE, @"NFC requires iOS 13+."),
        compact, quiet);
    return NOFF_EXIT_NOT_AVAILABLE;
}

static int cmd_write(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    if (@available(iOS 13.0, *)) {
        if (!NFCNDEFReaderSession.readingAvailable) {
            noff_emit_json(stdout_fd,
                noff_json_error(TOOL_NAME, @"write", NOFF_ERR_NOT_AVAILABLE, @"NFC not available."),
                compact, quiet);
            return NOFF_EXIT_NOT_AVAILABLE;
        }
        NSString *type = noff_find_arg(argc, argv, "--type") ?: @"text";
        NSString *payload = noff_find_arg(argc, argv, "--payload");
        NSString *mimeType = noff_find_arg(argc, argv, "--mime") ?: @"application/octet-stream";
        NSString *locale = noff_find_arg(argc, argv, "--locale") ?: @"en";
        NSString *message = noff_find_arg(argc, argv, "--message") ?: @"Hold your iPhone near the NFC tag to write";
        NSString *timeoutStr = noff_find_arg(argc, argv, "--timeout");
        NSTimeInterval timeout = timeoutStr ? [timeoutStr doubleValue] : 30.0;
        if (timeout <= 0 || timeout > 120) timeout = 30.0;

        if (!payload) {
            noff_emit_json(stdout_fd,
                noff_json_error(TOOL_NAME, @"write", NOFF_ERR_INVALID_ARGS,
                    @"--payload is required. Use --type text/url/mime with --payload <content>."),
                compact, quiet);
            return NOFF_EXIT_INVALID_ARGS;
        }

        NFCNDEFPayload *record = nil;
        if ([type isEqualToString:@"text"]) {
            record = [NFCNDEFPayload wellKnownTypeTextPayloadWithString:payload locale:[[NSLocale alloc] initWithLocaleIdentifier:locale]];
        } else if ([type isEqualToString:@"url"]) {
            NSURL *url = [NSURL URLWithString:payload];
            if (!url) {
                noff_emit_json(stdout_fd,
                    noff_json_error(TOOL_NAME, @"write", NOFF_ERR_INVALID_ARGS, @"Invalid URL."),
                    compact, quiet);
                return NOFF_EXIT_INVALID_ARGS;
            }
            record = [NFCNDEFPayload wellKnownTypeURIPayloadWithURL:url];
        } else if ([type isEqualToString:@"mime"]) {
            record = [[NFCNDEFPayload alloc]
                initWithFormat:NFCTypeNameFormatMedia
                          type:[mimeType dataUsingEncoding:NSUTF8StringEncoding]
                    identifier:[NSData data]
                       payload:[payload dataUsingEncoding:NSUTF8StringEncoding]];
        } else {
            noff_emit_json(stdout_fd,
                noff_json_error(TOOL_NAME, @"write", NOFF_ERR_INVALID_ARGS,
                    [NSString stringWithFormat:@"Unknown type '%@'. Valid: text, url, mime.", type]),
                compact, quiet);
            return NOFF_EXIT_INVALID_ARGS;
        }
        if (!record) {
            noff_emit_json(stdout_fd,
                noff_json_error(TOOL_NAME, @"write", NOFF_ERR_INTERNAL_ERROR, @"Failed to create NDEF record."),
                compact, quiet);
            return NOFF_EXIT_ERROR;
        }

        NFCNDEFMessage *ndefMessage = [[NFCNDEFMessage alloc] initWithNDEFRecords:@[record]];
        __block NFCHelper *helper = [[NFCHelper alloc] init];
        helper.isWriteMode = YES;
        helper.messageToWrite = ndefMessage;
        dispatch_async(dispatch_get_main_queue(), ^{
            helper.ndefSession = [[NFCNDEFReaderSession alloc]
                initWithDelegate:helper queue:nil invalidateAfterFirstRead:NO];
            helper.ndefSession.alertMessage = message;
            [helper.ndefSession beginSession];
        });
        long result = dispatch_semaphore_wait(helper.semaphore,
            dispatch_time(DISPATCH_TIME_NOW, (int64_t)(timeout * NSEC_PER_SEC)));
        if (result != 0) {
            dispatch_async(dispatch_get_main_queue(), ^{
                [helper.ndefSession invalidateSessionWithErrorMessage:@"Write timed out"];
            });
            noff_emit_json(stdout_fd,
                noff_json_error(TOOL_NAME, @"write", NOFF_ERR_INTERNAL_ERROR,
                    @"Write timed out. Hold the top of the iPhone against the tag and keep still."),
                compact, quiet);
            return NOFF_EXIT_ERROR;
        }
        if (helper.errorMessage) {
            noff_emit_json(stdout_fd,
                noff_json_error(TOOL_NAME, @"write", NOFF_ERR_INTERNAL_ERROR, helper.errorMessage),
                compact, quiet);
            return NOFF_EXIT_ERROR;
        }
        NSDictionary *data = @{
            @"type": type, @"payload_bytes": @([payload dataUsingEncoding:NSUTF8StringEncoding].length),
            @"success": @(helper.writeSuccess),
            @"hint": @"Write successful. Use 'apple-nfc scan' to verify.",
        };
        noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"write", data), compact, quiet);
        return NOFF_EXIT_SUCCESS;
    }
    noff_emit_json(stdout_fd,
        noff_json_error(TOOL_NAME, @"write", NOFF_ERR_NOT_AVAILABLE, @"NFC requires iOS 13+."),
        compact, quiet);
    return NOFF_EXIT_NOT_AVAILABLE;
}

// MARK: - Raw Tag Commands

static int cmd_tag_info(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    if (@available(iOS 13.0, *)) {
        NSString *message = noff_find_arg(argc, argv, "--message") ?: @"Hold your iPhone near the NFC tag";
        NSString *timeoutStr = noff_find_arg(argc, argv, "--timeout");
        NSTimeInterval timeout = timeoutStr ? [timeoutStr doubleValue] : 30.0;

        __block NSMutableDictionary *info = [NSMutableDictionary new];
        RawTagHelper *helper = [[RawTagHelper alloc] init];
        helper.onConnected = ^{
            info[@"tag_type"] = helper.detectedType ?: @"unknown";
            if (helper.mifareTag) {
                info[@"uid"] = dataToHex(helper.mifareTag.identifier);
                info[@"uid_bytes"] = @(helper.mifareTag.identifier.length);
                info[@"mifare_family"] = helper.detectedType;
                info[@"historical_bytes"] = helper.mifareTag.historicalBytes ? dataToHex(helper.mifareTag.historicalBytes) : [NSNull null];
                info[@"hint"] = @"MIFARE tag. Use 'apple-nfc tag-read --page 0 --pages 16' to dump memory, or 'tag-write --page <n> --data <hex>' to write.";
            } else if (helper.iso7816Tag) {
                info[@"uid"] = dataToHex(helper.iso7816Tag.identifier);
                info[@"uid_bytes"] = @(helper.iso7816Tag.identifier.length);
                info[@"historical_bytes"] = helper.iso7816Tag.historicalBytes ? dataToHex(helper.iso7816Tag.historicalBytes) : [NSNull null];
                info[@"application_data"] = helper.iso7816Tag.applicationData ? dataToHex(helper.iso7816Tag.applicationData) : [NSNull null];
                info[@"initial_selected_aid"] = helper.iso7816Tag.initialSelectedAID ?: [NSNull null];
                info[@"hint"] = @"ISO 7816 smart card. Use 'apple-nfc apdu --cla 00 --ins B0 --p1 00 --p2 00 --le 256' to send APDU commands.";
            } else if (helper.iso15693Tag) {
                info[@"uid"] = dataToHex(helper.iso15693Tag.identifier);
                info[@"uid_bytes"] = @(helper.iso15693Tag.identifier.length);
                info[@"ic_manufacturer_code"] = @(helper.iso15693Tag.icManufacturerCode);
                info[@"ic_serial_number"] = dataToHex(helper.iso15693Tag.icSerialNumber);
                info[@"hint"] = @"ISO 15693 tag. Use 'apple-nfc tag-read --block 0 --blocks 8' to read blocks.";
            } else if (helper.felicaTag) {
                info[@"idm"] = dataToHex(helper.felicaTag.currentIDm);
                info[@"system_code"] = dataToHex(helper.felicaTag.currentSystemCode);
                info[@"hint"] = @"FeliCa tag. Use 'apple-nfc felica --sc <service-code-hex> --bc 1 --bl 8000' to read blocks.";
            }
            [helper.session invalidateSession];
            dispatch_semaphore_signal(helper.semaphore);
        };

        dispatch_async(dispatch_get_main_queue(), ^{
            helper.session = [[NFCTagReaderSession alloc]
                initWithPollingOption:(NFCPollingISO14443 | NFCPollingISO15693 | NFCPollingISO18092)
                            delegate:helper queue:nil];
            helper.session.alertMessage = message;
            [helper.session beginSession];
        });
        long result = dispatch_semaphore_wait(helper.semaphore,
            dispatch_time(DISPATCH_TIME_NOW, (int64_t)(timeout * NSEC_PER_SEC)));
        if (result != 0) {
            dispatch_async(dispatch_get_main_queue(), ^{
                [helper.session invalidateSessionWithErrorMessage:@"Timed out"];
            });
            noff_emit_json(stdout_fd,
                noff_json_error(TOOL_NAME, @"tag-info", NOFF_ERR_INTERNAL_ERROR,
                    @"Timed out. Hold the top of the iPhone directly against the tag."),
                compact, quiet);
            return NOFF_EXIT_ERROR;
        }
        if (helper.errorMessage) {
            noff_emit_json(stdout_fd,
                noff_json_error(TOOL_NAME, @"tag-info", NOFF_ERR_INTERNAL_ERROR, helper.errorMessage),
                compact, quiet);
            return NOFF_EXIT_ERROR;
        }
        noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"tag-info", info), compact, quiet);
        return NOFF_EXIT_SUCCESS;
    }
    noff_emit_json(stdout_fd,
        noff_json_error(TOOL_NAME, @"tag-info", NOFF_ERR_NOT_AVAILABLE, @"NFC requires iOS 13+."),
        compact, quiet);
    return NOFF_EXIT_NOT_AVAILABLE;
}

static int cmd_tag_read(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    if (@available(iOS 13.0, *)) {
        NSString *pageStr = noff_find_arg(argc, argv, "--page");
        NSString *pagesStr = noff_find_arg(argc, argv, "--pages");
        NSString *blockStr = noff_find_arg(argc, argv, "--block");
        NSString *blocksStr = noff_find_arg(argc, argv, "--blocks");
        int startPage = pageStr ? [pageStr intValue] : (blockStr ? [blockStr intValue] : 0);
        int count = pagesStr ? [pagesStr intValue] : (blocksStr ? [blocksStr intValue] : 4);
        if (count <= 0) count = 4;
        if (count > 64) count = 64;

        NSString *message = noff_find_arg(argc, argv, "--message") ?: @"Hold near tag to read";
        NSString *timeoutStr = noff_find_arg(argc, argv, "--timeout");
        NSTimeInterval timeout = timeoutStr ? [timeoutStr doubleValue] : 30.0;

        __block NSMutableDictionary *readResult = [NSMutableDictionary new];
        __block NSString *readError = nil;

        RawTagHelper *helper = [[RawTagHelper alloc] init];
        helper.onConnected = ^{
            dispatch_semaphore_t readSem = dispatch_semaphore_create(0);

            if (helper.mifareTag) {
                // MIFARE: read pages via sendMIFARECommand (READ command 0x30)
                NSMutableArray *pages = [NSMutableArray new];
                __block int remaining = count;
                __block int currentPage = startPage;

                __block void (^readBlock)(void);
                readBlock = ^{
                    if (remaining <= 0) {
                        dispatch_semaphore_signal(readSem);
                        return;
                    }
                    // MIFARE Ultralight READ = 0x30, reads 4 pages (16 bytes) at once
                    uint8_t cmd[] = {0x30, (uint8_t)currentPage};
                    NSData *cmdData = [NSData dataWithBytes:cmd length:2];
                    [helper.mifareTag sendMiFareCommand:cmdData completionHandler:^(NSData *response, NSError *error) {
                        if (error || response.length == 0) {
                            // Read past end or error — stop
                            dispatch_semaphore_signal(readSem);
                            return;
                        }
                        // Response is 16 bytes (4 pages × 4 bytes each)
                        for (int i = 0; i < 4 && remaining > 0; i++) {
                            if (i * 4 < (int)response.length) {
                                NSData *pageData = [response subdataWithRange:NSMakeRange(i * 4, MIN(4, (int)response.length - i * 4))];
                                [pages addObject:@{
                                    @"page": @(currentPage),
                                    @"hex": dataToHex(pageData),
                                    @"ascii": [[NSString alloc] initWithData:pageData encoding:NSASCIIStringEncoding] ?: @"",
                                }];
                                currentPage++;
                                remaining--;
                            }
                        }
                        readBlock();
                    }];
                };
                readBlock();
                long readWait = dispatch_semaphore_wait(readSem, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC));
                readResult[@"tag_type"] = helper.detectedType;
                readResult[@"pages"] = pages;
                if (readWait != 0 || (int)pages.count < count) {
                    readResult[@"partial"] = @YES;
                    readResult[@"pages_requested"] = @(count);
                    readResult[@"pages_read"] = @(pages.count);
                    readResult[@"hint"] = @"Partial read — tag may have been moved. Hold steady and retry with 'apple-nfc tag-read'.";
                } else {
                    readResult[@"hint"] = @"Use 'apple-nfc tag-write --page <n> --data <hex>' to write pages. Each MIFARE Ultralight page is 4 bytes.";
                }

            } else if (helper.iso15693Tag) {
                // ISO 15693: read blocks sequentially (parallel reads can cause "Tag connection lost")
                NSMutableArray *blocks = [NSMutableArray new];
                __block int blockIdx = 0;
                __block void (^readNextBlock)(void);
                readNextBlock = ^{
                    if (blockIdx >= count) {
                        dispatch_semaphore_signal(readSem);
                        return;
                    }
                    uint8_t blockNum = (uint8_t)(startPage + blockIdx);
                    [helper.iso15693Tag readSingleBlockWithRequestFlags:NFCISO15693RequestFlagHighDataRate blockNumber:blockNum completionHandler:^(NSData *data, NSError *error) {
                        if (!error && data) {
                            [blocks addObject:@{
                                @"block": @(blockNum),
                                @"hex": dataToHex(data),
                                @"bytes": @(data.length),
                            }];
                        }
                        blockIdx++;
                        readNextBlock();
                    }];
                };
                readNextBlock();
                long isoWait = dispatch_semaphore_wait(readSem, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC));
                readResult[@"tag_type"] = @"iso15693";
                readResult[@"blocks"] = blocks;
                if (isoWait != 0 || (int)blocks.count < count) {
                    readResult[@"partial"] = @YES;
                    readResult[@"blocks_requested"] = @(count);
                    readResult[@"blocks_read"] = @(blocks.count);
                    readResult[@"hint"] = @"Partial read — tag may have been moved. Hold steady and retry.";
                } else {
                    readResult[@"hint"] = @"Use 'apple-nfc tag-write --block <n> --data <hex>' to write blocks.";
                }
            } else {
                readError = [NSString stringWithFormat:@"Tag type '%@' does not support page/block reads. Use 'apple-nfc apdu' for ISO 7816 or 'felica' for FeliCa.", helper.detectedType];
            }

            helper.session.alertMessage = @"Read complete";
            [helper.session invalidateSession];
            dispatch_semaphore_signal(helper.semaphore);
        };

        dispatch_async(dispatch_get_main_queue(), ^{
            helper.session = [[NFCTagReaderSession alloc]
                initWithPollingOption:(NFCPollingISO14443 | NFCPollingISO15693)
                            delegate:helper queue:nil];
            helper.session.alertMessage = message;
            [helper.session beginSession];
        });
        long result = dispatch_semaphore_wait(helper.semaphore,
            dispatch_time(DISPATCH_TIME_NOW, (int64_t)(timeout * NSEC_PER_SEC)));
        if (result != 0 || helper.errorMessage || readError) {
            NSString *err = readError ?: helper.errorMessage ?: @"Timed out.";
            noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"tag-read", NOFF_ERR_INTERNAL_ERROR, err), compact, quiet);
            return NOFF_EXIT_ERROR;
        }
        noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"tag-read", readResult), compact, quiet);
        return NOFF_EXIT_SUCCESS;
    }
    noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"tag-read", NOFF_ERR_NOT_AVAILABLE, @"NFC requires iOS 13+."), compact, quiet);
    return NOFF_EXIT_NOT_AVAILABLE;
}

static int cmd_tag_write(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    if (@available(iOS 13.0, *)) {
        NSString *hexData = noff_find_arg(argc, argv, "--data");
        if (!hexData) {
            noff_emit_json(stdout_fd,
                noff_json_error(TOOL_NAME, @"tag-write", NOFF_ERR_INVALID_ARGS,
                    @"--data <hex> is required. Each MIFARE page is 4 bytes (8 hex chars). Example: --data 48656C6C"),
                compact, quiet);
            return NOFF_EXIT_INVALID_ARGS;
        }
        NSData *writeData = dataFromHex(hexData);
        NSString *pageStr = noff_find_arg(argc, argv, "--page") ?: noff_find_arg(argc, argv, "--block");
        int page = pageStr ? [pageStr intValue] : 4; // default to page 4 (first user data page on NTAG)

        NSString *message = noff_find_arg(argc, argv, "--message") ?: @"Hold near tag to write";
        NSString *timeoutStr = noff_find_arg(argc, argv, "--timeout");
        NSTimeInterval timeout = timeoutStr ? [timeoutStr doubleValue] : 30.0;

        __block BOOL writeOk = NO;
        __block NSString *writeError = nil;

        RawTagHelper *helper = [[RawTagHelper alloc] init];
        helper.onConnected = ^{
            __block int writtenPages = 0;
            __block BOOL failed = NO;

            if (helper.mifareTag) {
                // MIFARE Ultralight WRITE = 0xA2, writes 4 bytes per page
                // Pad or split data into 4-byte pages
                NSUInteger totalPages = (writeData.length + 3) / 4;
                dispatch_semaphore_t wSem = dispatch_semaphore_create(0);

                __block void (^writeBlock)(int);
                writeBlock = ^(int pageOffset) {
                    if (failed || pageOffset >= (int)totalPages) {
                        dispatch_semaphore_signal(wSem);
                        return;
                    }
                    uint8_t pageData[4] = {0};
                    NSUInteger offset = pageOffset * 4;
                    NSUInteger len = MIN(4, writeData.length - offset);
                    memcpy(pageData, (const uint8_t *)writeData.bytes + offset, len);

                    uint8_t cmd[6] = {0xA2, (uint8_t)(page + pageOffset), pageData[0], pageData[1], pageData[2], pageData[3]};
                    NSData *cmdData = [NSData dataWithBytes:cmd length:6];
                    [helper.mifareTag sendMiFareCommand:cmdData completionHandler:^(NSData *response, NSError *error) {
                        if (error) {
                            writeError = error.localizedDescription;
                            failed = YES;
                            dispatch_semaphore_signal(wSem);
                            return;
                        }
                        writtenPages++;
                        writeBlock(pageOffset + 1);
                    }];
                };
                writeBlock(0);
                long wWait = dispatch_semaphore_wait(wSem, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC));
                if (wWait != 0) {
                    // Internal timeout — tag likely moved during write
                    failed = YES;
                    if (!writeError) writeError = @"Write timed out — tag may have been moved. Hold steady and retry.";
                }
                writeOk = !failed;
            } else if (helper.iso15693Tag) {
                // ISO 15693: write blocks sequentially (block size typically 4 bytes)
                // Query system info to get block size, fallback to 4
                __block NSUInteger blockSize = 4;
                dispatch_semaphore_t infoSem = dispatch_semaphore_create(0);
                if (@available(iOS 14.0, *)) {
                    [helper.iso15693Tag getSystemInfoAndUIDWithRequestFlag:NFCISO15693RequestFlagHighDataRate completionHandler:^(NSData *uid, NSInteger dsfid, NSInteger afi, NSInteger bs, NSInteger blockCount, NSInteger icRef, NSError *error) {
                        if (!error && bs > 0) blockSize = (NSUInteger)bs;
                        dispatch_semaphore_signal(infoSem);
                    }];
                } else {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
                    [helper.iso15693Tag getSystemInfoWithRequestFlag:NFCISO15693RequestFlagHighDataRate completionHandler:^(NSInteger dsfid, NSInteger afi, NSInteger bs, NSInteger blockCount, NSInteger icRef, NSError *error) {
                        if (!error && bs > 0) blockSize = (NSUInteger)bs;
                        dispatch_semaphore_signal(infoSem);
                    }];
#pragma clang diagnostic pop
                }
                dispatch_semaphore_wait(infoSem, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC));

                NSUInteger totalBlocks = (writeData.length + blockSize - 1) / blockSize;
                dispatch_semaphore_t wSem = dispatch_semaphore_create(0);
                __block int blockIdx = 0;
                __block void (^writeNextBlock)(void);
                writeNextBlock = ^{
                    if (failed || blockIdx >= (int)totalBlocks) {
                        dispatch_semaphore_signal(wSem);
                        return;
                    }
                    uint8_t blockNum = (uint8_t)(page + blockIdx);
                    NSUInteger offset = blockIdx * blockSize;
                    NSUInteger len = MIN(blockSize, writeData.length - offset);
                    // Pad to full block size
                    NSMutableData *blockData = [NSMutableData dataWithLength:blockSize];
                    memcpy(blockData.mutableBytes, (const uint8_t *)writeData.bytes + offset, len);
                    [helper.iso15693Tag writeSingleBlockWithRequestFlags:NFCISO15693RequestFlagHighDataRate blockNumber:blockNum dataBlock:blockData completionHandler:^(NSError *error) {
                        if (error) {
                            writeError = error.localizedDescription;
                            failed = YES;
                            dispatch_semaphore_signal(wSem);
                            return;
                        }
                        writtenPages++;
                        blockIdx++;
                        writeNextBlock();
                    }];
                };
                writeNextBlock();
                long isoWWait = dispatch_semaphore_wait(wSem, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC));
                if (isoWWait != 0 && !writeError) {
                    writeError = @"Write timed out — tag may have been moved. Hold steady and retry.";
                    failed = YES;
                }
                writeOk = !failed;
            } else {
                writeError = [NSString stringWithFormat:@"Tag type '%@' does not support raw writes. Use 'apple-nfc write' for NDEF or 'apdu' for smart cards.", helper.detectedType];
            }

            helper.session.alertMessage = writeOk ? @"Write successful!" : @"Write failed";
            [helper.session invalidateSession];
            dispatch_semaphore_signal(helper.semaphore);
        };

        dispatch_async(dispatch_get_main_queue(), ^{
            helper.session = [[NFCTagReaderSession alloc]
                initWithPollingOption:(NFCPollingISO14443 | NFCPollingISO15693)
                            delegate:helper queue:nil];
            helper.session.alertMessage = message;
            [helper.session beginSession];
        });
        long result = dispatch_semaphore_wait(helper.semaphore,
            dispatch_time(DISPATCH_TIME_NOW, (int64_t)(timeout * NSEC_PER_SEC)));
        if (result != 0 || writeError) {
            noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"tag-write", NOFF_ERR_INTERNAL_ERROR,
                writeError ?: @"Timed out."), compact, quiet);
            return NOFF_EXIT_ERROR;
        }
        NSDictionary *data = @{
            @"page": @(page), @"bytes_written": @(writeData.length), @"success": @(writeOk),
            @"hint": @"Use 'apple-nfc tag-read' to verify the written data.",
        };
        noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"tag-write", data), compact, quiet);
        return NOFF_EXIT_SUCCESS;
    }
    noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"tag-write", NOFF_ERR_NOT_AVAILABLE, @"NFC requires iOS 13+."), compact, quiet);
    return NOFF_EXIT_NOT_AVAILABLE;
}

static int cmd_apdu(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    if (@available(iOS 13.0, *)) {
        NSString *rawApdu = noff_find_arg(argc, argv, "--apdu");
        NSString *message = noff_find_arg(argc, argv, "--message") ?: @"Hold near smart card";
        NSString *timeoutStr = noff_find_arg(argc, argv, "--timeout");
        NSTimeInterval timeout = timeoutStr ? [timeoutStr doubleValue] : 30.0;

        // Semantic shortcuts for SELECT commands.
        // --select-aid <hex-or-alias>   e.g. "A0000000041010" or "unionpay" or "ppse"
        // --select-name <ascii>         e.g. "2PAY.SYS.DDF01" (encoded to hex, P1=04)
        NSString *selectAid = noff_find_arg(argc, argv, "--select-aid");
        NSString *selectName = noff_find_arg(argc, argv, "--select-name");

        // Build APDU either from --apdu hex, --select-aid/--select-name, or individual components
        NFCISO7816APDU *apdu = nil;
        NSString *resolvedAidHex = nil;
        if (rawApdu) {
            NSData *apduData = dataFromHex(rawApdu);
            if (apduData.length < 4) {
                noff_emit_json(stdout_fd,
                    noff_json_error(TOOL_NAME, @"apdu", NOFF_ERR_INVALID_ARGS,
                        @"APDU must be at least 4 bytes (CLA INS P1 P2). Example: --apdu 00B0000000"),
                    compact, quiet);
                return NOFF_EXIT_INVALID_ARGS;
            }
            apdu = [[NFCISO7816APDU alloc] initWithData:apduData];
        } else if (selectAid || selectName) {
            // SELECT command: 00 A4 04 00 <Lc> <data> 00
            NSData *selData;
            uint8_t p1;
            if (selectAid) {
                resolvedAidHex = emvAidResolve(selectAid);
                if (!resolvedAidHex) {
                    noff_emit_json(stdout_fd,
                        noff_json_error(TOOL_NAME, @"apdu", NOFF_ERR_INVALID_ARGS,
                            [NSString stringWithFormat:@"Could not resolve '%@' to an AID. Use hex directly or a known alias (ppse, pse, unionpay, visa, mastercard, amex, jcb, piv, openpgp, passport, ...).", selectAid]),
                        compact, quiet);
                    return NOFF_EXIT_INVALID_ARGS;
                }
                selData = dataFromHex(resolvedAidHex);
                p1 = 0x04; // SELECT by DF name / AID
            } else {
                selData = [selectName dataUsingEncoding:NSASCIIStringEncoding];
                p1 = 0x04; // SELECT by DF name
            }
            apdu = [[NFCISO7816APDU alloc] initWithInstructionClass:0x00
                instructionCode:0xA4 p1Parameter:p1 p2Parameter:0x00
                data:selData expectedResponseLength:256];
        } else {
            NSString *insStr = noff_find_arg(argc, argv, "--ins");
            if (!insStr) {
                noff_emit_json(stdout_fd,
                    noff_json_error(TOOL_NAME, @"apdu", NOFF_ERR_INVALID_ARGS,
                        @"Use --apdu <hex> for raw APDU, --select-aid <hex-or-alias> / --select-name <ascii> for SELECT, or --ins <hex> with --cla/--p1/--p2/--le for structured. Examples:\n  --select-aid ppse\n  --select-aid unionpay\n  --select-aid A0000000041010\n  --select-name \"2PAY.SYS.DDF01\"\n  --cla 00 --ins B0 --p1 00 --p2 00 --le 256\n  --apdu 00B0000000"),
                    compact, quiet);
                return NOFF_EXIT_INVALID_ARGS;
            }
            uint8_t cla = hexByte(noff_find_arg(argc, argv, "--cla") ?: @"00");
            uint8_t ins = hexByte(insStr);
            uint8_t p1 = hexByte(noff_find_arg(argc, argv, "--p1") ?: @"00");
            uint8_t p2 = hexByte(noff_find_arg(argc, argv, "--p2") ?: @"00");
            NSString *dataHex = noff_find_arg(argc, argv, "--data");
            NSData *cmdData = dataHex ? dataFromHex(dataHex) : [NSData data];
            NSString *leStr = noff_find_arg(argc, argv, "--le");
            NSInteger le = leStr ? [leStr integerValue] : -1;

            apdu = [[NFCISO7816APDU alloc] initWithInstructionClass:cla
                instructionCode:ins p1Parameter:p1 p2Parameter:p2
                data:cmdData expectedResponseLength:le];
        }
        if (!apdu) {
            noff_emit_json(stdout_fd,
                noff_json_error(TOOL_NAME, @"apdu", NOFF_ERR_INVALID_ARGS, @"Failed to build APDU."),
                compact, quiet);
            return NOFF_EXIT_INVALID_ARGS;
        }

        __block NSMutableDictionary *apduResult = [NSMutableDictionary new];
        __block NSString *apduError = nil;
        // Echo back the resolved APDU so callers can see what was actually sent
        if (resolvedAidHex) {
            apduResult[@"selected_aid"] = resolvedAidHex;
            NSString *aidName = emvAidName(resolvedAidHex);
            if (aidName) apduResult[@"selected_aid_name"] = aidName;
        } else if (selectName) {
            apduResult[@"selected_name"] = selectName;
        }

        RawTagHelper *helper = [[RawTagHelper alloc] init];
        helper.onConnected = ^{
            // Try ISO 7816 first, fall back to MIFARE (NTAG supports ISO 7816 via historicalBytes)
            id<NFCISO7816Tag> tag = helper.iso7816Tag;
            if (!tag && helper.mifareTag) {
                // MIFARE tags that support ISO 7816 (DESFire, etc.)
                tag = (id<NFCISO7816Tag>)helper.mifareTag;
                if (![tag conformsToProtocol:@protocol(NFCISO7816Tag)]) tag = nil;
            }
            if (!tag) {
                apduError = [NSString stringWithFormat:@"Tag type '%@' does not support APDU commands. APDU requires ISO 7816 compatible tags (smart cards, MIFARE DESFire).", helper.detectedType];
                [helper.session invalidateSession];
                dispatch_semaphore_signal(helper.semaphore);
                return;
            }

            dispatch_semaphore_t aSem = dispatch_semaphore_create(0);
            [tag sendCommandAPDU:apdu completionHandler:^(NSData *responseData, uint8_t sw1, uint8_t sw2, NSError *error) {
                if (error) {
                    apduError = error.localizedDescription;
                } else {
                    apduResult[@"sw1"] = [NSString stringWithFormat:@"%02X", sw1];
                    apduResult[@"sw2"] = [NSString stringWithFormat:@"%02X", sw2];
                    apduResult[@"status_word"] = [NSString stringWithFormat:@"%02X%02X", sw1, sw2];
                    apduResult[@"response_hex"] = dataToHex(responseData);
                    apduResult[@"response_bytes"] = @(responseData.length);
                    NSString *utf8 = [[NSString alloc] initWithData:responseData encoding:NSUTF8StringEncoding];
                    if (utf8) apduResult[@"response_utf8"] = utf8;
                    apduResult[@"success"] = @(sw1 == 0x90 && sw2 == 0x00);
                    if (sw1 == 0x90 && sw2 == 0x00) {
                        apduResult[@"hint"] = @"Command succeeded (SW=9000). Send more APDU commands as needed.";
                    } else if (sw1 == 0x6C) {
                        apduResult[@"hint"] = [NSString stringWithFormat:@"Wrong Le. Retry with --le %d", sw2];
                    } else if (sw1 == 0x61) {
                        apduResult[@"hint"] = [NSString stringWithFormat:@"More data available. Send GET RESPONSE: --cla 00 --ins C0 --p1 00 --p2 00 --le %d", sw2];
                    } else {
                        apduResult[@"hint"] = [NSString stringWithFormat:@"Non-success status %02X%02X. Check the command parameters.", sw1, sw2];
                    }
                }
                dispatch_semaphore_signal(aSem);
            }];
            dispatch_semaphore_wait(aSem, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC));
            [helper.session invalidateSession];
            dispatch_semaphore_signal(helper.semaphore);
        };

        dispatch_async(dispatch_get_main_queue(), ^{
            helper.session = [[NFCTagReaderSession alloc]
                initWithPollingOption:(NFCPollingISO14443)
                            delegate:helper queue:nil];
            helper.session.alertMessage = message;
            [helper.session beginSession];
        });
        long result = dispatch_semaphore_wait(helper.semaphore,
            dispatch_time(DISPATCH_TIME_NOW, (int64_t)(timeout * NSEC_PER_SEC)));
        if (result != 0 || apduError) {
            noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"apdu", NOFF_ERR_INTERNAL_ERROR,
                apduError ?: @"Timed out."), compact, quiet);
            return NOFF_EXIT_ERROR;
        }
        noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"apdu", apduResult), compact, quiet);
        return NOFF_EXIT_SUCCESS;
    }
    noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"apdu", NOFF_ERR_NOT_AVAILABLE, @"NFC requires iOS 13+."), compact, quiet);
    return NOFF_EXIT_NOT_AVAILABLE;
}

static int cmd_felica(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    if (@available(iOS 13.0, *)) {
        NSString *scHex = noff_find_arg(argc, argv, "--sc");
        if (!scHex || scHex.length < 4) {
            noff_emit_json(stdout_fd,
                noff_json_error(TOOL_NAME, @"felica", NOFF_ERR_INVALID_ARGS,
                    @"--sc <service-code-hex> is required (2 bytes, little-endian). Example: --sc 0B00 for Suica balance."),
                compact, quiet);
            return NOFF_EXIT_INVALID_ARGS;
        }
        NSString *bcStr = noff_find_arg(argc, argv, "--bc") ?: @"1";
        int blockCount = [bcStr intValue];
        if (blockCount <= 0) blockCount = 1;
        NSString *blHex = noff_find_arg(argc, argv, "--bl") ?: @"8000";

        NSString *message = noff_find_arg(argc, argv, "--message") ?: @"Hold near FeliCa card";
        NSString *timeoutStr = noff_find_arg(argc, argv, "--timeout");
        NSTimeInterval timeout = timeoutStr ? [timeoutStr doubleValue] : 30.0;

        __block NSMutableDictionary *felicaResult = [NSMutableDictionary new];
        __block NSString *felicaError = nil;

        RawTagHelper *helper = [[RawTagHelper alloc] init];
        helper.onConnected = ^{
            if (!helper.felicaTag) {
                felicaError = [NSString stringWithFormat:@"Tag type '%@' is not FeliCa. FeliCa is used by Japanese transit cards (Suica, PASMO, etc.).", helper.detectedType];
                [helper.session invalidateSession];
                dispatch_semaphore_signal(helper.semaphore);
                return;
            }

            NSData *serviceCode = dataFromHex(scHex);
            NSData *blockList = dataFromHex(blHex);

            dispatch_semaphore_t fSem = dispatch_semaphore_create(0);
            [helper.felicaTag readWithoutEncryptionWithServiceCodeList:@[serviceCode]
                blockList:@[blockList]
                completionHandler:^(NSInteger statusFlag1, NSInteger statusFlag2, NSArray<NSData *> *blockData, NSError *error) {
                if (error) {
                    felicaError = error.localizedDescription;
                } else {
                    felicaResult[@"status_flag1"] = @(statusFlag1);
                    felicaResult[@"status_flag2"] = @(statusFlag2);
                    felicaResult[@"idm"] = dataToHex(helper.felicaTag.currentIDm);
                    NSMutableArray *blocks = [NSMutableArray new];
                    for (NSData *bd in blockData) {
                        [blocks addObject:@{@"hex": dataToHex(bd), @"bytes": @(bd.length)}];
                    }
                    felicaResult[@"blocks"] = blocks;
                    felicaResult[@"hint"] = @"Read successful. Change --sc and --bl to read different service/block combinations.";
                }
                dispatch_semaphore_signal(fSem);
            }];
            dispatch_semaphore_wait(fSem, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC));
            [helper.session invalidateSession];
            dispatch_semaphore_signal(helper.semaphore);
        };

        dispatch_async(dispatch_get_main_queue(), ^{
            helper.session = [[NFCTagReaderSession alloc]
                initWithPollingOption:NFCPollingISO18092
                            delegate:helper queue:nil];
            helper.session.alertMessage = message;
            [helper.session beginSession];
        });
        long result = dispatch_semaphore_wait(helper.semaphore,
            dispatch_time(DISPATCH_TIME_NOW, (int64_t)(timeout * NSEC_PER_SEC)));
        if (result != 0 || felicaError) {
            noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"felica", NOFF_ERR_INTERNAL_ERROR,
                felicaError ?: @"Timed out."), compact, quiet);
            return NOFF_EXIT_ERROR;
        }
        noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"felica", felicaResult), compact, quiet);
        return NOFF_EXIT_SUCCESS;
    }
    noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"felica", NOFF_ERR_NOT_AVAILABLE, @"NFC requires iOS 13+."), compact, quiet);
    return NOFF_EXIT_NOT_AVAILABLE;
}

// MARK: - EMV Read (high-level read-only contactless flow)

// Synchronously send an APDU and wait for response; returns nil on error.
// sw1/sw2 are filled on success. Must be called from a background thread —
// blocks on an internal semaphore.
API_AVAILABLE(ios(13.0))
static NSData *emvSendAPDU(id<NFCISO7816Tag> tag, uint8_t cla, uint8_t ins,
                           uint8_t p1, uint8_t p2, NSData *data, NSInteger le,
                           uint8_t *sw1, uint8_t *sw2, NSError **outError) {
    NFCISO7816APDU *apdu = [[NFCISO7816APDU alloc]
        initWithInstructionClass:cla instructionCode:ins p1Parameter:p1 p2Parameter:p2
        data:data ?: [NSData data] expectedResponseLength:le];
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);
    __block NSData *respOut = nil;
    __block uint8_t sw1Out = 0, sw2Out = 0;
    __block NSError *errOut = nil;
    [tag sendCommandAPDU:apdu completionHandler:^(NSData *resp, uint8_t s1, uint8_t s2, NSError *err) {
        respOut = resp; sw1Out = s1; sw2Out = s2; errOut = err;
        dispatch_semaphore_signal(sem);
    }];
    dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC));
    if (sw1) *sw1 = sw1Out;
    if (sw2) *sw2 = sw2Out;
    if (outError) *outError = errOut;
    return respOut;
}

// Extract Track 2 PAN + expiry from tag 57. Track 2 format: PAN 'D' YYMM SVC DISC
static void emvParseTrack2(const uint8_t *buf, NSUInteger len, NSString **panOut, NSString **expiryOut) {
    // Decode as BCD-like nibble stream until separator 'D' (0x0D) or end
    NSMutableString *digits = [NSMutableString new];
    for (NSUInteger i = 0; i < len; i++) {
        uint8_t hi = (buf[i] >> 4) & 0x0F;
        uint8_t lo = buf[i] & 0x0F;
        [digits appendFormat:@"%X%X", hi, lo];
    }
    NSArray<NSString *> *parts = [digits componentsSeparatedByString:@"D"];
    if (parts.count >= 2 && panOut) {
        NSString *pan = parts[0];
        *panOut = pan;
        NSString *after = parts[1];
        if (after.length >= 4 && expiryOut) {
            NSString *yy = [after substringWithRange:NSMakeRange(0, 2)];
            NSString *mm = [after substringWithRange:NSMakeRange(2, 2)];
            *expiryOut = [NSString stringWithFormat:@"20%@-%@", yy, mm];
        }
    }
}

// Build GPO command data field from a PDOL spec (concatenated tag-length pairs).
// Fills in placeholder values that work for Visa/UnionPay/JCB; empty for unknown tags.
static NSData *emvBuildGPOData(const uint8_t *pdolBuf, NSUInteger pdolLen) {
    NSMutableData *concat = [NSMutableData new];
    // Parse DOL: sequence of <tag><length> with tag using multi-byte rules
    NSUInteger i = 0;
    while (i < pdolLen) {
        uint32_t tag = pdolBuf[i++];
        if ((tag & 0x1F) == 0x1F) {
            while (i < pdolLen) {
                tag = (tag << 8) | pdolBuf[i];
                if ((pdolBuf[i++] & 0x80) == 0) break;
            }
        }
        if (i >= pdolLen) break;
        uint8_t reqLen = pdolBuf[i++];

        uint8_t buf[256] = {0};
        NSUInteger fill = MIN((NSUInteger)reqLen, sizeof(buf));
        switch (tag) {
            case 0x9F66: // TTQ — signal full NFC support, require CVM+online
                if (reqLen >= 4) { buf[0]=0x36; buf[1]=0xA0; buf[2]=0x40; buf[3]=0x00; }
                break;
            case 0x9F02: // Amount authorised (BCD 6 bytes): 1.00
                if (reqLen >= 6) { buf[4]=0x01; buf[5]=0x00; }
                break;
            case 0x9F03: // Amount other: 0
                break;
            case 0x9F1A: // Terminal Country: CN 0156
                if (reqLen >= 2) { buf[0]=0x01; buf[1]=0x56; }
                break;
            case 0x95:   // TVR: all zero
                break;
            case 0x5F2A: // Transaction Currency: CNY 0156
                if (reqLen >= 2) { buf[0]=0x01; buf[1]=0x56; }
                break;
            case 0x9A: { // Transaction Date YYMMDD BCD = today
                NSDateComponents *dc = [[NSCalendar calendarWithIdentifier:NSCalendarIdentifierGregorian]
                    components:NSCalendarUnitYear|NSCalendarUnitMonth|NSCalendarUnitDay fromDate:[NSDate date]];
                int yy = (int)(dc.year % 100), mm = (int)dc.month, dd = (int)dc.day;
                if (reqLen >= 3) {
                    buf[0] = (uint8_t)(((yy/10)<<4) | (yy%10));
                    buf[1] = (uint8_t)(((mm/10)<<4) | (mm%10));
                    buf[2] = (uint8_t)(((dd/10)<<4) | (dd%10));
                }
                break;
            }
            case 0x9C:   // Transaction Type: 00 (purchase)
                break;
            case 0x9F37: { // Unpredictable Number: random
                uint32_t r = arc4random();
                if (reqLen >= 4) memcpy(buf, &r, MIN(fill, (NSUInteger)4));
                break;
            }
            case 0x9F35: // Terminal Type
                if (reqLen >= 1) buf[0] = 0x22;
                break;
            case 0x9F33: // Terminal Capabilities
                if (reqLen >= 3) { buf[0]=0xE0; buf[1]=0xA0; buf[2]=0x00; }
                break;
            case 0x9F40: // Additional Terminal Capabilities
                if (reqLen >= 5) { buf[0]=0x8E; buf[1]=0x00; buf[2]=0xB0; buf[3]=0x50; buf[4]=0x05; }
                break;
            default:
                // Unknown tag — send zeros
                break;
        }
        [concat appendBytes:buf length:fill];
    }

    // Wrap in Command Template 83 <len> <concat>
    NSMutableData *wrapped = [NSMutableData new];
    uint8_t prefix[2] = {0x83, (uint8_t)concat.length};
    [wrapped appendBytes:prefix length:2];
    [wrapped appendData:concat];
    return wrapped;
}

static int cmd_read_emv(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    if (@available(iOS 13.0, *)) {
        NSString *message = noff_find_arg(argc, argv, "--message") ?: @"Hold your iPhone near the bank card";
        NSString *timeoutStr = noff_find_arg(argc, argv, "--timeout");
        NSTimeInterval timeout = timeoutStr ? [timeoutStr doubleValue] : 30.0;
        BOOL verbose = noff_has_flag(argc, argv, "--verbose");

        __block NSMutableDictionary *emvResult = [NSMutableDictionary new];
        __block NSString *emvError = nil;
        __block NSMutableArray *trace = verbose ? [NSMutableArray new] : nil;

        RawTagHelper *helper = [[RawTagHelper alloc] init];
        helper.onConnected = ^{
            id<NFCISO7816Tag> tag = helper.iso7816Tag;
            if (!tag && helper.mifareTag) {
                tag = (id<NFCISO7816Tag>)helper.mifareTag;
                if (![tag conformsToProtocol:@protocol(NFCISO7816Tag)]) tag = nil;
            }
            if (!tag) {
                emvError = [NSString stringWithFormat:@"Not an ISO 7816 card. Detected type: %@. EMV read requires contactless bank cards.", helper.detectedType];
                [helper.session invalidateSession];
                dispatch_semaphore_signal(helper.semaphore);
                return;
            }

            uint8_t sw1 = 0, sw2 = 0;
            NSError *err = nil;

            // Step 1: SELECT PPSE
            NSData *ppseName = [@"2PAY.SYS.DDF01" dataUsingEncoding:NSASCIIStringEncoding];
            NSData *ppseResp = emvSendAPDU(tag, 0x00, 0xA4, 0x04, 0x00, ppseName, 256, &sw1, &sw2, &err);
            if (verbose) [trace addObject:@{@"step": @"SELECT PPSE", @"sw": [NSString stringWithFormat:@"%02X%02X", sw1, sw2], @"resp": dataToHex(ppseResp)}];
            if (err || sw1 != 0x90) {
                emvError = [NSString stringWithFormat:@"PPSE SELECT failed (SW=%02X%02X). Card may not support contactless EMV.", sw1, sw2];
                [helper.session invalidateSession];
                dispatch_semaphore_signal(helper.semaphore);
                return;
            }

            // Step 2: Extract AIDs from FCI (tag 4F inside each 61 template)
            NSMutableArray<NSData *> *aids = [NSMutableArray new];
            NSMutableArray<NSString *> *aidLabels = [NSMutableArray new];
            tlvWalk(ppseResp.bytes, ppseResp.length, ^(uint32_t t, const uint8_t *v, NSUInteger l) {
                if (t == 0x4F) [aids addObject:[NSData dataWithBytes:v length:l]];
                else if (t == 0x50) [aidLabels addObject:asciiTrim(v, l)];
            });
            if (aids.count == 0) {
                emvError = @"PPSE returned no AIDs. Card may not be a standard EMV card.";
                [helper.session invalidateSession];
                dispatch_semaphore_signal(helper.semaphore);
                return;
            }

            NSData *selectedAid = aids.firstObject;
            NSString *selectedAidHex = dataToHex(selectedAid);
            emvResult[@"aid"] = [selectedAidHex uppercaseString];
            NSString *brand = emvBrandFromAid(selectedAidHex);
            if (brand) emvResult[@"brand"] = brand;
            NSString *aidName = emvAidName(selectedAidHex);
            if (aidName) emvResult[@"aid_name"] = aidName;
            if (aidLabels.count > 0) emvResult[@"application_label"] = aidLabels.firstObject;
            NSMutableArray *allAids = [NSMutableArray new];
            for (NSData *a in aids) [allAids addObject:[dataToHex(a) uppercaseString]];
            emvResult[@"all_aids"] = allAids;

            // Step 3: SELECT first AID
            NSData *selResp = emvSendAPDU(tag, 0x00, 0xA4, 0x04, 0x00, selectedAid, 256, &sw1, &sw2, &err);
            if (verbose) [trace addObject:@{@"step": @"SELECT AID", @"aid": selectedAidHex.uppercaseString, @"sw": [NSString stringWithFormat:@"%02X%02X", sw1, sw2], @"resp": dataToHex(selResp)}];
            if (err || (sw1 != 0x90 && !(sw1 == 0x62 && (sw2 == 0x83 || sw2 == 0x85)))) {
                emvError = [NSString stringWithFormat:@"SELECT AID failed (SW=%02X%02X).", sw1, sw2];
                [helper.session invalidateSession];
                dispatch_semaphore_signal(helper.semaphore);
                return;
            }

            // Step 4: Extract PDOL (tag 9F38) from FCI if present
            const uint8_t *pdolVal = NULL; NSUInteger pdolLen = 0;
            tlvFind(selResp.bytes, selResp.length, 0x9F38, &pdolVal, &pdolLen);

            // Pick up Preferred Name (9F12) or Application Label (50) for display
            const uint8_t *prefName = NULL; NSUInteger prefLen = 0;
            if (tlvFind(selResp.bytes, selResp.length, 0x9F12, &prefName, &prefLen)) {
                emvResult[@"preferred_name"] = asciiTrim(prefName, prefLen);
            }
            const uint8_t *appLabel = NULL; NSUInteger appLabelLen = 0;
            if (tlvFind(selResp.bytes, selResp.length, 0x50, &appLabel, &appLabelLen)) {
                emvResult[@"application_label"] = asciiTrim(appLabel, appLabelLen);
            }

            // Step 5: GPO
            NSData *gpoData = emvBuildGPOData(pdolVal, pdolLen);
            NSData *gpoResp = emvSendAPDU(tag, 0x80, 0xA8, 0x00, 0x00, gpoData, 256, &sw1, &sw2, &err);
            if (verbose) [trace addObject:@{@"step": @"GPO", @"pdol": pdolLen ? dataToHex([NSData dataWithBytes:pdolVal length:pdolLen]) : @"", @"sw": [NSString stringWithFormat:@"%02X%02X", sw1, sw2], @"resp": dataToHex(gpoResp)}];
            if (sw1 != 0x90) {
                // Retry with empty PDOL
                uint8_t empty[] = {0x83, 0x00};
                gpoResp = emvSendAPDU(tag, 0x80, 0xA8, 0x00, 0x00, [NSData dataWithBytes:empty length:2], 256, &sw1, &sw2, &err);
                if (verbose) [trace addObject:@{@"step": @"GPO retry (empty PDOL)", @"sw": [NSString stringWithFormat:@"%02X%02X", sw1, sw2], @"resp": dataToHex(gpoResp)}];
            }

            NSData *aflData = nil;
            if (sw1 == 0x90) {
                // Step 6: Parse GPO response — format 1 (tag 80) or format 2 (tag 77)
                const uint8_t *respBytes = gpoResp.bytes;
                NSUInteger respLen = gpoResp.length;
                if (respLen >= 2 && respBytes[0] == 0x80) {
                    // Format 1: 80 <len> <AIP 2B> <AFL rest>
                    uint8_t flen = respBytes[1];
                    if (flen >= 2 && respLen >= (NSUInteger)2 + flen) {
                        // AIP = respBytes[2..4]
                        if (flen > 2) {
                            aflData = [NSData dataWithBytes:respBytes + 4 length:(NSUInteger)flen - 2];
                        }
                    }
                } else if (respLen >= 1 && respBytes[0] == 0x77) {
                    // Format 2: nested TLV — look for 94 (AFL), and scrape any inline 57/5A/5F20/5F24
                    const uint8_t *afl = NULL; NSUInteger afllen = 0;
                    if (tlvFind(respBytes, respLen, 0x94, &afl, &afllen)) {
                        aflData = [NSData dataWithBytes:afl length:afllen];
                    }
                    // Extract any inline track2/PAN/expiry/name from GPO response itself
                    tlvWalk(respBytes, respLen, ^(uint32_t t, const uint8_t *v, NSUInteger l) {
                        if (t == 0x57 && !emvResult[@"pan"]) {
                            NSString *pan = nil, *expiry = nil;
                            emvParseTrack2(v, l, &pan, &expiry);
                            if (pan) emvResult[@"pan"] = pan;
                            if (expiry) emvResult[@"expiry"] = expiry;
                            emvResult[@"track2"] = dataToHex([NSData dataWithBytes:v length:l]);
                        } else if (t == 0x5A && !emvResult[@"pan"]) {
                            emvResult[@"pan"] = bcdToString(v, l);
                        } else if (t == 0x5F24 && !emvResult[@"expiry"] && l >= 2) {
                            emvResult[@"expiry"] = [NSString stringWithFormat:@"20%@-%@", bcdToString(v, 1), bcdToString(v+1, 1)];
                        } else if (t == 0x5F20 && !emvResult[@"cardholder_name"]) {
                            emvResult[@"cardholder_name"] = asciiTrim(v, l);
                        } else if (t == 0x9F36 && !emvResult[@"atc"]) {
                            emvResult[@"atc"] = dataToHex([NSData dataWithBytes:v length:l]);
                        }
                    });
                }
            }

            // Step 7: READ RECORD loop per AFL
            if (aflData && aflData.length >= 4) {
                const uint8_t *afl = aflData.bytes;
                for (NSUInteger i = 0; i + 4 <= aflData.length; i += 4) {
                    uint8_t sfi = afl[i] >> 3;
                    uint8_t firstRec = afl[i+1];
                    uint8_t lastRec = afl[i+2];
                    uint8_t p2 = (uint8_t)((sfi << 3) | 0x04);
                    for (uint8_t rec = firstRec; rec <= lastRec; rec++) {
                        NSData *recResp = emvSendAPDU(tag, 0x00, 0xB2, rec, p2, nil, 256, &sw1, &sw2, &err);
                        if (verbose) [trace addObject:@{@"step": [NSString stringWithFormat:@"READ RECORD SFI=%u rec=%u", sfi, rec], @"sw": [NSString stringWithFormat:@"%02X%02X", sw1, sw2], @"resp": dataToHex(recResp)}];
                        if (sw1 != 0x90 || !recResp) continue;
                        tlvWalk(recResp.bytes, recResp.length, ^(uint32_t t, const uint8_t *v, NSUInteger l) {
                            if (t == 0x57 && !emvResult[@"pan"]) {
                                NSString *pan = nil, *expiry = nil;
                                emvParseTrack2(v, l, &pan, &expiry);
                                if (pan) emvResult[@"pan"] = pan;
                                if (expiry) emvResult[@"expiry"] = expiry;
                                emvResult[@"track2"] = dataToHex([NSData dataWithBytes:v length:l]);
                            } else if (t == 0x5A && !emvResult[@"pan"]) {
                                emvResult[@"pan"] = bcdToString(v, l);
                            } else if (t == 0x5F24 && !emvResult[@"expiry"] && l >= 2) {
                                emvResult[@"expiry"] = [NSString stringWithFormat:@"20%@-%@", bcdToString(v, 1), bcdToString(v+1, 1)];
                            } else if (t == 0x5F25 && !emvResult[@"effective_date"] && l >= 2) {
                                emvResult[@"effective_date"] = [NSString stringWithFormat:@"20%@-%@", bcdToString(v, 1), bcdToString(v+1, 1)];
                            } else if (t == 0x5F20 && !emvResult[@"cardholder_name"]) {
                                emvResult[@"cardholder_name"] = asciiTrim(v, l);
                            } else if (t == 0x5F28 && !emvResult[@"issuer_country"]) {
                                emvResult[@"issuer_country"] = bcdToString(v, l);
                            } else if (t == 0x9F42 && !emvResult[@"currency_code"]) {
                                emvResult[@"currency_code"] = bcdToString(v, l);
                            } else if (t == 0x5F34 && !emvResult[@"pan_sequence"]) {
                                emvResult[@"pan_sequence"] = bcdToString(v, l);
                            }
                        });
                    }
                }
            }

            // Step 8: GET DATA 9F36 (ATC) if not already collected
            if (!emvResult[@"atc"]) {
                NSData *atcResp = emvSendAPDU(tag, 0x80, 0xCA, 0x9F, 0x36, nil, 256, &sw1, &sw2, &err);
                if (verbose) [trace addObject:@{@"step": @"GET DATA 9F36 (ATC)", @"sw": [NSString stringWithFormat:@"%02X%02X", sw1, sw2], @"resp": dataToHex(atcResp)}];
                if (sw1 == 0x90 && atcResp.length > 0) {
                    const uint8_t *atcVal = NULL; NSUInteger atcLen = 0;
                    if (tlvFind(atcResp.bytes, atcResp.length, 0x9F36, &atcVal, &atcLen)) {
                        emvResult[@"atc"] = dataToHex([NSData dataWithBytes:atcVal length:atcLen]);
                    }
                }
            }

            // Mask PAN for display (keep first 6 + last 4)
            NSString *pan = emvResult[@"pan"];
            if ([pan isKindOfClass:[NSString class]] && pan.length >= 10) {
                NSUInteger n = pan.length;
                NSString *masked = [NSString stringWithFormat:@"%@%@%@",
                    [pan substringToIndex:6],
                    [@"" stringByPaddingToLength:n - 10 withString:@"*" startingAtIndex:0],
                    [pan substringFromIndex:n - 4]];
                emvResult[@"pan_masked"] = masked;
            }

            if (verbose) emvResult[@"trace"] = trace;
            emvResult[@"hint"] = emvResult[@"pan"]
                ? @"Read successful. PAN is the funding or device account number. Balances/transaction history are NOT on the chip — they require contacting the issuing bank."
                : @"Card detected but no PAN extracted. Try --verbose to see the APDU trace.";

            helper.session.alertMessage = emvResult[@"pan"] ? @"Card read" : @"Card detected";
            [helper.session invalidateSession];
            dispatch_semaphore_signal(helper.semaphore);
        };

        dispatch_async(dispatch_get_main_queue(), ^{
            helper.session = [[NFCTagReaderSession alloc]
                initWithPollingOption:NFCPollingISO14443
                            delegate:helper queue:nil];
            helper.session.alertMessage = message;
            [helper.session beginSession];
        });
        long result = dispatch_semaphore_wait(helper.semaphore,
            dispatch_time(DISPATCH_TIME_NOW, (int64_t)(timeout * NSEC_PER_SEC)));
        if (result != 0 || emvError) {
            noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"read-emv", NOFF_ERR_INTERNAL_ERROR,
                emvError ?: @"Timed out. Hold the card against the top of the iPhone."), compact, quiet);
            return NOFF_EXIT_ERROR;
        }
        noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"read-emv", emvResult), compact, quiet);
        return NOFF_EXIT_SUCCESS;
    }
    noff_emit_json(stdout_fd, noff_json_error(TOOL_NAME, @"read-emv", NOFF_ERR_NOT_AVAILABLE, @"NFC requires iOS 13+."), compact, quiet);
    return NOFF_EXIT_NOT_AVAILABLE;
}

// MARK: - Lookup Commands (no NFC session)

static int cmd_lookup_tag(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    NSArray<NSString *> *positional = noff_positional_args(argc, argv);
    NSString *tagHex = positional.count >= 2 ? positional[1] : nil;
    if (!tagHex) {
        noff_emit_json(stdout_fd,
            noff_json_error(TOOL_NAME, @"lookup-tag", NOFF_ERR_INVALID_ARGS,
                @"Tag hex required. Example: apple-nfc lookup-tag 9F36"),
            compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }
    unsigned int tagVal = 0;
    if (![[NSScanner scannerWithString:tagHex] scanHexInt:&tagVal]) {
        noff_emit_json(stdout_fd,
            noff_json_error(TOOL_NAME, @"lookup-tag", NOFF_ERR_INVALID_ARGS,
                [NSString stringWithFormat:@"Invalid hex tag '%@'.", tagHex]),
            compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }
    NSString *name = emvTagName((uint32_t)tagVal);
    NSDictionary *data = @{
        @"tag": [tagHex uppercaseString],
        @"name": name ?: [NSNull null],
        @"known": @(name != nil),
        @"hint": name
            ? @"This is an EMV tag. Use 'apple-nfc read-emv' for automatic parsing."
            : @"Unknown tag. It may be proprietary or not in the built-in EMV dictionary.",
    };
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"lookup-tag", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

static int cmd_lookup_aid(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    NSArray<NSString *> *positional = noff_positional_args(argc, argv);
    NSString *aidHex = positional.count >= 2 ? positional[1] : nil;
    if (!aidHex) {
        noff_emit_json(stdout_fd,
            noff_json_error(TOOL_NAME, @"lookup-aid", NOFF_ERR_INVALID_ARGS,
                @"AID hex required. Example: apple-nfc lookup-aid A0000000041010"),
            compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }
    NSString *name = emvAidName(aidHex);
    NSString *brand = emvBrandFromAid(aidHex);
    NSMutableDictionary *data = [@{
        @"aid": [aidHex uppercaseString],
        @"name": name ?: [NSNull null],
        @"known": @(name != nil),
    } mutableCopy];
    if (brand) data[@"brand"] = brand;
    data[@"hint"] = name
        ? @"Resolved via prefix match. Use 'apple-nfc apdu --apdu 00A40400<len><aid>00' to SELECT."
        : @"Unknown AID prefix. Check ISO 7816-5 RID registry or vendor docs.";
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"lookup-aid", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

// Case-insensitive substring match. Returns YES if needle is empty or found in haystack.
static BOOL searchMatch(NSString *haystack, NSString *needle) {
    if (!needle || needle.length == 0) return YES;
    return [haystack rangeOfString:needle options:NSCaseInsensitiveSearch].location != NSNotFound;
}

// Enumerate all known EMV TLV tags, AID prefixes, and AID aliases, optionally
// filtered by a substring query. Returns three arrays of objects in the JSON
// envelope so callers (or an LLM) can discover what's supported.
static int cmd_search(int argc, char **argv, int stdout_fd, BOOL compact, BOOL quiet) {
    NSArray<NSString *> *positional = noff_positional_args(argc, argv);
    NSString *query = positional.count >= 2 ? positional[1] : nil;
    NSString *filter = noff_find_arg(argc, argv, "--kind"); // "tag", "aid", "alias" or nil (all)

    NSMutableArray *tags = [NSMutableArray new];
    NSMutableArray *aids = [NSMutableArray new];
    NSMutableArray *aliases = [NSMutableArray new];

    BOOL wantTags    = !filter || [filter isEqualToString:@"tag"]    || [filter isEqualToString:@"tags"];
    BOOL wantAids    = !filter || [filter isEqualToString:@"aid"]    || [filter isEqualToString:@"aids"];
    BOOL wantAliases = !filter || [filter isEqualToString:@"alias"]  || [filter isEqualToString:@"aliases"];

    if (wantTags) {
        NSDictionary<NSNumber *, NSString *> *tagMap = emvTagMap();
        NSArray *sortedKeys = [tagMap.allKeys sortedArrayUsingSelector:@selector(compare:)];
        for (NSNumber *k in sortedKeys) {
            NSString *name = tagMap[k];
            NSString *hex = [NSString stringWithFormat:@"%X", k.unsignedIntValue];
            if (searchMatch(name, query) || searchMatch(hex, query)) {
                [tags addObject:@{@"tag": hex, @"name": name}];
            }
        }
    }

    if (wantAids) {
        for (NSArray *row in emvAidTable()) {
            NSString *aid = row[0], *name = row[1];
            if (searchMatch(aid, query) || searchMatch(name, query)) {
                [aids addObject:@{@"aid": aid, @"name": name}];
            }
        }
    }

    if (wantAliases) {
        NSDictionary<NSString *, NSString *> *aliasMap = emvAidAliases();
        NSArray *sortedAliasKeys = [aliasMap.allKeys sortedArrayUsingSelector:@selector(compare:)];
        for (NSString *alias in sortedAliasKeys) {
            NSString *aid = aliasMap[alias];
            NSString *name = emvAidName(aid);
            if (searchMatch(alias, query) || searchMatch(aid, query) || searchMatch(name ?: @"", query)) {
                NSMutableDictionary *row = [@{@"alias": alias, @"aid": aid} mutableCopy];
                if (name) row[@"name"] = name;
                [aliases addObject:row];
            }
        }
    }

    NSDictionary *data = @{
        @"query": query ?: [NSNull null],
        @"tags": tags,
        @"aids": aids,
        @"aliases": aliases,
        @"counts": @{
            @"tags": @(tags.count),
            @"aids": @(aids.count),
            @"aliases": @(aliases.count),
        },
        @"hint": @"Use 'apple-nfc apdu --select-aid <alias>' to SELECT by friendly name, 'apple-nfc lookup-tag <hex>' or 'lookup-aid <hex>' for single-value lookups. Filter with --kind tag|aid|alias.",
    };
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"search", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

// MARK: - Main Handler

static int nfc_handler(int argc, char **argv,
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
                @"No command specified. Start with 'apple-nfc status' to check availability, then 'scan' or 'tag-info'."),
            compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    if ([subcmd isEqualToString:@"status"])      return cmd_status(argc, argv, stdout_fd, compact, quiet);
    if ([subcmd isEqualToString:@"scan"])         return cmd_scan(argc, argv, stdout_fd, compact, quiet);
    if ([subcmd isEqualToString:@"write"])        return cmd_write(argc, argv, stdout_fd, compact, quiet);
    if ([subcmd isEqualToString:@"tag-info"])     return cmd_tag_info(argc, argv, stdout_fd, compact, quiet);
    if ([subcmd isEqualToString:@"tag-read"])     return cmd_tag_read(argc, argv, stdout_fd, compact, quiet);
    if ([subcmd isEqualToString:@"tag-write"])    return cmd_tag_write(argc, argv, stdout_fd, compact, quiet);
    if ([subcmd isEqualToString:@"apdu"])         return cmd_apdu(argc, argv, stdout_fd, compact, quiet);
    if ([subcmd isEqualToString:@"felica"])       return cmd_felica(argc, argv, stdout_fd, compact, quiet);
    if ([subcmd isEqualToString:@"read-emv"])     return cmd_read_emv(argc, argv, stdout_fd, compact, quiet);
    if ([subcmd isEqualToString:@"lookup-tag"])   return cmd_lookup_tag(argc, argv, stdout_fd, compact, quiet);
    if ([subcmd isEqualToString:@"lookup-aid"])   return cmd_lookup_aid(argc, argv, stdout_fd, compact, quiet);
    if ([subcmd isEqualToString:@"search"])       return cmd_search(argc, argv, stdout_fd, compact, quiet);

    noff_emit_help(stderr_fd, HELP_TEXT);
    noff_emit_json(stdout_fd,
        noff_json_error(TOOL_NAME, subcmd, NOFF_ERR_INVALID_ARGS,
            [NSString stringWithFormat:@"Unknown command '%@'. Valid: status, scan, write, tag-info, tag-read, tag-write, apdu, felica, read-emv, lookup-tag, lookup-aid, search.", subcmd]),
        compact, quiet);
    return NOFF_EXIT_INVALID_ARGS;
}

void nfc_offload_register(void) {
    int err = native_offload_add_handler("apple-nfc", nfc_handler);
    if (err == 0) {
        noff_ensure_guest_stub("/usr/local/bin/apple-nfc");
        NSLog(@"NativeOffloads: apple-nfc handler registered");
    } else {
        NSLog(@"NativeOffloads: failed to register apple-nfc handler (err=%d)", err);
    }
}
