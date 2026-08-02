/**
 * Execution-legend knowledge for focus coaching.
 * These are NOT idols/heroes — only obsession, execution speed, and work traits
 * to pressure the user into legal deep work (Cursor / shipping / problem-solving).
 * Crime/harm is never instructed; traits are remapped to building software.
 */

export type AgeMilestone = {
  age: number;
  feat: string;
};

export type ExecutionLegend = {
  id: string;
  name: string;
  /** What arena their intensity showed up in (neutral label). */
  arena: string;
  /** Proof-of-intensity outcome (one line). */
  peakProof: string;
  /** Concrete execution / obsession traits. */
  traits: string[];
  /** Specific behaviors / rituals / operating style. */
  executionMoves: string[];
  /** What they were doing around the user's age band. */
  ageMilestones: AgeMilestone[];
  /** Counterfactual: if they didn't grind / execute, what collapses. */
  withoutHardWork: string;
  /** Short fallback jabs (Telegram-safe). Use {goal}, {age}. */
  forceLines: string[];
};

/** Default focus-user age until we store per-user age in DB. */
export const DEFAULT_FOCUS_USER_AGE = 22;

export const EXECUTION_LEGENDS: ExecutionLegend[] = [
  {
    id: "steve_jobs",
    name: "Steve Jobs",
    arena: "product obsession / shipping taste",
    peakProof:
      "Built and rebuilt companies by refusing half-done products; Apple's comeback was taste + ruthless focus on a few bets.",
    traits: [
      "obsessive product standards — mediocre was treated as failure",
      "extreme focus: kill most ideas, finish the few that matter",
      "iteration under pressure — demos, deadlines, ship cycles",
      "owned the details end-to-end (UX, messaging, hardware feel)",
    ],
    executionMoves: [
      "cut scope until the core felt inevitable",
      "forced clarity: if you can't explain it simply, it's not done",
      "used urgency as a default operating mode, not a mood",
      "returned to the workbench after setbacks instead of coping with distraction",
    ],
    ageMilestones: [
      { age: 21, feat: "co-founded Apple — already building, selling, shipping hardware/software" },
      { age: 25, feat: "Apple was scaling; he was deep in product + company execution, not 'someday'" },
      { age: 30, feat: "forced out of Apple — then started NeXT / Pixar path instead of quitting intensity" },
    ],
    withoutHardWork:
      "No finished products, no company that survives taste tests, no comeback — talent without shipping is a footnote.",
    forceLines: [
      "Jobs at ~{age} was already shipping real product, not bingeing. Your goal: {goal}. Open the work screen.",
      "Jobs killed weak ideas and finished the strong ones. You're killing time. Return to {goal}.",
      "Half-done didn't survive Jobs' bar. Close this. Ship the next concrete step on {goal}.",
    ],
  },
  {
    id: "elon_musk",
    name: "Elon Musk",
    arena: "multi-problem engineering intensity",
    peakProof:
      "Ran overlapping hard technical companies by living inside the bottleneck — factories, code reviews, launch cadence.",
    traits: [
      "stacks impossible problems and attacks the critical path daily",
      "sleeps next to the work when the timeline is on fire",
      "first-principles breakdown: delete steps, then accelerate what's left",
      "high throughput: many decisions per day, low tolerance for drift",
    ],
    executionMoves: [
      "identify the constraint, then sit on it until it moves",
      "compress timelines by removing bureaucracy and excuses",
      "measure progress in hardware/software output, not vibes",
      "treat distraction as schedule theft against the mission",
    ],
    ageMilestones: [
      { age: 22, feat: "already building Zip2 — coding/selling, not waiting for permission" },
      { age: 27, feat: "PayPal-era execution: shipping payments infrastructure under competition" },
      { age: 30, feat: "pivoting capital into SpaceX/Tesla-scale bets — problem load goes nuclear" },
    ],
    withoutHardWork:
      "No rockets that land, no factories that scale — ideas stay slides. Intensity missing → timeline dies.",
    forceLines: [
      "Musk at {age} was already deep in building/shipping. You're {age} with {goal} open and this distraction winning. Close it.",
      "Musk attacks the bottleneck. Your bottleneck is you leaving {goal}. Get back.",
      "If Musk skipped the hard hours, nothing launched. Same rule: {goal} needs reps now.",
    ],
  },
  {
    id: "pablo_escobar",
    name: "Pablo Escobar",
    arena: "relentless operational scale (traits only — remap to legal building)",
    peakProof:
      "Scaled an operation to world-level wealth/power through extreme speed, logistics obsession, and refusal to lose — proof of intensity, NOT a model for crime. We steal the work rate for legal shipping only.",
    traits: [
      "obsessive operational tempo — move faster than opponents can react",
      "scale mindset: systems, people, routes, cashflow — not vibes",
      "extreme ownership of results; excuses were worthless",
      "relentless expansion: every day compounds territory / throughput",
    ],
    executionMoves: [
      "decide fast, execute same day, iterate tomorrow",
      "build distribution before comfort",
      "treat every idle hour as a rival getting ahead",
      "keep pressure on the mission until the number moves",
    ],
    ageMilestones: [
      { age: 22, feat: "already deep in grinding street-level operations — full-time intensity, not casual effort" },
      { age: 26, feat: "scaling networks hard; wealth compounding from relentless execution cadence" },
      { age: 33, feat: "peak empire scale — outcome of years of non-stop operational grind" },
    ],
    withoutHardWork:
      "No empire, no scale, no 8–9 figure outcomes — without obsessive execution he stays small and forgettable. Intensity was the engine; we point that engine at legal product work only.",
    forceLines: [
      "Escobar's edge was insane execution speed — used for crime; you're using the same edge for {goal}. Idle = you lose. Close this.",
      "At ~{age} he was already all-in on the grind. You're {age}. {goal} needs that same all-in hour. Open the work screen.",
      "Scale comes from daily ops, not Netflix. Steal the tempo, not the crime. Back to {goal}.",
    ],
  },
  {
    id: "eminem",
    name: "Eminem",
    arena: "skill obsession / craft under pressure",
    peakProof:
      "Turned raw drive into elite craft — endless writing, battle reps, studio hours until the skill was undeniable.",
    traits: [
      "volume of practice: write, rewrite, freestyle, stack hours",
      "competitiveness: treat every session like you're behind",
      "precision under pressure — technical skill from reps, not luck",
      "used hunger as fuel; refused to stay average",
    ],
    executionMoves: [
      "put in unseen hours before the public moment",
      "study the greats, then outwork them on craft",
      "turn anger/urgency into finished verses (finished output)",
      "protect practice time like survival",
    ],
    ageMilestones: [
      { age: 22, feat: "grinding battles/tapes — still hungry, still unknown to most, still working" },
      { age: 27, feat: "The Slim Shady LP era — years of craft finally compounding into a break" },
      { age: 29, feat: "global peak after a decade of obsessive writing/performing reps" },
    ],
    withoutHardWork:
      "No bars, no album, no career — talent without thousands of private reps stays a guy with opinions.",
    forceLines: [
      "Eminem earned skill in ugly private hours. You're skipping reps on {goal}. Close this and write/code the next bar.",
      "At {age} he was still grinding unknown. You're {age} — unknown is fine; quitting the session isn't. Back to {goal}.",
      "Craft > cope. Open {goal}. Do the next hard set.",
    ],
  },
  {
    id: "michael_jordan",
    name: "Michael Jordan",
    arena: "competitive standards / practice intensity",
    peakProof:
      "Six titles built on practice that was harder than games — standards so high teammates felt the pressure.",
    traits: [
      "practice harder than the game",
      "hate losing more than you like comfort",
      "hold yourself to a scoreboard every day",
      "show up when motivation is gone — especially then",
    ],
    executionMoves: [
      "extra reps after everyone else left",
      "turn every mismatch into film + work",
      "compete in small drills like they decide the season",
      "recover, then attack tomorrow's session",
    ],
    ageMilestones: [
      { age: 21, feat: "NBA rookie — already elite work habits under pro pressure" },
      { age: 23, feat: "MVP track forming; skill from years of brutal practice standards" },
      { age: 28, feat: "first three-peat era — peak of competitive obsession + execution" },
    ],
    withoutHardWork:
      "No dynasties — athleticism without obsessive practice becomes a highlight reel that fades.",
    forceLines: [
      "MJ practiced harder than he played. You're 'resting' mid-mission on {goal}. Get back on the court — the work screen.",
      "At ~{age} MJ was already pro-intensity. You're {age}. Treat {goal} like game day. Close this.",
      "Winners don't negotiate with the couch. Open {goal}. Next rep now.",
    ],
  },
];

