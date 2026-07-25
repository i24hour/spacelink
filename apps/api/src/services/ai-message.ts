import type { SavedLink, User } from "@deadlineai/db";
import { litellm } from "../lib/llm";
import { normalizeTimezone } from "../lib/timezones";

export type ReminderMessagePayload = {
  text: string;
  html: string;
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDeadlineLabel(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: normalizeTimezone(timezone),
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZoneName: "short",
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

function timeLeftLabel(minutesUntil: number): string {
  const totalMinutes = Math.max(0, Math.ceil(minutesUntil));
  const hours = Math.ceil(totalMinutes / 60);
  const days = Math.ceil(totalMinutes / (60 * 24));
  if (hours <= 48) return `${hours}h left`;
  return `${days}d left`;
}

function wrapReminderBody(
  link: SavedLink,
  user: User,
  minutesUntil: number,
  body: string
): ReminderMessagePayload {
  const title = link.title.trim() || "Untitled opportunity";
  const left = timeLeftLabel(minutesUntil);
  const deadlineLine = link.extractedDeadline
    ? formatDeadlineLabel(new Date(link.extractedDeadline), user.timezone)
    : "Deadline TBD";
  const category = link.category ? ` · ${link.category}` : "";
  const url = link.url.trim();

  const headerText =
    `⏰ ${title}${category}\n` +
    `📅 ${deadlineLine} · ${left}\n` +
    `🔗 ${url}\n`;

  const headerHtml =
    `⏰ <b>${escapeHtml(title)}</b>${escapeHtml(category)}\n` +
    `📅 ${escapeHtml(deadlineLine)} · ${escapeHtml(left)}\n` +
    `🔗 <a href="${escapeHtml(url)}">Open form / apply here</a>\n`;

  const cleanBody = body.trim();
  return {
    text: cleanBody ? `${headerText}\n${cleanBody}` : headerText.trimEnd(),
    html: cleanBody
      ? `${headerHtml}\n${escapeHtml(cleanBody)}`
      : headerHtml.trimEnd(),
  };
}

async function generateReminderBody(
  link: SavedLink,
  minutesUntilDeadline: number,
  reminderType: string
): Promise<string> {
  const model =
    process.env.BEDROCK_MODEL ||
    process.env.LITELLM_MODEL ||
    "moonshotai.kimi-k2.5";
  const daysAgo = Math.floor((Date.now() - link.createdAt.getTime()) / (1000 * 60 * 60 * 24));

  let systemPrompt = "";
  let userPrompt = "";

  if (reminderType === "daily_countdown") {
    const daysLeft = Math.ceil(minutesUntilDeadline / (60 * 24));
    systemPrompt =
      "You write friendly, motivating daily countdown reminders. Keep it very short (1-2 sentences). Emoji allowed. Do NOT include URLs or repeat the title — the app adds those.";
    userPrompt = `
Opportunity: ${link.title}
Category: ${link.category || "opportunity"}
Days remaining: ${daysLeft}
Estimated time: ${link.estimatedCompletionMinutes || "?"} minutes

Write a short motivational nudge about acting on this specific opportunity.
`.trim();
  } else if (reminderType === "hourly_urgent") {
    const hoursLeft = Math.ceil(minutesUntilDeadline / 60);
    systemPrompt =
      "You write urgent but not annoying hourly reminders. Very short (1-2 sentences). Stay encouraging. Do NOT include URLs or repeat the title.";
    userPrompt = `
Opportunity: ${link.title}
Hours remaining: ${hoursLeft}
Estimated time: ${link.estimatedCompletionMinutes || "?"} minutes

Write a short urgent nudge for this opportunity.
`.trim();
  } else if (reminderType === "final_hour") {
    systemPrompt =
      "You write final call reminders. Short, punchy, high urgency. Do NOT include URLs or repeat the title.";
    userPrompt = `
Opportunity: ${link.title}
Less than 1 hour remaining!

Write a final urgent nudge.
`.trim();
  } else {
    systemPrompt =
      "You write smart, context-aware deadline reminders. Keep it very short and actionable. Do NOT include URLs or repeat the title.";
    userPrompt = `
Opportunity: ${link.title}
Category: ${link.category || "opportunity"}
Time until: about ${Math.max(0, Math.round(minutesUntilDeadline / 60))} hours
Estimated completion: ${link.estimatedCompletionMinutes || "?"} minutes
Saved ${daysAgo} days ago.

Write a short reminder nudge.
`.trim();
  }

  try {
    const res = await litellm.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 80,
    });
    return (
      res.choices[0]?.message?.content?.trim() ||
      fallbackReminderBody(link, minutesUntilDeadline, reminderType)
    );
  } catch {
    return fallbackReminderBody(link, minutesUntilDeadline, reminderType);
  }
}

function fallbackReminderBody(
  link: SavedLink,
  minutesUntilDeadline: number,
  reminderType: string
): string {
  const daysLeft = Math.ceil(minutesUntilDeadline / (60 * 24));
  const hoursLeft = Math.ceil(minutesUntilDeadline / 60);
  if (reminderType === "daily_countdown") {
    return `📅 ${daysLeft} days left — block time today to finish this application.`;
  }
  if (reminderType === "hourly_urgent") {
    return `⏰ Only ${hoursLeft} hours left — open the link above and submit.`;
  }
  if (reminderType === "final_hour") {
    return `🔥 Final hour — submit now if you haven't already.`;
  }
  return `Don't miss this deadline — open the link above and complete it.`;
}

export async function generateReminderMessage(
  link: SavedLink,
  user: User,
  minutesUntilDeadline: number,
  reminderType: string
): Promise<ReminderMessagePayload> {
  const body = await generateReminderBody(link, minutesUntilDeadline, reminderType);
  return wrapReminderBody(link, user, minutesUntilDeadline, body);
}
