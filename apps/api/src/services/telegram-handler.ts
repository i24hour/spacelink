import { prisma } from "../lib/prisma";
import { sendTelegramRaw } from "../services/notifications/telegram";
import { processExtractionFromUrl } from "./extraction-url";

// Detect if text is a URL
function isUrl(text: string): boolean {
  return /^https?:\/\/\S+/i.test(text.trim());
}

// Detect if text contains a URL
function extractUrl(text: string): string | null {
  const match = text.trim().match(/(https?:\/\/\S+)/i);
  return match ? match[1] : null;
}

export async function handleTelegramMessage(chatId: string, text: string) {
  const cmd = text.trim().toLowerCase();

  // /start deep-link auth
  if (cmd.startsWith("/start")) {
    const token = cmd.split(" ")[1];
    if (token) {
      const { consumeTelegramLinkToken } = await import("../lib/auth");
      const userId = consumeTelegramLinkToken(token);
      if (userId) {
        await prisma.user.update({
          where: { id: userId },
          data: {
            telegramId: chatId,
            preferredChannels: { set: ["telegram"] },
          },
        });
        await sendTelegramRaw(
          chatId,
          "🎉 Connected! Now you can paste any link here and I'll track deadlines for you.\n\n<b>Commands:</b>\n/deadlines - See upcoming\n/help - Show all commands",
          "HTML"
        );
        return;
      }
      await sendTelegramRaw(chatId, "That link expired. Open the extension and click Connect Telegram again.", "HTML");
      return;
    }

    await sendTelegramRaw(
      chatId,
      "👋 <b>DeadlineAI Bot</b>\n\nPaste any opportunity link here (hackathon, internship, grant, etc.) and I'll track the deadline for you.\n\n<b>Commands:</b>\n/deadlines - Upcoming deadlines\n/help - All commands",
      "HTML"
    );
    return;
  }

  // /deadlines
  if (cmd === "/deadlines") {
    const user = await prisma.user.findFirst({ where: { telegramId: chatId } });
    if (!user) {
      await sendTelegramRaw(chatId, "You need to sign in first. Visit https://web-i24hours-projects.vercel.app/auth", "HTML");
      return;
    }
    const links = await prisma.savedLink.findMany({
      where: { userId: user.id, status: { in: ["active", "pending"] } },
      orderBy: { extractedDeadline: "asc" },
      take: 15,
    });

    if (links.length === 0) {
      await sendTelegramRaw(chatId, "No deadlines tracked yet. Paste a link here or save via the browser extension!", "HTML");
      return;
    }

    const lines = links.map((l, i) => {
      const date = l.extractedDeadline ? new Date(l.extractedDeadline).toLocaleDateString() : "TBD";
      const daysLeft = l.extractedDeadline
        ? Math.ceil((new Date(l.extractedDeadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        : null;
      const timeLeft = daysLeft != null && daysLeft >= 0 ? `${daysLeft}d left` : daysLeft != null ? `${Math.abs(daysLeft)}d ago` : "";
      return `${i + 1}. <b>${l.title}</b>\n   📅 ${date}${timeLeft ? ` · ${timeLeft}` : ""}${l.category ? ` · ${l.category}` : ""}${l.urgencyScore && l.urgencyScore >= 7 ? " 🔥" : ""}`;
    });

    await sendTelegramRaw(chatId, `<b>Your upcoming deadlines</b>\n\n${lines.join("\n\n")}`, "HTML");
    return;
  }

  // /help
  if (cmd === "/help") {
    await sendTelegramRaw(
      chatId,
      "<b>DeadlineAI Bot</b>\n\nJust paste any link and I'll extract the deadline, track it, and remind you.\n\n<b>Commands:</b>\n/start - Connect account\n/deadlines - Show upcoming\n/help - This message\n\n<b>Reminders:</b>\n📊 Daily countdown until deadline\n⏰ Hourly alerts when 1 day left\n🤖 AI-powered smart messages",
      "HTML"
    );
    return;
  }

  // URL detection - user pasted a link
  const url = extractUrl(text);
  if (url) {
    // Check if user exists
    const user = await prisma.user.findFirst({ where: { telegramId: chatId } });
    if (!user) {
      await sendTelegramRaw(
        chatId,
        "You need to sign in first.\n\n1️⃣ Visit https://web-i24hours-projects.vercel.app/auth\n2️⃣ Sign in with Google\n3️⃣ Click 'Connect Telegram'\n\nThen paste links here!",
        "HTML"
      );
      return;
    }

    // Check for duplicates
    const existing = await prisma.savedLink.findFirst({
      where: { userId: user.id, url },
    });
    if (existing) {
      const date = existing.extractedDeadline ? new Date(existing.extractedDeadline).toLocaleDateString() : "TBD";
      await sendTelegramRaw(chatId, `⚠️ Already tracking this link!\n\n<b>${existing.title}</b>\n📅 ${date}\n\nUse /deadlines to see all.`, "HTML");
      return;
    }

    await sendTelegramRaw(chatId, "🔄 Reading the page and extracting deadline info...", "HTML");

    try {
      const result = await processExtractionFromUrl(url, user.id);
      if (!result) {
        await sendTelegramRaw(chatId, "❌ Couldn't extract a deadline from this page. You can try saving it via the browser extension for better results.", "HTML");
        return;
      }

      const date = result.extractedDeadline ? new Date(result.extractedDeadline).toLocaleDateString() : "TBD";
      const daysLeft = result.extractedDeadline
        ? Math.ceil((new Date(result.extractedDeadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        : null;

      await sendTelegramRaw(
        chatId,
        `✅ <b>Deadline tracked!</b>\n\n<b>${result.title}</b>\n📅 ${date}${daysLeft != null ? ` · ${daysLeft}d left` : ""}${result.category ? `\n🏷 ${result.category}` : ""}${result.estimatedCompletionMinutes ? `\n⏱ ~${result.estimatedCompletionMinutes} min to complete` : ""}\n\nI'll send you daily countdowns and hourly alerts when the deadline is near.`,
        "HTML"
      );
    } catch (e: any) {
      console.error("Telegram URL processing error:", e);
      await sendTelegramRaw(chatId, "❌ Error processing that link. Please try again or use the browser extension.", "HTML");
    }
    return;
  }

  // Unknown message
  await sendTelegramRaw(
    chatId,
    "I didn't understand that.\n\n👉 <b>Paste a link</b> to track a deadline\n👉 Use <b>/deadlines</b> to see upcoming deadlines\n👉 Use <b>/help</b> for all commands",
    "HTML"
  );
}
