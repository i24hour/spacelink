import type { SavedLink } from "@deadlineai/db";
import { prisma } from "../lib/prisma";

function scoreLinkMatch(link: SavedLink, query: string): number {
  const title = link.title.toLowerCase();
  const url = link.url.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) return 0;

  if (title.includes(q) || url.includes(q)) return 100 + q.length;

  const tokens = q.split(/\s+/).filter((t) => t.length > 1);
  if (tokens.length === 0) return 0;

  const matched = tokens.filter((t) => title.includes(t) || url.includes(t)).length;
  if (matched === tokens.length) return 60 + matched * 10;
  if (matched > 0) return 30 + matched * 5;
  return 0;
}

/** Find a user's tracked link by title/url keywords (fuzzy token match). */
export async function findLinkForQuery(userId: string, query: string) {
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

  let best: SavedLink | null = null;
  let bestScore = 0;
  for (const link of links) {
    const score = scoreLinkMatch(link, q);
    if (score > bestScore) {
      bestScore = score;
      best = link;
    }
  }

  return bestScore >= 30 ? best : null;
}
