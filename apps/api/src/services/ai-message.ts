import { SavedLink, User } from "@prisma/client";
import { litellm } from "../lib/llm";

export async function generateReminderMessage(
  link: SavedLink,
  user: User,
  minutesUntilDeadline: number
) {
  const model = process.env.LITELLM_MODEL || "gpt-4o";

  const daysAgo = Math.floor(
    (Date.now() - link.createdAt.getTime()) / (1000 * 60 * 60 * 24)
  );

  const prompt = `
You are DeadlineAI, a smart and concise reminder assistant.

Context:
- Opportunity: ${link.title}
- Category: ${link.category || "opportunity"}
- Deadline: ${link.extractedDeadline?.toISOString() || "unknown"}
- Timezone: ${link.timezone || user.timezone}
- Estimated completion: ${link.estimatedCompletionMinutes || "?"} minutes
- User saved this ${daysAgo} days ago.
- Time until deadline: about ${Math.max(0, Math.round(minutesUntilDeadline / 60))} hours.

Write a short, intelligent, human-like reminder message (max 2 sentences). Be motivating. Do not be robotic.
`.trim();

  const res = await litellm.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content:
          "You write smart, context-aware deadline reminders. Keep it very short and actionable.",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.6,
    max_tokens: 120,
  });

  return (
    res.choices[0]?.message?.content?.trim() ||
    `Reminder: ${link.title} deadline is coming up.`
  );
}
