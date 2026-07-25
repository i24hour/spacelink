import { extractWithVisionLLM } from "../lib/llm";

export type ScreenAnalysis = {
  classification: "productive" | "off_track" | "unclear" | "sensitive_content";
  confidence: number | null;
  observedActivity: string | null;
  reason: string | null;
  suggestion: string | null;
  sensitiveContent: boolean;
};

function asText(value: unknown, max = 500): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

export async function analyzeScreenImage(
  imageBase64: string,
  mimeType: string,
  goal: string,
  recentContext: string
): Promise<ScreenAnalysis> {
  const result = await extractWithVisionLLM(
    `Analyze this phone screenshot as a private productivity check.

User's current goal: ${goal}
Current time: ${new Date().toISOString()}
Recent context: ${recentContext || "No previous check"}

Return JSON only with this shape:
{
  "classification": "productive|off_track|unclear|sensitive_content",
  "confidence": 0.0,
  "observed_activity": "short neutral description",
  "reason": "one short reason",
  "suggestion": "a short personalized Telegram intervention, or null when productive or unclear",
  "sensitive_content": false
}

Rules:
- Compare visible activity with the user's stated goal, without moral judgment.
- Use productive only when the visible activity is reasonably aligned with the goal.
- Use off_track when the user appears to be spending time on an unrelated distraction.
- Use unclear when the screenshot is ambiguous or too limited to decide.
- Use sensitive_content if passwords, banking, private messages, health data, or similarly sensitive information is visible.
- For off_track, write a fresh, direct, personalized intervention that connects the distraction to the user's goal. Tough-love language is allowed, but do not use harassment, threats, slurs, or humiliation. Do not write a generic quote.
- For productive, unclear, or sensitive_content, set suggestion to null. The app will not send a Telegram notification for those classifications.
- Never reproduce private messages, account numbers, passwords, or personal content.
- Keep each text field under 240 characters.`,
    imageBase64,
    mimeType,
    "You are a privacy-conscious productivity coach analyzing a phone screenshot. Return valid JSON only."
  );

  const rawClassification = asText(result?.classification, 40);
  const classification = ["productive", "off_track", "unclear", "sensitive_content"].includes(
    rawClassification || ""
  )
    ? (rawClassification as ScreenAnalysis["classification"])
    : "unclear";
  const sensitiveContent = Boolean(result?.sensitive_content) || classification === "sensitive_content";
  const rawConfidence = Number(result?.confidence);

  return {
    classification: sensitiveContent ? "sensitive_content" : classification,
    confidence: Number.isFinite(rawConfidence) ? Math.min(1, Math.max(0, rawConfidence)) : null,
    observedActivity: sensitiveContent ? null : asText(result?.observed_activity, 240),
    reason: sensitiveContent ? "Sensitive content was detected." : asText(result?.reason, 240),
    suggestion: sensitiveContent ? null : asText(result?.suggestion, 240),
    sensitiveContent,
  };
}
