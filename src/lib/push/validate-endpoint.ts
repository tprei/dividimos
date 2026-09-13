import { createPublicKey } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import https from "node:https";

const MAX_ENDPOINT_LENGTH = 2_048;
const MAX_KEY_LENGTH = 512;
const DNS_TIMEOUT_MS = 2_000;
const P256_SPKI_PREFIX = Buffer.from(
  "3059301306072a8648ce3d020106082a8648ce3d030107034200",
  "hex",
);

export interface ValidatedWebSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export type SubscriptionValidationResult =
  | { ok: true; value: ValidatedWebSubscription }
  | { ok: false; reason: "invalid" | "resolution_failed" };

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

class ProhibitedAddressError extends Error {}
class DnsResolutionError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeBase64Url(value: unknown, expectedLength: number): Buffer | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_KEY_LENGTH) {
    return null;
  }
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const decoded = Buffer.from(`${value}${padding}`.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  if (decoded.length !== expectedLength) return null;
  const canonical = decoded.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
  return canonical === value ? decoded : null;
}

function isValidP256Point(point: Buffer): boolean {
  if (point.length !== 65 || point[0] !== 0x04) return false;
  try {
    createPublicKey({
      key: Buffer.concat([P256_SPKI_PREFIX, point]),
      format: "der",
      type: "spki",
    });
    return true;
  } catch {
    return false;
  }
}

function ipv4ToNumber(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

function inIpv4Range(value: number, start: number, end: number): boolean {
  return value >= start && value <= end;
}

function isPublicIpv4(address: string): boolean {
  const value = ipv4ToNumber(address);
  if (value === null) return false;
  return !(
    inIpv4Range(value, 0x00000000, 0x00ffffff) ||
    inIpv4Range(value, 0x0a000000, 0x0affffff) ||
    inIpv4Range(value, 0x64400000, 0x647fffff) ||
    inIpv4Range(value, 0x7f000000, 0x7fffffff) ||
    inIpv4Range(value, 0xa9fe0000, 0xa9feffff) ||
    inIpv4Range(value, 0xac100000, 0xac1fffff) ||
    inIpv4Range(value, 0xc0a80000, 0xc0a8ffff) ||
    inIpv4Range(value, 0xc0000000, 0xc00000ff) ||
    inIpv4Range(value, 0xc0000200, 0xc00002ff) ||
    inIpv4Range(value, 0xc0000220, 0xc000022f) ||
    inIpv4Range(value, 0xc0000230, 0xc000023f) ||
    inIpv4Range(value, 0xc6120000, 0xc613ffff) ||
    inIpv4Range(value, 0xc6336400, 0xc63364ff) ||
    inIpv4Range(value, 0xcb007100, 0xcb0071ff) ||
    inIpv4Range(value, 0xc0586300, 0xc05863ff) ||
    inIpv4Range(value, 0xe0000000, 0xffffffff)
  );
}

function parseIpv6(address: string): number[] | null {
  if (address.includes("%")) return null;
  const halves = address.toLowerCase().split("::");
  if (halves.length > 2) return null;

  const parsePart = (part: string): number[] | null => {
    if (!part) return [];
    const result: number[] = [];
    for (const piece of part.split(":")) {
      if (piece.includes(".")) {
        const ipv4 = ipv4ToNumber(piece);
        if (ipv4 === null) return null;
        result.push((ipv4 >>> 16) & 0xffff, ipv4 & 0xffff);
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(piece)) return null;
        result.push(Number.parseInt(piece, 16));
      }
    }
    return result;
  };

  const left = parsePart(halves[0]);
  const right = parsePart(halves[1] ?? "");
  if (!left || !right) return null;
  const groups =
    halves.length === 2
      ? [...left, ...Array(8 - left.length - right.length).fill(0), ...right]
      : [...left];
  return groups.length === 8 ? groups : null;
}

