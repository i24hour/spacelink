/**
 * Lightweight self-test for focus-context (run: npx tsx src/services/focus-context.selftest.ts)
 */
import {
  buildFocusBehaviorContext,
  computeEscalationLevel,
  computeOffTrackStreak,
  computeProductiveStreakBeforeSlip,
  fallbackIntervention,
  isTooSimilarToLast,
  type FocusCheckHistoryItem,
} from "./focus-context";

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

function check(
  classification: string,
  capturedAt: Date,
  opts?: Partial<FocusCheckHistoryItem>
): FocusCheckHistoryItem {
  return {
    classification,
    observedActivity: opts?.observedActivity ?? "scrolling",
    suggestion: opts?.suggestion ?? null,
    capturedAt,
    telegramSentAt: opts?.telegramSentAt ?? null,
  };
}

function main() {
  const now = new Date("2026-07-27T12:00:00.000Z");
  const minsAgo = (m: number) => new Date(now.getTime() - m * 60_000);

  assert(computeEscalationLevel(1, 5) === 0, "first check → L0");
  assert(computeEscalationLevel(2, 5) === 1, "2 checks → L1");
  assert(computeEscalationLevel(1, 10) === 1, "10 min → L1");
  assert(computeEscalationLevel(4, 5) === 2, "4 checks → L2");
  assert(computeEscalationLevel(1, 20) === 2, "20 min → L2");
  assert(computeEscalationLevel(6, 5) === 3, "6 checks → L3");
  assert(computeEscalationLevel(1, 30) === 3, "30 min → L3");

  const streakHistory = [
    check("off_track", minsAgo(0)),
    check("off_track", minsAgo(5)),
    check("off_track", minsAgo(10)),
    check("productive", minsAgo(20)),
    check("off_track", minsAgo(30)),
  ];
  assert(computeOffTrackStreak(streakHistory) === 3, "streak stops at productive");

  const unclearBreaks = [
    check("off_track", minsAgo(0)),
    check("unclear", minsAgo(5)),
    check("off_track", minsAgo(10)),
  ];
  assert(computeOffTrackStreak(unclearBreaks) === 1, "unclear breaks streak");

  const history = [
    check("off_track", minsAgo(5), {
      suggestion: "Close Instagram and open your notes.",
      telegramSentAt: minsAgo(5),
    }),
    check("off_track", minsAgo(10), {
      suggestion: "Get back to studying.",
      telegramSentAt: minsAgo(10),
    }),
  ];

  const pastOnly = buildFocusBehaviorContext({
    historyNewestFirst: history,
    intervalMins: 5,
    now,
    assumeCurrentOffTrack: false,
  });
  assert(pastOnly.offTrackStreak === 2, "past streak is 2");
  assert(pastOnly.projectedOffTrackStreak === 2, "no project without assume");
  assert(pastOnly.nudgesIgnored === 2, "two nudges in streak");

  const projected = buildFocusBehaviorContext({
    historyNewestFirst: history,
    intervalMins: 5,
    now,
    assumeCurrentOffTrack: true,
  });
  assert(projected.projectedOffTrackStreak === 3, "projected streak +1");
  assert(projected.escalationLevel === 1, "3 checks → at least L1");
  assert(projected.projectedMinutesOffTrack >= 10, "minutes include elapsed streak");
  assert(projected.lastInterventions[0]?.includes("Instagram"), "keeps last nudge text");

  const empty = buildFocusBehaviorContext({
    historyNewestFirst: [],
    intervalMins: 60,
    now,
    assumeCurrentOffTrack: true,
  });
  assert(empty.projectedOffTrackStreak === 1, "first check projects to 1");
  assert(empty.escalationLevel === 0, "first check L0");

  // Productive block then first slip
  const afterClean = [
    check("productive", minsAgo(5), { observedActivity: "Cursor IDE" }),
    check("productive", minsAgo(10), { observedActivity: "Cursor IDE" }),
    check("productive", minsAgo(15), { observedActivity: "Cursor IDE" }),
  ];
  assert(computeProductiveStreakBeforeSlip(afterClean, 0) === 3, "3 productive before first slip");
  const slipCtx = buildFocusBehaviorContext({
    historyNewestFirst: afterClean,
    intervalMins: 5,
    now,
    assumeCurrentOffTrack: true,
  });
  assert(slipCtx.productiveStreakBeforeSlip === 3, "context keeps productive streak");
  assert(slipCtx.productiveMinutesBeforeSlip >= 15, "≈15+ clean minutes");
  assert(slipCtx.escalationLevel === 0, "first slip still L0 — strong, not soft");

  // Off-track run after productive block
  const slipAfter = [
    check("off_track", minsAgo(0)),
    check("productive", minsAgo(5)),
    check("productive", minsAgo(10)),
    check("productive", minsAgo(15)),
  ];
  assert(computeProductiveStreakBeforeSlip(slipAfter, 1) === 3, "skip 1 off_track then count productive");

  const dayHistory = [
    check("productive", minsAgo(60)),
    check("productive", minsAgo(120)),
    // yesterday (~30h ago from noon UTC Jul 27 → Jul 26)
    check("productive", new Date("2026-07-26T10:00:00.000Z")),
    check("productive", new Date("2026-07-26T11:00:00.000Z")),
    check("productive", new Date("2026-07-26T12:00:00.000Z")),
    check("productive", new Date("2026-07-26T13:00:00.000Z")),
  ];
  const withDays = buildFocusBehaviorContext({
    historyNewestFirst: slipAfter,
    dayHistoryNewestFirst: dayHistory,
    intervalMins: 60,
    now,
    assumeCurrentOffTrack: true,
  });
  assert(withDays.productiveMinutesYesterday >= 180, "yesterday productive minutes counted");

  const fallback = fallbackIntervention({
    goal: "Finish thesis",
    level: 2,
    projectedStreak: 4,
    projectedMinutes: 22,
    nudgesIgnored: 2,
    userAge: 22,
  });
  assert(fallback.includes("Finish thesis"), "fallback names goal");
  assert(fallback.includes("4"), "fallback mentions streak");
  assert(
    /Jobs|Musk|Escobar|Eminem|Jordan|MJ/i.test(fallback),
    "L2 fallback blends an execution legend"
  );

  const credited = fallbackIntervention({
    goal: "Cursor/Codex",
    level: 0,
    projectedStreak: 1,
    projectedMinutes: 1,
    nudgesIgnored: 0,
    productiveStreakBeforeSlip: 3,
    productiveMinutesBeforeSlip: 15,
    productiveMinutesYesterday: 240,
  });
  assert(/clean minute|solid check|Yesterday/i.test(credited), "fallback credits prior work");
  assert(/Close this distraction|return to the work/i.test(credited), "fallback keeps strong push");
  assert(!/sorry|it's okay|no worries/i.test(credited), "no soft apology language");

  assert(
    isTooSimilarToLast(
      "Close Instagram and open your notes right now please friend",
      ["Close Instagram and open your notes right now please friend"]
    ),
    "exact duplicate detected"
  );
  assert(
    !isTooSimilarToLast("Different short nudge.", ["Close Instagram and open your notes."]),
    "short different text ok"
  );

  console.log("focus-context.selftest: all passed");
}

main();
