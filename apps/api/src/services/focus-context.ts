/**
 * Builds psychological / behavioral context for focus-check interventions.
 * Uses prior ScreenCheck rows (no raw screenshots) to escalate accountability
 * while still crediting recent productive streaks so the user knows they can recover.
 */

export type FocusCheckHistoryItem = {
  classification: string;
  observedActivity: string | null;
  suggestion: string | null;
  capturedAt: Date;
  telegramSentAt: Date | null;
};

export type FocusBehaviorContext = {
  offTrackStreak: number;
  /** Includes the upcoming check if it continues the streak (streak + 1). */
  projectedOffTrackStreak: number;
  minutesOffTrack: number;
  /** Minutes if the current check is also off_track, using now as end. */
  projectedMinutesOffTrack: number;
  /** Consecutive productive checks immediately before the current off-track run. */
  productiveStreakBeforeSlip: number;
  /** Approx minutes of that productive block. */
  productiveMinutesBeforeSlip: number;
  /** Rough productive minutes today (from provided day history). */
  productiveMinutesToday: number;
  /** Rough productive minutes yesterday (from provided day history). */
  productiveMinutesYesterday: number;
  nudgesIgnored: number;
  lastInterventions: string[];
  escalationLevel: 0 | 1 | 2 | 3;
  recentPattern: string;
  intervalMins: number;
};

function isOffTrack(classification: string): boolean {
  return classification === "off_track";
}

function isProductive(classification: string): boolean {
  return classification === "productive";
}

/** Streak breaks on productive; unclear/sensitive also break harsh streak (v1). */
function breaksStreak(classification: string): boolean {
  return classification !== "off_track";
}

/**
 * History must be newest-first (as returned by Prisma orderBy capturedAt desc).
 */
export function computeOffTrackStreak(historyNewestFirst: FocusCheckHistoryItem[]): number {
  let streak = 0;
  for (const item of historyNewestFirst) {
    if (isOffTrack(item.classification)) {
      streak += 1;
      continue;
    }
    if (breaksStreak(item.classification)) break;
  }
  return streak;
}

/**
 * Count consecutive productive checks sitting right before the current off-track run.
 * `offTrackStreak` is how many leading off_track rows to skip.
 */
export function computeProductiveStreakBeforeSlip(
  historyNewestFirst: FocusCheckHistoryItem[],
  offTrackStreak: number
): number {
  let streak = 0;
  for (let i = Math.max(0, offTrackStreak); i < historyNewestFirst.length; i++) {
    if (isProductive(historyNewestFirst[i].classification)) {
      streak += 1;
      continue;
    }
    break;
  }
  return streak;
}

export function computeEscalationLevel(
  projectedStreak: number,
  projectedMinutes: number
): 0 | 1 | 2 | 3 {
  if (projectedStreak >= 6 || projectedMinutes >= 30) return 3;
  if (projectedStreak >= 4 || projectedMinutes >= 20) return 2;
  if (projectedStreak >= 2 || projectedMinutes >= 10) return 1;
  return 0;
}

function minutesBetween(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.max(1, Math.round(ms / 60_000));
}

/**
 * Minutes from the oldest check in the current off_track streak to `end`.
 * Falls back to streak * intervalMins when timestamps are missing/equal.
 */
export function computeMinutesOffTrack(
  historyNewestFirst: FocusCheckHistoryItem[],
  streak: number,
  end: Date,
  intervalMins: number
): number {
  if (streak <= 0) return 0;
  const streakItems = historyNewestFirst.slice(0, streak);
  const oldest = streakItems[streakItems.length - 1];
  if (!oldest) return 0;
  const fromTimestamps = minutesBetween(oldest.capturedAt, end);
  if (fromTimestamps > 0) return fromTimestamps;
  // Same-instant / missing gaps: estimate from gaps between checks, not a full interval per check.
  const gaps = Math.max(0, streak - 1);
  return Math.max(1, gaps * Math.max(1, intervalMins));
}

/** Estimate continuous minutes covered by a newest-first streak slice. */
export function estimateStreakMinutes(
  streakItemsNewestFirst: FocusCheckHistoryItem[],
  intervalMins: number
): number {
  const streak = streakItemsNewestFirst.length;
  if (streak <= 0) return 0;
  const interval = Math.max(1, intervalMins);
  if (streak === 1) return interval;
  const newest = streakItemsNewestFirst[0];
  const oldest = streakItemsNewestFirst[streak - 1];
  const span = minutesBetween(oldest.capturedAt, newest.capturedAt);
  // Prefer real span + one interval; never under-count vs check count * interval.
  return Math.max(span + interval, streak * interval);
}

