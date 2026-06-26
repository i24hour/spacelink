import { prisma } from "../lib/prisma";
import type { InlineKeyboard } from "./notifications/telegram";
import { clearPendingRemindersForLink } from "./reminders-smart";

export function buildReminderDoneKeyboard(linkId: string): InlineKeyboard {
  return {
    inline_keyboard: [[{ text: "✅ Done — I submitted", callback_data: `done:${linkId}` }]],
  };
}

export function parseLinkDoneCallback(data: string): string | null {
  if (!data.startsWith("done:")) return null;
  const linkId = data.slice(5).trim();
  return linkId || null;
}

export async function markLinkCompleted(linkId: string, userId: string) {
  const link = await prisma.savedLink.findFirst({
    where: { id: linkId, userId },
  });
  if (!link) return null;
  if (link.status === "completed") return link;

  await clearPendingRemindersForLink(linkId);

  const prevMeta = ((link.metadata as Record<string, unknown>) || {}) as Record<string, unknown>;

  return prisma.savedLink.update({
    where: { id: linkId },
    data: {
      status: "completed",
      metadata: {
        ...prevMeta,
        completed_at: new Date().toISOString(),
      } as object,
    },
  });
}
