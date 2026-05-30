const MIN_SECRET_LENGTH = 32;

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function assertStrongSecret(name: string, value: string | undefined): string {
  if (value && value.length >= MIN_SECRET_LENGTH) {
    return value;
  }

  if (isProduction()) {
    throw new Error(
      `${name} must be set in production (minimum ${MIN_SECRET_LENGTH} characters). ` +
        `Generate one with: openssl rand -base64 32`
    );
  }

  const devFallback = `dev-only-${name}-do-not-use-in-production`;
  console.warn(`[secrets] ${name} not configured — using dev-only fallback`);
  return devFallback;
}

/** Loaded once at startup; throws in production if JWT_SECRET is missing or weak. */
export const JWT_SECRET = assertStrongSecret("JWT_SECRET", process.env.JWT_SECRET);

/** Separate secret for Telegram link HMAC tokens; falls back to JWT_SECRET only after validation. */
export const TELEGRAM_LINK_SECRET = process.env.TELEGRAM_LINK_SECRET
  ? assertStrongSecret("TELEGRAM_LINK_SECRET", process.env.TELEGRAM_LINK_SECRET)
  : JWT_SECRET;

/**
 * Telegram webhook secret (X-Telegram-Bot-Api-Secret-Token).
 * Required in production; optional in dev (verification skipped when unset).
 */
export function getTelegramWebhookSecret(): string {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (secret && secret.length >= 16) {
    return secret;
  }
  if (isProduction()) {
    throw new Error(
      "TELEGRAM_WEBHOOK_SECRET must be set in production (16–256 chars, A-Za-z0-9_-). " +
        "Generate one with: openssl rand -hex 24"
    );
  }
  return "";
}

/** Validates required secrets at API startup. */
export function validateSecretsAtStartup(): void {
  void JWT_SECRET;
  void TELEGRAM_LINK_SECRET;
  void getTelegramWebhookSecret();
}
