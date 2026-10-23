import { isIP } from "node:net";

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

export function isBlockedAddress(address) {
  const version = isIP(address);
  if (version === 4) return isNonPublicIpv4(address);
  if (version === 6) return isNonPublicIpv6(address);
  return true;
}

