import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(__dirname, "../apps/api/.env") });

import { extractWithLLM, getLlmConfigSummary } from "../apps/api/src/lib/llm";

async function test() {
  console.log("LLM config:", getLlmConfigSummary());

  try {
    const result = await extractWithLLM(
      "Test prompt: extract deadline for YC Summer Grants 2026. Page Title: YC Summer Grants 2026. Content: Deadline is 20th May 2026. Return JSON with title and deadline fields."
    );
    console.log("LLM result:", JSON.stringify(result, null, 2));
  } catch (err: unknown) {
    console.error("LLM call failed:", err);
  }
}

test().catch(console.error);
