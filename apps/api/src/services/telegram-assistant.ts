import type { SavedLink, User } from "@deadlineai/db";
import { prisma } from "../lib/prisma";
import { litellm, extractWithLLM } from "../lib/llm";
import { scrapeUrl } from "../lib/firecrawl";
import { processExtractionFromUrl } from "./extraction-url";
import { scheduleSmartRemindersForLink } from "./reminders-smart";

type CountdownParts = {
  isPast: boolean;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  totalMinutes: number;
  totalSeconds: number;
};

function getCountdownParts(deadline: Date): CountdownParts {
  const diffMs = deadline.getTime() - Date.now();
  const isPast = diffMs < 0;
  const totalSeconds = Math.max(0, Math.floor(Math.abs(diffMs) / 1000));

  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);

  return { isPast, days, hours, minutes, seconds, totalMinutes, totalSeconds };
}

function formatCountdown(deadline: Date): string {
  const c = getCountdownParts(deadline);
  const suffix = c.isPast ? "ago" : "left";
  return `${c.days}d ${c.hours}h ${c.minutes}m ${c.seconds}s ${suffix} (total ${c.totalMinutes}m ${c.seconds}s)`;
}

function formatDeadlineDate(deadline: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZoneName: "short",
    }).format(deadline);
  } catch {
    return deadline.toISOString();
  }
}

function buildExtractionPrompt(title: string, content: string) {
  return `
You are DeadlineAI. Analyze this webpage content and extract deadline information.

Page Title: ${title}
Content: ${content.slice(0, 12000)}

Return JSON only:
{
  "title": "Event/Program name",
  "deadline": "2026-05-20T23:59:00",
  "timezone": "IST",
  "category": "hackathon|internship|grant|visa|contest|program",
  "urgency_score": 1-10,
  "confidence_score": 0.0-1.0,
  "rolling_application": false,
  "estimated_completion_minutes": 30
}
`.trim();
}

