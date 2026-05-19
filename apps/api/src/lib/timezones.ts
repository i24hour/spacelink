import { DateTime } from "luxon";

export type TimezoneOption = {
  id: string;
  label: string;
  short: string;
};

/** Major zones shown during onboarding (IANA ids). */
export const TIMEZONE_OPTIONS: TimezoneOption[] = [
  { id: "Asia/Kolkata", label: "India — IST", short: "IST" },
  { id: "America/Los_Angeles", label: "US Pacific — PT / PST", short: "PT" },
  { id: "America/Denver", label: "US Mountain — MT", short: "MT" },
  { id: "America/Chicago", label: "US Central — CT", short: "CT" },
  { id: "America/New_York", label: "US Eastern — ET / EST", short: "ET" },
  { id: "Europe/London", label: "UK — GMT / BST", short: "GMT" },
  { id: "Europe/Paris", label: "Europe — CET", short: "CET" },
  { id: "Asia/Dubai", label: "Gulf — GST", short: "GST" },
  { id: "Asia/Singapore", label: "Singapore — SGT", short: "SGT" },
  { id: "Asia/Tokyo", label: "Japan — JST", short: "JST" },
  { id: "Australia/Sydney", label: "Australia — AEST", short: "AEST" },
  { id: "UTC", label: "UTC / GMT", short: "UTC" },
];

const ALIASES: Record<string, string> = {
  ist: "Asia/Kolkata",
  pst: "America/Los_Angeles",
  pdt: "America/Los_Angeles",
  pt: "America/Los_Angeles",
  pacific: "America/Los_Angeles",
  est: "America/New_York",
  edt: "America/New_York",
  et: "America/New_York",
  eastern: "America/New_York",
  cst: "America/Chicago",
  ct: "America/Chicago",
  mst: "America/Denver",
  mt: "America/Denver",
  gmt: "UTC",
  utc: "UTC",
  bst: "Europe/London",
  cet: "Europe/Paris",
  gst: "Asia/Dubai",
  sgt: "Asia/Singapore",
  jst: "Asia/Tokyo",
  aest: "Australia/Sydney",
};

export function normalizeTimezone(input: string): string {
  const raw = input.trim();
  if (!raw) return "UTC";

  const byId = TIMEZONE_OPTIONS.find((z) => z.id === raw);
  if (byId) return byId.id;

  const alias = ALIASES[raw.toLowerCase()];
  if (alias) return alias;

  try {
    Intl.DateTimeFormat(undefined, { timeZone: raw });
    return raw;
  } catch {
    return "UTC";
  }
}

export function timezoneLabel(zone: string): string {
  const opt = TIMEZONE_OPTIONS.find((z) => z.id === zone);
  return opt ? `${opt.label} (${opt.id})` : zone;
}

export function needsTimezoneSetup(user: {
  timezone: string;
  timezoneConfigured: boolean;
}): boolean {
  if (user.timezoneConfigured) return false;
  if (user.timezone && user.timezone !== "UTC") return false;
  return true;
}

export function formatNowInTimezone(zone: string): string {
  const z = normalizeTimezone(zone);
  return DateTime.now().setZone(z).toFormat("LLL d, yyyy · h:mm a ZZZZ");
}
