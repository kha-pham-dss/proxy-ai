import { describe, expect, it } from "vitest";
import { redactText } from "./index.js";

describe("redactText", () => {
  it("redacts openai-style keys", () => {
    expect(redactText("key sk-abcdefghijklmnopqrstuvwxyz1234")).toContain("[REDACTED_KEY]");
  });

  it("redacts anthropic keys", () => {
    expect(redactText("sk-ant-api03-abcdefghijklmnop")).toContain("[REDACTED_KEY]");
  });

  it("redacts absolute user paths", () => {
    expect(redactText("open /Users/alice/secret/repo")).toContain("[PATH]");
    expect(redactText("open C:\\Users\\alice\\secret")).toContain("[PATH]");
  });

  it("redacts env assignments", () => {
    expect(redactText("OPENAI_API_KEY=sk-test-should-hide-this-value")).toMatch(
      /OPENAI_API_KEY=\[REDACTED/,
    );
  });

  it("leaves ordinary coding text alone", () => {
    const text = "Prefer TypeScript and NestJS patterns in this repo.";
    expect(redactText(text)).toBe(text);
  });
});