function parseDeadline(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function safeJsonParse(input: string | undefined): Record<string, unknown> {
  if (!input) return {};
  try {
    const parsed = JSON.parse(input);
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
  } catch {
    // ignore parse errors
  }
  return {};
}

function summarizeLinks(links: SavedLink[], timezone: string): string {
  if (!links.length) return "No saved links.";
  return links
    .map((link, idx) => {
      const deadline = link.extractedDeadline ? new Date(link.extractedDeadline) : null;
      const deadlineText = deadline
        ? `${formatDeadlineDate(deadline, timezone)} | ${formatCountdown(deadline)}`
        : "No deadline extracted";
      return `${idx + 1}. ${link.title} | ${link.url} | ${deadlineText}`;
    })
    .join("\n");
}

async function listDeadlines(user: User, limit = 10) {
  const links = await prisma.savedLink.findMany({
    where: { userId: user.id, status: { in: ["active", "pending"] } },
    orderBy: [{ extractedDeadline: "asc" }, { createdAt: "desc" }],
    take: Math.min(Math.max(limit, 1), 25),
  });

  return {
    count: links.length,
    deadlines: links.map((link) => {
      const deadline = link.extractedDeadline ? new Date(link.extractedDeadline) : null;
      return {
        title: link.title,
        url: link.url,
        category: link.category,
        deadlineIso: deadline ? deadline.toISOString() : null,
        deadlineDisplay: deadline ? formatDeadlineDate(deadline, user.timezone) : null,
        countdown: deadline ? formatCountdown(deadline) : null,
      };
    }),
  };
}

async function findLinkForQuery(userId: string, query: string) {
  const q = query.trim();
  if (!q) return null;

  const exactUrl = await prisma.savedLink.findFirst({
    where: { userId, url: q, status: { in: ["active", "pending"] } },
  });
  if (exactUrl) return exactUrl;

  const links = await prisma.savedLink.findMany({
    where: { userId, status: { in: ["active", "pending"] } },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });

  const lower = q.toLowerCase();
  return (
    links.find((l) => l.title.toLowerCase().includes(lower) || l.url.toLowerCase().includes(lower)) ||
    null
  );
}

async function deleteLinkForQuery(userId: string, query: string) {
  const link = await findLinkForQuery(userId, query);
  if (!link) return { ok: false, message: "No matching tracked link to delete." };
  await prisma.savedLink.delete({ where: { id: link.id } });
  return {
    ok: true,
    deleted: {
      id: link.id,
      title: link.title,
      url: link.url,
    },
  };
}

async function refreshExistingLink(user: User, link: SavedLink): Promise<SavedLink> {
  let content = "";
  let title = link.title || link.url;

  try {
    const scraped = await scrapeUrl(link.url);
    content = scraped.markdown || scraped.html || "";
    title = (scraped.metadata?.title as string) || title;
  } catch {
    // fallback below
  }

  if (!content || content.length < 100) {
    const res = await fetch(link.url, { headers: { "User-Agent": "Mozilla/5.0" } });
    const html = await res.text();
    content = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").slice(0, 15000);
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    if (titleMatch) title = titleMatch[1];
  }

  const extraction = await extractWithLLM(buildExtractionPrompt(title, content));
  const extractedDeadline = parseDeadline(extraction.deadline);
  const urgency = typeof extraction.urgency_score === "number" ? extraction.urgency_score : link.urgencyScore;
  const confidence = typeof extraction.confidence_score === "number" ? extraction.confidence_score : link.confidenceScore;
  const estMinutes =
    typeof extraction.estimated_completion_minutes === "number"
      ? extraction.estimated_completion_minutes
      : link.estimatedCompletionMinutes;

  const updated = await prisma.savedLink.update({
    where: { id: link.id },
    data: {
      title: (typeof extraction.title === "string" && extraction.title) ? extraction.title : title,
      rawContent: content || link.rawContent,
      extractedDeadline: extractedDeadline ?? link.extractedDeadline,
      timezone: (typeof extraction.timezone === "string" && extraction.timezone) ? extraction.timezone : link.timezone,
      category: (typeof extraction.category === "string" && extraction.category) ? extraction.category : link.category,
      urgencyScore: urgency,
      confidenceScore: confidence,
      rollingApplication:
        typeof extraction.rolling_application === "boolean"
          ? extraction.rolling_application
          : link.rollingApplication,
      estimatedCompletionMinutes: estMinutes,
      status: "active",
    },
  });

  await prisma.reminder.deleteMany({ where: { savedLinkId: link.id, sentStatus: "pending" } });
  await scheduleSmartRemindersForLink(updated as SavedLink);

  return updated as SavedLink;
}

async function executeTool(user: User, name: string, args: Record<string, unknown>) {
  if (name === "list_deadlines") {
    const limit = typeof args.limit === "number" ? args.limit : 10;
    return await listDeadlines(user, limit);
  }

  if (name === "get_deadline_details") {
    const query = typeof args.query === "string" ? args.query : "";
    const link = await findLinkForQuery(user.id, query);
    if (!link) return { found: false, message: "No matching tracked deadline found." };

    const deadline = link.extractedDeadline ? new Date(link.extractedDeadline) : null;
    return {
      found: true,
      title: link.title,
      url: link.url,
      category: link.category,
      deadlineIso: deadline ? deadline.toISOString() : null,
      deadlineDisplay: deadline ? formatDeadlineDate(deadline, user.timezone) : null,
      countdown: deadline ? formatCountdown(deadline) : null,
    };
  }

  if (name === "refresh_link_data") {
    const query = typeof args.query === "string" ? args.query : "";
    const url = typeof args.url === "string" ? args.url : "";
    const target = url || query;
    if (!target) return { ok: false, message: "Missing url/query." };

    const existing = await findLinkForQuery(user.id, target);
    if (!existing && url) {
      const created = await processExtractionFromUrl(url, user.id);
      if (!created) return { ok: false, message: "Could not crawl and extract this URL." };
      const deadline = created.extractedDeadline ? new Date(created.extractedDeadline) : null;
      return {
        ok: true,
        action: "created",
        title: created.title,
        url: created.url,
        deadlineDisplay: deadline ? formatDeadlineDate(deadline, user.timezone) : null,
        countdown: deadline ? formatCountdown(deadline) : null,
      };
    }

    if (!existing) return { ok: false, message: "No matching tracked link to refresh." };
    const updated = await refreshExistingLink(user, existing);
    const deadline = updated.extractedDeadline ? new Date(updated.extractedDeadline) : null;
    return {
      ok: true,
      action: "refreshed",
      title: updated.title,
      url: updated.url,
      deadlineDisplay: deadline ? formatDeadlineDate(deadline, user.timezone) : null,
      countdown: deadline ? formatCountdown(deadline) : null,
    };
  }

  if (name === "delete_link") {
    const query = typeof args.query === "string" ? args.query : "";
    if (!query) return { ok: false, message: "Missing query." };
    return await deleteLinkForQuery(user.id, query);
  }

  return { ok: false, message: `Unknown tool: ${name}` };
}

export async function runTelegramAssistant(user: User, message: string): Promise<string | null> {
  const model = process.env.LITELLM_TOOL_MODEL || process.env.LITELLM_MODEL || "gpt-4o-mini";
  const recentLinks = await prisma.savedLink.findMany({
    where: { userId: user.id, status: { in: ["active", "pending"] } },
    orderBy: [{ extractedDeadline: "asc" }, { updatedAt: "desc" }],
    take: 12,
  });

  const tools: any[] = [
    {
      type: "function",
      function: {
        name: "list_deadlines",
        description: "List all tracked deadlines for this user with exact countdown",
        parameters: {
          type: "object",
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 25 },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_deadline_details",
        description: "Get exact deadline details for one tracked link by title or URL keyword",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "refresh_link_data",
        description: "Re-crawl and refresh extracted deadline data using Firecrawl for an existing tracked link or URL",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string" },
            query: { type: "string" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "delete_link",
        description: "Delete a tracked link/deadline by title keyword or URL",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
          },
          required: ["query"],
        },
      },
    },
  ];

  const messages: any[] = [
    {
      role: "system",
      content:
        "You are DeadlineAI Telegram assistant. Always answer user questions directly. " +
        "Use tools whenever deadlines or crawling are relevant. " +
        "When showing countdown, always use exact format: Xd Yh Zm Ws left, and include total minutes+seconds in parentheses. " +
        "If user asks 'all things I have' or similar, call list_deadlines. " +
        "If user asks to remove/delete a tracked item, call delete_link.",
    },
    {
      role: "system",
      content:
        `User email: ${user.email}\nUser timezone: ${user.timezone}\n` +
        `Tracked links snapshot:\n${summarizeLinks(recentLinks as SavedLink[], user.timezone)}`,
    },
    { role: "user", content: message },
  ];

  for (let i = 0; i < 5; i++) {
    const res: any = await litellm.chat.completions.create({
      model,
      messages,
      temperature: 0.2,
      tools,
      tool_choice: "auto",
    });

    const choice = res.choices?.[0]?.message;
    if (!choice) return null;
    messages.push(choice);

    const toolCalls = choice.tool_calls as
      | Array<{ id: string; function?: { name?: string; arguments?: string } }>
      | undefined;

    if (!toolCalls || toolCalls.length === 0) {
      const content = typeof choice.content === "string" ? choice.content.trim() : "";
      return content || "I can help with deadline countdowns, listing your links, and refreshing site data.";
    }

    for (const call of toolCalls) {
      const name = call.function?.name || "";
      const args = safeJsonParse(call.function?.arguments);
      const toolResult = await executeTool(user, name, args);

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(toolResult),
      });
    }
  }

  return "I couldn't complete that right now. Try asking with a specific link title or URL.";
}
