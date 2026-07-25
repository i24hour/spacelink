import OpenAI from "openai";

/**
 * Amazon Bedrock Mantle (OpenAI-compatible) → Moonshot Kimi K2.5
 *
 * Docs:
 * - Model ID: moonshotai.kimi-k2.5
 * - Base URL: https://bedrock-mantle.{region}.api.aws/v1
 * - Auth: Bedrock long-term API key (Bearer)
 *   env: BEDROCK_API_KEY or AWS_BEARER_TOKEN_BEDROCK
 *
 * Legacy LITELLM_* env vars are still accepted as fallbacks during migration.
 */

const DEFAULT_MODEL = "moonshotai.kimi-k2.5";
/** Match Render Ohio by default; override with BEDROCK_REGION. */
const DEFAULT_REGION = "us-east-2";

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

type CachedClient = {
  key: string;
  baseURL: string;
  client: OpenAI;
};

let cachedClient: CachedClient | null = null;

/** Lazily build the OpenAI client so dotenv/env injection after import still works. */
export function getLlmClient(): OpenAI {
  const key = resolveApiKey();
  const baseURL = resolveBaseURL();
  if (
    !cachedClient ||
    cachedClient.key !== key ||
    cachedClient.baseURL !== baseURL
  ) {
    cachedClient = {
      key,
      baseURL,
      client: new OpenAI({ apiKey: key, baseURL }),
    };
  }
  return cachedClient.client;
}

/**
 * Drop-in OpenAI client. Resolves credentials on each property access so
 * process.env can be loaded after this module is imported.
 */
export const llm: OpenAI = new Proxy({} as OpenAI, {
  get(_target, prop, receiver) {
    const client = getLlmClient();
    const value = Reflect.get(client as object, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

/** @deprecated Use `llm` — kept for existing imports during migration. */
export const litellm = llm;

export function getLlmConfigSummary() {
  const key = resolveApiKey();
  const baseURL = resolveBaseURL();
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

function parseJsonContent(raw: string): any {
  const trimmed = (raw || "").trim();
  if (!trimmed) return {};

  try {
    return JSON.parse(trimmed);
  } catch {
    // Some models wrap JSON in ```json fences
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch {
        // fall through
      }
    }

    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return {};
      }
    }
    return {};
  }
}

export async function extractWithLLM(prompt: string): Promise<any> {
  const model = resolveLlmModel("default");
  const apiKey = resolveApiKey();
  if (!apiKey) {
    console.error(
      "LLM extraction skipped: BEDROCK_API_KEY / AWS_BEARER_TOKEN_BEDROCK is missing"
    );
    return {};
  }

  try {
    const res = await getLlmClient().chat.completions.create({
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
): Promise<any> {
  const model = resolveLlmModel("vision");
  const apiKey = resolveApiKey();
  if (!apiKey) {
    console.error(
      "Vision LLM skipped: BEDROCK_API_KEY / AWS_BEARER_TOKEN_BEDROCK is missing"
    );
    return {};
  }

  try {
    const res = await getLlmClient().chat.completions.create({
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
