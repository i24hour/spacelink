import OpenAI from "openai";

/**
 * Amazon Bedrock Mantle (OpenAI-compatible) → Moonshot Kimi K2.5
 *
 * Docs:
 * - Model ID: moonshotai.kimi-k2.5
 * - Base URL: https://bedrock-mantle.{region}.api.aws/v1
 * - Auth: Bedrock long-term API key (Bearer)
 *
 * Legacy LITELLM_* env vars are still accepted as fallbacks during migration.
 */

const DEFAULT_MODEL = "moonshotai.kimi-k2.5";
const DEFAULT_REGION = "us-east-1";

function resolveRegion(): string {
  return (
    process.env.BEDROCK_REGION ||
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION ||
    DEFAULT_REGION
  ).trim();
}

function resolveBaseURL(): string {
  const explicit =
    process.env.BEDROCK_BASE_URL ||
    process.env.LITELLM_PROXY_URL ||
    "";
  if (explicit.trim()) return explicit.replace(/\/$/, "");

  const region = resolveRegion();
  return `https://bedrock-mantle.${region}.api.aws/v1`;
}

function resolveApiKey(): string {
  return (
    process.env.BEDROCK_API_KEY ||
    process.env.AWS_BEARER_TOKEN_BEDROCK ||
    process.env.LITELLM_API_KEY ||
    ""
  ).trim();
}

export function resolveLlmModel(kind: "default" | "vision" | "tools" = "default"): string {
  if (kind === "vision") {
    return (
      process.env.BEDROCK_VISION_MODEL ||
      process.env.LITELLM_VISION_MODEL ||
      process.env.BEDROCK_MODEL ||
      process.env.LITELLM_MODEL ||
      DEFAULT_MODEL
    ).trim();
  }

  if (kind === "tools") {
    return (
      process.env.BEDROCK_TOOL_MODEL ||
      process.env.LITELLM_TOOL_MODEL ||
      process.env.BEDROCK_MODEL ||
      process.env.LITELLM_MODEL ||
      DEFAULT_MODEL
    ).trim();
  }

  return (process.env.BEDROCK_MODEL || process.env.LITELLM_MODEL || DEFAULT_MODEL).trim();
}

const baseURL = resolveBaseURL();
const apiKey = resolveApiKey();

/** OpenAI SDK client pointed at Bedrock Mantle (or legacy LiteLLM proxy). */
export const llm = new OpenAI({
  baseURL,
  apiKey,
});

/** @deprecated Use `llm` — kept for existing imports during migration. */
export const litellm = llm;

export function getLlmConfigSummary() {
  const key = resolveApiKey();
  return {
    provider: baseURL.includes("bedrock-mantle")
      ? "amazon-bedrock-mantle"
      : baseURL.includes("amazonaws.com")
        ? "amazon-bedrock"
        : baseURL
          ? "openai-compatible"
          : "unconfigured",
    baseURL: baseURL || null,
    region: resolveRegion(),
    model: resolveLlmModel("default"),
    visionModel: resolveLlmModel("vision"),
    toolsModel: resolveLlmModel("tools"),
    apiKeyConfigured: Boolean(key),
    apiKeyPrefix: key ? `${key.slice(0, 6)}…` : null,
  };
}

function parseJsonContent(raw: string): Record<string, unknown> {
  const trimmed = (raw || "").trim();
  if (!trimmed) return {};

  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    // Some models wrap JSON in ```json fences
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      try {
        return JSON.parse(fenced[1].trim()) as Record<string, unknown>;
      } catch {
        // fall through
      }
    }

    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
      } catch {
        return {};
      }
    }
    return {};
  }
}

export async function extractWithLLM(prompt: string) {
  const model = resolveLlmModel("default");
  if (!apiKey) {
    console.error("LLM extraction skipped: BEDROCK_API_KEY (or legacy LITELLM_API_KEY) is missing");
    return {};
  }

  try {
    const res = await llm.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: "You are an expert deadline extraction AI. Return valid JSON only.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
    });

    const raw = res.choices[0]?.message?.content || "{}";
    return parseJsonContent(raw);
  } catch (err) {
    console.error("LLM extraction failed, using fallback empty object:", err);
    return {};
  }
}

export async function extractWithVisionLLM(
  prompt: string,
  imageBase64: string,
  mimeType: string
) {
  const model = resolveLlmModel("vision");
  if (!apiKey) {
    console.error("Vision LLM skipped: BEDROCK_API_KEY (or legacy LITELLM_API_KEY) is missing");
    return {};
  }

  try {
    const res = await llm.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content:
            "You are an expert deadline extraction AI reading posters and screenshots. Return valid JSON only.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: { url: `data:${mimeType};base64,${imageBase64}` },
            },
          ],
        },
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
    });

    const raw = res.choices[0]?.message?.content || "{}";
    return parseJsonContent(raw);
  } catch (err) {
    console.error("Vision LLM extraction failed:", err);
    return {};
  }
}
