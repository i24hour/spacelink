import OpenAI from "openai";

const baseURL = process.env.LITELLM_PROXY_URL || "";
const apiKey = process.env.LITELLM_API_KEY || "";

export const litellm = new OpenAI({
  baseURL,
  apiKey,
});

export async function extractWithLLM(prompt: string) {
  const model = process.env.LITELLM_MODEL || "gpt-4o";
  try {
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
  } catch (err) {
    console.error("LLM extraction failed, using fallback empty object:", err);
    return {};
  }
}

export async function extractWithVisionLLM(
  prompt: string,
  imageBase64: string,
  mimeType: string,
  systemPrompt = "You are an expert deadline extraction AI reading posters and screenshots. Return valid JSON only."
) {
  const model =
    process.env.LITELLM_VISION_MODEL || process.env.LITELLM_MODEL || "gpt-4o";
  try {
    const res = await litellm.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: systemPrompt,
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
    return JSON.parse(raw);
  } catch (err) {
    console.error("Vision LLM extraction failed:", err);
    return {};
  }
}
