import type { User } from "@deadlineai/db";
import { prisma } from "../lib/prisma";
import { chatWithLLM } from "../lib/llm";
import {
  buildFocusBehaviorContext,
  formatFocusContextForPrompt,
  type FocusCheckHistoryItem,
} from "./focus-context";

const RECENT_NUDGE_WINDOW_MS = 2 * 60 * 60 * 1000;

function looksLikeUrl(message: string): boolean {
  return /https?:\/\/\S+/i.test(message) || /\b[\w-]+\.(com|io|dev|app|ai|org|net)\b/i.test(message);
}

function looksLikeDeadlineAdmin(message: string): boolean {
  const lower = message.toLowerCase().trim();
  if (/^\/(list|help|status|start|stop|pause|resume)\b/.test(lower)) return true;
  if (/^(list|show|delete|remove)\s+(my\s+)?(links|deadlines|items)\b/.test(lower)) return true;
  if (/\b(set|change|update)\s+(the\s+)?deadline\b/.test(lower)) return true;
  if (/\b(remind|reminder)\b/.test(lower) && /\b(am|pm|o'?clock|daily)\b/.test(lower)) return true;
  return false;
}

/**
 * Prefer focus-coach replies when monitoring is active or a nudge was just sent.
 * Skip for clear link/deadline admin intents.
 */
export async function shouldUseFocusCoach(userId: string, message: string): Promise<boolean> {
  if (looksLikeUrl(message) || looksLikeDeadlineAdmin(message)) return false;

  const active = await prisma.monitoringSession.findFirst({
    where: { userId, status: "active" },
    select: { id: true },
  });
  if (active) return true;

  const since = new Date(Date.now() - RECENT_NUDGE_WINDOW_MS);
  const recentNudge = await prisma.screenCheck.findFirst({
    where: {
      telegramSentAt: { gte: since },
      classification: "off_track",
      session: { userId },
    },
    select: { id: true },
  });
  return Boolean(recentNudge);
}

export async function runTelegramFocusCoach(
  user: User,
  message: string
): Promise<{ text: string } | null> {
  const session =
    (await prisma.monitoringSession.findFirst({
      where: { userId: user.id, status: "active" },
      orderBy: { updatedAt: "desc" },
    })) ||
    (await prisma.monitoringSession.findFirst({
      where: {
        userId: user.id,
        OR: [
          { status: "paused" },
          {
            status: "stopped",
            stoppedAt: { gte: new Date(Date.now() - RECENT_NUDGE_WINDOW_MS) },
          },
        ],
      },
      orderBy: { updatedAt: "desc" },
    }));

  if (!session) return null;

  const recent = await prisma.screenCheck.findMany({
    where: { sessionId: session.id },
    orderBy: { capturedAt: "desc" },
    take: 24,
    select: {
      classification: true,
      observedActivity: true,
      suggestion: true,
      capturedAt: true,
      telegramSentAt: true,
      reason: true,
    },
  });

  const since = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const dayRows = await prisma.screenCheck.findMany({
    where: {
      capturedAt: { gte: since },
      classification: "productive",
      session: { userId: user.id },
    },
    orderBy: { capturedAt: "desc" },
    take: 200,
    select: {
      classification: true,
      observedActivity: true,
      suggestion: true,
      capturedAt: true,
      telegramSentAt: true,
    },
  });

  const history: FocusCheckHistoryItem[] = recent.map((item) => ({
    classification: item.classification,
    observedActivity: item.observedActivity,
    suggestion: item.suggestion,
    capturedAt: item.capturedAt,
    telegramSentAt: item.telegramSentAt,
  }));
  const dayHistory: FocusCheckHistoryItem[] = dayRows.map((item) => ({
    classification: item.classification,
    observedActivity: item.observedActivity,
    suggestion: item.suggestion,
    capturedAt: item.capturedAt,
    telegramSentAt: item.telegramSentAt,
  }));

  const behavior = buildFocusBehaviorContext({
    historyNewestFirst: history,
    dayHistoryNewestFirst: dayHistory,
    intervalMins: session.intervalMins,
    assumeCurrentOffTrack: history[0]?.classification === "off_track",
  });

  const lastNudge = recent.find((r) => r.telegramSentAt && r.suggestion)?.suggestion || null;
  const lastActivity = recent[0]?.observedActivity || null;
  const contextBlock = formatFocusContextForPrompt(session.goal, behavior);

  const system = `You are DeadlineAI's focus accountability coach on Telegram — the SAME coach that just sent Focus check nudges from phone screen monitoring.

Stay in character: tough, direct, English only. You already know their goal and distraction history. Continue the conversation; do not reset into a generic helpdesk.

Rules:
- Interpret casual typos and slang from the focus-nudge thread. Examples: "return hn" / "return honestly" / "y return" = pushing back on going back to work. Do NOT invent unrelated meanings (especially not Hacker News for "hn").
- Use the behavior context (off-track streak, productive streak before slip, today/yesterday productive minutes, prior nudges) to answer specifically.
- KEEP strong wording. Do not soften into gentle therapy language.
- If they had a recent productive streak or solid yesterday hours, briefly credit that as PROOF they can still lock in — then push them to continue that streak / get back now. Credit is not an excuse.
- Use the Execution reference when useful: juggle name + one trait, or an age milestone vs user_age, or the without_hard_work counterfactual — then force return to the goal. These are work-rate / execution examples, NOT heroes. Remap intensity to LEGAL building only. Never instruct crime or harm. Don't dump biographies — one sharp blend max per reply.
- Keep replies short (2–5 sentences). No markdown tables. Plain text is fine; light <b> HTML ok.
- Tough love is required. Still forbid threats, slurs, humiliation, or attacking identity — attack the distraction and wasted time only.
- If they ask to stop monitoring, tell them to use the Android Focus Monitor app (Pause/Stop), not Telegram commands.
- If they are clearly asking about saved deadlines/links instead of focus, say so briefly and tell them to ask again without the focus thread — but prefer answering as coach when ambiguous.
- Never invent screenshots you did not see; rely on the context provided.`;

  const userPrompt = `${contextBlock}

Monitoring session status: ${session.status}
Last observed activity: ${lastActivity || "(none)"}
Last Telegram nudge you sent: ${lastNudge || "(none)"}

User just replied in Telegram:
"""${message.trim()}"""

Reply as the focus coach continuing this thread.`;

  const text = await chatWithLLM({
    system,
    user: userPrompt,
    temperature: 0.6,
    kind: "default",
  });

  if (!text) {
    return {
      text:
        lastNudge ||
        `Your goal is still "${session.goal}". Close the distraction and get back to it — debating the nudge doesn't write the code.`,
    };
  }

  // Strip markdown fences if the model adds them; keep HTML-ish plain text.
  return { text: text.replace(/^```(?:html|markdown)?\s*|\s*```$/g, "").trim() };
}
