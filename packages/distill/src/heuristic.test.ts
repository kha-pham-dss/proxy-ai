import { describe, expect, it } from "vitest";
import type { LtmProfile } from "@proxy-cli/proto";
import { heuristicDistill } from "./heuristic.js";

const empty: LtmProfile = {
  stacks: [],
  style: [],
  projects: [],
  facts: [],
  habits: [],
  meta: { updated_at: "2026-07-13T00:00:00.000Z", version: 1 },
};

describe("heuristicDistill", () => {
  it("extracts stack keywords and preserves habits", () => {
    const habits = [
      {
        id: "habit.no-invented-apis",
        label: "No invented APIs",
        enabled: true,
        inject_text: "Do not invent APIs",
        seed: true,
      },
    ];
    const result = heuristicDistill(
      { ...empty, habits },
      [
        {
          role: "user",
          content: "We use TypeScript and NestJS with PostgreSQL in this service.",
          at: "2026-07-13T00:00:00.000Z",
        },
      ],
    );
    expect(result.stacks).toEqual(expect.arrayContaining(["TypeScript", "NestJS", "PostgreSQL"]));
    expect(result.habits).toEqual(habits);
  });
});
