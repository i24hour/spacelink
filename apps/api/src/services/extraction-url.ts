import { prisma } from "../lib/prisma";
import { scrapeUrl, searchWeb } from "../lib/firecrawl";
import { extractWithLLM } from "../lib/llm";
import { scheduleSmartRemindersForLink } from "./reminders-smart";
import type { SavedLink } from "@deadlineai/db";

export type DeadlineSource = "page" | "search" | "none";

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
  deadlineEvidenceUrl?: string;
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

function buildSearchDeadlinePrompt(title: string, content: string, sourceUrl: string, targetUrl: string) {
  return `
You are DeadlineAI. Find ONLY the application/event deadline date related to this target URL:
${targetUrl}

Candidate source URL:
${sourceUrl}

Page title:
${title}

Page content:
${content.slice(0, 12000)}

Return JSON only:
{
  "deadline": "2026-05-20T23:59:00",
  "confidence_score": 0.0,
  "reason": "short text"
}

Rules:
- If no explicit or highly reliable deadline exists, set deadline to null.
- Do not invent dates.
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

async function findDeadlineViaSearch(targetUrl: string, titleHint: string) {
  let hostname = "";
  try {
    hostname = new URL(targetUrl).hostname.replace(/^www\./, "");
  } catch {
    hostname = targetUrl;
  }

  const queryBase = titleHint && titleHint !== targetUrl ? titleHint : hostname;
  const queries = [
    `${queryBase} deadline`,
    `${queryBase} last date to apply`,
    `${hostname} application deadline`,
  ];

  const seen = new Set<string>([targetUrl]);
  const candidates: Array<{ deadline: Date; confidence: number; evidenceUrl: string }> = [];

  for (const q of queries) {
    const results = await searchWeb(q, 5);
    for (const result of results) {
      const candidateUrl = result.url;
      if (!candidateUrl || seen.has(candidateUrl)) continue;
      seen.add(candidateUrl);

      let pageTitle = result.title || candidateUrl;
      let pageContent = "";

      try {
        const scraped = await scrapeUrl(candidateUrl);
        pageContent = scraped.markdown || scraped.html || "";
        pageTitle = (scraped.metadata?.title as string) || pageTitle;
      } catch {
        try {
          const res = await fetch(candidateUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
          const html = await res.text();
          pageContent = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").slice(0, 15000);
          const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
          if (titleMatch) pageTitle = titleMatch[1];
        } catch {
          // Skip this candidate
        }
      }

      if (!pageContent || pageContent.length < 80) continue;

      const extracted = await extractWithLLM(
        buildSearchDeadlinePrompt(pageTitle, pageContent, candidateUrl, targetUrl)
      );
      const deadline = parseDeadline(extracted.deadline);
      if (!deadline) continue;

      const confidence =
        typeof extracted.confidence_score === "number" ? extracted.confidence_score : 0.4;
      candidates.push({ deadline, confidence, evidenceUrl: candidateUrl });
      if (confidence >= 0.8) break;
    }
    if (candidates.some((c) => c.confidence >= 0.8)) break;
  }

  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return a.deadline.getTime() - b.deadline.getTime();
  });

  return candidates[0];
}

export async function extractUrlDataWithFallback(url: string): Promise<UrlExtractionResult | null> {
  const { content, title } = await readUrlContent(url);

  if (!content || content.length < 50) return null;

  // AI extraction
  const extraction = await extractWithLLM(buildPrompt(title, content));
  const pageDeadline = parseDeadline(extraction.deadline);

  let extractedDeadline = pageDeadline;
  let deadlineSource: DeadlineSource = pageDeadline ? "page" : "none";
  let deadlineEvidenceUrl: string | undefined;

  if (!extractedDeadline) {
    const fromSearch = await findDeadlineViaSearch(url, extraction.title || title);
    if (fromSearch?.deadline) {
      extractedDeadline = fromSearch.deadline;
      deadlineSource = "search";
      deadlineEvidenceUrl = fromSearch.evidenceUrl;
    }
  }

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
    deadlineEvidenceUrl,
  };
}

export async function saveExtractedUrlData(
  url: string,
  userId: string,
  data: UrlExtractionResult
): Promise<SavedLink> {
  const metadata: Record<string, unknown> = {
    deadline_source: data.deadlineSource,
  };
  if (data.deadlineEvidenceUrl) metadata.deadline_evidence_url = data.deadlineEvidenceUrl;

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
      metadata: metadata as any,
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
