import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(__dirname, "../apps/api/.env") });

import { extractWithLLM } from "../apps/api/src/lib/llm";

async function test() {
  console.log("LITELLM_PROXY_URL:", process.env.LITELLM_PROXY_URL || "MISSING");
  console.log("LITELLM_API_KEY:", process.env.LITELLM_API_KEY || "MISSING");
  console.log("LITELLM_MODEL:", process.env.LITELLM_MODEL || "MISSING");
  
  try {
    const result = await extractWithLLM("Test prompt: extract deadline for YC Summer Grants 2026. Page Title: YC Summer Grants 2026. Content: Deadline is 20th May 2026.");
    console.log("LLM result:", JSON.stringify(result));
  } catch (err: any) {
    console.error("LLM call failed:", err);
  }
}

test().catch(console.error);