export function computeProductiveMinutesInRange(
  historyNewestFirst: FocusCheckHistoryItem[],
  start: Date,
  end: Date,
  intervalMins: number
): number {
  const interval = Math.max(1, intervalMins);
  let count = 0;
  for (const item of historyNewestFirst) {
    if (!isProductive(item.classification)) continue;
    if (item.capturedAt >= start && item.capturedAt < end) count += 1;
  }
  return count * interval;
}

export function collectLastInterventions(
  historyNewestFirst: FocusCheckHistoryItem[],
  limit = 5
): string[] {
  const out: string[] = [];
  for (const item of historyNewestFirst) {
    if (!item.telegramSentAt) continue;
    const text = item.suggestion?.trim();
    if (!text) continue;
    out.push(text.slice(0, 240));
    if (out.length >= limit) break;
  }
  return out;
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function buildFocusBehaviorContext(input: {
  historyNewestFirst: FocusCheckHistoryItem[];
  intervalMins: number;
  now?: Date;
  /** When true, treat the in-progress check as another off_track for projected stats. */
  assumeCurrentOffTrack?: boolean;
  /**
   * Broader history (e.g. last 48h across sessions) for today/yesterday productive totals.
   * Falls back to session history when omitted.
   */
  dayHistoryNewestFirst?: FocusCheckHistoryItem[];
}): FocusBehaviorContext {
  const now = input.now ?? new Date();
  const intervalMins = Math.max(1, input.intervalMins || 60);
  const history = input.historyNewestFirst;
  const dayHistory = input.dayHistoryNewestFirst ?? history;
  const offTrackStreak = computeOffTrackStreak(history);
  const projectedOffTrackStreak = input.assumeCurrentOffTrack
    ? offTrackStreak + 1
    : offTrackStreak;

  const minutesOffTrack = computeMinutesOffTrack(history, offTrackStreak, now, intervalMins);
  // Elapsed time to `now` already covers "if still off-track right now".
  // First off-track in a session → ~1 minute, not a full interval.
  const projectedMinutesOffTrack = input.assumeCurrentOffTrack
    ? offTrackStreak === 0
      ? 1
      : Math.max(1, minutesOffTrack)
    : minutesOffTrack;

  // When projecting the current check as off_track, skip the existing off-track run
  // (or 0 if this is the first slip) to find the productive block they just broke.
  const productiveSkip = input.assumeCurrentOffTrack ? offTrackStreak : offTrackStreak;
  const productiveStreakBeforeSlip = computeProductiveStreakBeforeSlip(history, productiveSkip);
  const productiveBlock = history.slice(
    productiveSkip,
    productiveSkip + productiveStreakBeforeSlip
  );
  const productiveMinutesBeforeSlip = estimateStreakMinutes(productiveBlock, intervalMins);

  const todayStart = startOfUtcDay(now);
  const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
  const productiveMinutesToday = computeProductiveMinutesInRange(
    dayHistory,
    todayStart,
    new Date(todayStart.getTime() + 24 * 60 * 60 * 1000),
    intervalMins
  );
  const productiveMinutesYesterday = computeProductiveMinutesInRange(
    dayHistory,
    yesterdayStart,
    todayStart,
    intervalMins
  );

  const streakSlice = history.slice(0, offTrackStreak);
  const nudgesIgnored = streakSlice.filter((item) => Boolean(item.telegramSentAt)).length;
  const lastInterventions = collectLastInterventions(history, 5);
  const escalationLevel = input.assumeCurrentOffTrack
    ? computeEscalationLevel(projectedOffTrackStreak, projectedMinutesOffTrack)
    : computeEscalationLevel(Math.max(offTrackStreak, 1), Math.max(minutesOffTrack, 1));

  const recentPattern = history
    .slice(0, 8)
    .map((item) => {
      const activity = item.observedActivity?.trim() || "no details";
      const sent = item.telegramSentAt ? ", nudged" : "";
      return `${item.classification}: ${activity}${sent}`;
    })
    .join(" | ");

  return {
    offTrackStreak,
    projectedOffTrackStreak,
    minutesOffTrack,
    projectedMinutesOffTrack,
    productiveStreakBeforeSlip,
    productiveMinutesBeforeSlip,
    productiveMinutesToday,
    productiveMinutesYesterday,
    nudgesIgnored,
    lastInterventions,
    escalationLevel,
    recentPattern: recentPattern || "No previous checks",
    intervalMins,
  };
}

export function formatFocusContextForPrompt(
  goal: string,
  context: FocusBehaviorContext
): string {
  const interventions =
    context.lastInterventions.length === 0
      ? "- (none yet)"
      : context.lastInterventions.map((text, i) => `${i + 1}) ${text}`).join("\n");

  return `Goal: ${goal}
Behavior context (use this to personalize and escalate — keep wording strong):
- off_track_streak_so_far: ${context.offTrackStreak}
- projected_off_track_streak_if_still_distracted: ${context.projectedOffTrackStreak}
- minutes_likely_distracted_so_far: ${context.minutesOffTrack}
- projected_minutes_distracted: ${context.projectedMinutesOffTrack}
- productive_streak_checks_before_this_slip: ${context.productiveStreakBeforeSlip}
- productive_minutes_before_this_slip: ${context.productiveMinutesBeforeSlip}
- productive_minutes_today_approx: ${context.productiveMinutesToday}
- productive_minutes_yesterday_approx: ${context.productiveMinutesYesterday}
- nudges_already_sent_in_current_streak: ${context.nudgesIgnored}
- escalation_level: ${context.escalationLevel} (0=firm, 1=repeat, 2=time+nudges, 3=hardest allowed)
- check_interval_minutes: ${context.intervalMins}
- recent_pattern: ${context.recentPattern}
- last_telegram_interventions:
${interventions}`;
}

export function telegramHeadlineForLevel(level: 0 | 1 | 2 | 3): string {
  switch (level) {
    case 0:
      return "Focus check";
    case 1:
      return "Focus check — still off track";
    case 2:
      return "Focus check — streak";
    case 3:
      return "Focus check — long streak";
  }
}

function creditPrefix(input: {
  productiveStreakBeforeSlip: number;
  productiveMinutesBeforeSlip: number;
  productiveMinutesYesterday: number;
}): string {
  const parts: string[] = [];
  if (input.productiveStreakBeforeSlip >= 2 || input.productiveMinutesBeforeSlip >= 10) {
    parts.push(
      `You just banked ~${Math.max(input.productiveMinutesBeforeSlip, input.productiveStreakBeforeSlip)} clean minute(s) (${input.productiveStreakBeforeSlip} solid check(s)). That proves you can lock in`
    );
  }
  if (input.productiveMinutesYesterday >= 60) {
    const hours = Math.round((input.productiveMinutesYesterday / 60) * 10) / 10;
    parts.push(`Yesterday you put in ~${hours}h of focused checks`);
  }
  if (parts.length === 0) return "";
  return `${parts.join(". ")}. `;
}

export function fallbackIntervention(input: {
  goal: string;
  level: 0 | 1 | 2 | 3;
  projectedStreak: number;
  projectedMinutes: number;
  nudgesIgnored: number;
  productiveStreakBeforeSlip?: number;
  productiveMinutesBeforeSlip?: number;
  productiveMinutesYesterday?: number;
}): string {
  const goal = input.goal.trim() || "your goal";
  const streak = Math.max(1, input.projectedStreak);
  const mins = Math.max(input.projectedMinutes, streak);
  const credit = creditPrefix({
    productiveStreakBeforeSlip: input.productiveStreakBeforeSlip ?? 0,
    productiveMinutesBeforeSlip: input.productiveMinutesBeforeSlip ?? 0,
    productiveMinutesYesterday: input.productiveMinutesYesterday ?? 0,
  });

  let body = "";
  switch (input.level) {
    case 0:
      body = `You're off "${goal}". Close this distraction and return to the work you said matters.`;
      break;
    case 1:
      body = `Still off "${goal}" — check #${streak}. That's about ${mins} minutes drifting. Get back now.`;
      break;
    case 2:
      body = `${streak} checks in a row off "${goal}" (~${mins} min). You already got ${Math.max(1, input.nudgesIgnored)} nudge(s). Close this and open the work screen.`;
      break;
    case 3:
      body = `${streak}th off-track check on "${goal}" — roughly ${mins} minutes gone and ${input.nudgesIgnored} nudges ignored. Stop scrolling. Do the next concrete work step now.`;
      break;
  }

  if (!credit) return body;
  // Keep the push hard; credit is proof they can recover, not a softener.
  return `${credit}Don't break that streak — ${body.charAt(0).toLowerCase()}${body.slice(1)}`;
}

/** Avoid sending nearly identical interventions back-to-back. */
export function isTooSimilarToLast(suggestion: string, lastInterventions: string[]): boolean {
  const current = suggestion.trim().toLowerCase();
  if (!current || lastInterventions.length === 0) return false;
  const last = lastInterventions[0]?.trim().toLowerCase() || "";
  if (!last) return false;
  if (current === last) return true;
  const shared = current.split(/\s+/).filter((w) => w.length > 3 && last.includes(w)).length;
  return shared >= 8 && current.length > 40 && last.length > 40;
}