export function getExecutionLegendById(id: string): ExecutionLegend | undefined {
  return EXECUTION_LEGENDS.find((l) => l.id === id);
}

/** Stable-ish rotation so consecutive checks don't always repeat the same name. */
export function selectExecutionLegend(input: {
  projectedStreak: number;
  goal: string;
  lastInterventions?: string[];
}): ExecutionLegend {
  const list = EXECUTION_LEGENDS;
  if (list.length === 0) {
    throw new Error("EXECUTION_LEGENDS is empty");
  }

  // Prefer a legend not named in the last intervention.
  const last = (input.lastInterventions?.[0] || "").toLowerCase();
  const unused = list.filter((l) => !last.includes(l.name.toLowerCase().split(" ")[0]!));
  const pool = unused.length > 0 ? unused : list;

  const seed =
    Math.max(0, input.projectedStreak) * 17 +
    Array.from(input.goal).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return pool[Math.abs(seed) % pool.length]!;
}

export function milestonesNearAge(legend: ExecutionLegend, age: number): AgeMilestone[] {
  const sorted = [...legend.ageMilestones].sort(
    (a, b) => Math.abs(a.age - age) - Math.abs(b.age - age)
  );
  return sorted.slice(0, 2);
}

export function formatExecutionLegendForPrompt(
  legend: ExecutionLegend,
  age: number,
  goal: string
): string {
  const near = milestonesNearAge(legend, age);
  const milestoneLines =
    near.length === 0
      ? "- (none)"
      : near.map((m) => `- age ${m.age}: ${m.feat}`).join("\n");

  return `Execution reference (NOT a hero/idol — extract WORK RATE + EXECUTION only; remap to legal building on the user's goal):
- name: ${legend.name}
- arena: ${legend.arena}
- peak_proof: ${legend.peakProof}
- traits: ${legend.traits.join("; ")}
- execution_moves: ${legend.executionMoves.join("; ")}
- age_milestones_near_user (user_age=${age}):
${milestoneLines}
- without_hard_work: ${legend.withoutHardWork}
- user_goal_to_force: ${goal}
- blend_rules: juggle 1 name + 1 trait OR 1 age milestone OR the without_hard_work counterfactual into the intervention; always end by ordering return to the goal; never instruct crime/harm; never soft-therapy.`;
}

export function fillForceLine(
  template: string,
  vars: { goal: string; age: number }
): string {
  return template
    .replaceAll("{goal}", vars.goal.trim() || "your goal")
    .replaceAll("{age}", String(vars.age));
}

/** Deterministic short jab for fallbacks when LLM suggestion is missing. */
export function legendFallbackLine(input: {
  legend: ExecutionLegend;
  goal: string;
  age: number;
  projectedStreak: number;
}): string {
  const idx = Math.abs(input.projectedStreak) % input.legend.forceLines.length;
  return fillForceLine(input.legend.forceLines[idx]!, {
    goal: input.goal,
    age: input.age,
  });
}

export function resolveFocusUserAge(envAge?: string | undefined): number {
  const raw = envAge ?? process.env.FOCUS_USER_AGE;
  const n = raw ? Number(raw) : DEFAULT_FOCUS_USER_AGE;
  if (!Number.isFinite(n) || n < 14 || n > 80) return DEFAULT_FOCUS_USER_AGE;
  return Math.round(n);
}
