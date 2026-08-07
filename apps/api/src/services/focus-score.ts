import { DateTime } from "luxon";
import { prisma } from "../lib/prisma";

const CONFIDENCE_THRESHOLD = 0.65;
const HISTORY_DAYS = 30;

type FocusCheckRow = {
  classification: string;
  confidence: number | null;
  capturedAt: Date;
};

export interface FocusScoreHistoryEntry {
  timestamp: string;
  score: number;
  bonusPoints: number;
}

export interface FocusScoreSummary {
  score: number;
  bonusPoints: number;
  history: FocusScoreHistoryEntry[];
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function scoreChecks(checks: FocusCheckRow[]): { score: number; bonusPoints: number } {
  const totalWeight = checks.reduce((sum, check) => sum + Number(check.confidence || 0), 0);
  const productiveWeight = checks.reduce(
    (sum, check) => sum + (check.classification === "productive" ? Number(check.confidence || 0) : 0),
    0
  );
  const score = totalWeight > 0 ? round((productiveWeight / totalWeight) * 100) : 0;
  return {
    score,
    bonusPoints: totalWeight > 0 ? Math.min(50, Math.round(score / 2)) : 0,
  };
}

export async function getFocusScoreSummary(userId: string, now = new Date()): Promise<FocusScoreSummary> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } });
  const timezone = user?.timezone || "UTC";
  const localNow = DateTime.fromJSDate(now).setZone(timezone);
  const localTodayStart = localNow.startOf("day");
  const todayStart = localTodayStart.toUTC().toJSDate();
  const historyStart = new Date(todayStart);
  historyStart.setUTCDate(historyStart.getUTCDate() - (HISTORY_DAYS - 1));

  const checks = await prisma.screenCheck.findMany({
    where: {
      capturedAt: { gte: historyStart, lte: now },
      classification: { in: ["productive", "off_track"] },
      confidence: { gte: CONFIDENCE_THRESHOLD },
      session: { userId },
    },
    orderBy: { capturedAt: "asc" },
    select: {
      classification: true,
      confidence: true,
      capturedAt: true,
    },
  });

  const byDay = new Map<string, FocusCheckRow[]>();
  for (const check of checks) {
    const day = DateTime.fromJSDate(check.capturedAt).setZone(timezone).toFormat("yyyy-MM-dd");
    const rows = byDay.get(day) || [];
    rows.push(check);
    byDay.set(day, rows);
  }

  const history: FocusScoreHistoryEntry[] = [];
  for (let index = 0; index < HISTORY_DAYS; index += 1) {
    const day = localTodayStart.minus({ days: HISTORY_DAYS - 1 - index });
    const dayKey = day.toFormat("yyyy-MM-dd");
    const timestamp = day.startOf("day").toUTC().toISO() || new Date().toISOString();
    const dayScore = scoreChecks(byDay.get(dayKey) || []);
    if ((byDay.get(dayKey) || []).length > 0 || dayKey === localTodayStart.toFormat("yyyy-MM-dd")) {
      history.push({ timestamp, ...dayScore });
    }
  }

  const current = scoreChecks(byDay.get(localTodayStart.toFormat("yyyy-MM-dd")) || []);
  return { ...current, history };
}
