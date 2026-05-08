export async function scrapeUrl(url: string) {
  const apiKey = process.env.FIRECRAWL_API_KEY || "";
  const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      url,
      formats: ["markdown", "html"],
    }),
  });

  if (!res.ok) {
    throw new Error(`Firecrawl error: ${res.status}`);
  }

  const data = (await res.json()) as {
    data?: {
      markdown?: string;
      html?: string;
      metadata?: Record<string, unknown>;
    };
  };

  return {
    markdown: data.data?.markdown || "",
    html: data.data?.html || "",
    metadata: data.data?.metadata || {},
  };
}
