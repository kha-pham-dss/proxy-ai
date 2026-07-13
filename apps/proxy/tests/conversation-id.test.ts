import { describe, expect, it } from "vitest";
import { resolveConversationId } from "../src/conversation-id.js";

describe("resolveConversationId", () => {
  it("prefers x-conversation-id header", () => {
    const id = resolveConversationId({
      headers: { "x-conversation-id": "abc" },
      body: { conversation_id: "other" },
    });
    expect(id).toBe("abc");
  });

  it("uses body conversation_id", () => {
    const id = resolveConversationId({
      headers: {},
      body: { conversation_id: "from-body" },
    });
    expect(id).toBe("from-body");
  });

  it("fingerprints from first user message", () => {
    const id = resolveConversationId({
      headers: {},
      body: { messages: [{ role: "user", content: "Hello world project" }] },
      clientHint: "cursor",
    });
    expect(id.startsWith("fp-")).toBe(true);
  });
});
