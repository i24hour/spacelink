const DEFAULT_FRONTEND_URL = "https://spacelink-mocha.vercel.app";

/** Canonical frontend URL (no trailing slash). Used for CORS, emails, Telegram links. */
export function getFrontendUrl(): string {
  const url = process.env.FRONTEND_URL || process.env.WEB_APP_URL || DEFAULT_FRONTEND_URL;
  return url.replace(/\/$/, "");
}

/** Origins allowed for browser CORS (production aliases + local dev). */
export function getAllowedFrontendOrigins(): string[] {
  const origins = new Set<string>([
    getFrontendUrl(),
    "https://spacelink-mocha.vercel.app",
    "https://spacelink-i24hours-projects.vercel.app",
    "http://localhost:3000",
  ]);
  return [...origins];
}
