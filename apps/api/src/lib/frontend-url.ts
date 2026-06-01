export const PRODUCTION_FRONTEND_URL = "https://spacelink-mocha.vercel.app";

/** Hostnames from the deleted Vercel `web` project — never use for auth/Telegram links. */
const DEPRECATED_FRONTEND_HOSTS = new Set([
  "web-i24hours-projects.vercel.app",
  "web.vercel.app",
]);

function isDeprecatedFrontendUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (DEPRECATED_FRONTEND_HOSTS.has(host)) return true;
    return host.startsWith("web-") && host.endsWith(".vercel.app") && !host.includes("spacelink");
  } catch {
    return true;
  }
}

/** Canonical frontend URL (no trailing slash). Used for CORS, emails, Telegram links. */
export function getFrontendUrl(): string {
  const configured =
    process.env.FRONTEND_URL || process.env.WEB_APP_URL || PRODUCTION_FRONTEND_URL;
  const cleaned = configured.replace(/\/$/, "");
  if (isDeprecatedFrontendUrl(cleaned)) {
    return PRODUCTION_FRONTEND_URL;
  }
  return cleaned;
}

/** Origins allowed for browser CORS (production aliases + local dev). */
export function getAllowedFrontendOrigins(): string[] {
  const origins = new Set<string>([
    getFrontendUrl(),
    PRODUCTION_FRONTEND_URL,
    "https://spacelink-i24hours-projects.vercel.app",
    "http://localhost:3000",
  ]);
  return [...origins];
}
