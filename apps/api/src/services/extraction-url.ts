import { prisma } from "../lib/prisma";
import { scrapeUrl } from "../lib/firecrawl";
import { extractWithLLM } from "../lib/llm";
import { scheduleSmartRemindersForLink } from "./reminders-smart";
import type { SavedLink } from "@deadlineai/db";

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

export async function processExtractionFromUrl(url: string, userId: string): Promise<SavedLink | null> {
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

  if (!content || content.length < 50) return null;

  // AI extraction
  const extraction = await extractWithLLM(buildPrompt(title, content));
  const deadline = extraction.deadline ? new Date(extraction.deadline) : null;

  const link = await prisma.savedLink.create({
    data: {
      userId,
      url,
      title: extraction.title || title,
      rawContent: content,
      extractedDeadline: deadline,
      timezone: extraction.timezone || null,
      category: extraction.category || null,
      urgencyScore: typeof extraction.urgency_score === "number" ? extraction.urgency_score : null,
      confidenceScore: typeof extraction.confidence_score === "number" ? extraction.confidence_score : null,
      rollingApplication: Boolean(extraction.rolling_application),
      estimatedCompletionMinutes: typeof extraction.estimated_completion_minutes === "number"
        ? extraction.estimated_completion_minutes
        : null,
      status: "active",
    },
  });

  // Schedule smart reminders
  await scheduleSmartRemindersForLink(link);

  return link;
}
