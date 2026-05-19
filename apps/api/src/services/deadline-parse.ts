import { DateTime } from "luxon";
import { extractWithLLM } from "../lib/llm";
import { normalizeTimezone } from "../lib/timezones";

function resolveTimezone(timezoneHint?: string): string {
  return normalizeTimezone(timezoneHint || "UTC");
}

/** True when user gave a calendar date without a specific time. */
export function isDateOnlyInput(input: string): boolean {
  const t = input.trim();
  if (/\d{1,2}:\d{2}/.test(t)) return false;
  if (/\b\d{1,2}\s*(am|pm)\b/i.test(t)) return false;
  if (/\b(noon|midnight)\b/i.test(t)) return false;
  return true;
}

function endOfDayInZone(year: number, month: number, day: number, zone: string): Date {
  return DateTime.fromObject({ year, month, day }, { zone }).endOf("day").toJSDate();
}

function tryParseDateOnlyLocal(input: string, zone: string): Date | null {
  const text = input.trim().replace(/\s+/g, " ");
  const formats = [
    "d LLL yyyy",
    "d LLLL yyyy",
    "LLL d yyyy",
    "LLLL d yyyy",
    "yyyy-MM-dd",
    "d/M/yyyy",
    "d-M-yyyy",
  ];

  for (const fmt of formats) {
    const dt = DateTime.fromFormat(text, fmt, { zone, locale: "en" });
    if (dt.isValid) return dt.endOf("day").toJSDate();
  }

  const loose = DateTime.fromJSDate(new Date(text), { zone });
  if (loose.isValid && !Number.isNaN(Date.parse(text))) {
    return loose.endOf("day").toJSDate();
  }

  return null;
}

export function formatCountdownHuman(deadline: Date): string {
  const diffMs = deadline.getTime() - Date.now();
  if (diffMs <= 0) return "passed";

  const totalMinutes = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m left`;
  if (hours > 0) return `${hours}h ${minutes}m left`;
  return `${minutes}m left`;
}

export function formatDeadlineDisplay(deadline: Date, timezone: string): string {
  try {
    return DateTime.fromJSDate(deadline, { zone: timezone }).toFormat(
      "LLL d, yyyy, h:mm a ZZZZ"
    );
  } catch {
    return deadline.toISOString();
  }
}

/** Parse natural-language or ISO date strings into a Date. */
export async function parseDateFromUserText(
  input: string,
  timezoneHint?: string
): Promise<Date | null> {
  const zone = resolveTimezone(timezoneHint);
  const dateOnly = isDateOnlyInput(input);

  if (dateOnly) {
    const local = tryParseDateOnlyLocal(input, zone);
    if (local) return local;
  }

  const withTime = DateTime.fromISO(input, { setZone: true });
  if (!dateOnly && withTime.isValid) {
    return withTime.setZone(zone).toJSDate();
  }

  const extracted = await extractWithLLM(`
Extract a deadline date-time from this text.
User timezone: ${zone}
Text: ${input}

Rules:
- If the user gives ONLY a calendar date (no time), the deadline is END of that day (23:59:59.999) in ${zone}, NOT midnight UTC.
- If they give a time, use that time in ${zone}.
- Return ISO-8601 with numeric offset for ${zone}.

Return JSON only:
{
  "deadline": "2026-05-19T23:59:59.999+05:30",
  "year": 2026,
  "month": 5,
  "day": 19,
  "date_only": true
}

If no clear date exists:
{ "deadline": null }
`.trim());

  if (!extracted || extracted.deadline == null) return null;

  const llmDateOnly =
    extracted.date_only === true || extracted.date_only === "true" || dateOnly;

  if (llmDateOnly) {
    const y = Number(extracted.year);
    const m = Number(extracted.month);
    const d = Number(extracted.day);
    if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
      return endOfDayInZone(y, m, d, zone);
    }

    const fromIso = DateTime.fromISO(String(extracted.deadline), { setZone: true });
    if (fromIso.isValid) {
      return endOfDayInZone(fromIso.year, fromIso.month, fromIso.day, zone);
    }
  }

  const parsed = DateTime.fromISO(String(extracted.deadline), { setZone: true });
  if (!parsed.isValid) return null;
  return parsed.setZone(zone).toJSDate();
}
