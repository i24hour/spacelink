import { DateTime } from "luxon";
import { prisma } from "../lib/prisma";
import { scrapeUrl } from "../lib/firecrawl";
import { extractWithLLM } from "../lib/llm";
import { normalizeLinkUrl } from "../lib/link-url";
import { normalizeTimezone } from "../lib/timezones";
import { clearPendingRemindersForLink } from "./reminders-smart";
import { rebuildRemindersForLink } from "./reminder-engine";
import type { SavedLink } from "@deadlineai/db";

export type DeadlineSource = "page" | "image" | "none";

export type UrlExtractionResult = {
  title: string;
  rawContent: string;
  extractedDeadline: Date | null;
  timezone: string | null;
  category: string | null;
  urgencyScore: number | null;
  confidenceScore: number | null;
  rollingApplication: boolean;
  estimatedCompletionMinutes: number | null;
  deadlineSource: DeadlineSource;
  sourceUrl?: string | null;
};

const CONTENT_CHAR_LIMIT = 24000;

function buildPrompt(title: string, content: string, userTimezone?: string) {
  const zone = normalizeTimezone(userTimezone || "UTC");
  const today = DateTime.now().setZone(zone).toISODate();

  return `
You are DeadlineAI. Today is ${today}. Analyze this full webpage and extract the best UPCOMING deadline for someone who wants to apply or register.

Page Title: ${title}
Content: ${content.slice(0, CONTENT_CHAR_LIMIT)}

Rules:
- Always look for the nearest FUTURE application, registration, or submission deadline
- IGNORE past cohort dates, archived programs, "deadline was…", blog posts about old events
- If the page lists multiple intakes/cohorts/rounds, pick the earliest still-open one
- If applications are rolling/open with no fixed end date, set rolling_application: true and deadline: null
- Do NOT return a deadline before ${today} unless no future date exists anywhere on the page
- Scan the entire content — dates may appear in FAQs, banners, footers, or apply sections

Return JSON only:
{
  "title": "Event/Program name",
  "deadline": "2026-05-20T23:59:00",
  "deadlines": ["2026-05-20T23:59:00", "2026-08-01T23:59:59"],
  "timezone": "IST",
  "category": "hackathon|internship|grant|visa|contest|program",
  "urgency_score": 1-10,
  "confidence_score": 0.0-1.0,
  "rolling_application": false,
  "estimated_completion_minutes": 30
}
`.trim();
}

export function parseDeadline(value: unknown, zoneHint: string): Date | null {
  if (typeof value !== "string" || !value) return null;
  const zone = normalizeTimezone(zoneHint);
  const trimmed = value.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const dt = DateTime.fromISO(trimmed, { zone }).endOf("day");
    return dt.isValid ? dt.toJSDate() : null;
  }

  const dt = DateTime.fromISO(trimmed, { setZone: true });
  if (dt.isValid) return dt.toJSDate();

  const fallback = new Date(trimmed);
  if (Number.isNaN(fallback.getTime())) return null;
  return fallback;
}

function pickBestUpcomingDeadline(
  extraction: Record<string, unknown>,
  zone: string
): Date | null {
  const candidates: Date[] = [];
  const primary = parseDeadline(extraction.deadline, zone);
  if (primary) candidates.push(primary);

  if (Array.isArray(extraction.deadlines)) {
    for (const item of extraction.deadlines) {
      const parsed = parseDeadline(item, zone);
      if (parsed) candidates.push(parsed);
    }
  }

  const now = Date.now();
  const upcoming = candidates.filter((d) => d.getTime() > now);
  if (!upcoming.length) return null;

  upcoming.sort((a, b) => a.getTime() - b.getTime());
  return upcoming[0];
}

async function readUrlContent(url: string) {
  let content = "";
  let title = url;

  try {
    const scraped = await scrapeUrl(url);
    content = scraped.markdown || scraped.html || "";
    title = (scraped.metadata?.title as string) || url;
  } catch {
    content = "";
  }

  if (!content || content.length < 100) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; DeadlineAI/1.0)" },
        redirect: "follow",
      });
      const html = await res.text();
      content = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").slice(0, CONTENT_CHAR_LIMIT);
      const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
      if (titleMatch) title = titleMatch[1];
    } catch {
      // Keep whatever we have
    }
  }

  return { content, title };
}

