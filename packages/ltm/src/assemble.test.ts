import { describe, expect, it } from "vitest";
import { LTM_MARKER_END, LTM_MARKER_START, type LtmProfile } from "@proxy-cli/proto";
import { assembleProfileText, extractLtmBlock } from "./assemble.js";

const sample: LtmProfile = {
  identity: { role: "fullstack engineer" },
  stacks: ["TypeScript", "NestJS"],
  style: ["Prefer small diffs"],
  projects: [{ name: "proxy-ai", stack: ["TypeScript"], notes: "local memory proxy" }],
  facts: [
    {
      id: "f1",
      text: "Uses pnpm workspaces",
      topic: "stack",
      updated_at: "2026-07-13T00:00:00.000Z",
    },
  ],
  habits: [
    {
      id: "habit.no-invented-apis",
      label: "No invented APIs",
      enabled: true,
      inject_text: "Do not invent files or APIs",
      seed: true,
    },
  ],
  meta: { updated_at: "2026-07-13T00:00:00.000Z", version: 1 },
};

describe("assembleProfileText", () => {
  it("wraps content with LTM markers", () => {
    const text = assembleProfileText(sample);
    expect(text.startsWith(LTM_MARKER_START)).toBe(true);
    expect(text.trimEnd().endsWith(LTM_MARKER_END)).toBe(true);
    expect(text).toContain("TypeScript");
    expect(text).toContain("Do not invent files or APIs");
    expect(extractLtmBlock(text)).not.toBeNull();
  });

  it("omits disabled habits", () => {
    const text = assembleProfileText({
      ...sample,
      habits: sample.habits.map((h) => ({ ...h, enabled: false })),
    });
    expect(text).not.toContain("Standing rules");
  });
});
