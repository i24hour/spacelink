import { createTelegramChatLinkToken } from "./auth";
import { getFrontendUrl } from "./frontend-url";

/** Sign-in URL for this Telegram chat (Google OAuth + reconnect). */
export function buildTelegramSignInUrl(chatId: string): string {
  const token = createTelegramChatLinkToken(chatId);
  return `${getFrontendUrl()}/auth?tgLink=${encodeURIComponent(token)}`;
}