export async function findExistingLinkForUser(
  userId: string,
  url: string
): Promise<SavedLink | null> {
  const target = normalizeLinkUrl(url);
  const exact = await prisma.savedLink.findFirst({ where: { userId, url } });
  if (exact && normalizeLinkUrl(exact.url) === target) return exact;

  const links = await prisma.savedLink.findMany({ where: { userId } });
  return links.find((link) => normalizeLinkUrl(link.url) === target) ?? null;
}

export async function extractUrlDataWithFallback(
  url: string,
  userTimezone?: string
): Promise<UrlExtractionResult | null> {
  const { content, title } = await readUrlContent(url);

  if (!content || content.length < 50) return null;

  const extraction = await extractWithLLM(buildPrompt(title, content, userTimezone));
  const pageZone = normalizeTimezone(
    (typeof extraction.timezone === "string" && extraction.timezone) ||
      userTimezone ||
      "UTC"
  );
  const extractedDeadline = pickBestUpcomingDeadline(extraction, pageZone);
  const rollingApplication =
    Boolean(extraction.rolling_application) ||
    (!extractedDeadline && /rolling|open\s+application|apply\s+anytime/i.test(content));
  const deadlineSource: DeadlineSource = extractedDeadline ? "page" : "none";

  return {
    title: (typeof extraction.title === "string" && extraction.title) || title,
    rawContent: content,
    extractedDeadline,
    timezone: extraction.timezone ? pageZone : null,
    category: typeof extraction.category === "string" ? extraction.category : null,
    urgencyScore: typeof extraction.urgency_score === "number" ? extraction.urgency_score : null,
    confidenceScore:
      typeof extraction.confidence_score === "number" ? extraction.confidence_score : null,
    rollingApplication,
    estimatedCompletionMinutes:
      typeof extraction.estimated_completion_minutes === "number"
        ? extraction.estimated_completion_minutes
        : null,
    deadlineSource,
  };
}

export function isDeadlinePassed(deadline: Date | string | null | undefined): boolean {
  if (!deadline) return false;
  return new Date(deadline).getTime() <= Date.now();
}

export async function updateLinkFromExtraction(
  linkId: string,
  data: UrlExtractionResult,
  options?: { url?: string }
): Promise<SavedLink> {
  const existing = await prisma.savedLink.findUnique({ where: { id: linkId } });
  const meta = ((existing?.metadata as Record<string, unknown>) || {}) as Record<string, unknown>;
  const { reminder_schedule: _removed, ...metaRest } = meta;

  await clearPendingRemindersForLink(linkId);

  const user = existing
    ? await prisma.user.findUnique({ where: { id: existing.userId } })
    : null;
  const userZone = normalizeTimezone(user?.timezone || "UTC");

  return prisma.savedLink.update({
    where: { id: linkId },
    data: {
      url: options?.url,
      title: data.title,
      rawContent: data.rawContent,
      extractedDeadline: data.extractedDeadline,
      timezone: data.timezone || userZone,
      category: data.category,
      urgencyScore: data.urgencyScore,
      confidenceScore: data.confidenceScore,
      rollingApplication: data.rollingApplication,
      estimatedCompletionMinutes: data.estimatedCompletionMinutes,
      status: "active",
      metadata: { ...metaRest, deadline_source: data.deadlineSource } as object,
    },
  });
}

export async function saveExtractedUrlData(
  url: string,
  userId: string,
  data: UrlExtractionResult,
  options?: { autoScheduleReminders?: boolean }
): Promise<SavedLink> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const userZone = normalizeTimezone(user?.timezone || "UTC");

  const link = await prisma.savedLink.create({
    data: {
      userId,
      url,
      title: data.title,
      rawContent: data.rawContent,
      extractedDeadline: data.extractedDeadline,
      timezone: data.timezone || userZone,
      category: data.category,
      urgencyScore: data.urgencyScore,
      confidenceScore: data.confidenceScore,
      rollingApplication: data.rollingApplication,
      estimatedCompletionMinutes: data.estimatedCompletionMinutes,
      metadata: { deadline_source: data.deadlineSource } as any,
      status: "active",
    },
  });

  if (options?.autoScheduleReminders && link.extractedDeadline) {
    await rebuildRemindersForLink(link.id, "daily_all");
  }

  return link;
}

export async function processExtractionFromUrl(url: string, userId: string): Promise<SavedLink | null> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const extracted = await extractUrlDataWithFallback(url, user?.timezone);
  if (!extracted) return null;
  return saveExtractedUrlData(url, userId, extracted);
}
