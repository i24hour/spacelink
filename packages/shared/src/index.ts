export interface LinkPayload {
  url: string;
  title: string;
  rawContent: string;
  metadata?: Record<string, unknown>;
}

export interface ExtractedDeadline {
  title: string;
  deadline: string; // ISO
  timezone: string;
  category: string;
  urgencyScore: number; // 1-10
  confidenceScore: number; // 0-1
  rollingApplication: boolean;
  estimatedCompletionMinutes: number;
}

export interface SaveLinkRequest {
  url: string;
  title: string;
  rawContent: string;
  metadata?: Record<string, unknown>;
  manualDeadline?: string;
}

export interface ReminderChannel {
  type: "email" | "whatsapp" | "telegram";
  enabled: boolean;
}

/** Returns true only for http: or https: URLs with a non-empty hostname. */
export function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    return parsed.hostname.length > 0 && (parsed.protocol === "http:" || parsed.protocol === "https:");
  } catch {
    return false;
  }
}

/** Returns the URL only if it is a safe http(s) link; otherwise returns null. */
export function toSafeUrl(url: string): string | null {
  const trimmed = url.trim();
  return isHttpUrl(trimmed) ? trimmed : null;
}
