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

export type WebSearchResult = {
  url: string;
  title?: string;
  description?: string;
};

function parseFirecrawlSearchResponse(json: any): WebSearchResult[] {
  const list = Array.isArray(json?.data) ? json.data : Array.isArray(json?.results) ? json.results : [];
  const out: WebSearchResult[] = [];
  for (const item of list) {
    const url = typeof item?.url === "string" ? item.url : typeof item?.link === "string" ? item.link : null;
    if (!url) continue;
    out.push({
      url,
      title: typeof item?.title === "string" ? item.title : undefined,
      description:
        typeof item?.description === "string"
          ? item.description
          : typeof item?.snippet === "string"
          ? item.snippet
          : undefined,
    });
  }
  return out;
}

async function searchWithFirecrawl(query: string, limit: number): Promise<WebSearchResult[]> {
  const apiKey = process.env.FIRECRAWL_API_KEY || "";
  if (!apiKey) return [];

  const res = await fetch("https://api.firecrawl.dev/v1/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      limit,
    }),
  });

  if (!res.ok) return [];
  const json = await res.json().catch(() => ({}));
  return parseFirecrawlSearchResponse(json);
}

function decodeDuckDuckGoResultHref(rawHref: string): string | null {
  try {
    if (rawHref.startsWith("//")) return `https:${rawHref}`;
    if (rawHref.startsWith("/l/?")) {
      const u = new URL(`https://duckduckgo.com${rawHref}`);
      const encoded = u.searchParams.get("uddg");
      if (encoded) return decodeURIComponent(encoded);
      return null;
    }
    if (/^https?:\/\//i.test(rawHref)) return rawHref;
    return null;
  } catch {
    return null;
  }
}

async function searchWithDuckDuckGo(query: string, limit: number): Promise<WebSearchResult[]> {
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!res.ok) return [];
  const html = await res.text();

  const results: WebSearchResult[] = [];
  const regex = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/gi;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(html)) !== null && results.length < limit) {
    const href = match[1];
    const titleHtml = match[2] || "";
    const parsedUrl = decodeDuckDuckGoResultHref(href);
    if (!parsedUrl) continue;
    const title = titleHtml.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    results.push({ url: parsedUrl, title });
  }

  return results;
}

export async function searchWeb(query: string, limit = 5): Promise<WebSearchResult[]> {
  try {
    const firecrawlResults = await searchWithFirecrawl(query, limit);
    if (firecrawlResults.length) return firecrawlResults.slice(0, limit);
  } catch {
    // fall through
  }

  try {
    const ddgResults = await searchWithDuckDuckGo(query, limit);
    return ddgResults.slice(0, limit);
  } catch {
    return [];
  }
}
