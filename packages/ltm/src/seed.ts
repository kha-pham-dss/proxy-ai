import type { HabitCheckbox } from "@proxy-cli/proto";

export const SEED_HABITS: HabitCheckbox[] = [
  {
    id: "habit.verify-before-claim",
    label: "Double-check before claiming done",
    enabled: false,
    inject_text:
      "Prefer verifying with tests/commands before claiming success.",
    seed: true,
  },
  {
    id: "habit.no-invented-apis",
    label: "Do not invent APIs / files",
    enabled: false,
    inject_text:
      "Do not invent files, APIs, or configs that are not in the repo.",
    seed: true,
  },
  {
    id: "habit.prefer-existing-patterns",
    label: "Prefer existing repo patterns",
    enabled: false,
    inject_text: "Follow existing project patterns over new abstractions.",
    seed: true,
  },
  {
    id: "habit.ask-destructive",
    label: "Ask before destructive ops",
    enabled: false,
    inject_text:
      "Ask before destructive git/ops (reset, force push, rm -rf).",
    seed: true,
  },
  {
    id: "habit.typecheck-tests",
    label: "Remind typecheck/tests",
    enabled: false,
    inject_text: "When changing code, run or suggest typecheck/tests.",
    seed: true,
  },
];
