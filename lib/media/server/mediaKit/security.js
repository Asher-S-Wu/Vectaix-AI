import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_MEDIA_URL_LENGTH = 8192;
const BLOCKED_UPLOAD_HEADERS = new Set([
  "authorization",
  "connection",
  "content-length",
  "cookie",
  "expect",
  "forwarded",
  "host",
  "keep-alive",
  "origin",
  "referer",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "x-http-method-override",
  "x-method-override",
]);
const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const MAX_UPLOAD_HEADER_COUNT = 32;
const MAX_UPLOAD_HEADERS_LENGTH = 16 * 1024;

export class MediaKitSecurityError extends Error {
  constructor(message = "视频地址未通过安全检查") {
    super(message);
    this.name = "MediaKitSecurityError";
    this.status = 400;
    this.code = "UNSAFE_MEDIA_URL";
  }
}

function normalizeHostname(hostname) {
  const unwrapped = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
  return unwrapped.toLowerCase().replace(/\.$/, "");
}

function parseIpv4(address) {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => Number(part));
  return octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? octets
    : null;
}

function isNonPublicIpv4(address) {
  const octets = parseIpv4(address);
  if (!octets) return true;
  const [a, b, c] = octets;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && c === 0)
    || (a === 192 && b === 0 && c === 2)
    || (a === 192 && b === 88 && c === 99)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224;
}

function parseIpv6(address) {
  let input = address.toLowerCase().split("%")[0];
  if (input.includes(".")) {
    const lastColon = input.lastIndexOf(":");
    const ipv4 = parseIpv4(input.slice(lastColon + 1));
    if (!ipv4) return null;
    input = `${input.slice(0, lastColon)}:${((ipv4[0] << 8) | ipv4[1]).toString(16)}:${((ipv4[2] << 8) | ipv4[3]).toString(16)}`;
  }
  const halves = input.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) {
    return null;
  }
  const groups = [
    ...left,
    ...Array.from({ length: missing }, () => "0"),
    ...right,
  ].map((part) => Number.parseInt(part, 16));
  return groups.length === 8
    && groups.every((part) => Number.isInteger(part) && part >= 0 && part <= 0xffff)
    ? groups
    : null;
}

function isNonPublicIpv6(address) {
  const groups = parseIpv6(address);
  if (!groups) return true;
  const [first, second, third] = groups;

  if ((first & 0xfff0) === 0 && second === 0 && third === 0) {
    const isMapped = groups.slice(0, 5).every((part) => part === 0) && groups[5] === 0xffff;
    if (isMapped) {
      const mapped = `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`;
      return isNonPublicIpv4(mapped);
    }
  }
  if (first < 0x2000 || first > 0x3fff) return true;
  if (first === 0x2001 && second === 0x0000) return true;
  if (first === 0x2001 && second === 0x0002 && third === 0) return true;
  if (first === 0x2001 && (second & 0xfff0) === 0x0010) return true;
  if (first === 0x2001 && (second & 0xfff0) === 0x0020) return true;
  if (first === 0x2001 && second === 0x0db8) return true;
  if (first === 0x2002) return true;
  if (first === 0x3fff && (second & 0xf000) === 0) return true;
  return false;
}

export function isBlockedMediaAddress(address) {
  const version = isIP(address);
  if (version === 4) return isNonPublicIpv4(address);
  if (version === 6) return isNonPublicIpv6(address);
  return true;
}

function parseHttpsUrl(value) {
  const source = typeof value === "string" ? value.trim() : "";
  if (!source || source.length > MAX_MEDIA_URL_LENGTH) {
    throw new MediaKitSecurityError();
  }
  let parsed;
  try {
    parsed = new URL(source);
  } catch {
    throw new MediaKitSecurityError();
  }
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || (parsed.port && parsed.port !== "443")
    || parsed.hash
  ) {
    throw new MediaKitSecurityError();
  }
  const hostname = normalizeHostname(parsed.hostname);
  if (
    !hostname
    || hostname === "localhost"
    || hostname.endsWith(".localhost")
    || isIP(hostname)
  ) {
    throw new MediaKitSecurityError();
  }
  return { parsed, hostname };
}

export async function assertPublicHttpsMediaUrl(value) {
  const { parsed, hostname } = parseHttpsUrl(value);
  let addresses;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new MediaKitSecurityError("视频地址的域名无法解析到安全的公网地址");
  }
  if (
    !addresses.length
    || addresses.some((entry) => isBlockedMediaAddress(String(entry?.address || "")))
  ) {
    throw new MediaKitSecurityError();
  }
  return Object.freeze({
    url: parsed.toString(),
    hostname,
    addresses: Object.freeze(addresses.map((entry) => entry.address)),
  });
}

export async function assertMediaKitUploadUrl(value) {
  const safe = await assertPublicHttpsMediaUrl(value);
  if (!safe.hostname.endsWith(".volcvod.com")) {
    throw new MediaKitSecurityError("MediaKit 返回了不安全的上传地址");
  }
  return safe;
}

function isBlockedUploadHeader(name) {
  const normalized = name.toLowerCase();
  return BLOCKED_UPLOAD_HEADERS.has(normalized)
    || normalized.startsWith("proxy-")
    || normalized.startsWith("sec-")
    || normalized.startsWith("x-forwarded-");
}

export function filterMediaKitUploadHeaders(value) {
  if (!Array.isArray(value) || value.length > MAX_UPLOAD_HEADER_COUNT) {
    throw new MediaKitSecurityError("MediaKit 返回了无效的上传请求头");
  }
  const headers = [];
  let totalLength = 0;
  for (const item of value) {
    const key = typeof item?.key === "string" ? item.key.trim() : "";
    const headerValue = typeof item?.value === "string" ? item.value.trim() : "";
    const valueLength = Buffer.byteLength(headerValue, "utf8");
    totalLength += Buffer.byteLength(key, "utf8") + valueLength;
    if (totalLength > MAX_UPLOAD_HEADERS_LENGTH) {
      throw new MediaKitSecurityError("MediaKit 返回的上传请求头过大");
    }
    if (
      !key
      || !HEADER_NAME_PATTERN.test(key)
      || isBlockedUploadHeader(key)
      || /[\r\n]/.test(headerValue)
      || valueLength > 8192
    ) {
      continue;
    }
    headers.push(Object.freeze({ key, value: headerValue }));
  }
  return Object.freeze(headers);
}
