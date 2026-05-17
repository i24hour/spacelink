import { prisma } from "../lib/prisma";
import { sendTelegramRaw } from "../services/notifications/telegram";
import { processExtractionFromUrl } from "./extraction-url";

// Detect if text is a URL (with or without protocol)
function isUrl(text: string): boolean {
  return /^(https?:\/\/)?([\w-]+\.)+[\w-]+(\/\S*)?$/i.test(text.trim());
}

// Detect if text contains a URL (with or without protocol)
function extractUrl(text: string): string | null {
  const trimmed = text.trim();
  // Matches https://domain.com or domain.com/path
  const match = trimmed.match(/(https?:\/\/\S+)|(\b[\w-]+\.[\w-]+(?:\/\S*)?\b)/i);
  if (!match) return null;
  const url = match[1] || match[2];
  if (!url) return null;
  // Add https:// if missing
  if (!/^https?:\/\//i.test(url)) {
    return `https://${url}`;
  }
  return url;
}

export async function handleTelegramMessage(chatId: string, text: string) {
  const raw = text.trim();
  const cmd = raw.toLowerCase();
  const linkedUser = await prisma.user.findFirst({ where: { telegramId: chatId } });
  const webAppUrl = process.env.WEB_APP_URL || "https://web-i24hours-projects.vercel.app";

  async function connectThisChatUrl(): Promise<string> {
    const { createTelegramChatLinkToken } = await import("../lib/auth.js");
    const token = createTelegramChatLinkToken(chatId);
    return `${webAppUrl}/auth?tgLink=${encodeURIComponent(token)}`;
  }

  // /start deep-link auth
  if (cmd.startsWith("/start")) {
    const token = raw.split(/\s+/)[1];
    if (token) {
      const { consumeTelegramLinkToken } = await import("../lib/auth.js");
      const userId = consumeTelegramLinkToken(token);
      if (userId) {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
          await sendTelegramRaw(chatId, "That link is no longer valid. Please generate a new connect link.", "HTML");
          return;
        }

        const preferredChannels = user.preferredChannels.includes("telegram")
          ? user.preferredChannels
          : [...user.preferredChannels, "telegram"];

        await prisma.user.update({
          where: { id: userId },
          data: {
            telegramId: chatId,
            preferredChannels: { set: preferredChannels },
          },
        });
        await sendTelegramRaw(
          chatId,
          "🎉 <b>You're connected!</b>\n\nNow just paste any link here (e.g. istocks.codes) and I'll:\n• Extract the deadline with AI\n• Track it for you\n• Send daily countdowns\n• Alert you every hour when it's urgent\n\n<b>Commands:</b>\n/deadlines - See your deadlines\n/help - All commands",
          "HTML"
        );
        return;
      }
      await sendTelegramRaw(chatId, "That link expired. Open the extension and click Connect Telegram again.", "HTML");
      return;
    }

    if (linkedUser) {
      await sendTelegramRaw(
        chatId,
        "✅ <b>You are connected.</b>\n\nYour account is already linked. Paste any opportunity link and I'll track it.\n\n<b>Quick commands:</b>\n/status - Connection status\n/deadlines - Upcoming deadlines\n/help - All commands",
        "HTML"
      );
      return;
    }

    await sendTelegramRaw(
      chatId,
      `👋 <b>Welcome to DeadlineAI!</b>\n\nI track deadlines from any link you paste — hackathons, internships, grants, programs, and more.\n\n<b>Get started:</b>\n1️⃣ <a href="${await connectThisChatUrl()}">Sign in with Google (connect this chat)</a>\n2️⃣ Come back here and paste any link\n3️⃣ I'll extract the deadline and remind you daily\n\n<b>Commands:</b>\n/status - Connection status\n/deadlines - Your upcoming deadlines\n/help - All commands\n\nJust paste a link to start!`,
      "HTML"
    );
    return;
  }

  // /status
  if (cmd === "/status") {
    if (linkedUser) {
      await sendTelegramRaw(
        chatId,
        `✅ <b>Connected</b>\n\nLogged in as: <code>${linkedUser.email}</code>\n\nPaste any link to track deadlines.`,
        "HTML"
      );
      return;
    }
    await sendTelegramRaw(
      chatId,
      `❌ <b>Not connected</b>\n\n<a href="${await connectThisChatUrl()}">Sign in with Google and connect this Telegram chat</a>`,
      "HTML"
    );
    return;
  }

  // /deadlines
  if (cmd === "/deadlines") {
    const user = linkedUser;
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
      "<b>DeadlineAI Bot</b>\n\nTrack deadlines from any opportunity link.\n\n<b>Get started:</b>\n<a href=\"https://web-i24hours-projects.vercel.app/auth\">👉 Sign in with Google</a>\n\n<b>How it works:</b>\n1️⃣ Sign in above\n2️⃣ Paste any link here (e.g. istocks.codes)\n3️⃣ AI extracts the deadline\n4️⃣ Get daily countdowns + hourly alerts when urgent\n\n<b>Commands:</b>\n/deadlines - Your upcoming deadlines\n/help - This message",
      "HTML"
    );
    return;
  }

  // URL detection - user pasted a link
  const url = extractUrl(text);
  if (url) {
    // Check if user exists
    const user = linkedUser;
    if (!user) {
      await sendTelegramRaw(
        chatId,
        `🔐 <b>Please sign in first</b>\n\n<a href="${await connectThisChatUrl()}">👉 Sign in with Google and connect this Telegram chat</a>\n\nThen come back and paste your link!`,
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
  if (linkedUser) {
    await sendTelegramRaw(
      chatId,
      "✅ You're connected.\n\n👉 Paste a link (like istocks.codes) and I'll track the deadline\n👉 Use /deadlines to see your deadlines\n👉 Use /status to verify connection",
      "HTML"
    );
    return;
  }

  await sendTelegramRaw(
    chatId,
    `I didn't understand that.\n\n👉 <b>Paste a link</b> (like istocks.codes) to track a deadline\n👉 <a href="${await connectThisChatUrl()}">Sign in with Google and connect this chat</a>\n👉 Use <b>/status</b> to check connection\n👉 Use <b>/help</b> for all commands`,
    "HTML"
  );
}
