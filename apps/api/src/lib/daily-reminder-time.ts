import { DateTime } from "luxon";
import { normalizeTimezone } from "./timezones";
export function parseDailyReminderHour(text: string): number | null {
  const t = text.trim().toLowerCase();
  const patterns = [
    /(?:daily|morning)\s+remind(?:er)?s?\s+(?:at|@)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i,
    /remind(?:er)?s?\s+(?:at|@)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i,
    /set\s+(?:daily\s+)?remind(?:er)?\s+(?:time\s+)?(?:to\s+)?(\d{1,2})\s*(am|pm)/i,
    /^(\d{1,2})\s*(am|pm)\s+(?:daily\s+)?remind/i,
  ];

  for (const re of patterns) {
    const m = t.match(re);
    if (m) return toHour24(Number(m[1]), m[3]);
  }
  return null;
}

function toHour24(hour12: number, ampm?: string): number | null {
  if (!Number.isFinite(hour12) || hour12 < 1 || hour12 > 12) return null;
  const ap = (ampm || "").toLowerCase();
  if (!ap) {
    if (hour12 >= 0 && hour12 <= 23) return hour12;
    return null;
  }
  if (ap.startsWith("p")) return hour12 === 12 ? 12 : hour12 + 12;
  return hour12 === 12 ? 0 : hour12;
}

export function formatDailyReminderHour(hour24: number, timezone: string): string {
  const zone = normalizeTimezone(timezone);
  const h = Math.min(23, Math.max(0, hour24));
  return DateTime.now().setZone(zone).set({ hour: h, minute: 0, second: 0, millisecond: 0 }).toFormat("h:mm a");
}
