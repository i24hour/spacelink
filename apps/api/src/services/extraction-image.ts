import { extractWithVisionLLM } from "../lib/llm";
import { normalizeTimezone } from "../lib/timezones";
import {
  parseDeadline,
  type UrlExtractionResult,
} from "./extraction-url";

function buildImagePrompt(caption: string | undefined, userTimezone: string) {
  return `
Analyze this image (poster, screenshot, flyer, or form) and extract opportunity deadline information.

User timezone: ${userTimezone}
${caption ? `User caption (extra hint): ${caption}` : ""}

Return JSON only:
{
  "title": "Event or program name",
  "deadline": "2026-05-20T17:00:00",
  "deadline_text": "original date text visible in image if any",
  "timezone": "IST",
  "url": "https://... if a URL is visible, else null",
  "category": "hackathon|internship|grant|visa|contest|program",
  "urgency_score": 1-10,
  "confidence_score": 0.0-1.0,
  "rolling_application": false,
  "estimated_completion_minutes": 30,
  "summary": "one sentence about what this opportunity is"
}

Rules:
- If only a calendar date is visible (no time), use end of that day in ${userTimezone}.
- If timezone is ambiguous, prefer ${userTimezone}.
- If no deadline is visible, set deadline to null.
`.trim();
}

export async function extractImageDataWithVision(
  imageBase64: string,
  mimeType: string,
  userTimezone: string,
  caption?: string
): Promise<UrlExtractionResult | null> {
  const zone = normalizeTimezone(userTimezone);
  const extraction = await extractWithVisionLLM(
    buildImagePrompt(caption, zone),
    imageBase64,
    mimeType
  );

  if (!extraction || typeof extraction !== "object") return null;

  const pageZone = normalizeTimezone(
    (typeof extraction.timezone === "string" && extraction.timezone) || zone
  );
  const extractedDeadline = parseDeadline(extraction.deadline, pageZone);

  const title =
    (typeof extraction.title === "string" && extraction.title.trim()) ||
    "Opportunity from image";
  const summary =
    typeof extraction.summary === "string" ? extraction.summary.trim() : "";

  return {
    title,
    rawContent: [summary, caption].filter(Boolean).join("\n").slice(0, 8000),
    extractedDeadline,
    timezone: extraction.timezone ? pageZone : null,
    category: typeof extraction.category === "string" ? extraction.category : null,
    urgencyScore:
      typeof extraction.urgency_score === "number" ? extraction.urgency_score : null,
    confidenceScore:
      typeof extraction.confidence_score === "number" ? extraction.confidence_score : null,
    rollingApplication: Boolean(extraction.rolling_application),
    estimatedCompletionMinutes:
      typeof extraction.estimated_completion_minutes === "number"
        ? extraction.estimated_completion_minutes
        : null,
    deadlineSource: "image",
    sourceUrl:
      typeof extraction.url === "string" && extraction.url.startsWith("http")
        ? extraction.url
        : null,
  };
}

export function imagePlaceholderUrl(userId: string, messageId: number): string {
  return `telegram-photo:${userId}:${messageId}`;
}
