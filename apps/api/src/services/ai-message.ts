import { SavedLink, User } from "@prisma/client";
import { litellm } from "../lib/llm";

export async function generateReminderMessage(
  link: SavedLink,
  user: User,
  minutesUntilDeadline: number,
  reminderType: string
): Promise<string> {
  const model = process.env.LITELLM_MODEL || "DeepSeek-V4-Pro";
  const daysAgo = Math.floor((Date.now() - link.createdAt.getTime()) / (1000 * 60 * 60 * 24));

  let systemPrompt = "";
  let userPrompt = "";

  if (reminderType === "daily_countdown") {
    const daysLeft = Math.ceil(minutesUntilDeadline / (60 * 24));
    systemPrompt = "You write friendly, motivating daily countdown reminders. Keep it very short (2 sentences max). Emoji allowed.";
    userPrompt = `
Deadline: ${link.title}
Category: ${link.category || "opportunity"}
Days remaining: ${daysLeft}
Estimated time: ${link.estimatedCompletionMinutes || "?"} minutes

Write a short daily countdown reminder. Mention how many days left and motivate them to act.
`.trim();
  } else if (reminderType === "hourly_urgent") {
    const hoursLeft = Math.ceil(minutesUntilDeadline / 60);
    systemPrompt = "You write urgent but not annoying hourly reminders. Very short (1-2 sentences). Emphasize urgency but stay encouraging.";
    userPrompt = `
Deadline: ${link.title}
Hours remaining: ${hoursLeft}
Estimated time: ${link.estimatedCompletionMinutes || "?"} minutes

Write an urgent hourly reminder. Very short, actionable.
`.trim();
  } else if (reminderType === "final_hour") {
    systemPrompt = "You write final call reminders. Short, punchy, high urgency.";
    userPrompt = `
Deadline: ${link.title}
Less than 1 hour remaining!

Write a final urgent reminder.
`.trim();
  } else {
    // Default pre-deadline
    systemPrompt = "You write smart, context-aware deadline reminders. Keep it very short and actionable.";
    userPrompt = `
Deadline: ${link.title}
Category: ${link.category || "opportunity"}
Time until: about ${Math.max(0, Math.round(minutesUntilDeadline / 60))} hours
Estimated completion: ${link.estimatedCompletionMinutes || "?"} minutes
Saved ${daysAgo} days ago.

Write a short, intelligent reminder message.
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
    return res.choices[0]?.message?.content?.trim() || `Reminder: ${link.title} deadline is coming up.`;
  } catch {
    // Fallback messages if LLM fails
    const daysLeft = Math.ceil(minutesUntilDeadline / (60 * 24));
    if (reminderType === "daily_countdown") return `📅 ${link.title} — ${daysLeft} days left. Don't miss it!`;
    if (reminderType === "hourly_urgent") return `⏰ ${link.title} — Only ${Math.ceil(minutesUntilDeadline / 60)} hours left!`;
    if (reminderType === "final_hour") return `🔥 FINAL CALL: ${link.title} expires in less than 1 hour!`;
    return `Reminder: ${link.title} deadline is coming up.`;
  }
}
