/** Canonical frontend URL (no trailing slash). Set FRONTEND_URL on Render. */
export function getFrontendUrl(): string {
  const url = process.env.FRONTEND_URL;
  if (!url?.trim()) {
    if (process.env.NODE_ENV !== "production") {
      return "http://localhost:3000";
    }
    throw new Error("FRONTEND_URL is not configured");
  }
  return url.trim().replace(/\/$/, "");
}

/** Origins allowed for browser CORS (configured frontend + local dev). */
export function getAllowedFrontendOrigins(): string[] {
  const origins = new Set<string>([getFrontendUrl()]);
  origins.add("http://localhost:3000");
  return [...origins];
}