function isPublicIpv6(address: string): boolean {
  const groups = parseIpv6(address);
  if (!groups) return false;

  const isZero = groups.every((group) => group === 0);
  const isLoopback = isZero || (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1);
  const isMapped =
    groups.slice(0, 5).every((group) => group === 0) &&
    groups[5] === 0xffff;
  const first = groups[0];

  if (
    isLoopback ||
    isMapped ||
    (first >>> 8) === 0xff ||
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first === 0x2001 && groups[1] === 0x0db8) ||
    (first === 0x2001 && (groups[1] & 0xfff0) === 0x0010) ||
    (first === 0x2001 && (groups[1] & 0xfff0) === 0x0020) ||
    (first === 0x2001 && groups[1] === 0x0001 && groups[2] === 0) ||
    (first === 0x2001 && groups[1] === 0x0002 && groups[2] === 0) ||
    (first === 0x2001 && groups[1] === 0x0003) ||
    (first === 0x2001 && groups[1] === 0x0004 && groups[2] === 0x0112) ||
    (first === 0x2001 && groups[1] === 0) ||
    first === 0x2002 ||
    first === 0x3fff
  ) {
    return false;
  }
  return first >= 0x2000 && first <= 0x3fff;
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  const timeout = Promise.withResolvers<never>();
  const timer = setTimeout(() => timeout.reject(new DnsResolutionError("DNS resolution timed out")), timeoutMs);
  return Promise.race([promise, timeout.promise]).finally(() => clearTimeout(timer));
}

export async function resolvePublicHost(hostname: string): Promise<readonly ResolvedAddress[]> {
  let records: readonly { address: string; family: number }[];
  try {
    records = await withTimeout(dnsLookup(hostname, { all: true, verbatim: true }), DNS_TIMEOUT_MS);
  } catch (error) {
    if (error instanceof ProhibitedAddressError) throw error;
    throw new DnsResolutionError("DNS resolution failed");
  }

  const addresses: ResolvedAddress[] = records.map((record) => ({
    address: record.address,
    family: (record.family === 6 ? 6 : 4) as 4 | 6,
  }));
  if (addresses.length === 0) throw new DnsResolutionError("DNS returned no addresses");
  if (addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new ProhibitedAddressError("DNS returned a prohibited address");
  }
  return addresses;
}
function isAllowedHost(hostname: string): boolean {
  const labels = hostname.split(".");
  if (labels.some((label) => label.length === 0)) return false;
  return (
    hostname === "fcm.googleapis.com" ||
    hostname === "updates.push.services.mozilla.com" ||
    (hostname.endsWith(".push.apple.com") && hostname !== "push.apple.com")
  );
}

function isSubscription(
  value: unknown,
): value is { endpoint?: unknown; keys: Record<string, unknown> } {
  return isRecord(value) && isRecord(value.keys);
}

export async function validateWebSubscription(input: unknown): Promise<SubscriptionValidationResult> {
  if (!isSubscription(input)) return { ok: false, reason: "invalid" };
  const endpoint = input.endpoint;
  if (typeof endpoint !== "string" || endpoint.length === 0 || endpoint.length > MAX_ENDPOINT_LENGTH) {
    return { ok: false, reason: "invalid" };
  }

  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    (parsed.port !== "" && parsed.port !== "443") ||
    isIP(hostname) !== 0 ||
    !isAllowedHost(hostname)
  ) {
    return { ok: false, reason: "invalid" };
  }

  const p256dh = input.keys.p256dh;
  const auth = input.keys.auth;
  const p256dhBytes = decodeBase64Url(p256dh, 65);
  const authBytes = decodeBase64Url(auth, 16);
  if (!p256dhBytes || !authBytes || !isValidP256Point(p256dhBytes)) {
    return { ok: false, reason: "invalid" };
  }

  try {
    await resolvePublicHost(hostname);
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof ProhibitedAddressError ? "invalid" : "resolution_failed",
    };
  }

  return {
    ok: true,
    value: {
      endpoint,
      keys: {
        p256dh: p256dh as string,
        auth: auth as string,
      },
    },
  };
}

export function createRebindingSafeAgent(hostname: string): https.Agent {
  const agent = new https.Agent({
    keepAlive: false,
    lookup: (lookupHostname, options, callback) => {
      if (lookupHostname !== hostname) {
        callback(new Error("Hostname mismatch"), "", 0);
        return;
      }
      void resolvePublicHost(lookupHostname)
        .then((addresses) => {
          const filtered = options.family
            ? addresses.filter(({ family }) => family === options.family)
            : addresses;
          if (filtered.length === 0) throw new Error("No address for requested family");
          if (options.all) {
            callback(null, filtered.map(({ address, family }) => ({ address, family })));
          } else {
            const selected = filtered[0];
            callback(null, selected.address, selected.family);
          }
        })
        .catch((error: unknown) =>
          callback(error instanceof Error ? error : new Error("DNS lookup failed"), "", 0),
        );
    },
  });
  return agent;
}

