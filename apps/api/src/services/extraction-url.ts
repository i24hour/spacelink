import { prisma } from "../lib/prisma";
import { scrapeUrl } from "../lib/firecrawl";
import { extractWithLLM } from "../lib/llm";
import { scheduleSmartRemindersForLink } from "./reminders-smart";
import type { SavedLink } from "@deadlineai/db";

export type DeadlineSource = "page" | "none";

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
};

function buildPrompt(title: string, content: string) {
  return `
You are DeadlineAI. Analyze this webpage content and extract deadline information.

Page Title: ${title}
Content: ${content.slice(0, 12000)}

Return JSON only:
{
  "title": "Event/Program name",
  "deadline": "2026-05-20T23:59:00",
  "timezone": "IST",
  "category": "hackathon|internship|grant|visa|contest|program",
  "urgency_score": 1-10,
  "confidence_score": 0.0-1.0,
  "rolling_application": false,
  "estimated_completion_minutes": 30
}
`.trim();
}

function parseDeadline(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

async function readUrlContent(url: string) {
  let content = "";
  let title = url;

  // Try Firecrawl first
  try {
    const scraped = await scrapeUrl(url);
    content = scraped.markdown || scraped.html || "";
    title = (scraped.metadata?.title as string) || url;
  } catch {
    content = "No content available";
  }

  // Fallback: simple fetch if Firecrawl fails
  if (!content || content.length < 100) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      const html = await res.text();
      content = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").slice(0, 15000);
      const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
      if (titleMatch) title = titleMatch[1];
    } catch {
      // Keep whatever we have
    }
  }

  return { content, title };
}

export async function extractUrlDataWithFallback(url: string): Promise<UrlExtractionResult | null> {
  const { content, title } = await readUrlContent(url);

  if (!content || content.length < 50) return null;

  // AI extraction
  const extraction = await extractWithLLM(buildPrompt(title, content));
  const extractedDeadline = parseDeadline(extraction.deadline);
  const deadlineSource: DeadlineSource = extractedDeadline ? "page" : "none";

  return {
    title: extraction.title || title,
    rawContent: content,
    extractedDeadline,
    timezone: extraction.timezone || null,
    category: extraction.category || null,
    urgencyScore: typeof extraction.urgency_score === "number" ? extraction.urgency_score : null,
    confidenceScore: typeof extraction.confidence_score === "number" ? extraction.confidence_score : null,
    rollingApplication: Boolean(extraction.rolling_application),
    estimatedCompletionMinutes:
      typeof extraction.estimated_completion_minutes === "number"
        ? extraction.estimated_completion_minutes
        : null,
    deadlineSource,
  };
}

export async function saveExtractedUrlData(
  url: string,
  userId: string,
  data: UrlExtractionResult
): Promise<SavedLink> {
  const link = await prisma.savedLink.create({
    data: {
      userId,
      url,
      title: data.title,
      rawContent: data.rawContent,
      extractedDeadline: data.extractedDeadline,
      timezone: data.timezone,
      category: data.category,
      urgencyScore: data.urgencyScore,
      confidenceScore: data.confidenceScore,
      rollingApplication: data.rollingApplication,
      estimatedCompletionMinutes: data.estimatedCompletionMinutes,
      metadata: { deadline_source: data.deadlineSource } as any,
      status: "active",
    },
  });

  // Schedule smart reminders
  await scheduleSmartRemindersForLink(link);

  return link;
}

export async function processExtractionFromUrl(url: string, userId: string): Promise<SavedLink | null> {
  const extracted = await extractUrlDataWithFallback(url);
  if (!extracted) return null;
  return saveExtractedUrlData(url, userId, extracted);
}
