import OpenAI from "openai";

const baseURL = process.env.LITELLM_PROXY_URL || "";
const apiKey = process.env.LITELLM_API_KEY || "";

export const litellm = new OpenAI({
  baseURL,
  apiKey,
});

export async function extractWithLLM(prompt: string) {
  const model = process.env.LITELLM_MODEL || "gpt-4o";
  const res = await litellm.chat.completions.create({
    model,
    messages: [
      { role: "system", content: "You are an expert deadline extraction AI. Return valid JSON only." },
      { role: "user", content: prompt },
    ],
    temperature: 0.2,
    response_format: { type: "json_object" },
  });

  const raw = res.choices[0]?.message?.content || "{}";
  return JSON.parse(raw);
}
