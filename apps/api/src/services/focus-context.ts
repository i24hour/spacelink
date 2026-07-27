/**
 * Builds psychological / behavioral context for focus-check interventions.
 * Uses prior ScreenCheck rows (no raw screenshots) to escalate accountability.
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
  nudgesIgnored: number;
  lastInterventions: string[];
  escalationLevel: 0 | 1 | 2 | 3;
  recentPattern: string;
  intervalMins: number;
};

function isOffTrack(classification: string): boolean {
  return classification === "off_track";
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

export function buildFocusBehaviorContext(input: {
  historyNewestFirst: FocusCheckHistoryItem[];
  intervalMins: number;
  now?: Date;
  /** When true, treat the in-progress check as another off_track for projected stats. */
  assumeCurrentOffTrack?: boolean;
}): FocusBehaviorContext {
  const now = input.now ?? new Date();
  const intervalMins = Math.max(1, input.intervalMins || 60);
  const history = input.historyNewestFirst;
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
Behavior context (use this to personalize and escalate):
- off_track_streak_so_far: ${context.offTrackStreak}
- projected_off_track_streak_if_still_distracted: ${context.projectedOffTrackStreak}
- minutes_likely_distracted_so_far: ${context.minutesOffTrack}
- projected_minutes_distracted: ${context.projectedMinutesOffTrack}
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

export function fallbackIntervention(input: {
  goal: string;
  level: 0 | 1 | 2 | 3;
  projectedStreak: number;
  projectedMinutes: number;
  nudgesIgnored: number;
}): string {
  const goal = input.goal.trim() || "your goal";
  const streak = Math.max(1, input.projectedStreak);
  const mins = Math.max(input.projectedMinutes, streak);
  switch (input.level) {
    case 0:
      return `You're off "${goal}". Close this distraction and return to the work you said matters.`;
    case 1:
      return `Still off "${goal}" — check #${streak}. That's about ${mins} minutes drifting. Get back now.`;
    case 2:
      return `${streak} checks in a row off "${goal}" (~${mins} min). You already got ${Math.max(1, input.nudgesIgnored)} nudge(s). Close this and open the work screen.`;
    case 3:
      return `${streak}th off-track check on "${goal}" — roughly ${mins} minutes gone and ${input.nudgesIgnored} nudges ignored. Stop scrolling. Do the next concrete work step now.`;
  }
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
