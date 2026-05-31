import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(__dirname, "../apps/api/.env") });

async function test() {
  const apiKey = process.env.FIRECRAWL_API_KEY || "";
  
  const testUrl = "https://airtable.com/appasC90KmqZ5x1t5/pag6tvR9VUG4Kf1iM/form";
  console.log("Scraping with auto proxy and waitFor:", testUrl);
  
  const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      url: testUrl,
      formats: ["markdown"],
      waitFor: 3000,
    }),
  });

  console.log("Response Status:", res.status);
  const data = await res.json();
  if (data.success) {
    console.log("Scrape success! Markdown length:", data.data?.markdown?.length || 0);
    console.log("Content preview:", data.data?.markdown?.slice(0, 1500));
  } else {
    console.log("Scrape failed:", JSON.stringify(data));
  }
}

test().catch(console.error);
