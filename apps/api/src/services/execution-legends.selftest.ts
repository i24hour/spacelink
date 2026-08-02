/**
 * Lightweight self-test for execution-legends
 * Run: npx tsx src/services/execution-legends.selftest.ts
 */
import {
  EXECUTION_LEGENDS,
  fillForceLine,
  formatExecutionLegendForPrompt,
  legendFallbackLine,
  milestonesNearAge,
  resolveFocusUserAge,
  selectExecutionLegend,
} from "./execution-legends";

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

function main() {
  assert(EXECUTION_LEGENDS.length >= 5, "expected seed legends");
  for (const legend of EXECUTION_LEGENDS) {
    assert(legend.traits.length >= 3, `${legend.id} needs traits`);
    assert(legend.executionMoves.length >= 3, `${legend.id} needs execution moves`);
    assert(legend.ageMilestones.length >= 2, `${legend.id} needs age milestones`);
    assert(legend.withoutHardWork.length > 20, `${legend.id} needs withoutHardWork`);
    assert(legend.forceLines.length >= 2, `${legend.id} needs force lines`);
  }

  const a = selectExecutionLegend({
    projectedStreak: 4,
    goal: "building in cursor and codex",
  });
  const b = selectExecutionLegend({
    projectedStreak: 5,
    goal: "building in cursor and codex",
    lastInterventions: [`${a.name} says get back`],
  });
  assert(a.id, "selected legend has id");
  assert(b.id, "second select has id");
  // Prefer not repeating the same first-name if pool allows
  assert(b.name !== a.name || EXECUTION_LEGENDS.length === 1, "rotation avoids last name when possible");

  const near = milestonesNearAge(a, 22);
  assert(near.length > 0, "near-age milestones");
  assert(near[0]!.age >= 18 && near[0]!.age <= 35, "near-age in young band");

  const block = formatExecutionLegendForPrompt(a, 22, "Cursor/Codex");
  assert(block.includes(a.name), "prompt names legend");
  assert(block.includes("user_age=22"), "prompt includes age");
  assert(block.includes("without_hard_work"), "prompt includes counterfactual");
  assert(/NOT a hero|work rate|LEGAL/i.test(block), "prompt frames non-idol remap");

  const line = legendFallbackLine({
    legend: a,
    goal: "Cursor/Codex",
    age: 22,
    projectedStreak: 4,
  });
  assert(line.includes("Cursor/Codex") || line.includes("22"), "fallback filled vars");
  assert(!/kill someone|sell drugs|commit crime/i.test(line), "no crime instruction");

  assert(
    fillForceLine("x {goal} y {age}", { goal: "Ship", age: 22 }) === "x Ship y 22",
    "fillForceLine"
  );
  assert(resolveFocusUserAge("22") === 22, "age parse");
  assert(resolveFocusUserAge("bad") === 22, "age fallback");

  const escobar = EXECUTION_LEGENDS.find((l) => l.id === "pablo_escobar");
  assert(escobar, "escobar profile present");
  assert(/legal/i.test(escobar!.peakProof + escobar!.forceLines.join(" ")), "escobar remapped to legal");

  console.log("execution-legends.selftest: all passed");
}

main();
