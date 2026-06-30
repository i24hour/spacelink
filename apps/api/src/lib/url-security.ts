import { isHttpUrl } from "@deadlineai/shared";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
  "metadata.google.internal",
  "metadata",
  "169.254.169.254",
]);

function isPrivateIp(ip: string): boolean {
  // IPv4 private ranges
  const ipv4Match = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4Match) {
    const [, a, b, c, d] = ipv4Match.map(Number);
    if (a === 127) return true;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 0) return true;
    if (a === 255) return true;
    if (d === 255) return true;
    return false;
  }

  // IPv6 loopback / link-local / unique-local
  const lower = ip.toLowerCase();
  if (lower.startsWith("fe80")) return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower === "::1") return true;
  return false;
}

function hostnameLooksPrivate(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(lower)) return true;
  if (lower.endsWith(".localhost") || lower.endsWith(".local")) return true;
  if (lower.includes("metadata.google.internal")) return true;

  // Bare IPv4 addresses
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(lower)) {
    return isPrivateIp(lower);
  }

  return false;
}

export class UnsafeUrlError extends Error {
  constructor(message = "URL is not allowed") {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

/** Validates that a URL is safe for the server to fetch (SSRF protection). */
export function assertUrlAllowed(url: string): void {
  if (!isHttpUrl(url)) {
    throw new UnsafeUrlError("URL must be http or https");
  }

  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new UnsafeUrlError("Invalid URL");
  }

  const hostname = parsed.hostname.replace(/^[\[\]]+|[\[\]]+$/g, "").toLowerCase();

  if (hostnameLooksPrivate(hostname)) {
    throw new UnsafeUrlError("Private or internal URLs are not allowed");
  }

  if (parsed.port) {
    const port = Number(parsed.port);
    if (Number.isNaN(port) || port <= 0 || port > 65535) {
      throw new UnsafeUrlError("Invalid port");
    }
  }
}

export function isUrlAllowed(url: string): boolean {
  try {
    assertUrlAllowed(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetches a URL while re-validating every redirect hop.
 * `fetch(..., { redirect: "follow" })` happily lands on internal IPs if a
 * public URL 302s to http://169.254.169.254 — we walk redirects manually and
 * reject any unsafe Location before following it.
 */
export async function safeFetch(
  url: string,
  init: RequestInit = {},
  maxRedirects = 5
): Promise<Response> {
  assertUrlAllowed(url);
  let currentUrl = url;
  for (let i = 0; i <= maxRedirects; i++) {
    const res = await fetch(currentUrl, { ...init, redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return res;
      const nextUrl = new URL(location, currentUrl).toString();
      assertUrlAllowed(nextUrl);
      currentUrl = nextUrl;
      continue;
    }
    return res;
  }
  throw new UnsafeUrlError("Too many redirects");
}
