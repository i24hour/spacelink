import { DateTime } from "luxon";
import { extractWithLLM } from "../lib/llm";
import { normalizeTimezone } from "../lib/timezones";

const TZ_TOKEN =
  /\b(IST|PST|PDT|PT|EST|EDT|ET|CST|CT|MST|MT|GMT|UTC|BST|CET|GST|SGT|JST|AEST|Asia\/[\w_]+|America\/[\w_]+|Europe\/[\w_]+|Australia\/[\w_]+)\b/i;

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

/** Pull an explicit timezone token out of free-form user text. */
function extractZoneFromText(input: string, fallbackZone: string): {
  text: string;
  zone: string;
} {
  const match = input.match(TZ_TOKEN);
  if (!match) return { text: input.trim(), zone: fallbackZone };
  const zone = normalizeTimezone(match[1]);
  const text = input.replace(match[0], " ").replace(/\s+/g, " ").trim();
  return { text, zone };
}

/**
 * Normalize common Telegram date phrasings so Luxon can parse them locally
 * without depending on the LLM.
 *
 * Examples handled:
 * - "Set 25th july 2026"
 * - "2026-07-25 11:59 PM IST"
 * - "deadline: 25 July 2026 5pm"
 */
export function normalizeUserDateText(input: string): string {
  return input
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(
      /^(please\s+)?(set|update|change|use|make|put|schedule)?\s*(the\s+)?(deadline|date|due(\s*date)?)\s*(to|as|is|:)?\s*/i,
      ""
    )
    .replace(/^(set|update|change)\s+/i, "")
    .replace(/(\d+)(st|nd|rd|th)\b/gi, "$1")
    // "5pm" / "11:59pm" → "5 pm" / "11:59 pm"
    .replace(/(\d)\s*(am|pm)\b/gi, "$1 $2")
    .replace(/\bat\b/gi, " ")
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const DATE_ONLY_FORMATS = [
  "d LLL yyyy",
  "d LLLL yyyy",
  "LLL d yyyy",
  "LLLL d yyyy",
  "yyyy-MM-dd",
  "d/M/yyyy",
  "d-M-yyyy",
  "M/d/yyyy",
  "M-d-yyyy",
];

const DATE_TIME_FORMATS = [
  "yyyy-MM-dd h:mm a",
  "yyyy-MM-dd hh:mm a",
  "yyyy-MM-dd h a",
  "yyyy-MM-dd H:mm",
  "yyyy-MM-dd HH:mm",
  "d LLLL yyyy h:mm a",
  "d LLL yyyy h:mm a",
  "d LLLL yyyy hh:mm a",
  "d LLL yyyy hh:mm a",
  "d LLLL yyyy h a",
  "d LLL yyyy h a",
  "d LLLL yyyy H:mm",
  "d LLL yyyy H:mm",
  "LLLL d yyyy h:mm a",
  "LLL d yyyy h:mm a",
  "LLLL d yyyy h a",
  "LLL d yyyy h a",
  "LLLL d yyyy H:mm",
  "LLL d yyyy H:mm",
  "d/M/yyyy h:mm a",
  "d/M/yyyy h a",
  "d/M/yyyy H:mm",
  "M/d/yyyy h:mm a",
  "M/d/yyyy h a",
  "M/d/yyyy H:mm",
  "yyyy-MM-dd'T'HH:mm",
  "yyyy-MM-dd'T'HH:mm:ss",
];

function tryParseWithFormats(
  text: string,
  zone: string,
  formats: string[],
  dateOnly: boolean
): Date | null {
  for (const fmt of formats) {
    const dt = DateTime.fromFormat(text, fmt, { zone, locale: "en" });
    if (!dt.isValid) continue;
    return dateOnly ? dt.endOf("day").toJSDate() : dt.toJSDate();
  }
  return null;
}

/** Local (non-LLM) parse for common natural-language and ISO-ish date strings. */
export function tryParseUserDateLocal(
  input: string,
  timezoneHint?: string
): Date | null {
  const fallbackZone = resolveTimezone(timezoneHint);
  const normalized = normalizeUserDateText(input);
  if (!normalized) return null;

  const { text, zone } = extractZoneFromText(normalized, fallbackZone);
  if (!text) return null;

  const dateOnly = isDateOnlyInput(text);

  if (dateOnly) {
    const local = tryParseWithFormats(text, zone, DATE_ONLY_FORMATS, true);
    if (local) return local;

    // Last local fallback for bare calendar strings browsers can parse.
    if (/^\d{4}-\d{2}-\d{2}$/.test(text) || /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}$/.test(text)) {
      const loose = DateTime.fromJSDate(new Date(text), { zone });
      if (loose.isValid && !Number.isNaN(Date.parse(text))) {
        return loose.endOf("day").toJSDate();
      }
    }
    return null;
  }

  const withTime = tryParseWithFormats(text, zone, DATE_TIME_FORMATS, false);
  if (withTime) return withTime;

  // ISO with offset / Z, e.g. 2026-07-25T23:59:00+05:30
  const iso = DateTime.fromISO(text, { setZone: true });
  if (iso.isValid) {
    // If the user didn't include an offset, interpret in their zone.
    if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(text)) {
      return DateTime.fromObject(
        {
          year: iso.year,
          month: iso.month,
          day: iso.day,
          hour: iso.hour,
          minute: iso.minute,
          second: iso.second,
          millisecond: iso.millisecond,
        },
        { zone }
      ).toJSDate();
    }
    return iso.toJSDate();
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

  // Prefer deterministic local parsing so Telegram "set deadline" works even
  // when LiteLLM is down or returns empty JSON.
  const local = tryParseUserDateLocal(input, zone);
  if (local) return local;

  const dateOnly = isDateOnlyInput(normalizeUserDateText(input));

  const extracted = await extractWithLLM(`
Extract a deadline date-time from this text.
User timezone: ${zone}
Text: ${input}

Rules:
- If the user gives ONLY a calendar date (no time), the deadline is END of that day (23:59:59.999) in ${zone}, NOT midnight UTC.
- If they give a time, use that time in ${zone} (or the timezone they named, e.g. IST).
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
  return parsed.toJSDate();
}
