import { prisma } from "../lib/prisma";
import { extractWithLLM } from "../lib/llm";
import { scrapeUrl } from "../lib/firecrawl";
import { rebuildRemindersForLink } from "./reminder-engine";

function buildPrompt(title: string, content: string, metadata?: Record<string, unknown>) {
  return `
You are DeadlineAI, an expert system that extracts structured deadline information from webpage content.

Input:
- Title: ${title}
- Content: ${content.slice(0, 12000)}
- Metadata: ${JSON.stringify(metadata || {}).slice(0, 2000)}

Instructions:
1. Identify the primary deadline date and time. Use ISO 8601 format with timezone if available. If timezone is ambiguous, use the most likely timezone for the opportunity.
2. Identify the event/program name.
3. Classify the category (e.g., startup accelerator, hackathon, internship, grant, visa, university, contest).
4. Assign an urgency_score from 1 (very far) to 10 (imminent).
5. Assign a confidence_score from 0 to 1.
6. Determine if this is a rolling application (true/false).
7. Estimate completion time in minutes.

Return strictly JSON in this shape:
{
  "title": "string",
  "deadline": "2026-05-12T23:59:00-07:00",
  "timezone": "PT",
  "category": "string",
  "urgency_score": 9,
  "confidence_score": 0.93,
  "rolling_application": false,
  "estimated_completion_minutes": 45
}
`.trim();
}

export async function processExtraction(savedLinkId: string) {
  const link = await prisma.savedLink.findUnique({ where: { id: savedLinkId } });
  if (!link) throw new Error("Link not found");

  // Optionally enrich with Firecrawl if raw content is thin
  let content = link.rawContent || "";
  if ((!content || content.length < 200) && process.env.FIRECRAWL_API_KEY) {
    try {
      const scraped = await scrapeUrl(link.url);
      content = scraped.markdown || scraped.html || "";
      await prisma.savedLink.update({
        where: { id: savedLinkId },
        data: { rawContent: content },
      });
    } catch {
      // Non-blocking: continue with whatever we have
    }
  }

  const prompt = buildPrompt(link.title, content, (link.metadata as Record<string, unknown>) || {});
  const extraction = await extractWithLLM(prompt);

  const deadline = extraction.deadline ? new Date(extraction.deadline) : null;

  const updated = await prisma.savedLink.update({
    where: { id: savedLinkId },
    data: {
      extractedDeadline: deadline,
      timezone: extraction.timezone || null,
      category: extraction.category || null,
      urgencyScore: typeof extraction.urgency_score === "number" ? extraction.urgency_score : null,
      confidenceScore: typeof extraction.confidence_score === "number" ? extraction.confidence_score : null,
      rollingApplication: Boolean(extraction.rolling_application),
      estimatedCompletionMinutes:
        typeof extraction.estimated_completion_minutes === "number"
          ? extraction.estimated_completion_minutes
          : null,
      status: "active",
    },
  });

  if (updated.extractedDeadline && updated.extractedDeadline.getTime() > Date.now()) {
    await rebuildRemindersForLink(updated.id, "daily_all");
  }

  return updated;
}
