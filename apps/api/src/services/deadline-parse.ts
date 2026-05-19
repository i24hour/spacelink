import { extractWithLLM } from "../lib/llm";

/** Parse natural-language or ISO date strings into a Date. */
export async function parseDateFromUserText(
  input: string,
  timezoneHint?: string
): Promise<Date | null> {
  const direct = new Date(input);
  if (!Number.isNaN(direct.getTime()) && input.length > 6) return direct;

  const tz = timezoneHint ? `User timezone: ${timezoneHint}` : "";
  const extracted = await extractWithLLM(`
Extract a deadline date-time from this text.
${tz}
Text: ${input}

Return JSON only:
{
  "deadline": "2026-05-20T23:59:00"
}

If no clear date exists, return:
{ "deadline": null }
`.trim());

  if (!extracted || extracted.deadline == null) return null;
  const parsed = new Date(extracted.deadline);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}
