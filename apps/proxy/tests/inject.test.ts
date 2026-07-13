import { describe, expect, it } from "vitest";
import { LTM_MARKER_END, LTM_MARKER_START } from "@proxy-cli/proto";
import { ensureLtmInject, ensureLtmInInstructions } from "../src/inject.js";

const block = `${LTM_MARKER_START}\n# memory\n${LTM_MARKER_END}`;

describe("ensureLtmInject", () => {
  it("inserts system message when missing", () => {
    const out = ensureLtmInject([{ role: "user", content: "hi" }], block);
    expect(out[0]?.role).toBe("system");
    expect(String(out[0]?.content)).toContain(LTM_MARKER_START);
  });

  it("replaces existing LTM block idempotently", () => {
    const old = `${LTM_MARKER_START}\nold\n${LTM_MARKER_END}`;
    const out = ensureLtmInject(
      [{ role: "system", content: `rules\n${old}` }, { role: "user", content: "hi" }],
      block,
    );
    const content = String(out[0]?.content);
    expect(content).toContain("# memory");
    expect(content).not.toContain("old");
    expect(content.match(new RegExp(LTM_MARKER_START, "g"))?.length).toBe(1);
  });
});

describe("ensureLtmInInstructions", () => {
  it("appends when no markers", () => {
    expect(ensureLtmInInstructions("be concise", block)).toContain("be concise");
    expect(ensureLtmInInstructions("be concise", block)).toContain(LTM_MARKER_START);
  });
});
