import { lookup, resolve4, resolve6 } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

const MAX_URL_LENGTH = 2048;
const DNS_TIMEOUT_MS = 3_000;

const blockList = new BlockList();

blockList.addSubnet("0.0.0.0", 8, "ipv4");
blockList.addSubnet("10.0.0.0", 8, "ipv4");
blockList.addSubnet("100.64.0.0", 10, "ipv4");
blockList.addSubnet("127.0.0.0", 8, "ipv4");
blockList.addSubnet("169.254.0.0", 16, "ipv4");
blockList.addSubnet("172.16.0.0", 12, "ipv4");
blockList.addSubnet("192.0.0.0", 24, "ipv4");
blockList.addSubnet("192.0.2.0", 24, "ipv4");
blockList.addSubnet("192.168.0.0", 16, "ipv4");
blockList.addSubnet("198.18.0.0", 15, "ipv4");
blockList.addSubnet("198.51.100.0", 24, "ipv4");
blockList.addSubnet("203.0.113.0", 24, "ipv4");
blockList.addSubnet("224.0.0.0", 4, "ipv4");
blockList.addSubnet("240.0.0.0", 4, "ipv4");
blockList.addAddress("255.255.255.255", "ipv4");

blockList.addAddress("::", "ipv6");
blockList.addAddress("::1", "ipv6");
blockList.addSubnet("64:ff9b::", 96, "ipv6");
blockList.addSubnet("64:ff9b:1::", 48, "ipv6");
blockList.addSubnet("2001::", 32, "ipv6");
blockList.addSubnet("2001:db8::", 32, "ipv6");
blockList.addSubnet("2002::", 16, "ipv6");
blockList.addSubnet("fc00::", 7, "ipv6");
blockList.addSubnet("fe80::", 10, "ipv6");
blockList.addSubnet("fec0::", 10, "ipv6");
blockList.addSubnet("ff00::", 8, "ipv6");

const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata",
  "metadata.google.internal",
  "metadata.google.com",
  "instance-data",
  "kubernetes",
  "kubernetes.default",
  "kubernetes.default.svc",
]);

const BLOCKED_SUFFIXES = [".localhost", ".local", ".localdomain", ".internal", ".home.arpa"];

export class UrlPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UrlPolicyError";
  }
}

export type HostResolver = (hostname: string) => Promise<string[]>;

/**
 * Admission check for a scan URL. This does not fetch the page.
 * Redirect targets are checked again when the browser follows them.
 */
export async function assertSafeScanUrl(
  input: string,
  resolveHosts: HostResolver = resolveHostAddresses,
): Promise<string> {
  if (input.length === 0 || input.length > MAX_URL_LENGTH) {
    throw new UrlPolicyError("Enter an absolute http or https URL.");
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new UrlPolicyError("Enter an absolute http or https URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UrlPolicyError("Only http and https URLs can be scanned.");
  }

  if (url.username !== "" || url.password !== "") {
    throw new UrlPolicyError("URLs that contain credentials cannot be scanned.");
  }

  const hostname = normalizeHostname(url.hostname);
  if (hostname.length === 0 || isBlockedHostname(hostname)) {
    throw new UrlPolicyError("That URL is not eligible for scanning.");
  }

  if (isObfuscatedIp(hostname)) {
    throw new UrlPolicyError("That URL is not eligible for scanning.");
  }

  if (isIP(hostname) !== 0) {
    if (isBlockedAddress(hostname)) {
      throw new UrlPolicyError("That URL is not eligible for scanning.");
    }
  } else {
    let addresses: string[];
    try {
      addresses = await withTimeout(resolveHosts(hostname), DNS_TIMEOUT_MS);
    } catch (error) {
      if (error instanceof UrlPolicyError) {
        throw error;
      }
      throw new UrlPolicyError("The host could not be resolved.");
    }

    if (addresses.length === 0 || addresses.some((address) => isBlockedAddress(address))) {
      throw new UrlPolicyError("That URL is not eligible for scanning.");
    }
  }

  url.hash = "";
  url.hostname = hostname;
  if ((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443")) {
    url.port = "";
  }

  return url.toString();
}

export async function resolveHostAddresses(hostname: string): Promise<string[]> {
  const [lookedUp, ipv4, ipv6] = await Promise.all([
    lookup(hostname, { all: true, verbatim: true }).catch(ignoreMissingName),
    resolve4(hostname).catch(ignoreMissingName),
    resolve6(hostname).catch(ignoreMissingName),
  ]);

  const addresses = new Set<string>();
  for (const record of lookedUp ?? []) {
    addresses.add(record.address);
  }
  for (const address of ipv4 ?? []) {
    addresses.add(address);
  }
  for (const address of ipv6 ?? []) {
    addresses.add(address);
  }

  return [...addresses];
}

function normalizeHostname(hostname: string): string {
  const lower = hostname.toLowerCase().replace(/\.$/, "");
  return lower.startsWith("[") && lower.endsWith("]") ? lower.slice(1, -1) : lower;
}

function isBlockedHostname(hostname: string): boolean {
  if (BLOCKED_HOSTS.has(hostname)) {
    return true;
  }

  return BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

function isObfuscatedIp(hostname: string): boolean {
  if (isIP(hostname) !== 0) {
    return false;
  }

  if (/^\d+$/.test(hostname) || /^0x[0-9a-f]+$/i.test(hostname)) {
    return true;
  }

  const parts = hostname.split(".");
  return parts.length > 1 && parts.every((part) => /^(0x[0-9a-f]+|\d+)$/i.test(part));
}

export function isBlockedAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped?.[1]) {
    return blockList.check(mapped[1], "ipv4");
  }

  const family = isIP(address);
  if (family === 4) {
    return blockList.check(address, "ipv4");
  }
  if (family === 6) {
    return blockList.check(address, "ipv6");
  }

  return true;
}

function ignoreMissingName(error: unknown): null {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  if (code === "ENOTFOUND" || code === "ENODATA" || code === "EAI_AGAIN" || code === "ESERVFAIL") {
    return null;
  }
  throw error;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new UrlPolicyError("The host could not be resolved."));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
