import type { SavedLink, User } from "@deadlineai/db";
import { prisma } from "../lib/prisma";
import { litellm, extractWithLLM } from "../lib/llm";
import { scrapeUrl } from "../lib/firecrawl";
import { processExtractionFromUrl } from "./extraction-url";
import {
  formatCountdownHuman,
  formatDeadlineDisplay,
  parseDateFromUserText,
} from "./deadline-parse";
import { findLinkForQuery } from "./link-search";
import { normalizeTimezone } from "../lib/timezones";
import { clearPendingRemindersForLink } from "./reminders-smart";
import { rebuildRemindersForLink, setUserDailyReminderHour } from "./reminder-engine";
import { parseDailyReminderHour } from "../lib/daily-reminder-time";

export type TelegramAssistantReply = {
  text: string;
  reminderPickLinkId?: string;
};

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
      return `${idx + 1}. [id:${link.id.slice(0, 8)}] ${link.title} | ${deadlineText}`;
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

async function setManualDeadline(user: User, query: string, deadlineText: string) {
  const link = await findLinkForQuery(user.id, query);
  if (!link) {
    return {
      ok: false,
      message: `No tracked link matching "${query}". Use /list to see saved items.`,
    };
  }

  const parsed = await parseDateFromUserText(deadlineText, user.timezone);
  if (!parsed) {
    return {
      ok: false,
      message: 'Could not parse that date. Try "19 May 2026" or "2026-05-19 11:59 PM".',
    };
  }

  const prevMeta = ((link.metadata as Record<string, unknown>) || {}) as Record<string, unknown>;
  await clearPendingRemindersForLink(link.id);

  const updated = await prisma.savedLink.update({
    where: { id: link.id },
    data: {
      extractedDeadline: parsed,
      status: "active",
      metadata: { ...prevMeta, deadline_source: "manual" } as object,
    },
  });

  const schedule = await rebuildRemindersForLink(updated.id, "daily_all");

  const deadlineDisplay = formatDeadlineDisplay(parsed, user.timezone);
  const countdown = formatCountdownHuman(parsed);
  const isPast = countdown === "passed";

  const scheduleNote =
    "error" in schedule
      ? `Reminders: ${schedule.error}`
      : `${schedule.total} reminders scheduled (Telegram).`;

  return {
    ok: true,
    title: updated.title,
    url: updated.url,
    deadlineIso: parsed.toISOString(),
    deadlineDisplay,
    countdown,
    isPast,
    linkId: updated.id,
    needsReminderPick: false,
    message: isPast
      ? "Deadline saved but it has already passed — no reminders scheduled."
      : `Deadline saved. ${scheduleNote}`,
  };
}

async function clearManualDeadline(user: User, query: string) {
  const link = await findLinkForQuery(user.id, query);
  if (!link) {
    return { ok: false, message: `No tracked link matching "${query}".` };
  }

  await clearPendingRemindersForLink(link.id);
  await prisma.savedLink.update({
    where: { id: link.id },
    data: { extractedDeadline: null, status: "active" },
  });

  return { ok: true, title: link.title, message: "Deadline cleared for this link." };
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
      timezone:
        typeof extraction.timezone === "string" && extraction.timezone
          ? normalizeTimezone(extraction.timezone)
          : link.timezone,
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

  await clearPendingRemindersForLink(link.id);
  if (updated.extractedDeadline && updated.extractedDeadline.getTime() > Date.now()) {
    await rebuildRemindersForLink(updated.id);
  }

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

  if (name === "set_manual_deadline") {
    const query = typeof args.query === "string" ? args.query : "";
    const deadlineText = typeof args.deadline_text === "string" ? args.deadline_text : "";
    if (!query || !deadlineText) {
      return { ok: false, message: "Need link query and deadline_text." };
    }
    return await setManualDeadline(user, query, deadlineText);
  }

  if (name === "clear_manual_deadline") {
    const query = typeof args.query === "string" ? args.query : "";
    if (!query) return { ok: false, message: "Missing query." };
    return await clearManualDeadline(user, query);
  }

  if (name === "set_daily_reminder_hour") {
    const text = typeof args.time_text === "string" ? args.time_text : "";
    const hour = parseDailyReminderHour(text) ?? parseDailyReminderHour(String(args.hour ?? ""));
    if (hour === null) {
      return { ok: false, message: 'Say a time like "8 am" or "remind me at 9 PM".' };
    }
    await setUserDailyReminderHour(user.id, hour);
    return { ok: true, hour, message: `Daily reminders will use ${hour}:00 (24h) in your timezone.` };
  }

  return { ok: false, message: `Unknown tool: ${name}` };
}

