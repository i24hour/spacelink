import { extractWithVisionLLM } from "../lib/llm";
import {
  FocusBehaviorContext,
  formatFocusContextForPrompt,
  isTooSimilarToLast,
} from "./focus-context";

export type ScreenAnalysis = {
  classification: "productive" | "off_track" | "unclear" | "sensitive_content";
  confidence: number | null;
  observedActivity: string | null;
  reason: string | null;
  suggestion: string | null;
  sensitiveContent: boolean;
  escalationLevel: 0 | 1 | 2 | 3;
};

function asText(value: unknown, max = 500): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

export async function analyzeScreenImage(
  imageBase64: string,
  mimeType: string,
  goal: string,
  behaviorContext: FocusBehaviorContext
): Promise<ScreenAnalysis> {
  const contextBlock = formatFocusContextForPrompt(goal, behaviorContext);
  const result = await extractWithVisionLLM(
    `Analyze this phone screenshot as a private productivity check for a user who asked for a hard accountability coach (their own focus clone).

${contextBlock}
Current time: ${new Date().toISOString()}

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
- Compare visible activity with the user's stated goal.
- Use productive only when the visible activity is reasonably aligned with the goal.
- Use off_track when the user appears to be spending time on an unrelated distraction.
- Use unclear when the screenshot is ambiguous or too limited to decide.
- Use sensitive_content if passwords, banking, private messages, health data, or similarly sensitive information is visible.
- For off_track, write a fresh intervention that:
  - Names the goal
  - Matches escalation_level (0 firm, 1 mention repeat, 2 mention streak + minutes + prior nudges, 3 hardest allowed push)
  - If projected streak >= 2, mention streak count and approximate minutes distracted
  - If prior telegram interventions exist, acknowledge they were already sent
  - Must NOT copy or lightly paraphrase the last intervention
  - Tough, direct, psychologically sharp accountability is required at higher levels
  - Still forbid harassment, threats, slurs, humiliation, or shaming the person's identity — attack the behavior and wasted time only
- For productive, unclear, or sensitive_content, set suggestion to null.
- Never reproduce private messages, account numbers, passwords, or personal content.
- Keep each text field under 240 characters.`,
    imageBase64,
    mimeType,
    "You are a strict privacy-conscious accountability coach analyzing a phone screenshot for someone who asked to be pushed hard using their own distraction history. Return valid JSON only."
  );

  const rawClassification = asText(result?.classification, 40);
  const classification = ["productive", "off_track", "unclear", "sensitive_content"].includes(
    rawClassification || ""
  )
    ? (rawClassification as ScreenAnalysis["classification"])
    : "unclear";
  const sensitiveContent = Boolean(result?.sensitive_content) || classification === "sensitive_content";
  const rawConfidence = Number(result?.confidence);
  let suggestion = sensitiveContent ? null : asText(result?.suggestion, 240);
  if (
    suggestion &&
    classification === "off_track" &&
    isTooSimilarToLast(suggestion, behaviorContext.lastInterventions)
  ) {
    suggestion = null; // route will use escalating fallback
  }

  const escalationLevel =
    classification === "off_track" && !sensitiveContent
      ? behaviorContext.escalationLevel
      : 0;

  return {
    classification: sensitiveContent ? "sensitive_content" : classification,
    confidence: Number.isFinite(rawConfidence) ? Math.min(1, Math.max(0, rawConfidence)) : null,
    observedActivity: sensitiveContent ? null : asText(result?.observed_activity, 240),
    reason: sensitiveContent ? "Sensitive content was detected." : asText(result?.reason, 240),
    suggestion,
    sensitiveContent,
    escalationLevel,
  };
}