export async function runTelegramAssistant(
  user: User,
  message: string
): Promise<TelegramAssistantReply | null> {
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
    {
      type: "function",
      function: {
        name: "set_manual_deadline",
        description:
          "Set or update the deadline for an existing tracked link using a user-provided date (not from crawling). Use when user says set/change/update deadline with a date. Match link by title keywords like YC grant, internshala, etc.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Keywords to find the tracked link (title fragment)",
            },
            deadline_text: {
              type: "string",
              description: "The date/time the user provided, e.g. 19 May 2026",
            },
          },
          required: ["query", "deadline_text"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "clear_manual_deadline",
        description: "Remove the deadline from a tracked link (keep the link saved)",
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
        name: "set_daily_reminder_hour",
        description:
          "Change the user's default daily reminder clock time (default 9 AM in their timezone). Use when they ask to remind at 8am, change morning reminder time, etc.",
        parameters: {
          type: "object",
          properties: {
            time_text: {
              type: "string",
              description: "Time phrase from user, e.g. 8 am, 9 PM",
            },
          },
          required: ["time_text"],
        },
      },
    },
  ];

  const messages: any[] = [
    {
      role: "system",
      content:
        "You are DeadlineAI Telegram assistant. You operate on the user's database of saved links — not regex rules. " +
        "Always use tools to read or change data. Never claim you can only use crawled page data. " +
        "When the user sets or changes a deadline with a date they provide, call set_manual_deadline (query = title keywords, deadline_text = their date). " +
        "Only call refresh_link_data when they explicitly ask to re-crawl or refresh from the website — not when they give a manual date. " +
        "When showing countdown, use ONLY the countdown field from tool results — never invent times. " +
        "If isPast is true, say the deadline has already passed. No markdown tables. " +
        "For listing links, tell them to use /list (interactive buttons). " +
        "For delete, use delete_link or suggest /list delete buttons. " +
        "Keep replies short (2-4 lines) in HTML-friendly plain text (no <tags> unless simple <b>).",
    },
    {
      role: "system",
      content:
        `User email: ${user.email}\nUser timezone: ${user.timezone}\n` +
        `Tracked links snapshot:\n${summarizeLinks(recentLinks as SavedLink[], user.timezone)}`,
    },
    { role: "user", content: message },
  ];

  let reminderPickLinkId: string | undefined;

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
      return {
        text:
          content ||
          "I can set deadlines, list your links (/list), delete items, and refresh pages when you ask.",
        reminderPickLinkId,
      };
    }

    for (const call of toolCalls) {
      const name = call.function?.name || "";
      const args = safeJsonParse(call.function?.arguments);
      const toolResult = await executeTool(user, name, args);

      const manualSet =
        name === "set_manual_deadline" &&
        toolResult &&
        typeof toolResult === "object" &&
        "ok" in toolResult &&
        (toolResult as { ok?: boolean }).ok;

      if (
        manualSet &&
        "needsReminderPick" in toolResult &&
        (toolResult as { needsReminderPick?: boolean }).needsReminderPick &&
        "linkId" in toolResult &&
        typeof (toolResult as { linkId?: string }).linkId === "string"
      ) {
        reminderPickLinkId = (toolResult as { linkId: string }).linkId;
      }

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(toolResult),
      });
    }
  }

  return {
    text: "I couldn't complete that right now. Try: Set deadline for YC grant 19 May 2026",
    reminderPickLinkId,
  };
}
